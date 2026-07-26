#!/usr/bin/env bun
/**
 * Which tag on a commit counts as "this commit is already released"?
 *
 *   bun run catalog/src/tag-policy.ts <tag> [<tag> ...]
 *
 * Prints the selected tag, or `none`. Exits non-zero with a message on stderr
 * when the tags on HEAD are ambiguous or malformed.
 *
 * `git tag --points-at HEAD | head -1` was none of this: it accepted any tag
 * (a stray `latest` or `nightly` would be mistaken for a release), and with
 * more than one tag it picked whichever git listed first.
 */
import { parseTag } from "./semver.ts";

export interface TagSelection {
  /** The single project release tag on the commit, or null when unreleased. */
  tag: string | null;
  /** Set when the tag set is ambiguous or malformed; the caller must fail. */
  error?: string;
}

/** Tags that look like a project release tag and so must parse as SemVer. */
const PROJECT_TAG = /^v/;

export function selectReleaseTag(tagsOnHead: string[]): TagSelection {
  // Non-project tags (release candidates from elsewhere, `latest`, moving
  // pointers) are ignored rather than treated as releases.
  const candidates = [...new Set(tagsOnHead.map((t) => t.trim()).filter(Boolean))]
    .filter((t) => PROJECT_TAG.test(t))
    .sort();

  if (candidates.length === 0) return { tag: null };

  const malformed = candidates.filter((t) => parseTag(t) === null);
  if (malformed.length > 0) {
    return {
      tag: null,
      error:
        `malformed project tag(s) on this commit: ${malformed.join(", ")}. ` +
        `Project release tags must be vMAJOR.MINOR.PATCH. Delete or rename them, then re-run.`,
    };
  }

  if (candidates.length > 1) {
    return {
      tag: null,
      error:
        `conflicting release tags on this commit: ${candidates.join(", ")}. ` +
        `Exactly one project release tag may point at a released commit. ` +
        `Remove the incorrect tag(s) before re-running.`,
    };
  }

  return { tag: candidates[0]! };
}

if (import.meta.main) {
  const r = selectReleaseTag(process.argv.slice(2));
  if (r.error) {
    process.stderr.write(r.error + "\n");
    process.exit(1);
  }
  process.stdout.write((r.tag ?? "none") + "\n");
}