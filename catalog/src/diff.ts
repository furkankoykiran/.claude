/**
 * Catalog diff: classify every change vs a base catalog (typically the previous
 * release's skills-catalog.json). Output drives both the change report and the
 * SemVer classifier / auto-merge gate.
 *
 * Renames are detected by matching digests: a removed invocation whose digest
 * matches an added invocation is a rename, not an add+remove.
 */
import type { Catalog, CatalogSkillEntry, SecurityProfile } from "./types.ts";
import {
  capabilityEscalations,
  presentCapabilities,
  buildSecurityProfile,
  ESCALATION_CAPABILITIES,
} from "./security.ts";

export type ChangeKind = "added" | "updated" | "removed" | "renamed";

/**
 * More changed entries than this in a single diff is treated as a mass change
 * and forces manual review regardless of per-skill classification. A routine
 * daily upstream bump touches a handful of skills; a batch this large means a
 * source restructured, a selection changed, or a resolver bug — always worth a
 * human look before it auto-merges.
 *
 * Not applied when there is no base catalog (the bootstrap diff legitimately
 * reports every skill as added).
 */
export const MASS_CHANGE_THRESHOLD = 25;

export interface DiffChange {
  key: string;
  kind: ChangeKind;
  sourceId?: string;
  oldInvocation?: string;
  detail?: string;
  securitySensitive: boolean;
  manualReviewRequired: boolean;
  /** Why review is required. Capability names only — never secret material. */
  reasons: string[];
}

export interface DiffReport {
  schemaVersion: number;
  base: string | null;
  summary: {
    added: number;
    updated: number;
    removed: number;
    renamed: number;
    licenseRestricted: number;
    runtimeOnly: number;
    securitySensitive: number;
    manualReviewRequired: boolean;
    /** True when the batch exceeded MASS_CHANGE_THRESHOLD. */
    massChange: boolean;
    /** Deduplicated, sorted union of every per-change reason. */
    reviewReasons: string[];
  };
  changes: DiffChange[];
}

/**
 * The previous security profile for a skill.
 *
 * Prefer the profile persisted in the base catalog: it was computed from the
 * real body and directory listing at the time. The fallback reconstructs a
 * partial profile from frontmatter alone and is ONLY for base catalogs written
 * before `security` was persisted (schemaVersion < 1 entries / hand-written
 * fixtures). The fallback cannot see the body or file list, so it under-reports
 * body-derived capabilities — which makes it fail SAFE (more escalations
 * reported, never fewer).
 */
export function previousSecurityProfile(prev: CatalogSkillEntry): SecurityProfile {
  if (prev.security && typeof prev.security === "object") return prev.security;
  return buildSecurityProfile((prev.frontmatter ?? {}) as Record<string, unknown>, "", [], "");
}

/** Normalize a repo URL so trivial formatting differences are not "identity changes". */
export function normalizeRepo(r: string | undefined): string {
  return (r ?? "")
    .trim()
    .replace(/^git\+/, "")
    .replace(/^ssh:\/\/git@/, "https://")
    .replace(/^git@([^:]+):/, "https://$1/")
    .replace(/\.git$/, "")
    .replace(/\/+$/, "")
    .toLowerCase();
}

const normList = (v: string[] | undefined): string => [...(v ?? [])].map((s) => s.trim()).sort().join(",");

/**
 * The policy-relevant projection of a catalog entry.
 *
 * A skill is NOT unchanged merely because its content digest is unchanged: the
 * same bytes can be re-pointed at a different repository, relocated, downgraded
 * to metadata-only, or have its detected license change underneath it. Every
 * field here is compared independently of the digest.
 *
 * `resolvedRevision` is deliberately absent. Advancing a pinned SHA while
 * content and every policy field stay identical is a bookkeeping change, not a
 * supply-chain event, and gating on it would make every upstream bump require
 * review.
 */
export interface PolicyView {
  repo: string;
  sourceId: string;
  sourceType: string;
  relativePath: string;
  redistribution: string;
  licenseDeclared: string;
  licenseDetected: string;
  licenseMatchesDeclaration: boolean;
  allowedTools: string;
  disallowedTools: string;
  security: SecurityProfile;
}

export function policyView(e: CatalogSkillEntry): PolicyView {
  return {
    repo: normalizeRepo(e.repo),
    sourceId: e.sourceId ?? "",
    sourceType: e.sourceType ?? "",
    relativePath: (e.relativePath ?? "").trim(),
    redistribution: e.redistribution ?? "",
    licenseDeclared: e.license?.declared ?? "",
    licenseDetected: e.license?.detected ?? "",
    licenseMatchesDeclaration: e.license?.matchesDeclaration ?? false,
    allowedTools: normList(e.allowedTools),
    disallowedTools: normList(e.disallowedTools),
    security: e.security,
  };
}

/**
 * Policy fields that differ between two entries, excluding the security
 * profile (which has its own capability-aware comparison). Sorted and stable.
 */
export function changedPolicyFields(prev: CatalogSkillEntry, cur: CatalogSkillEntry): string[] {
  const a = policyView(prev);
  const b = policyView(cur);
  const out: string[] = [];
  for (const k of Object.keys(a) as Array<keyof PolicyView>) {
    if (k === "security") continue;
    if (a[k] !== b[k]) out.push(k);
  }
  return out.sort();
}

/** True when any security-profile field differs at all (not only escalations). */
export function securityProfileChanged(prev: CatalogSkillEntry, cur: CatalogSkillEntry): boolean {
  const a = previousSecurityProfile(prev);
  const b = cur.security;
  if (!a || !b) return false;
  return (
    ESCALATION_CAPABILITIES.some((c) => c.read(a) !== c.read(b)) || a.toolCount !== b.toolCount
  );
}

function indexBy(catalog: Catalog | null): Map<string, CatalogSkillEntry> {
  const m = new Map<string, CatalogSkillEntry>();
  if (!catalog) return m;
  for (const s of catalog.skills) m.set(s.canonicalInvocation, s);
  return m;
}

/**
 * Manual-review policy. A change auto-merges only when NONE of these apply.
 *
 * Newly added skill — any capability surface at all:
 *   credential reference, executable/binary, hooks, MCP/LSP, agents,
 *   dynamic shell, Bash/PowerShell, network access, hidden files.
 * Updated skill:
 *   a capability that was absent before and is present now, an expanded tool
 *   surface, a redistribution downgrade, a detected-license change, or a
 *   repository/source identity change (including one appearing or disappearing).
 * Removed / renamed skill:
 *   always — a skill vanishing or changing its public invocation is a
 *   supply-chain and API event, never routine.
 *
 * Returns the reasons; empty means routine.
 */
function reviewReasonsFor(
  cur: CatalogSkillEntry | undefined,
  prev: CatalogSkillEntry | undefined,
  kind: ChangeKind,
): string[] {
  if (kind === "removed") return ["skill-removed"];
  if (kind === "renamed") return ["skill-renamed"];
  if (!cur) return ["unclassifiable-change"];

  if (!prev) {
    // Newly added skill: gate on any capability it carries.
    return presentCapabilities(cur.security).map((c) => `new-skill-capability:${c}`);
  }

  const reasons = capabilityEscalations(previousSecurityProfile(prev), cur.security).map(
    (c) => `capability-introduced:${c}`,
  );

  // One authoritative policy comparison drives the diff JSON, the markdown
  // report, the PR summary, the release bump, and the merge decision.
  const changed = new Set(changedPolicyFields(prev, cur));

  if (prev.redistribution === "full" && cur.redistribution === "metadata-only") {
    reasons.push("redistribution-downgraded");
  } else if (changed.has("redistribution")) {
    reasons.push(`redistribution-changed:${prev.redistribution}->${cur.redistribution}`);
  }
  if (changed.has("licenseDetected")) {
    reasons.push(`license-changed:${prev.license?.detected}->${cur.license?.detected}`);
  }
  if (changed.has("licenseDeclared")) {
    reasons.push(`license-declaration-changed:${prev.license?.declared}->${cur.license?.declared}`);
  }
  if (changed.has("licenseMatchesDeclaration")) {
    reasons.push("license-declaration-match-changed");
  }
  if (changed.has("repo")) reasons.push("source-identity-changed");
  // Ownership/location moves: same bytes, different provenance.
  for (const f of ["sourceId", "sourceType", "relativePath"] as const) {
    if (changed.has(f)) reasons.push(`policy-changed:${f}`);
  }
  // Tool surface can shrink (routine) or change composition (reviewable) with
  // an unchanged count, which the capability check alone would miss.
  for (const f of ["allowedTools", "disallowedTools"] as const) {
    if (changed.has(f) && !reasons.some((r) => r.startsWith("tool-surface"))) {
      reasons.push(`policy-changed:${f}`);
    }
  }
  return [...new Set(reasons)].sort();
}

export function diffCatalogs(current: Catalog, base: Catalog | null, baseName: string | null): DiffReport {
  const curIdx = indexBy(current);
  const baseIdx = indexBy(base);

  const changes: DiffChange[] = [];
  let licenseRestricted = 0;
  let runtimeOnly = 0;

  for (const cur of [...curIdx.values()].sort((a, b) => a.canonicalInvocation.localeCompare(b.canonicalInvocation))) {
    if (cur.redistribution === "metadata-only" && cur.digest === "") runtimeOnly++;
    if (cur.redistribution === "metadata-only") licenseRestricted++;
    const prev = baseIdx.get(cur.canonicalInvocation);
    if (!prev) {
      // Could be a rename (digest exists in a removed entry).
      continue; // handled below
    }
    // An entry is "updated" when its CONTENT changed OR any policy-relevant
    // field changed. Digest equality alone is not evidence of no change: the
    // same bytes can be re-pointed at a different repository, relocated,
    // downgraded to metadata-only, or have their licence change underneath.
    const contentChanged = prev.digest !== cur.digest;
    const policyFields = changedPolicyFields(prev, cur);
    const securityChanged = securityProfileChanged(prev, cur);
    if (contentChanged || policyFields.length > 0 || securityChanged) {
      const reasons = reviewReasonsFor(cur, prev, "updated");
      const detail = contentChanged
        ? `digest ${prev.digest.slice(0, 10)} -> ${cur.digest.slice(0, 10)}`
        : `metadata-only change (digest unchanged): ${[...policyFields, ...(securityChanged ? ["security"] : [])].join(", ")}`;
      changes.push({
        key: cur.canonicalInvocation,
        kind: "updated",
        sourceId: cur.sourceId,
        detail,
        securitySensitive: reasons.some((r) => r.startsWith("capability-introduced:")),
        manualReviewRequired: reasons.length > 0,
        reasons,
      });
    }
  }

  // Adds and removes (with rename detection by digest).
  const added = [...curIdx.keys()].filter((k) => !baseIdx.has(k));
  const removed = [...baseIdx.keys()].filter((k) => !curIdx.has(k));
  const matchedRemoved = new Set<string>();

  for (const addKey of added.sort()) {
    const cur = curIdx.get(addKey)!;
    // Find a removed entry with the same digest (rename).
    const renameFrom = removed.find((rk) => !matchedRemoved.has(rk) && baseIdx.get(rk)?.digest === cur.digest && cur.digest !== "");
    if (renameFrom) {
      matchedRemoved.add(renameFrom);
      const reasons = reviewReasonsFor(cur, baseIdx.get(renameFrom), "renamed");
      changes.push({
        key: addKey,
        kind: "renamed",
        sourceId: cur.sourceId,
        oldInvocation: renameFrom,
        detail: `renamed from ${renameFrom} (digest unchanged)`,
        securitySensitive: false,
        manualReviewRequired: reasons.length > 0,
        reasons,
      });
    } else {
      const reasons = reviewReasonsFor(cur, undefined, "added");
      changes.push({
        key: addKey,
        kind: "added",
        sourceId: cur.sourceId,
        securitySensitive: reasons.length > 0,
        manualReviewRequired: reasons.length > 0,
        reasons,
      });
    }
  }
  for (const rmKey of removed.sort()) {
    if (matchedRemoved.has(rmKey)) continue;
    const prev = baseIdx.get(rmKey)!;
    const reasons = reviewReasonsFor(undefined, prev, "removed");
    changes.push({
      key: rmKey,
      kind: "removed",
      sourceId: prev.sourceId,
      securitySensitive: false,
      manualReviewRequired: reasons.length > 0,
      reasons,
    });
  }

  changes.sort((a, b) => a.key.localeCompare(b.key));

  // A mass change forces review on its own. Not applied to the bootstrap diff
  // (no base), where "every skill is added" is the expected, correct answer.
  const massChange = base !== null && changes.length > MASS_CHANGE_THRESHOLD;
  const reviewReasons = [...new Set(changes.flatMap((c) => c.reasons))].sort();
  if (massChange) reviewReasons.push(`mass-change:${changes.length}>${MASS_CHANGE_THRESHOLD}`);

  const summary = {
    added: changes.filter((c) => c.kind === "added").length,
    updated: changes.filter((c) => c.kind === "updated").length,
    removed: changes.filter((c) => c.kind === "removed").length,
    renamed: changes.filter((c) => c.kind === "renamed").length,
    licenseRestricted,
    runtimeOnly,
    securitySensitive: changes.filter((c) => c.securitySensitive).length,
    manualReviewRequired: massChange || changes.some((c) => c.manualReviewRequired),
    massChange,
    reviewReasons,
  };

  return { schemaVersion: 2, base: baseName, summary, changes };
}