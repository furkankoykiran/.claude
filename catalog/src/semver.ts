/**
 * Semantic Version classification and next-tag computation.
 *
 * Source of truth for releases is git tags (there is no tracked version file).
 * Rules (see docs/release-automation.md):
 *   - No prior tags            -> v0.1.0 (initial release)
 *   - Explicit PR label wins  -> release:major | release:minor | release:patch
 *                                 (exactly one allowed; more than one is an error)
 *   - Removed/renamed public   -> major, but minor while below 1.0.0
 *     invocation / schema break
 *   - Added public skill / new -> minor
 *     backward-compatible capability
 *   - Updated body/metadata/   -> patch
 *     sha/doc/resolver fix
 *   - No catalog change        -> none (no release)
 */
import { CatalogError } from "./types.ts";
import type { DiffReport } from "./diff.ts";

export type Bump = "major" | "minor" | "patch" | "none";

const TAG_RE = /^v(\d+)\.(\d+)\.(\d+)$/;

export interface SemVer {
  major: number;
  minor: number;
  patch: number;
}

export function parseTag(tag: string): SemVer | null {
  const m = TAG_RE.exec(tag);
  if (!m) return null;
  return { major: Number(m[1]), minor: Number(m[2]), patch: Number(m[3]) };
}

/** Validate explicit label overrides; return the single chosen bump or null. */
export function labelBump(labels: string[]): Bump | null {
  const present = labels.filter((l) =>
    ["release:major", "release:minor", "release:patch"].includes(l.trim().toLowerCase()),
  );
  if (present.length === 0) return null;
  if (present.length > 1) {
    throw new CatalogError(
      `conflicting release labels on the same PR: ${[...new Set(present)].join(", ")}`,
      "<semver>",
    );
  }
  return present[0]!.trim().toLowerCase().replace("release:", "") as Bump;
}

/** Infer a bump from the diff when no explicit label is present. */
export function inferBump(diff: DiffReport | null): Bump {
  if (!diff) return "patch";
  const s = diff.summary;
  if (s.added === 0 && s.updated === 0 && s.removed === 0 && s.renamed === 0) return "none";
  if (s.removed > 0 || s.renamed > 0) return "major";
  if (s.added > 0) return "minor";
  return "patch";
}

/**
 * Decide the next tag. Returns null when no release should be cut.
 * `hasPriorTags` collapses a pre-1.0 major to a minor bump.
 */
export function nextTag(
  latestTag: string | null,
  diff: DiffReport | null,
  labels: string[],
): { tag: string; bump: Bump } | null {
  // Initial release.
  if (!latestTag || !parseTag(latestTag)) {
    return { tag: "v0.1.0", bump: "minor" };
  }

  let bump = labelBump(labels) ?? inferBump(diff);
  if (bump === "none") return null;

  const cur = parseTag(latestTag)!;
  let { major, minor, patch } = cur;

  if (bump === "major") {
    if (major === 0) {
      // Below 1.0.0: a "major" catalog break still bumps minor.
      minor += 1;
      patch = 0;
      bump = "minor";
    } else {
      major += 1;
      minor = 0;
      patch = 0;
    }
  } else if (bump === "minor") {
    minor += 1;
    patch = 0;
  } else {
    patch += 1;
  }

  return { tag: `v${major}.${minor}.${patch}`, bump };
}