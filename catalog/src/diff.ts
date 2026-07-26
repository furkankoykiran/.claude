/**
 * Catalog diff: classify every change vs a base catalog (typically the previous
 * release's skills-catalog.json). Output drives both the change report and the
 * SemVer classifier / auto-merge gate.
 *
 * Renames are detected by matching digests: a removed invocation whose digest
 * matches an added invocation is a rename, not an add+remove.
 */
import type { Catalog, CatalogSkillEntry, SecurityProfile } from "./types.ts";
import { capabilityEscalations, presentCapabilities, buildSecurityProfile } from "./security.ts";

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
function normalizeRepo(r: string | undefined): string {
  return (r ?? "").trim().replace(/\.git$/, "").replace(/\/+$/, "").toLowerCase();
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
  if (prev.redistribution === "full" && cur.redistribution === "metadata-only") {
    reasons.push("redistribution-downgraded");
  }
  const prevDetected = prev.license?.detected;
  const curDetected = cur.license?.detected;
  if (prevDetected !== undefined && curDetected !== undefined && prevDetected !== curDetected) {
    reasons.push(`license-changed:${prevDetected}->${curDetected}`);
  }
  if (normalizeRepo(prev.repo) !== normalizeRepo(cur.repo)) {
    reasons.push("source-identity-changed");
  }
  return reasons.sort();
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
    if (prev.digest !== cur.digest) {
      const reasons = reviewReasonsFor(cur, prev, "updated");
      changes.push({
        key: cur.canonicalInvocation,
        kind: "updated",
        sourceId: cur.sourceId,
        detail: `digest ${prev.digest.slice(0, 10)} -> ${cur.digest.slice(0, 10)}`,
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