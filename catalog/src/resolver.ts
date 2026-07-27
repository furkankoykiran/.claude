/**
 * The resolver.
 *
 * Three modes:
 *   - "update": network. Resolve moving refs, advance SHAs, (re)populate cache.
 *   - "lock":   use locked SHAs; populate cache from network only if a snapshot
 *               is missing. Idempotent when nothing changed.
 *   - "cache":  strictly offline. Read committed snapshots + lock only. Used by
 *               `catalog:generate` so generation never needs the network.
 *
 * The committed cache lives at catalog/cache/<sourceId>/<sha>/.snapshot.json and
 * holds parsed skill data (frontmatter always; body only when redistribution is
 * "full"). LICENSE/NOTICE are cached verbatim for attribution. Upstream content
 * is untrusted data: nothing is executed, hooks/LFS/submodules are disabled.
 */
import { readdir, readFile, stat, lstat, realpath, writeFile, mkdir, cp } from "node:fs/promises";
import { existsSync } from "node:fs";
import { join, relative, resolve, posix } from "node:path";
import type {
  GitSourceConfig,
  Lockfile,
  LockedSkill,
  LockedSource,
  Manifest,
  ResolvedSkill,
  SourceConfig,
} from "./types.ts";
import { CatalogError } from "./types.ts";
import { runGit, resolveRef, fetchAtSha, revParseHead } from "./git.ts";
import { parseSkillBytes, extractFields } from "./parser.ts";
import { digestBytes } from "./digest.ts";
import { finalSegment, personalInvocation, pluginInvocation, caseKey } from "./naming.ts";
import { detectLicense, verdict as licenseVerdict } from "./license.ts";
import { buildSecurityProfile, type DirFile } from "./security.ts";
import { info, warn } from "./log.ts";

export const RESOLVER_VERSION = "1";

export type ResolveMode = "update" | "lock" | "cache";

export interface ResolvedCatalog {
  manifest: Manifest;
  lock: Lockfile;
  skills: ResolvedSkill[];
  sourceMeta: Array<{
    id: string;
    type: SourceConfig["type"];
    displayName: string;
    pack: string;
    repo?: string;
    ref?: string;
    resolvedRevision?: string;
    skillCount: number;
    redistribution: "full" | "metadata-only";
    runtimeOnly: boolean;
  }>;
  warnings: string[];
}

interface SnapshotEntry {
  relPath: string;
  dirName: string;
  canonicalInvocation: string;
  namespacedInvocations: string[];
  digest: string;
  redistribution: "full" | "metadata-only";
  licenseDeclared: string;
  licenseDetected: string;
  frontmatter: Record<string, unknown>;
  rawFrontmatter: string;
  body: string | null; // null when metadata-only
  description?: string;
  whenToUse?: string;
  version?: string;
  allowedTools?: string[];
  disallowedTools?: string[];
  preambleTier?: number;
  security: ReturnType<typeof buildSecurityProfile>;
  warnings: string[];
}

interface Snapshot {
  sourceId: string;
  sha: string;
  repo: string;
  ref: string;
  licenseDeclared: string;
  licenseDetected: string;
  redistribution: "full" | "metadata-only";
  entries: SnapshotEntry[];
  /**
   * Every skill directory that EXISTS upstream under the selection root,
   * whether or not the selection picked it. Lets the coverage report name
   * upstream skills we have not opted into, instead of them being invisible.
   *
   * Optional: snapshots written before this field existed simply omit it, and
   * the coverage report reports "not recorded" rather than guessing.
   */
  availableSkillDirs?: string[];
}

// ---------------------------------------------------------------------------
// Filesystem helpers (with traversal + cycle guards)
// ---------------------------------------------------------------------------

function assertWithin(parent: string, child: string): void {
  // Listing the root itself (child === parent) is legitimate; only an escape
  // ABOVE the approved root (relative path starting with "..") is a violation.
  const rel = relative(parent, child);
  if (rel.startsWith("..")) {
    throw new CatalogError(`path traversal outside approved root: ${child}`, "<resolver>");
  }
}

function isBinaryBytes(bytes: Uint8Array): boolean {
  const n = Math.min(bytes.length, 8192);
  for (let i = 0; i < n; i++) if (bytes[i] === 0) return true;
  return false;
}

async function realpathSafe(p: string): Promise<string> {
  try {
    return await realpath(p);
  } catch {
    return resolve(p);
  }
}

/** Bounded recursive listing of files under `dir`, with exec/binary flags and cycle guards. */
async function listFiles(dir: string, root: string, depthLimit = 8, visited = new Set<string>()): Promise<DirFile[]> {
  if (depthLimit < 0) throw new CatalogError(`directory too deep (possible cycle): ${dir}`, "<resolver>");
  assertWithin(root, dir);
  const realDir = await realpathSafe(dir);
  if (visited.has(realDir)) throw new CatalogError(`symlink cycle detected at ${dir}`, "<resolver>");
  visited.add(realDir);
  let names: string[];
  try {
    names = await readdir(dir);
  } catch {
    return [];
  }
  const out: DirFile[] = [];
  for (const name of names.sort()) {
    const full = join(dir, name);
    let lst: Awaited<ReturnType<typeof lstat>>;
    try {
      lst = await lstat(full);
    } catch {
      continue;
    }
    if (lst.isSymbolicLink()) {
      // Follow only if the target stays inside the approved root; else flag + skip.
      let real: string;
      try {
        real = await realpath(full);
      } catch {
        out.push({ name, executable: false, isBinary: false });
        continue;
      }
      const rel = relative(root, real);
      if (rel.startsWith("..")) {
        out.push({ name, executable: false, isBinary: false });
        continue;
      }
      const rs = await stat(real).catch(() => null);
      if (!rs) continue;
      if (rs.isDirectory()) out.push(...(await listFiles(real, root, depthLimit - 1, visited)));
      else out.push({ name: relative(root, real), executable: (rs.mode & 0o111) !== 0, isBinary: false });
      continue;
    }
    if (lst.isDirectory()) {
      out.push(...(await listFiles(full, root, depthLimit - 1, visited)));
    } else if (lst.isFile()) {
      let executable = (lst.mode & 0o111) !== 0;
      let isBinary = false;
      if (executable || /\.(so|dylib|dll|exe|bin|wasm|zip|gz|tar|png|jpe?g|gif|woff2?|ttf|otf|mp[34])$/i.test(name)) {
        try {
          isBinary = isBinaryBytes(await readFile(full));
        } catch {
          /* ignore */
        }
      }
      out.push({ name: relative(root, full), executable, isBinary });
    }
  }
  return out;
}

/**
 * Every directory containing a SKILL.md that the selection COULD have picked,
 * i.e. the upstream candidate set before the selection filter is applied.
 * Used only for the coverage report; never affects what is cataloged.
 */
async function findAvailableSkillDirs(workRoot: string, cfg: GitSourceConfig): Promise<string[]> {
  const sel = cfg.selection;
  if (sel.kind === "subpath") {
    // The candidate set is the parent directory of the selected subpath.
    const parent = sel.path.split("/").slice(0, -1).join("/");
    const base = join(workRoot, parent);
    if (!existsSync(base)) return [];
    const names: string[] = [];
    for (const name of (await readdir(base).catch(() => [] as string[])).sort()) {
      if (existsSync(join(base, name, "SKILL.md"))) names.push(name);
    }
    return names;
  }
  if (sel.kind === "whole-repo") {
    return uniqueSorted((await scanForSkills(workRoot, workRoot)).map((d) => d.dirName));
  }
  const skillsRoot = join(workRoot, sel.root);
  if (!existsSync(skillsRoot)) return [];
  const names: string[] = [];
  for (const name of (await readdir(skillsRoot).catch(() => [] as string[])).sort()) {
    if (existsSync(join(skillsRoot, name, "SKILL.md"))) names.push(name);
  }
  return names;
}

/** Find skill directories under `rootDir/<selectionRoot>` matching the selection. */
async function findSkillDirs(
  workRoot: string,
  cfg: GitSourceConfig,
): Promise<Array<{ dirName: string; abs: string; rel: string }>> {
  const sel = cfg.selection;
  const found: Array<{ dirName: string; abs: string; rel: string }> = [];

  if (sel.kind === "subpath") {
    // Single skill at a subpath; dest dir name is the final dest segment.
    const skillRoot = join(workRoot, sel.path);
    if (!existsSync(skillRoot)) return found;
    const dirName = sel.dest.split("/").filter(Boolean).pop() ?? sel.path.split("/").pop() ?? "skill";
    found.push({ dirName, abs: skillRoot, rel: `${sel.path}/SKILL.md` });
    return found;
  }

  if (sel.kind === "whole-repo") {
    // The repo itself is one skill pack; scan the clone for <dir>/SKILL.md.
    return scanForSkills(workRoot, workRoot);
  }

  // all-skills | named — both have a `.root`.
  const selRoot = sel.root;
  const skillsRoot = join(workRoot, selRoot);
  if (!existsSync(skillsRoot)) return found;

  let names: string[];
  try {
    names = await readdir(skillsRoot);
  } catch {
    return found;
  }
  for (const name of names.sort()) {
    if (sel.kind === "named" && !sel.names.includes(name)) continue;
    const abs = join(skillsRoot, name);
    let lst: Awaited<ReturnType<typeof lstat>>;
    try {
      lst = await lstat(abs);
    } catch {
      continue;
    }
    if (!lst.isDirectory()) continue;
    // A skill directory must contain SKILL.md; everything else is skipped.
    if (!existsSync(join(abs, "SKILL.md"))) continue;
    found.push({ dirName: name, abs, rel: posix.join(selRoot, name, "SKILL.md") });
  }
  return found;
}

/** whole-repo scan: locate every <dir>/SKILL.md within the clone. */
async function scanForSkills(workRoot: string, root: string): Promise<Array<{ dirName: string; abs: string; rel: string }>> {
  const files = await listFiles(workRoot, root);
  const skillFiles = files.filter((f) => f.name.endsWith("/SKILL.md") || f.name === "SKILL.md");
  const out: Array<{ dirName: string; abs: string; rel: string }> = [];
  for (const f of skillFiles) {
    const abs = join(root, f.name);
    const parts = f.name.split("/").filter(Boolean);
    const skillFileSeg = parts[parts.length - 1];
    if (skillFileSeg !== "SKILL.md") continue;
    const dirName = parts.length >= 2 ? parts[parts.length - 2]! : "skill";
    out.push({ dirName, abs, rel: f.name });
  }
  return out;
}

// ---------------------------------------------------------------------------
// Parsing a single skill from bytes + its directory listing
// ---------------------------------------------------------------------------

function parseSkillFromBytes(bytes: Uint8Array, file: string): {
  rawFrontmatter: string;
  body: string;
  frontmatter: Record<string, unknown>;
  fields: ReturnType<typeof extractFields>;
  warnings: string[];
} {
  const parsed = parseSkillBytes(bytes, file);
  const fields = extractFields(parsed.frontmatter, file);
  return {
    rawFrontmatter: parsed.rawFrontmatter,
    body: parsed.body,
    frontmatter: parsed.frontmatter,
    fields,
    warnings: parsed.warnings,
  };
}

// ---------------------------------------------------------------------------
// Snapshot (cache) read/write
// ---------------------------------------------------------------------------

function snapshotDir(cacheDir: string, sourceId: string, sha: string): string {
  return join(cacheDir, sourceId, sha);
}

async function readSnapshot(cacheDir: string, sourceId: string, sha: string): Promise<Snapshot | null> {
  const p = join(snapshotDir(cacheDir, sourceId, sha), ".snapshot.json");
  if (!existsSync(p)) return null;
  const text = await readFile(p, "utf8");
  return JSON.parse(text) as Snapshot;
}

async function writeSnapshot(cacheDir: string, snap: Snapshot): Promise<void> {
  const dir = snapshotDir(cacheDir, snap.sourceId, snap.sha);
  await mkdir(dir, { recursive: true });
  await writeFile(join(dir, ".snapshot.json"), JSON.stringify(snap, null, 2) + "\n", "utf8");
}

// ---------------------------------------------------------------------------
// Per-source resolution
// ---------------------------------------------------------------------------

function lockedSourceFor(lock: Lockfile | null, id: string): LockedSource | undefined {
  return lock?.sources.find((s) => s.id === id);
}

async function resolveGitSource(
  cfg: GitSourceConfig,
  mode: ResolveMode,
  lock: Lockfile | null,
  cacheDir: string,
  timeoutMs: number | undefined,
): Promise<{ snapshot: Snapshot; warnings: string[] }> {
  const warnings: string[] = [];
  const locked = lockedSourceFor(lock, cfg.id);

  // Determine the SHA to use.
  let sha: string;
  if (mode === "update") {
    sha = await resolveRef(cfg.repo, cfg.ref, timeoutMs);
  } else if (locked?.resolvedRevision) {
    sha = locked.resolvedRevision;
  } else if (mode === "cache") {
    throw new CatalogError(
      `git source "${cfg.id}" has no locked revision and generate is offline; run "bun run catalog:resolve" first`,
      "skills-source.lock.json",
    );
  } else {
    // lock mode without a prior lock: resolve from network.
    sha = await resolveRef(cfg.repo, cfg.ref, timeoutMs);
  }

  // Try the committed snapshot first (offline fast path / cache mode).
  let snapshot = await readSnapshot(cacheDir, cfg.id, sha);
  if (!snapshot) {
    if (mode === "cache") {
      throw new CatalogError(
        `missing cache snapshot for "${cfg.id}" @ ${sha}; run "bun run catalog:resolve"`,
        `catalog/cache/${cfg.id}/${sha}/.snapshot.json`,
      );
    }
    info(`fetching ${cfg.id} @ ${sha.slice(0, 10)}`);
    const fetched = await fetchAtSha(cfg.repo, sha, timeoutMs);
    try {
      const headSha = await revParseHead(fetched.workdir, fetched.home, timeoutMs);
      if (!headSha.startsWith(sha.slice(0, 7))) {
        warnings.push(`${cfg.id}: checked-out HEAD ${headSha.slice(0, 10)} != requested ${sha.slice(0, 10)}`);
      }
      snapshot = await buildSnapshotFromWorkdir(cfg, sha, fetched.workdir);
      await writeSnapshot(cacheDir, snapshot);
      // Cache license/notice verbatim for attribution.
      await cacheLicenseNotice(cfg, fetched.workdir, snapshotDir(cacheDir, cfg.id, sha));
    } finally {
      await fetched.cleanup();
    }
  }

  return { snapshot, warnings };
}

async function cacheLicenseNotice(cfg: GitSourceConfig, workRoot: string, destDir: string): Promise<void> {
  for (const name of cfg.licenseNoticeFiles) {
    const src = join(workRoot, name);
    if (existsSync(src)) {
      try {
        await cp(src, join(destDir, name), { recursive: false });
      } catch {
        /* non-fatal */
      }
    }
  }
}

async function readLicenseText(workRoot: string, names: string[]): Promise<string> {
  let text = "";
  for (const name of names) {
    const p = join(workRoot, name);
    if (existsSync(p)) {
      try {
        text += (await readFile(p, "utf8")) + "\n";
      } catch {
        /* ignore */
      }
    }
  }
  return text;
}

async function buildSnapshotFromWorkdir(cfg: GitSourceConfig, sha: string, workRoot: string): Promise<Snapshot> {
  // Root-level license detection (upstream notice files).
  const rootLicenseText = await readLicenseText(workRoot, cfg.licenseNoticeFiles);
  const rootDetected = rootLicenseText.trim() ? detectLicense(rootLicenseText) : "unknown";

  const skillDirs = await findSkillDirs(workRoot, cfg);
  if (skillDirs.length === 0) {
    warn(`${cfg.id}: no skills found under selection ${cfg.selection.kind}`);
  }
  // Candidate set before the selection filter — drives the coverage report.
  const availableSkillDirs = await findAvailableSkillDirs(workRoot, cfg);

  const entries: SnapshotEntry[] = [];
  for (const sd of skillDirs.sort((a, b) => a.rel.localeCompare(b.rel))) {
    const skillFile = join(sd.abs, "SKILL.md");
    const file = `${cfg.repo}@${sha}:${sd.rel}`;
    if (!existsSync(skillFile)) continue;

    const bytes = await readFile(skillFile);
    let parsed: ReturnType<typeof parseSkillFromBytes>;
    try {
      parsed = parseSkillFromBytes(bytes, file);
    } catch (e) {
      throw e instanceof CatalogError ? e : new CatalogError(`failed to parse ${file}: ${(e as Error).message}`, file);
    }

    // Per-skill license (e.g. anthropics/skills ships LICENSE.txt per skill).
    const skillLicenseText = await readLicenseText(sd.abs, ["LICENSE", "LICENSE.txt", "LICENSE.md"]);
    const detected = skillLicenseText.trim() ? detectLicense(skillLicenseText) : rootDetected;
    const v = licenseVerdict(cfg.license, detected, cfg.redistribution);
    const effective = v.redistribution;

    const dirFiles = await listFiles(sd.abs, sd.abs);
    const { name: skillName } = finalSegment(parsed.fields.name, sd.dirName, file);
    const warnings = [...parsed.warnings];
    if (v.note) warnings.push(`license: ${v.note}`);

    entries.push({
      relPath: sd.rel,
      dirName: sd.dirName,
      canonicalInvocation: personalInvocation(skillName),
      namespacedInvocations: [personalInvocation(skillName)],
      digest: digestBytes(bytes),
      redistribution: effective,
      licenseDeclared: cfg.license,
      licenseDetected: detected,
      frontmatter: parsed.frontmatter,
      rawFrontmatter: parsed.rawFrontmatter,
      body: effective === "full" ? parsed.body : null,
      description: parsed.fields.description,
      whenToUse: parsed.fields.whenToUse,
      version: parsed.fields.version,
      allowedTools: parsed.fields.allowedTools,
      disallowedTools: parsed.fields.disallowedTools,
      preambleTier: parsed.fields.preambleTier,
      security: buildSecurityProfile(parsed.frontmatter, parsed.body, dirFiles, parsed.rawFrontmatter),
      warnings,
    });
  }

  // Source-level redistribution = full only if every entry is full.
  const sourceEffective: "full" | "metadata-only" =
    entries.length > 0 && entries.every((e) => e.redistribution === "full") ? "full" : "metadata-only";

  return {
    sourceId: cfg.id,
    sha,
    repo: cfg.repo,
    ref: cfg.ref,
    licenseDeclared: cfg.license,
    licenseDetected: rootDetected,
    redistribution: sourceEffective,
    entries,
    availableSkillDirs,
  };
}

// ---------------------------------------------------------------------------
// Repo-owned source (committed skills/)
// ---------------------------------------------------------------------------

async function resolveRepoOwned(
  cfg: { id: string; displayName: string; root: string },
  repoRoot: string,
): Promise<{ entries: SnapshotEntry[]; warnings: string[] }> {
  const warnings: string[] = [];
  const skillsRoot = join(repoRoot, cfg.root);
  // Repo-owned skills are this repository's own content (MIT): always full.
  const repoLicenseText = await readLicenseText(repoRoot, ["LICENSE", "LICENSE.md", "LICENSE.txt"]);
  const repoLicense = repoLicenseText.trim() ? detectLicense(repoLicenseText) : "MIT";
  // Two shapes live under skills/ and both are this repository's own content:
  //
  //   skills/<name>/SKILL.md                  bare, personal scope   -> /<name>
  //   skills/<plugin>/skills/<name>/SKILL.md  plugin scope           -> /<plugin>:<name>
  //
  // The plugin form is what marketplace.toml publishes; Claude Code also loads
  // it directly as <plugin>@skills-dir when this repo IS ~/.claude. Both are
  // enumerated so a half-migrated tree is described accurately rather than
  // silently under-reported.
  //
  // Use git to list TRACKED skills only (ignore a developer's locally-installed packs).
  const globs = [`${cfg.root}/*/SKILL.md`, `${cfg.root}/*/skills/*/SKILL.md`];
  let tracked: string[];
  try {
    const r = await runGit(["-C", repoRoot, "ls-files", "--", ...globs], {});
    tracked = r.stdout.split("\n").map((s) => s.trim()).filter(Boolean);
  } catch {
    // No git (tests): fall back to walking the directory.
    tracked = [];
    if (existsSync(skillsRoot)) {
      const names = await readdir(skillsRoot);
      for (const name of names.sort()) {
        const lst = await lstat(join(skillsRoot, name)).catch(() => null);
        if (!lst?.isDirectory()) continue;
        if (existsSync(join(skillsRoot, name, "SKILL.md"))) {
          tracked.push(posix.join(cfg.root, name, "SKILL.md"));
        }
        const nested = join(skillsRoot, name, "skills");
        if (existsSync(nested)) {
          for (const inner of (await readdir(nested)).sort()) {
            if (existsSync(join(nested, inner, "SKILL.md"))) {
              tracked.push(posix.join(cfg.root, name, "skills", inner, "SKILL.md"));
            }
          }
        }
      }
    }
  }

  const entries: SnapshotEntry[] = [];
  for (const rel of tracked.sort()) {
    const abs = join(repoRoot, rel);
    const bytes = await readFile(abs);
    const parts = rel.split("/").filter(Boolean);
    const dirName = parts.length >= 2 ? parts[parts.length - 2]! : "skill";
    const skillDir = join(repoRoot, parts.slice(0, -1).join("/"));
    const file = `${repoRoot}/${rel}`;
    const parsed = parseSkillFromBytes(bytes, file);
    const { name: skillName } = finalSegment(parsed.fields.name, dirName, file);
    // parts is [root, <plugin>, "skills", <name>, "SKILL.md"] for the plugin form.
    const plugin = parts.length === 5 && parts[2] === "skills" ? parts[1]! : null;
    const invocation = plugin ? pluginInvocation(plugin, skillName) : personalInvocation(skillName);
    entries.push({
      relPath: rel,
      dirName,
      canonicalInvocation: invocation,
      namespacedInvocations: [invocation],
      digest: digestBytes(bytes),
      redistribution: "full", // repo-owned: always redistributable (this repo's own content)
      licenseDeclared: repoLicense,
      licenseDetected: repoLicense,
      frontmatter: parsed.frontmatter,
      rawFrontmatter: parsed.rawFrontmatter,
      body: parsed.body,
      description: parsed.fields.description,
      whenToUse: parsed.fields.whenToUse,
      version: parsed.fields.version,
      allowedTools: parsed.fields.allowedTools,
      disallowedTools: parsed.fields.disallowedTools,
      preambleTier: parsed.fields.preambleTier,
      security: buildSecurityProfile(parsed.frontmatter, parsed.body, await listFiles(skillDir, skillDir), parsed.rawFrontmatter),
      warnings: parsed.warnings,
    });
  }
  return { entries, warnings };
}

// ---------------------------------------------------------------------------
// Runtime source (non-deterministic; recorded honestly)
// ---------------------------------------------------------------------------

function runtimeEntries(cfg: Extract<SourceConfig, { type: "runtime" }>): SnapshotEntry[] {
  // Runtime sources produce a single synthetic, explicitly-unresolved entry.
  const invocations: string[] = [];
  if (cfg.runtimeKind === "plugin-marketplace") {
    for (const m of cfg.marketplaces ?? []) invocations.push(`/${m}:*`);
    for (const p of cfg.plugins ?? []) invocations.push(`/${p}`);
  } else if (cfg.runtimeKind === "pypi-package" && cfg.pypiPackage) {
    invocations.push(`/${cfg.pypiPackage}`);
  } else if (cfg.runtimeKind === "installer-script") {
    invocations.push(`/${cfg.id}`);
  }
  return [
    {
      relPath: "",
      dirName: cfg.id,
      canonicalInvocation: invocations[0] ?? `/${cfg.id}`,
      namespacedInvocations: invocations,
      digest: "",
      redistribution: "metadata-only",
      licenseDeclared: "unknown",
      licenseDetected: "unknown",
      frontmatter: {},
      rawFrontmatter: "",
      body: null,
      security: buildSecurityProfile({}, "", [], ""),
      warnings: [],
    },
  ];
}

// ---------------------------------------------------------------------------
// Top-level resolve
// ---------------------------------------------------------------------------

export interface ResolveOptions {
  mode: ResolveMode;
  lock: Lockfile | null;
  cacheDir: string;
  repoRoot: string;
  timeoutMs?: number;
}

function snapshotToSkill(cfg: SourceConfig, snap: Snapshot, entry: SnapshotEntry): ResolvedSkill {
  const license = licenseVerdict(entry.licenseDeclared, entry.licenseDetected, entry.redistribution);
  return {
    canonicalInvocation: entry.canonicalInvocation,
    skillName: entry.canonicalInvocation.replace(/^\//, ""),
    namespacedInvocations: entry.namespacedInvocations,
    sourceId: cfg.id,
    sourceType: cfg.type,
    pack: cfg.type === "git" ? cfg.pack : cfg.type === "repo-owned" ? "repository" : cfg.runtimeKind,
    repo: cfg.type === "git" ? cfg.repo : undefined,
    ref: cfg.type === "git" ? cfg.ref : undefined,
    resolvedRevision: cfg.type === "git" ? snap.sha : undefined,
    relativePath: entry.relPath,
    frontmatter: entry.frontmatter,
    rawFrontmatter: entry.rawFrontmatter,
    body: entry.body ?? "",
    description: entry.description,
    whenToUse: entry.whenToUse,
    version: entry.version,
    allowedTools: entry.allowedTools,
    disallowedTools: entry.disallowedTools,
    preambleTier: entry.preambleTier,
    digest: entry.digest,
    license,
    security: entry.security,
    generated: true,
    warnings: entry.warnings,
    unresolvedReason: cfg.type === "runtime" ? (cfg as Extract<SourceConfig, { type: "runtime" }>).reason : undefined,
  };
}

export async function resolveCatalog(manifest: Manifest, opts: ResolveOptions): Promise<ResolvedCatalog> {
  const skills: ResolvedSkill[] = [];
  const sourceMeta: ResolvedCatalog["sourceMeta"] = [];
  const allWarnings: string[] = [];
  const lockSources: LockedSource[] = [];
  const lockSkills: LockedSkill[] = [];

  for (const cfg of Object.values(manifest.sources)) {
    if (cfg.type === "git") {
      let snap: Snapshot;
      try {
        const r = await resolveGitSource(cfg, opts.mode, opts.lock, opts.cacheDir, opts.timeoutMs);
        snap = r.snapshot;
        allWarnings.push(...r.warnings);
      } catch (e) {
        if (opts.mode === "cache") throw e;
        // Network/git failures are fail-soft (repo moved, fetch timeout). Content
        // errors (malformed YAML, path escape, security policy) must fail loud.
        const isNetwork = e instanceof CatalogError && e.file === "<git>";
        if (!isNetwork) throw e;
        warn(`source "${cfg.id}" failed to resolve (network): ${(e as Error).message}`);
        allWarnings.push(`${cfg.id}: unresolved network (${(e as Error).message})`);
        continue;
      }
      for (const entry of snap.entries) {
        skills.push(snapshotToSkill(cfg, snap, entry));
      }
      sourceMeta.push({
        id: cfg.id,
        type: "git",
        displayName: cfg.displayName,
        pack: cfg.pack,
        repo: cfg.repo,
        ref: cfg.ref,
        resolvedRevision: snap.sha,
        skillCount: snap.entries.length,
        redistribution: snap.redistribution,
        runtimeOnly: false,
      });
      lockSources.push({
        id: cfg.id,
        type: "git",
        repo: cfg.repo,
        configuredRef: cfg.ref,
        resolvedRevision: snap.sha,
        selectedPaths: uniqueSorted(snap.entries.map((e) => e.relPath.split("/").slice(0, -1).join("/"))),
        canonicalSkills: snap.entries.map((e) => e.canonicalInvocation),
        license: { declared: snap.licenseDeclared, detected: snap.licenseDetected },
        redistribution: snap.redistribution,
        notes: cfg.notes,
        availableSkillDirs: snap.availableSkillDirs,
      });
      for (const entry of snap.entries) {
        lockSkills.push({
          canonicalInvocation: entry.canonicalInvocation,
          sourceId: cfg.id,
          relativePath: entry.relPath,
          digest: entry.digest,
          resolvedRevision: snap.sha,
          redistribution: entry.redistribution,
          license: { declared: snap.licenseDeclared, detected: snap.licenseDetected },
        });
      }
    } else if (cfg.type === "repo-owned") {
      const { entries, warnings } = await resolveRepoOwned(cfg, opts.repoRoot);
      allWarnings.push(...warnings);
      const snap: Snapshot = {
        sourceId: cfg.id,
        sha: "repository",
        repo: "",
        ref: "",
        licenseDeclared: "repository-owned",
        licenseDetected: "repository-owned",
        redistribution: "full",
        entries,
      };
      for (const entry of entries) skills.push(snapshotToSkill(cfg, snap, entry));
      sourceMeta.push({
        id: cfg.id,
        type: "repo-owned",
        displayName: cfg.displayName,
        pack: "repository",
        skillCount: entries.length,
        redistribution: "full",
        runtimeOnly: false,
      });
      lockSources.push({
        id: cfg.id,
        type: "repo-owned",
        selectedPaths: uniqueSorted(entries.map((e) => e.relPath.split("/").slice(0, -1).join("/"))),
        canonicalSkills: entries.map((e) => e.canonicalInvocation),
        license: { declared: "repository-owned", detected: "repository-owned" },
        redistribution: "full",
      });
      for (const entry of entries) {
        lockSkills.push({
          canonicalInvocation: entry.canonicalInvocation,
          sourceId: cfg.id,
          relativePath: entry.relPath,
          digest: entry.digest,
          redistribution: "full",
          license: { declared: "repository-owned", detected: "repository-owned" },
        });
      }
    } else {
      // runtime
      const entries = runtimeEntries(cfg);
      const snap: Snapshot = {
        sourceId: cfg.id,
        sha: "runtime",
        repo: cfg.installerUrl ?? "",
        ref: "",
        licenseDeclared: "unknown",
        licenseDetected: "unknown",
        redistribution: "metadata-only",
        entries,
      };
      for (const entry of entries) skills.push(snapshotToSkill(cfg, snap, entry));
      sourceMeta.push({
        id: cfg.id,
        type: "runtime",
        displayName: cfg.displayName,
        pack: cfg.runtimeKind,
        repo: cfg.installerUrl,
        skillCount: entries.length,
        redistribution: "metadata-only",
        runtimeOnly: true,
      });
      lockSources.push({
        id: cfg.id,
        type: "runtime",
        repo: cfg.installerUrl ?? cfg.pypiPackage,
        selectedPaths: [],
        canonicalSkills: entries.map((e) => e.canonicalInvocation),
        license: { declared: "unknown", detected: "unknown" },
        redistribution: "metadata-only",
        notes: cfg.reason,
      });
    }
  }

  // Duplicate canonical-invocation detection (case-sensitive + case-insensitive).
  const seen = new Map<string, string>();
  const seenCase = new Map<string, string>();
  for (const s of skills) {
    const prev = seen.get(s.canonicalInvocation);
    if (prev) allWarnings.push(`duplicate canonical invocation ${s.canonicalInvocation} (sources: ${prev}, ${s.sourceId})`);
    else seen.set(s.canonicalInvocation, s.sourceId);
    const ck = caseKey(s.canonicalInvocation);
    const prevC = seenCase.get(ck);
    if (prevC && prevC !== s.sourceId) {
      allWarnings.push(`case-colliding invocation ${ck} (sources: ${prevC}, ${s.sourceId})`);
    } else if (!prevC) {
      seenCase.set(ck, s.sourceId);
    }
  }

  const lock: Lockfile = {
    schemaVersion: 1,
    resolverVersion: RESOLVER_VERSION,
    sources: lockSources,
    skills: lockSkills,
  };

  return { manifest, lock, skills, sourceMeta, warnings: allWarnings };
}

function uniqueSorted(arr: string[]): string[] {
  return [...new Set(arr)].sort();
}

/** Stable sort key for deterministic output. */
export function skillSortKey(s: ResolvedSkill): string {
  return `${s.sourceId}\t${s.canonicalInvocation}`;
}