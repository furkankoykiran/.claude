/**
 * Catalog diff: classify every change vs a base catalog (typically the previous
 * release's skills-catalog.json). Output drives both the change report and the
 * SemVer classifier / auto-merge gate.
 *
 * Renames are detected by matching digests: a removed invocation whose digest
 * matches an added invocation is a rename, not an add+remove.
 */
import type { Catalog, CatalogSkillEntry } from "./types.ts";
import { isCapabilityEscalation, buildSecurityProfile } from "./security.ts";

export type ChangeKind = "added" | "updated" | "removed" | "renamed";

export interface DiffChange {
  key: string;
  kind: ChangeKind;
  sourceId?: string;
  oldInvocation?: string;
  detail?: string;
  securitySensitive: boolean;
  manualReviewRequired: boolean;
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
  };
  changes: DiffChange[];
}

function indexBy(catalog: Catalog | null): Map<string, CatalogSkillEntry> {
  const m = new Map<string, CatalogSkillEntry>();
  if (!catalog) return m;
  for (const s of catalog.skills) m.set(s.canonicalInvocation, s);
  return m;
}

/**
 * A change is manual-review-required when it introduces supply-chain risk that
 * must not auto-merge: a new source, a new hook/MCP/agent, a secret, an
 * executable/binary, or a license downgrade.
 */
function isManualReview(
  cur: CatalogSkillEntry,
  prev: CatalogSkillEntry | undefined,
  securityEscalation: boolean,
): boolean {
  if (!prev) {
    // Newly added skill: only escalate if it carries real risk surface.
    return (
      cur.security.hasCredentialRef ||
      cur.security.hasExecutable ||
      cur.security.hasHooks ||
      cur.security.hasMcpOrLsp
    );
  }
  // Updated skill.
  const licenseDowngraded = prev.redistribution === "full" && cur.redistribution === "metadata-only";
  return (
    securityEscalation ||
    licenseDowngraded ||
    (prev.repo !== undefined && cur.repo !== undefined && prev.repo !== cur.repo)
  );
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
      const escalation = isCapabilityEscalation(
        buildSecurityProfile(prev.frontmatter as Record<string, unknown>, "", [], ""),
        cur.security,
      );
      changes.push({
        key: cur.canonicalInvocation,
        kind: "updated",
        sourceId: cur.sourceId,
        detail: `digest ${prev.digest.slice(0, 10)} -> ${cur.digest.slice(0, 10)}`,
        securitySensitive: escalation,
        manualReviewRequired: isManualReview(cur, prev, escalation),
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
      changes.push({
        key: addKey,
        kind: "renamed",
        sourceId: cur.sourceId,
        oldInvocation: renameFrom,
        detail: `renamed from ${renameFrom} (digest unchanged)`,
        securitySensitive: false,
        manualReviewRequired: false,
      });
    } else {
      const mr = isManualReview(cur, undefined, false);
      changes.push({
        key: addKey,
        kind: "added",
        sourceId: cur.sourceId,
        securitySensitive: cur.security.hasCredentialRef || cur.security.hasExecutable || cur.security.hasHooks || cur.security.hasMcpOrLsp,
        manualReviewRequired: mr,
      });
    }
  }
  for (const rmKey of removed.sort()) {
    if (matchedRemoved.has(rmKey)) continue;
    const prev = baseIdx.get(rmKey)!;
    changes.push({
      key: rmKey,
      kind: "removed",
      sourceId: prev.sourceId,
      securitySensitive: false,
      manualReviewRequired: false,
    });
  }

  changes.sort((a, b) => a.key.localeCompare(b.key));
  const summary = {
    added: changes.filter((c) => c.kind === "added").length,
    updated: changes.filter((c) => c.kind === "updated").length,
    removed: changes.filter((c) => c.kind === "removed").length,
    renamed: changes.filter((c) => c.kind === "renamed").length,
    licenseRestricted,
    runtimeOnly,
    securitySensitive: changes.filter((c) => c.securitySensitive).length,
    manualReviewRequired: changes.some((c) => c.manualReviewRequired),
  };

  return { schemaVersion: 1, base: baseName, summary, changes };
}