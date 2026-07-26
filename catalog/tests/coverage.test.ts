/**
 * Coverage contract tests.
 *
 * Deterministic and network-free: every upstream is a local fixture git repo,
 * so these run in ordinary PR CI. The live-upstream equivalent lives in
 * network.test.ts behind CATALOG_NETWORK_TESTS=1.
 *
 * What must hold:
 *   - each selection mode catalogs exactly what it declares;
 *   - a SELECTED skill vanishing upstream is a hard failure, never a silent
 *     shrink;
 *   - upstream skills a curated selection leaves out are reported, never
 *     auto-ingested;
 *   - duplicate canonical invocations across sources are a hard failure.
 */
import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { mkdtemp, mkdir, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execSync } from "node:child_process";
import { parseManifest } from "../src/manifest.ts";
import { resolveCatalog } from "../src/resolver.ts";
import { buildCoverageReport, renderCoverageMarkdown } from "../src/coverage.ts";
import type { Lockfile, Manifest } from "../src/types.ts";

const GIT_ENV = { ...process.env, GIT_CONFIG_NOSYSTEM: "1", GIT_CONFIG_GLOBAL: "/dev/null" } as Record<string, string>;

const skillMd = (name: string, extra = "") =>
  `---\nname: ${name}\ndescription: ${name} skill\n${extra}---\n# ${name}\nbody\n`;

async function makeRepo(root: string, skillsByPath: Record<string, string>, license = true) {
  await mkdir(root, { recursive: true });
  for (const [relDir, body] of Object.entries(skillsByPath)) {
    await mkdir(join(root, relDir), { recursive: true });
    await writeFile(join(root, relDir, "SKILL.md"), body, "utf8");
  }
  if (license) await writeFile(join(root, "LICENSE"), "MIT License\n\nCopyright (c) test\n", "utf8");
  execSync(`git init -q -b main && git add -A && git -c user.email=t@t -c user.name=t commit -q -m init`, {
    cwd: root, env: GIT_ENV,
  });
}

describe("coverage contract", () => {
  let work: string;
  let cacheDir: string;
  let repoRoot: string;

  beforeEach(async () => {
    work = await mkdtemp(join(tmpdir(), "cat-cov-"));
    cacheDir = join(work, "cache");
    repoRoot = join(work, "repo");
    await mkdir(repoRoot, { recursive: true });
  });
  afterEach(async () => {
    await rm(work, { recursive: true, force: true });
  });

  const resolveTo = async (manifest: Manifest): Promise<Lockfile> => {
    const resolved = await resolveCatalog(manifest, { mode: "update", lock: null, cacheDir, repoRoot });
    return resolved.lock;
  };

  it("all-skills catalogs every upstream skill and reports nothing unselected", async () => {
    const repo = join(work, "all");
    await makeRepo(repo, {
      "skills/alpha": skillMd("alpha"),
      "skills/beta": skillMd("beta"),
      "skills/gamma": skillMd("gamma"),
    });
    const manifest = parseManifest(`
[sources.all]
type = "git"
display_name = "All"
repo = "${repo}"
ref = "main"
pack = "a"
license = "MIT"
redistribution = "full"
install_step = "i"
selection.kind = "all-skills"
selection.root = "skills"
`);
    const report = buildCoverageReport(manifest, await resolveTo(manifest));
    const src = report.sources[0]!;
    expect(src.selectionMode).toBe("all-skills");
    expect(src.catalogedSkills).toEqual(["/alpha", "/beta", "/gamma"]);
    expect(src.unselectedUpstream).toEqual([]);
    expect(src.missingSelected).toEqual([]);
    expect(report.problems).toEqual([]);
  });

  it("named selection reports the upstream skills it deliberately leaves out", async () => {
    const repo = join(work, "named");
    await makeRepo(repo, {
      "skills/wanted": skillMd("wanted"),
      "skills/unwanted-a": skillMd("unwanted-a"),
      "skills/unwanted-b": skillMd("unwanted-b"),
    });
    const manifest = parseManifest(`
[sources.named]
type = "git"
display_name = "Named"
repo = "${repo}"
ref = "main"
pack = "n"
license = "MIT"
redistribution = "full"
install_step = "i"
selection.kind = "named"
selection.root = "skills"
selection.names = ["wanted"]
`);
    const report = buildCoverageReport(manifest, await resolveTo(manifest));
    const src = report.sources[0]!;
    expect(src.catalogedSkills).toEqual(["/wanted"]);
    // Curation stays curation: the extras are reported, never ingested.
    expect(src.unselectedUpstream).toEqual(["unwanted-a", "unwanted-b"]);
    expect(report.problems).toEqual([]);
    expect(report.observations.join(" ")).toContain("unwanted-a");
    expect(report.totals.curatedOut).toBe(2);
  });

  it("HARD FAILS when a selected skill has disappeared upstream", async () => {
    const repo = join(work, "gone");
    await makeRepo(repo, {
      "skills/still-here": skillMd("still-here"),
      // "removed-upstream" is named in the manifest but absent from the repo.
    });
    const manifest = parseManifest(`
[sources.gone]
type = "git"
display_name = "Gone"
repo = "${repo}"
ref = "main"
pack = "g"
license = "MIT"
redistribution = "full"
install_step = "i"
selection.kind = "named"
selection.root = "skills"
selection.names = ["still-here", "removed-upstream"]
`);
    const report = buildCoverageReport(manifest, await resolveTo(manifest));
    const src = report.sources[0]!;
    expect(src.catalogedSkills).toEqual(["/still-here"]);
    expect(src.missingSelected).toEqual(["removed-upstream"]);
    expect(report.problems.length).toBe(1);
    expect(report.problems[0]).toContain("removed-upstream");
    expect(report.problems[0]).toContain("missing upstream");
  });

  it("a named skill that loses its SKILL.md is also caught", async () => {
    const repo = join(work, "nomd");
    await makeRepo(repo, { "skills/ok": skillMd("ok") });
    // Directory exists but has no SKILL.md -> not a skill.
    await mkdir(join(repo, "skills", "hollow"), { recursive: true });
    await writeFile(join(repo, "skills", "hollow", "README.md"), "not a skill", "utf8");
    execSync(`git add -A && git -c user.email=t@t -c user.name=t commit -q -m hollow`, { cwd: repo, env: GIT_ENV });

    const manifest = parseManifest(`
[sources.nomd]
type = "git"
display_name = "NoMd"
repo = "${repo}"
ref = "main"
pack = "n"
license = "MIT"
redistribution = "full"
install_step = "i"
selection.kind = "named"
selection.root = "skills"
selection.names = ["ok", "hollow"]
`);
    const report = buildCoverageReport(manifest, await resolveTo(manifest));
    expect(report.sources[0]!.missingSelected).toEqual(["hollow"]);
    expect(report.problems.length).toBe(1);
  });

  it("subpath selection catalogs exactly one skill and sees its siblings", async () => {
    const repo = join(work, "sub");
    await makeRepo(repo, {
      ".claude/skills/target": skillMd("target"),
      ".claude/skills/sibling": skillMd("sibling"),
    });
    const manifest = parseManifest(`
[sources.sub]
type = "git"
display_name = "Sub"
repo = "${repo}"
ref = "main"
pack = "s"
license = "MIT"
redistribution = "full"
install_step = "i"
selection.kind = "subpath"
selection.path = ".claude/skills/target"
selection.dest = "skills/target"
`);
    const report = buildCoverageReport(manifest, await resolveTo(manifest));
    const src = report.sources[0]!;
    expect(src.selectionMode).toBe("subpath");
    expect(src.catalogedSkills).toEqual(["/target"]);
    expect(src.unselectedUpstream).toEqual(["sibling"]);
    expect(report.problems).toEqual([]);
  });

  it("detects duplicate canonical invocations across sources", async () => {
    const a = join(work, "dupa");
    const b = join(work, "dupb");
    await makeRepo(a, { "skills/clash": skillMd("clash") });
    await makeRepo(b, { "skills/clash": skillMd("clash") });
    const manifest = parseManifest(`
[sources.dupa]
type = "git"
display_name = "A"
repo = "${a}"
ref = "main"
pack = "a"
license = "MIT"
redistribution = "full"
install_step = "i"
selection.kind = "all-skills"
selection.root = "skills"

[sources.dupb]
type = "git"
display_name = "B"
repo = "${b}"
ref = "main"
pack = "b"
license = "MIT"
redistribution = "full"
install_step = "i"
selection.kind = "all-skills"
selection.root = "skills"
`);
    const report = buildCoverageReport(manifest, await resolveTo(manifest));
    expect(report.duplicateInvocations.length).toBe(1);
    expect(report.duplicateInvocations[0]).toContain("/clash");
    expect(report.problems.some((p) => p.includes("duplicate canonical invocation"))).toBe(true);
  });

  it("a source with no upstream license is metadata-only and reported as such", async () => {
    const repo = join(work, "nolic");
    await makeRepo(repo, { "skills/unlicensed": skillMd("unlicensed") }, false);
    const manifest = parseManifest(`
[sources.nolic]
type = "git"
display_name = "NoLicense"
repo = "${repo}"
ref = "main"
pack = "n"
license = "unknown"
redistribution = "metadata-only"
install_step = "i"
selection.kind = "all-skills"
selection.root = "skills"
`);
    const report = buildCoverageReport(manifest, await resolveTo(manifest));
    expect(report.sources[0]!.bodiesReproducible).toBe(false);
    expect(report.totals.bodiesNotReproducible).toBe(1);
    expect(report.observations.join(" ")).toContain("metadata-only");
  });

  it("renders deterministically", async () => {
    const repo = join(work, "det");
    await makeRepo(repo, { "skills/one": skillMd("one") });
    const manifest = parseManifest(`
[sources.det]
type = "git"
display_name = "Det"
repo = "${repo}"
ref = "main"
pack = "d"
license = "MIT"
redistribution = "full"
install_step = "i"
selection.kind = "all-skills"
selection.root = "skills"
`);
    const lock = await resolveTo(manifest);
    const a = renderCoverageMarkdown(buildCoverageReport(manifest, lock));
    const b = renderCoverageMarkdown(buildCoverageReport(manifest, lock));
    expect(a).toBe(b);
    expect(a).toContain("# Skills Catalog coverage");
  });

  it("reports 'not recorded' rather than 'none' for locks predating availability tracking", () => {
    const manifest = parseManifest(`
[sources.legacy]
type = "git"
display_name = "Legacy"
repo = "https://example.invalid/x.git"
ref = "main"
pack = "l"
license = "MIT"
redistribution = "full"
install_step = "i"
selection.kind = "named"
selection.root = "skills"
selection.names = ["kept"]
`);
    const legacyLock: Lockfile = {
      schemaVersion: 1,
      resolverVersion: "1",
      sources: [{
        id: "legacy", type: "git", repo: "https://example.invalid/x.git", configuredRef: "main",
        resolvedRevision: "deadbeef", selectedPaths: ["skills/kept"], canonicalSkills: ["/kept"],
        license: { declared: "MIT", detected: "MIT" }, redistribution: "full",
        // availableSkillDirs deliberately absent
      }],
      skills: [],
    };
    const report = buildCoverageReport(manifest, legacyLock);
    expect(report.sources[0]!.unselectedUpstream).toBeNull();
    expect(report.sources[0]!.missingSelected).toEqual([]);
    expect(report.problems).toEqual([]);
    expect(report.observations.join(" ")).toContain("not recorded in the lock yet");
  });
});