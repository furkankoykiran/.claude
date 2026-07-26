import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { mkdtemp, mkdir, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  loadMarketplaceSpec,
  readVersion,
  verifyPluginTree,
  buildAll,
  buildMarketplaceManifest,
  buildPluginManifest,
  findStale,
  writeAll,
} from "../src/marketplace.ts";
import { CatalogError } from "../src/types.ts";

const BASE_TOML = `
schema_version = 1

[marketplace]
name = "fk-toolkit"
display_name = "FK Claude Toolkit"
description = "Test marketplace."
owner_name = "Owner"
owner_url = "https://example.invalid/owner"
homepage = "https://example.invalid/home"
repository = "https://example.invalid/repo"
license = "MIT"
plugin_root = "skills"

[marketplace.renames]

[[plugins]]
name = "fk-alpha"
dir = "fk-alpha"
display_name = "Alpha"
description = "Alpha plugin."
category = "development"
keywords = ["a"]
skills = ["one"]
`;

let root: string;

async function writeSkill(plugin: string, skill: string, description = "d"): Promise<void> {
  const dir = join(root, "skills", plugin, "skills", skill);
  await mkdir(dir, { recursive: true });
  await writeFile(join(dir, "SKILL.md"), `---\nname: ${skill}\ndescription: ${description}\n---\n\nbody\n`);
}

async function writeToml(body: string): Promise<string> {
  const p = join(root, "marketplace.toml");
  await writeFile(p, body);
  return p;
}

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), "fkt-marketplace-"));
  await writeFile(join(root, "VERSION"), "1.2.3\n");
  await writeSkill("fk-alpha", "one");
});

afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

describe("marketplace.toml parsing", () => {
  it("parses a minimal valid manifest", async () => {
    const spec = await loadMarketplaceSpec(await writeToml(BASE_TOML));
    expect(spec.name).toBe("fk-toolkit");
    expect(spec.plugins).toHaveLength(1);
    expect(spec.plugins[0]!.skills).toEqual(["one"]);
    expect(spec.plugins[0]!.agents).toEqual([]);
  });

  it("rejects a reserved marketplace name", async () => {
    const p = await writeToml(BASE_TOML.replace('name = "fk-toolkit"', 'name = "claude-plugins-official"'));
    await expect(loadMarketplaceSpec(p)).rejects.toThrow(/reserved/);
  });

  it("rejects a non-kebab-case plugin name", async () => {
    const p = await writeToml(BASE_TOML.replace('name = "fk-alpha"', 'name = "FK_Alpha"'));
    await expect(loadMarketplaceSpec(p)).rejects.toThrow(/kebab-case/);
  });

  it("rejects an unknown plugin key rather than silently dropping it", async () => {
    const p = await writeToml(BASE_TOML + "bogus = 1\n");
    await expect(loadMarketplaceSpec(p)).rejects.toThrow(/unknown key "bogus"/);
  });

  it("rejects an unknown marketplace key", async () => {
    const p = await writeToml(BASE_TOML.replace('license = "MIT"', 'license = "MIT"\nauto_publish = true'));
    await expect(loadMarketplaceSpec(p)).rejects.toThrow(/unknown key "auto_publish"/);
  });

  it("rejects a plugin dir that tries to escape plugin_root", async () => {
    const p = await writeToml(BASE_TOML.replace('dir = "fk-alpha"', 'dir = "../elsewhere"'));
    await expect(loadMarketplaceSpec(p)).rejects.toThrow(/single directory name/);
  });

  it("rejects a plugin with no components", async () => {
    const p = await writeToml(BASE_TOML.replace('skills = ["one"]', ""));
    await expect(loadMarketplaceSpec(p)).rejects.toThrow(/declares no skills and no agents/);
  });

  it("rejects duplicate plugin names", async () => {
    const dup = BASE_TOML + '\n[[plugins]]\nname = "fk-alpha"\ndir = "fk-other"\ndisplay_name = "A"\ndescription = "a"\ncategory = "c"\nkeywords = ["a"]\nskills = ["one"]\n';
    await expect(loadMarketplaceSpec(await writeToml(dup))).rejects.toThrow(/duplicate plugin name/);
  });

  it("rejects a rename whose source is still a live plugin", async () => {
    const p = await writeToml(BASE_TOML.replace("[marketplace.renames]", '[marketplace.renames]\nfk-alpha = "fk-alpha"'));
    await expect(loadMarketplaceSpec(p)).rejects.toThrow(/still a live plugin/);
  });

  it("rejects a rename pointing at an unknown plugin", async () => {
    const p = await writeToml(BASE_TOML.replace("[marketplace.renames]", '[marketplace.renames]\nfk-old = "fk-nope"'));
    await expect(loadMarketplaceSpec(p)).rejects.toThrow(/unknown plugin/);
  });

  it("maps an empty rename target to null (removed plugin)", async () => {
    const p = await writeToml(BASE_TOML.replace("[marketplace.renames]", '[marketplace.renames]\nfk-old = ""'));
    const spec = await loadMarketplaceSpec(p);
    expect(spec.renames["fk-old"]).toBeNull();
  });
});

describe("VERSION", () => {
  it("reads a bare semver", async () => {
    expect(await readVersion(root)).toBe("1.2.3");
  });

  it("rejects a non-semver VERSION", async () => {
    await writeFile(join(root, "VERSION"), "v1.2\n");
    await expect(readVersion(root)).rejects.toThrow(CatalogError);
  });
});

describe("tree verification", () => {
  it("fails when a declared skill is missing on disk", async () => {
    const p = await writeToml(BASE_TOML.replace('skills = ["one"]', 'skills = ["one", "two"]'));
    const spec = await loadMarketplaceSpec(p);
    await expect(verifyPluginTree(spec, root)).rejects.toThrow(/do not match declared/);
  });

  it("fails when the tree holds a skill the manifest never declared", async () => {
    await writeSkill("fk-alpha", "undeclared");
    const spec = await loadMarketplaceSpec(await writeToml(BASE_TOML));
    await expect(verifyPluginTree(spec, root)).rejects.toThrow(/undeclared/);
  });

  it("fails when a declared skill directory has no SKILL.md", async () => {
    await mkdir(join(root, "skills", "fk-alpha", "skills", "two"), { recursive: true });
    const p = await writeToml(BASE_TOML.replace('skills = ["one"]', 'skills = ["one", "two"]'));
    const spec = await loadMarketplaceSpec(p);
    await expect(verifyPluginTree(spec, root)).rejects.toThrow(/no SKILL.md/);
  });
});

describe("generated manifests", () => {
  it("uses one version everywhere, because --strict rejects a mismatch", async () => {
    const spec = await loadMarketplaceSpec(await writeToml(BASE_TOML));
    const market = buildMarketplaceManifest(spec, "1.2.3") as Record<string, unknown>;
    const plugin = buildPluginManifest(spec, spec.plugins[0]!, "1.2.3");
    const entries = market["plugins"] as Array<Record<string, unknown>>;
    expect(entries[0]!["version"]).toBe("1.2.3");
    expect(plugin["version"]).toBe("1.2.3");
    expect(entries[0]!["version"]).toBe(plugin["version"]);
  });

  it("points each entry at its plugin directory", async () => {
    const spec = await loadMarketplaceSpec(await writeToml(BASE_TOML));
    const market = buildMarketplaceManifest(spec, "1.2.3") as Record<string, unknown>;
    const entries = market["plugins"] as Array<Record<string, unknown>>;
    expect(entries[0]!["source"]).toBe("./skills/fk-alpha");
  });

  it("omits renames entirely when there are none", async () => {
    const spec = await loadMarketplaceSpec(await writeToml(BASE_TOML));
    expect(buildMarketplaceManifest(spec, "1.2.3")).not.toHaveProperty("renames");
  });

  it("is byte-stable across two builds", async () => {
    const p = await writeToml(BASE_TOML);
    const a = await buildAll(root, p);
    const b = await buildAll(root, p);
    expect(a).toEqual(b);
  });

  it("findStale reports everything before a first write, and nothing after", async () => {
    const p = await writeToml(BASE_TOML);
    expect((await findStale(root, p)).length).toBe(2);
    await writeAll(root, p);
    expect(await findStale(root, p)).toEqual([]);
  });

  it("findStale notices a VERSION bump that was never regenerated", async () => {
    const p = await writeToml(BASE_TOML);
    await writeAll(root, p);
    await writeFile(join(root, "VERSION"), "1.3.0\n");
    expect((await findStale(root, p)).length).toBe(2);
  });
});