import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { mkdtemp, mkdir, writeFile, rm } from "node:fs/promises";
import { existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execSync } from "node:child_process";
import { parseManifest } from "../src/manifest.ts";
import { resolveCatalog } from "../src/resolver.ts";
import { generateAll, buildCatalogJson, stageOutputs } from "../src/generate.ts";
import { diffCatalogs } from "../src/diff.ts";

const GIT_ENV = { ...process.env, GIT_CONFIG_NOSYSTEM: "1", GIT_CONFIG_GLOBAL: "/dev/null" } as Record<string, string>;

async function makeFixtureRepo(root: string, skills: Record<string, string>, license = true) {
  await mkdir(root, { recursive: true });
  await mkdir(join(root, "skills"), { recursive: true });
  for (const [name, body] of Object.entries(skills)) {
    await mkdir(join(root, "skills", name), { recursive: true });
    await writeFile(join(root, "skills", name, "SKILL.md"), body, "utf8");
  }
  if (license) {
    await writeFile(join(root, "LICENSE"), "MIT License\n\nCopyright (c) test\n", "utf8");
  }
  execSync(`git init -q -b main && git add -A && git -c user.email=t@t -c user.name=t commit -q -m init`, { cwd: root, env: GIT_ENV });
}

function hashDir(p: string): string {
  return execSync(`find . -type f | sort | xargs sha256sum 2>/dev/null | sha256sum`, { cwd: p }).toString().trim();
}

describe("integration: resolve + generate from fixture repos", () => {
  let work: string;
  let cacheDir: string;
  let outDir: string;
  let repoRoot: string;

  beforeEach(async () => {
    work = await mkdtemp(join(tmpdir(), "cat-it-"));
    cacheDir = join(work, "cache");
    outDir = join(work, "out");
    repoRoot = join(work, "repo"); // empty: no repo-owned skills
    await mkdir(repoRoot, { recursive: true });
    await mkdir(outDir, { recursive: true });
  });
  afterEach(async () => {
    await rm(work, { recursive: true, force: true });
  });

  it("resolves a fixture git repo, generates, and is byte-identical across runs", async () => {
    const repo = join(work, "fixture");
    await makeFixtureRepo(repo, {
      "alpha": "---\nname: alpha\ndescription: alpha skill\nallowed-tools:\n  - Bash\n---\n# Alpha\nbody\n",
      "beta": "---\nname: beta\ndescription: beta skill\n---\n# Beta\nbody\n",
    });

    const manifest = parseManifest(`
[sources.fixture]
type = "git"
display_name = "Fixture"
repo = "${repo}"
ref = "main"
pack = "fix"
license = "MIT"
redistribution = "full"
install_step = "install_fixture"
selection.kind = "all-skills"
selection.root = "skills"
`);

    const resolved = await resolveCatalog(manifest, { mode: "update", lock: null, cacheDir, repoRoot });
    expect(resolved.skills.length).toBe(2);
    const alpha = resolved.skills.find((s) => s.skillName === "alpha")!;
    expect(alpha.canonicalInvocation).toBe("/alpha");
    expect(alpha.allowedTools).toEqual(["Bash"]);
    expect(alpha.license.redistribution).toBe("full");
    expect(alpha.digest).toMatch(/^[0-9a-f]{64}$/);

    const diff = diffCatalogs(buildCatalogJson(resolved), null, null);
    await generateAll(resolved, { outDir, lock: resolved.lock, diff });

    expect(existsSync(join(outDir, "SKILLS_CATALOG.md"))).toBe(true);
    expect(existsSync(join(outDir, "claude_code_skills.md"))).toBe(true);
    expect(existsSync(join(outDir, "skills-catalog.json"))).toBe(true);
    expect(existsSync(join(outDir, "docs", "skills", "fixture", "alpha.md"))).toBe(true);
    expect(existsSync(join(outDir, "SHA256SUMS"))).toBe(true);

    const h1 = hashDir(outDir);
    // Re-generate from cache (offline) — must be byte-identical.
    const resolved2 = await resolveCatalog(manifest, { mode: "cache", lock: resolved.lock, cacheDir, repoRoot });
    await generateAll(resolved2, { outDir, lock: resolved2.lock, diff });
    expect(hashDir(outDir)).toBe(h1);
  });

  it("atomic generation: staging is isolated from committed outputs", async () => {
    const repo = join(work, "iso");
    await makeFixtureRepo(repo, {
      "good": "---\nname: good\ndescription: g\n---\nbody\n",
    });
    const manifest = parseManifest(`
[sources.iso]
type = "git"
display_name = "Iso"
repo = "${repo}"
ref = "main"
pack = "i"
license = "MIT"
redistribution = "full"
install_step = "i"
selection.kind = "all-skills"
selection.root = "skills"
`);
    const resolved = await resolveCatalog(manifest, { mode: "update", lock: null, cacheDir, repoRoot });
    await generateAll(resolved, { outDir, lock: resolved.lock });
    const before = hashDir(outDir);

    // stageOutputs builds into a separate staging dir and must NOT mutate outDir.
    const staging = join(work, "staging");
    await stageOutputs(resolved, staging, { lock: resolved.lock });
    expect(hashDir(outDir)).toBe(before);
    expect(existsSync(join(staging, "SKILLS_CATALOG.md"))).toBe(true);

    // A full regenerate (swap) is idempotent.
    await generateAll(resolved, { outDir, lock: resolved.lock });
    expect(hashDir(outDir)).toBe(before);
  });

  it("malformed YAML in a fixture skill fails the resolve with a file:line error", async () => {
    const repo = join(work, "malformed");
    await makeFixtureRepo(repo, {
      "broken": "---\nname: broken\n  bad: [\n---\nbody\n",
    });
    const manifest = parseManifest(`
[sources.malformed]
type = "git"
display_name = "M"
repo = "${repo}"
ref = "main"
pack = "m"
license = "MIT"
redistribution = "full"
install_step = "i"
selection.kind = "all-skills"
selection.root = "skills"
`);
    let threw = false;
    try {
      await resolveCatalog(manifest, { mode: "update", lock: null, cacheDir, repoRoot });
    } catch (e) {
      threw = true;
      expect((e as Error).message).toMatch(/:\d+:/);
    }
    expect(threw).toBe(true);
  });

  it("metadata-only license (no LICENSE file) omits the body", async () => {
    const repo = join(work, "nolicense");
    await makeFixtureRepo(repo, {
      "secret": "---\nname: secret\ndescription: s\n---\nbody\n",
    }, false /* no license */);
    const manifest = parseManifest(`
[sources.nolicense]
type = "git"
display_name = "N"
repo = "${repo}"
ref = "main"
pack = "n"
license = "unknown"
redistribution = "metadata-only"
install_step = "i"
selection.kind = "all-skills"
selection.root = "skills"
`);
    const resolved = await resolveCatalog(manifest, { mode: "update", lock: null, cacheDir, repoRoot });
    const s = resolved.skills[0]!;
    expect(s.license.redistribution).toBe("metadata-only");
    expect(s.body).toBe("");
  });
});