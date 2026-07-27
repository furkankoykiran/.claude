/**
 * Release tag parsing.
 *
 * Releases are tagged `v$(cat VERSION)`. VERSION is the single version source of
 * truth — it is also what every plugin.json and marketplace entry carries — so
 * there is nothing here to *compute*, only to validate.
 *
 * The bump a range requires is derived in catalog/src/release-notes.ts, from the
 * commits plus the catalog diff. This module used to compute the next tag from
 * the diff alone, with `release:major|minor|patch` PR labels as an override;
 * both are gone, because a maintainer who wants a larger bump now simply writes
 * a larger VERSION and every artefact follows.
 */

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
