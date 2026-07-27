/**
 * Release notes, derived — never hand-maintained.
 *
 * WHY THIS REPLACED THE CHANGELOG
 * -------------------------------
 * CHANGELOG.md carried a permanent `## [Unreleased]` section that every change
 * had to be hand-edited into. Nothing consumed it: the release workflow built
 * its notes from the catalog diff and never read the file. So the repository
 * had two release-note sources, one of which was pure manual overhead and
 * quietly drifted from what actually shipped.
 *
 * There is now one source: the commits. This module turns a commit range into
 * categorised release notes, merges in what the catalog diff says about skill
 * content, and the release workflow publishes the result as the GitHub Release
 * body. Nothing to remember, nothing to keep in sync.
 *
 * It also answers the question the workflow needs before tagging: given what
 * landed since the last release, what is the LOWEST version that may be
 * published? VERSION is the single source of truth for both plugin manifests
 * and release tags, so a bump that is too small has to fail loudly rather than
 * ship plugins under a version that understates what changed.
 */
import { readFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import type { DiffReport } from "./diff.ts";
import { CatalogError } from "./types.ts";

export interface Commit {
  sha: string;
  shortSha: string;
  subject: string;
  body: string;
  files: string[];
}

export interface ParsedCommit extends Commit {
  type: string | null;
  scope: string | null;
  description: string;
  breaking: boolean;
}

export type Category =
  | "breaking"
  | "features"
  | "fixes"
  | "security"
  | "sources"
  | "other";

export const CATEGORY_TITLES: Record<Category, string> = {
  breaking: "Breaking changes",
  features: "Features",
  fixes: "Fixes",
  security: "Security",
  sources: "Dependencies and upstream sources",
  other: "Other changes",
};

/** Order sections appear in the notes. */
export const CATEGORY_ORDER: Category[] = [
  "breaking",
  "security",
  "features",
  "fixes",
  "sources",
  "other",
];

const CONVENTIONAL = /^(?<type>[a-z]+)(?:\((?<scope>[^)]+)\))?(?<bang>!)?:\s*(?<desc>.+)$/;

/** Parse one commit subject/body into Conventional Commit parts. */
export function parseCommit(c: Commit): ParsedCommit {
  const m = CONVENTIONAL.exec(c.subject);
  // Conventional Commits defines `BREAKING CHANGE:` / `BREAKING-CHANGE:`. A bare
  // `BREAKING:` is accepted too: it is a common shorthand, and mis-reading it as
  // breaking only ever raises the required bump, which is the safe direction.
  const breakingFooter = /^BREAKING(?:[ -]CHANGE)?:/m.test(c.body);
  if (!m?.groups) {
    return { ...c, type: null, scope: null, description: c.subject, breaking: breakingFooter };
  }
  return {
    ...c,
    type: m.groups["type"]!,
    scope: m.groups["scope"] ?? null,
    description: m.groups["desc"]!,
    breaking: Boolean(m.groups["bang"]) || breakingFooter,
  };
}

const SOURCE_SCOPES = new Set(["deps", "dependencies", "skills", "sources", "catalog-sources"]);

/**
 * Which section a commit belongs in.
 *
 * Breaking wins over everything: a breaking fix is a breaking change first, and
 * burying it under "Fixes" is how upgrade surprises happen.
 */
export function categorize(c: ParsedCommit): Category {
  if (c.breaking) return "breaking";
  if (c.type === "security" || (c.scope !== null && /security/i.test(c.scope))) return "security";
  if (c.type === "feat") return "features";
  if (c.type === "fix") return "fixes";
  if (c.scope !== null && SOURCE_SCOPES.has(c.scope.toLowerCase())) return "sources";
  if (c.type === "build" || c.type === "deps") return "sources";
  return "other";
}

function git(args: string[], cwd: string): string {
  const r = spawnSync("git", args, { cwd, encoding: "utf8", maxBuffer: 64 * 1024 * 1024 });
  if (r.status !== 0) throw new CatalogError(`git ${args.join(" ")} failed: ${r.stderr.trim()}`, "<git>");
  return r.stdout;
}

/**
 * Read commits in (from, to]. `from` may be null for the first release, in
 * which case the whole history is used.
 */
export function readCommits(repoRoot: string, from: string | null, to = "HEAD"): Commit[] {
  const range = from ? `${from}..${to}` : to;
  // Delimiters git passes through verbatim that cannot appear in a commit
  // message. Written as escapes, not literal control characters, so they
  // survive copy/paste and editors that strip unprintables.
  const REC = "\u0001COMMIT\u0001";
  const FIELD = "\u0002BODY\u0002";
  const out = git(["log", range, `--format=${REC}%H%n%h%n%s%n%b%n${FIELD}`, "--name-only"], repoRoot);
  const commits: Commit[] = [];
  for (const chunk of out.split(REC)) {
    if (!chunk.trim()) continue;
    const [head, tail = ""] = chunk.split(FIELD);
    const lines = head!.split("\n");
    const sha = lines[0]!.trim();
    const shortSha = lines[1]!.trim();
    const subject = lines[2] ?? "";
    const body = lines.slice(3).join("\n").trim();
    const files = tail.split("\n").map((s) => s.trim()).filter(Boolean);
    if (sha) commits.push({ sha, shortSha, subject, body, files });
  }
  return commits;
}

/**
 * Migration scripts introduced in this range.
 *
 * A migration is a property of the RELEASE, not of one commit — the commit that
 * carries it is usually a feature or a fix and belongs in that section. Users
 * need to know a migration will run; hiding that inside a commit list does not
 * tell them.
 */
export function migrationsIn(commits: Commit[]): string[] {
  const seen = new Set<string>();
  for (const c of commits) {
    for (const f of c.files) {
      if (/^migrations\/\d{4}-[a-z0-9-]+\.sh$/.test(f)) seen.add(f);
    }
  }
  return [...seen].sort();
}

export interface Grouped {
  category: Category;
  commits: ParsedCommit[];
}

export function groupCommits(commits: Commit[]): Grouped[] {
  const parsed = commits.map(parseCommit);
  const buckets = new Map<Category, ParsedCommit[]>();
  for (const c of parsed) {
    const cat = categorize(c);
    if (!buckets.has(cat)) buckets.set(cat, []);
    buckets.get(cat)!.push(c);
  }
  return CATEGORY_ORDER.filter((c) => buckets.has(c)).map((category) => ({
    category,
    commits: buckets.get(category)!,
  }));
}

export type Bump = "major" | "minor" | "patch" | "none";

/** The smallest bump that honestly describes this range. */
export function requiredBump(groups: Grouped[], diff: DiffReport | null): Bump {
  const has = (c: Category) => groups.some((g) => g.category === c && g.commits.length > 0);
  if (has("breaking")) return "major";
  // A removed or renamed public invocation breaks whoever was calling it.
  if (diff && (diff.summary.removed > 0 || diff.summary.renamed > 0)) return "major";
  if (has("features") || (diff && diff.summary.added > 0)) return "minor";
  if (groups.some((g) => g.commits.length > 0)) return "patch";
  if (diff && diff.summary.updated > 0) return "patch";
  return "none";
}

export interface SemVer {
  major: number;
  minor: number;
  patch: number;
}

export function parseVersion(v: string): SemVer | null {
  const m = /^v?(\d+)\.(\d+)\.(\d+)$/.exec(v.trim());
  if (!m) return null;
  return { major: Number(m[1]), minor: Number(m[2]), patch: Number(m[3]) };
}

export function formatVersion(v: SemVer): string {
  return `${v.major}.${v.minor}.${v.patch}`;
}

/** Apply a bump. Below 1.0.0 a "major" break moves the minor, per SemVer §4. */
export function applyBump(base: SemVer, bump: Bump): SemVer {
  switch (bump) {
    case "major":
      return base.major === 0
        ? { major: 0, minor: base.minor + 1, patch: 0 }
        : { major: base.major + 1, minor: 0, patch: 0 };
    case "minor":
      return { major: base.major, minor: base.minor + 1, patch: 0 };
    case "patch":
      return { major: base.major, minor: base.minor, patch: base.patch + 1 };
    case "none":
      return base;
  }
}

export function compareVersions(a: SemVer, b: SemVer): number {
  return a.major - b.major || a.minor - b.minor || a.patch - b.patch;
}

export interface VersionVerdict {
  previous: string | null;
  declared: string;
  minimum: string;
  bump: Bump;
  ok: boolean;
  reason: string;
}

/**
 * Is the VERSION in the tree high enough for what landed?
 *
 * Contributors bump one line; this is what tells them which line to write, and
 * refuses the release when they got it wrong.
 */
export function checkVersion(
  declared: string,
  previousTag: string | null,
  groups: Grouped[],
  diff: DiffReport | null,
): VersionVerdict {
  const dec = parseVersion(declared);
  if (!dec) {
    throw new CatalogError(`VERSION must be MAJOR.MINOR.PATCH (got "${declared}")`, "VERSION");
  }
  const prev = previousTag ? parseVersion(previousTag) : null;
  const bump = requiredBump(groups, diff);

  if (!prev) {
    return {
      previous: null,
      declared,
      minimum: declared,
      bump,
      ok: true,
      reason: "no previous release; VERSION is accepted as the first release",
    };
  }

  if (bump === "none") {
    return {
      previous: formatVersion(prev),
      declared,
      minimum: formatVersion(prev),
      bump,
      ok: true,
      reason: "nothing released-worthy in this range",
    };
  }

  const minimum = applyBump(prev, bump);
  const ok = compareVersions(dec, minimum) >= 0;
  return {
    previous: formatVersion(prev),
    declared,
    minimum: formatVersion(minimum),
    bump,
    ok,
    reason: ok
      ? `VERSION ${declared} covers the required ${bump} bump`
      : `this range needs a ${bump} bump: VERSION must be at least ${formatVersion(minimum)}, but says ${declared}`,
  };
}

export interface VersionPlan {
  previous: string | null;
  declared: string;
  minimum: string;
  next: string;
  bump: Bump;
  raised: boolean;
  reason: string;
}

/**
 * The VERSION this range should carry.
 *
 * checkVersion asks "is the declared VERSION big enough?" — a question the
 * release only gets to ask after the merge, which is too late for an automated
 * PR: the bot has already landed a catalog change it never bumped for, and main
 * is un-releasable until a human fixes it by hand. This answers the same
 * question one step earlier and returns the value to write.
 *
 * Never lowers VERSION. A VERSION already past the minimum is a deliberate bump
 * someone made for a change that has not been released yet; clamping it down to
 * the minimum would silently undo that and understate the next release.
 */
export function nextVersion(
  declared: string,
  previousTag: string | null,
  groups: Grouped[],
  diff: DiffReport | null,
): VersionPlan {
  // Validates `declared` and derives the minimum; throws on non-semver.
  const verdict = checkVersion(declared, previousTag, groups, diff);
  const dec = parseVersion(declared)!;
  const min = parseVersion(verdict.minimum)!;
  const raised = compareVersions(min, dec) > 0;
  return {
    previous: verdict.previous,
    declared,
    minimum: verdict.minimum,
    next: raised ? verdict.minimum : declared,
    bump: verdict.bump,
    raised,
    reason: raised
      ? `raising VERSION ${declared} -> ${verdict.minimum} to cover the required ${verdict.bump} bump`
      : verdict.reason,
  };
}

export interface NotesOptions {
  version: string;
  migrations?: string[];
  previousTag: string | null;
  commitSha: string;
  repoUrl?: string;
  diff?: DiffReport | null;
  sourceRevisions?: Array<{ id: string; revision: string }>;
}

/** Render the GitHub Release body. */
export function renderNotes(groups: Grouped[], o: NotesOptions): string {
  const lines: string[] = [];
  const compare =
    o.repoUrl && o.previousTag
      ? `${o.repoUrl}/compare/${o.previousTag}...v${o.version}`
      : null;

  lines.push(`## v${o.version}`, "");
  if (o.previousTag) {
    lines.push(
      compare
        ? `Changes since [${o.previousTag}](${compare}).`
        : `Changes since ${o.previousTag}.`,
    );
  } else {
    lines.push("First release.");
  }
  lines.push("");

  if (groups.length === 0) {
    lines.push("_No commits in range._", "");
  }

  for (const g of groups) {
    lines.push(`### ${CATEGORY_TITLES[g.category]}`, "");
    for (const c of g.commits) {
      const scope = c.scope ? `**${c.scope}**: ` : "";
      lines.push(`- ${scope}${c.description} (${c.shortSha})`);
    }
    lines.push("");
  }

  if (o.migrations && o.migrations.length > 0) {
    lines.push("### Migrations", "");
    lines.push("`fkt update` runs these once, automatically:", "");
    for (const m of o.migrations) lines.push(`- \`${m.replace(/^migrations\//, "").replace(/\.sh$/, "")}\``);
    lines.push("");
  }

  if (o.diff) {
    const s = o.diff.summary;
    lines.push("### Skill catalog", "");
    lines.push(
      `- added: ${s.added} · updated: ${s.updated} · removed: ${s.removed} · renamed: ${s.renamed}`,
    );
    if (s.manualReviewRequired) {
      lines.push("- this release contains changes that required manual capability review");
    }
    lines.push("");
  }

  if (o.sourceRevisions && o.sourceRevisions.length > 0) {
    lines.push("### Upstream source revisions", "");
    for (const r of o.sourceRevisions) lines.push(`- ${r.id}: \`${r.revision.slice(0, 12)}\``);
    lines.push("");
  }

  lines.push("---", "", `Released from \`${o.commitSha.slice(0, 12)}\`.`);
  return lines.join("\n") + "\n";
}

// ---------------------------------------------------------------------------
// CLI
// ---------------------------------------------------------------------------

async function loadDiff(path: string | null): Promise<DiffReport | null> {
  if (!path || !existsSync(path)) return null;
  return JSON.parse(await readFile(path, "utf8")) as DiffReport;
}

async function loadSourceRevisions(repoRoot: string): Promise<Array<{ id: string; revision: string }>> {
  const p = join(repoRoot, "skills-source.lock.json");
  if (!existsSync(p)) return [];
  const lock = JSON.parse(await readFile(p, "utf8")) as {
    sources: Array<{ id: string; resolvedRevision?: string }>;
  };
  return lock.sources
    .filter((s) => s.resolvedRevision)
    .map((s) => ({ id: s.id, revision: s.resolvedRevision! }));
}

function arg(name: string): string | null {
  const i = process.argv.indexOf(name);
  return i >= 0 && process.argv[i + 1] ? process.argv[i + 1]! : null;
}

async function main(): Promise<void> {
  const repoRoot = join(import.meta.dirname, "..", "..");
  const mode = process.argv[2];
  const previousTag = arg("--previous");
  const diff = await loadDiff(arg("--diff"));
  const version = (await readFile(join(repoRoot, "VERSION"), "utf8")).trim();
  const commits = readCommits(repoRoot, previousTag, arg("--to") ?? "HEAD");
  // A caller that is ABOUT to commit (the catalog automation, deciding its own
  // VERSION before it has made the commit) has to reckon with that commit: the
  // release will see it and derive a bump floor from it, so a plan built
  // without it can come out a bump too low and strand main un-releasable.
  const pending = arg("--pending-commit");
  if (pending) {
    commits.push({ sha: "0".repeat(40), shortSha: "0000000", subject: pending, body: "", files: [] });
  }
  const groups = groupCommits(commits);

  if (mode === "check-version") {
    const verdict = checkVersion(version, previousTag, groups, diff);
    process.stdout.write(JSON.stringify(verdict, null, 2) + "\n");
    if (!verdict.ok) {
      process.stderr.write(`\nxx ${verdict.reason}\n`);
      process.stderr.write(`   Edit VERSION to ${verdict.minimum} (or higher) and regenerate:\n`);
      process.stderr.write(`     printf '${verdict.minimum}\\n' > VERSION && bun run marketplace:generate\n`);
      process.exit(1);
    }
    return;
  }

  if (mode === "next-version") {
    process.stdout.write(JSON.stringify(nextVersion(version, previousTag, groups, diff), null, 2) + "\n");
    return;
  }

  if (mode === "notes") {
    process.stdout.write(
      renderNotes(groups, {
        version,
        migrations: migrationsIn(commits),
        previousTag,
        commitSha: arg("--sha") ?? "HEAD",
        repoUrl: arg("--repo-url") ?? undefined,
        diff,
        sourceRevisions: await loadSourceRevisions(repoRoot),
      }),
    );
    return;
  }

  process.stderr.write(
    "usage: bun run catalog/src/release-notes.ts <notes|check-version|next-version> " +
      "[--previous vX.Y.Z] [--to REF] [--diff FILE] [--sha SHA] [--repo-url URL] " +
      "[--pending-commit SUBJECT]\n",
  );
  process.exit(mode ? 1 : 0);
}

if (import.meta.main) await main();