#!/usr/bin/env bun
/**
 * `bun run docs:check` — deterministic, offline documentation validation.
 *
 * Documentation rots silently: a file moves, a script is renamed, a link keeps
 * pointing at a path that no longer exists, and nothing fails until a user
 * follows it. This checks the claims documentation makes against the actual
 * repository. No network access, so it is safe as a required PR check.
 *
 * Validates:
 *   - every relative link and image target in tracked Markdown resolves;
 *   - heading anchors within the repository resolve;
 *   - every `bun run <script>` shown in docs exists in package.json;
 *   - the root layout documented in the README matches the real root;
 *   - nothing references a path that the restructure moved away;
 *   - no duplicate canonical documentation pages;
 *   - public docs carry no stale personal framing.
 */
import { readFileSync, existsSync, statSync } from "node:fs";
import { join, dirname, resolve, relative } from "node:path";
import { execFileSync } from "node:child_process";

const ROOT = resolve(import.meta.dir, "..", "..");

interface Problem { file: string; line: number; message: string }
const problems: Problem[] = [];
const problem = (file: string, line: number, message: string) => problems.push({ file, line, message });

function trackedFiles(): string[] {
  return execFileSync("git", ["ls-files"], { cwd: ROOT, encoding: "utf8" })
    .split("\n")
    .filter(Boolean);
}

/**
 * Tracked files PLUS untracked-but-not-ignored ones.
 *
 * Checking only tracked files means a brand-new document passes locally and
 * fails in CI the moment it is staged — which is exactly what happened when
 * docs/ was first split out.
 */
function candidateFiles(): string[] {
  const untracked = execFileSync("git", ["ls-files", "--others", "--exclude-standard"], {
    cwd: ROOT, encoding: "utf8",
  }).split("\n").filter(Boolean);
  return [...new Set([...trackedFiles(), ...untracked])].sort();
}

/** Markdown we author. Generated pages and vendored packs are not ours to lint. */
function docFiles(all: string[]): string[] {
  return all.filter(
    (f) =>
      f.endsWith(".md") &&
      !f.startsWith("docs/skills/") &&
      !f.startsWith("catalog/generated/") &&
      !f.startsWith("catalog/cache/") &&
      !f.startsWith("skills/") &&
      !f.startsWith("plugins/") &&
      !f.startsWith("agents/") &&
      !f.includes("/.") &&
      f !== "claude_code_skills.md",
  );
}

/** Strip fenced code blocks so examples are not linted as real links. */
function stripFences(md: string): string {
  return md.replace(/^```[\s\S]*?^```/gm, (m) => m.replace(/[^\n]/g, " "));
}

const slug = (heading: string): string =>
  heading
    .trim()
    .toLowerCase()
    .replace(/[`*_~]/g, "")
    .replace(/[^\w\s-]/g, "")
    .replace(/\s+/g, "-");

function headingsOf(path: string): Set<string> {
  if (!existsSync(join(ROOT, path))) return new Set();
  const out = new Set<string>();
  for (const line of stripFences(readFileSync(join(ROOT, path), "utf8")).split("\n")) {
    const m = /^#{1,6}\s+(.*)$/.exec(line);
    if (m) out.add(slug(m[1]!));
  }
  return out;
}

const LINK_RE = /!?\[[^\]]*\]\(([^)\s]+)(?:\s+"[^"]*")?\)/g;

function checkLinks(all: string[], docs: string[]): void {
  const headingCache = new Map<string, Set<string>>();
  for (const doc of docs) {
    const text = stripFences(readFileSync(join(ROOT, doc), "utf8"));
    const lines = text.split("\n");
    lines.forEach((line, i) => {
      for (const m of line.matchAll(LINK_RE)) {
        const raw = m[1]!;
        if (/^(https?:|mailto:|#|<)/.test(raw)) {
          // Same-file anchor.
          if (raw.startsWith("#")) {
            if (!headingCache.has(doc)) headingCache.set(doc, headingsOf(doc));
            if (!headingCache.get(doc)!.has(raw.slice(1).toLowerCase())) {
              problem(doc, i + 1, `anchor "${raw}" has no matching heading`);
            }
          }
          continue;
        }
        const [targetRaw, anchor] = raw.split("#");
        const target = decodeURIComponent(targetRaw!);
        if (!target) continue;
        const resolved = relative(ROOT, resolve(ROOT, dirname(doc), target));
        const abs = join(ROOT, resolved);
        if (!existsSync(abs)) {
          problem(doc, i + 1, `link target does not exist: ${target}`);
          continue;
        }
        if (anchor && statSync(abs).isFile() && abs.endsWith(".md")) {
          if (!headingCache.has(resolved)) headingCache.set(resolved, headingsOf(resolved));
          const set = headingCache.get(resolved)!;
          if (set.size > 0 && !set.has(anchor.toLowerCase())) {
            problem(doc, i + 1, `anchor "#${anchor}" not found in ${target}`);
          }
        }
      }
    });
  }
}

function checkScripts(docs: string[]): void {
  const pkg = JSON.parse(readFileSync(join(ROOT, "package.json"), "utf8")) as { scripts?: Record<string, string> };
  const scripts = new Set(Object.keys(pkg.scripts ?? {}));
  for (const doc of docs) {
    readFileSync(join(ROOT, doc), "utf8").split("\n").forEach((line, i) => {
      for (const m of line.matchAll(/\bbun run ([a-z][\w:-]*)/g)) {
        const name = m[1]!;
        // `bun run <path>.ts` is a direct file invocation, not a script name.
        if (name.includes(".")) continue;
        if (!scripts.has(name)) {
          problem(doc, i + 1, `documents "bun run ${name}" but package.json has no such script`);
        }
      }
    });
  }
}

/** Paths the restructure moved; documentation must not resurrect them. */
const MOVED: Array<[RegExp, string]> = [
  [/(^|[\s(`"])SKILLS_CATALOG\.md/, "catalog/generated/SKILLS_CATALOG.md"],
  [/(^|[\s(`"])skills-catalog\.json/, "catalog/generated/skills-catalog.json"],
  [/(^|[\s(`"])skills-catalog-diff\.json/, "catalog/generated/skills-catalog-diff.json"],
  [/(^|[\s(`"])catalog-change-report\.md/, "catalog/generated/catalog-change-report.md"],
];

function checkMovedPaths(docs: string[]): void {
  for (const doc of docs) {
    // CHANGELOG records history; past entries legitimately name old paths.
    if (doc === "CHANGELOG.md") continue;
    let section = "";
    readFileSync(join(ROOT, doc), "utf8").split("\n").forEach((line, i) => {
      const h = /^#{1,6}\s+(.*)$/.exec(line);
      if (h) section = h[1]!.toLowerCase();
      // Published release ASSET names are deliberately bare and are a
      // compatibility contract — they are not repository paths.
      if (/release asset/.test(section)) return;
      if (/asset|release download|sha256sum -c|SHA256SUMS/i.test(line)) return;
      for (const [re, better] of MOVED) {
        if (re.test(line) && !line.includes("catalog/generated/")) {
          problem(doc, i + 1, `references a moved path; use ${better}`);
        }
      }
    });
  }
}

function checkRootLayout(): void {
  const readme = join(ROOT, "README.md");
  if (!existsSync(readme)) { problem("README.md", 0, "missing"); return; }
  const text = readFileSync(readme, "utf8");
  const block = /<!-- root-layout:start -->([\s\S]*?)<!-- root-layout:end -->/.exec(text);
  if (!block) return; // Layout block is optional; only validated when present.

  const documented = new Set(
    [...block[1]!.matchAll(/^\s*([A-Za-z0-9._-]+\/?)\s{2,}/gm)].map((m) => m[1]!.replace(/\/$/, "")),
  );
  const tracked = trackedFiles();
  const realTop = new Set(tracked.map((f) => (f.includes("/") ? f.split("/")[0]! : f)));
  // Dotfiles are conventional and not worth enumerating in the README table.
  const notable = [...realTop].filter((e) => !e.startsWith("."));

  for (const entry of notable) {
    if (!documented.has(entry)) {
      problem("README.md", 0, `root entry "${entry}" exists but is not in the documented root layout`);
    }
  }
  for (const entry of documented) {
    if (!realTop.has(entry)) {
      problem("README.md", 0, `documented root entry "${entry}" does not exist`);
    }
  }
}

function checkNoDuplicateCanonicalPages(docs: string[]): void {
  const byTitle = new Map<string, string[]>();
  for (const doc of docs) {
    const first = readFileSync(join(ROOT, doc), "utf8").split("\n").find((l) => /^#\s+/.test(l));
    if (!first) continue;
    const t = slug(first.replace(/^#\s+/, ""));
    byTitle.set(t, [...(byTitle.get(t) ?? []), doc]);
  }
  for (const [title, files] of byTitle) {
    if (files.length > 1) {
      problem(files[1]!, 0, `duplicate canonical page "${title}" also at ${files[0]}`);
    }
  }
}

/** Public-facing docs must not be framed as one person's private setup. */
const PERSONAL = [
  /\bmy personal (dotfiles|setup|config)/i,
  /\bfurkan(?:'s)? (?:personal )?(?:dotfiles|setup)/i,
  /\bpersonal dotfiles repo(?:sitory)?\b/i,
];

function checkTone(): void {
  for (const doc of ["README.md", "docs/README.md"]) {
    if (!existsSync(join(ROOT, doc))) continue;
    readFileSync(join(ROOT, doc), "utf8").split("\n").forEach((line, i) => {
      for (const re of PERSONAL) {
        if (re.test(line)) problem(doc, i + 1, `public documentation uses personal framing: "${line.trim().slice(0, 70)}"`);
      }
    });
  }
}

function main(): void {
  const all = candidateFiles();
  const docs = docFiles(all);
  checkLinks(all, docs);
  checkScripts(docs);
  checkMovedPaths(docs);
  checkRootLayout();
  checkNoDuplicateCanonicalPages(docs);
  checkTone();

  if (problems.length === 0) {
    process.stdout.write(`docs:check OK (${docs.length} documents)\n`);
    return;
  }
  for (const p of problems.sort((a, b) => a.file.localeCompare(b.file) || a.line - b.line)) {
    process.stderr.write(`${p.file}:${p.line}: ${p.message}\n`);
  }
  process.stderr.write(`\ndocs:check FAILED: ${problems.length} problem(s) across ${docs.length} documents\n`);
  process.exit(1);
}

main();