/**
 * Marketplace + plugin manifest generation.
 *
 * marketplace.toml is the single authoritative inventory. This module reads it,
 * verifies it against the directories it describes, and emits:
 *
 *   .claude-plugin/marketplace.json
 *   <plugin_root>/<dir>/.claude-plugin/plugin.json
 *
 * Both artefacts are pure functions of marketplace.toml + VERSION + the tree, so
 * regenerating is byte-stable and `marketplace:check` can assert the committed
 * output is current.
 *
 * VERSION (repository root) is the ONE version source of truth. It is written
 * into every plugin.json AND every marketplace entry, because
 * `claude plugin validate --strict` fails the marketplace when an entry's
 * version disagrees with the plugin.json it points at (plugin.json wins at
 * install time, so a disagreement is silently wrong rather than loudly wrong).
 */
import { parse as tomlParse } from "smol-toml";
import { readFile, readdir, writeFile, mkdir } from "node:fs/promises";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { CatalogError } from "./types.ts";

/** Every field the generator is allowed to see in a [[plugins]] table. */
const PLUGIN_KEYS = new Set([
  "name",
  "dir",
  "display_name",
  "description",
  "category",
  "keywords",
  "skills",
  "agents",
]);

const MARKETPLACE_KEYS = new Set([
  "name",
  "display_name",
  "description",
  "owner_name",
  "owner_email",
  "owner_url",
  "homepage",
  "repository",
  "license",
  "plugin_root",
  "renames",
]);

/**
 * Marketplace names Claude Code reserves for Anthropic-operated catalogues.
 * Checked here so a rename can never accidentally impersonate a first-party
 * source; the CLI rejects these too, but failing in `marketplace:check` gives a
 * far better message than a validation error at publish time.
 */
const RESERVED_MARKETPLACE_NAMES = new Set([
  "agent-skills",
  "anthropic-agent-skills",
  "anthropic-marketplace",
  "anthropic-plugins",
  "claude-code-marketplace",
  "claude-code-plugins",
  "claude-community",
  "claude-for-financial-services",
  "claude-for-legal",
  "claude-plugins-community",
  "claude-plugins-official",
  "financial-services-plugins",
  "first-party-plugins",
  "healthcare",
  "knowledge-work-plugins",
  "life-sciences",
]);

const NAME_RE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const SEMVER_RE = /^\d+\.\d+\.\d+$/;

export interface PluginSpec {
  name: string;
  dir: string;
  displayName: string;
  description: string;
  category: string;
  keywords: string[];
  skills: string[];
  agents: string[];
}

export interface MarketplaceSpec {
  name: string;
  displayName: string;
  description: string;
  ownerName: string;
  ownerEmail?: string;
  ownerUrl?: string;
  homepage: string;
  repository: string;
  license: string;
  pluginRoot: string;
  /** old name -> new name, or old name -> null for a removed plugin. */
  renames: Record<string, string | null>;
  plugins: PluginSpec[];
}

function str(v: unknown, who: string, field: string): string {
  if (typeof v !== "string" || v.length === 0) {
    throw new CatalogError(`${who}: "${field}" must be a non-empty string`, "marketplace.toml");
  }
  return v;
}

function strArray(v: unknown, who: string, field: string): string[] {
  if (!Array.isArray(v) || v.some((x) => typeof x !== "string" || x.length === 0)) {
    throw new CatalogError(`${who}: "${field}" must be an array of non-empty strings`, "marketplace.toml");
  }
  return v as string[];
}

function assertName(name: string, who: string): string {
  if (!NAME_RE.test(name)) {
    throw new CatalogError(
      `${who}: "${name}" must be kebab-case (lowercase letters, digits and single hyphens)`,
      "marketplace.toml",
    );
  }
  return name;
}

/** Read and validate marketplace.toml. Does not touch the filesystem tree. */
export async function loadMarketplaceSpec(path: string): Promise<MarketplaceSpec> {
  const raw = tomlParse(await readFile(path, "utf8")) as Record<string, unknown>;

  if (raw["schema_version"] !== 1) {
    throw new CatalogError(`schema_version must be 1 (got ${String(raw["schema_version"])})`, "marketplace.toml");
  }

  const mRaw = raw["marketplace"];
  if (typeof mRaw !== "object" || mRaw === null || Array.isArray(mRaw)) {
    throw new CatalogError(`missing [marketplace] table`, "marketplace.toml");
  }
  const m = mRaw as Record<string, unknown>;
  for (const k of Object.keys(m)) {
    if (!MARKETPLACE_KEYS.has(k)) {
      throw new CatalogError(`[marketplace]: unknown key "${k}"`, "marketplace.toml");
    }
  }

  const name = assertName(str(m["name"], "[marketplace]", "name"), "[marketplace]");
  if (RESERVED_MARKETPLACE_NAMES.has(name)) {
    throw new CatalogError(
      `[marketplace]: "${name}" is reserved by Claude Code for Anthropic-operated catalogues; pick a distinctive name`,
      "marketplace.toml",
    );
  }

  const renamesRaw = (m["renames"] ?? {}) as Record<string, unknown>;
  const renames: Record<string, string | null> = {};
  for (const [from, to] of Object.entries(renamesRaw)) {
    assertName(from, `[marketplace.renames]`);
    if (typeof to !== "string") {
      throw new CatalogError(
        `[marketplace.renames]: "${from}" must map to a plugin name, or "" for a removed plugin`,
        "marketplace.toml",
      );
    }
    renames[from] = to === "" ? null : assertName(to, `[marketplace.renames]`);
  }

  const pluginsRaw = raw["plugins"];
  if (!Array.isArray(pluginsRaw) || pluginsRaw.length === 0) {
    throw new CatalogError(`at least one [[plugins]] entry is required`, "marketplace.toml");
  }

  const seenNames = new Set<string>();
  const seenDirs = new Set<string>();
  const plugins: PluginSpec[] = pluginsRaw.map((pRaw) => {
    if (typeof pRaw !== "object" || pRaw === null || Array.isArray(pRaw)) {
      throw new CatalogError(`[[plugins]] entries must be tables`, "marketplace.toml");
    }
    const p = pRaw as Record<string, unknown>;
    const who = `[[plugins]] "${String(p["name"] ?? "<unnamed>")}"`;
    for (const k of Object.keys(p)) {
      if (!PLUGIN_KEYS.has(k)) throw new CatalogError(`${who}: unknown key "${k}"`, "marketplace.toml");
    }
    const pname = assertName(str(p["name"], who, "name"), who);
    if (seenNames.has(pname)) throw new CatalogError(`${who}: duplicate plugin name`, "marketplace.toml");
    seenNames.add(pname);

    const dir = str(p["dir"], who, "dir");
    if (dir.includes("/") || dir.includes("\\") || dir === "." || dir === "..") {
      throw new CatalogError(`${who}: "dir" must be a single directory name under plugin_root`, "marketplace.toml");
    }
    if (seenDirs.has(dir)) throw new CatalogError(`${who}: duplicate plugin dir "${dir}"`, "marketplace.toml");
    seenDirs.add(dir);

    const skills = p["skills"] === undefined ? [] : strArray(p["skills"], who, "skills");
    const agents = p["agents"] === undefined ? [] : strArray(p["agents"], who, "agents");
    if (skills.length === 0 && agents.length === 0) {
      throw new CatalogError(`${who}: declares no skills and no agents`, "marketplace.toml");
    }

    return {
      name: pname,
      dir,
      displayName: str(p["display_name"], who, "display_name"),
      description: str(p["description"], who, "description"),
      category: str(p["category"], who, "category"),
      keywords: strArray(p["keywords"], who, "keywords"),
      skills: [...skills].sort(),
      agents: [...agents].sort(),
    };
  });

  if (renames[name] !== undefined) {
    // Nothing forbids it, but renaming a plugin to the marketplace's own name is
    // almost always a copy/paste slip.
    throw new CatalogError(`[marketplace.renames]: "${name}" is the marketplace name, not a plugin`, "marketplace.toml");
  }
  for (const [from, to] of Object.entries(renames)) {
    if (seenNames.has(from)) {
      throw new CatalogError(
        `[marketplace.renames]: "${from}" is still a live plugin; a rename source must no longer exist`,
        "marketplace.toml",
      );
    }
    if (to !== null && !seenNames.has(to)) {
      throw new CatalogError(`[marketplace.renames]: "${from}" points at unknown plugin "${to}"`, "marketplace.toml");
    }
  }

  return {
    name,
    displayName: str(m["display_name"], "[marketplace]", "display_name"),
    description: str(m["description"], "[marketplace]", "description"),
    ownerName: str(m["owner_name"], "[marketplace]", "owner_name"),
    ownerEmail: typeof m["owner_email"] === "string" ? m["owner_email"] : undefined,
    ownerUrl: typeof m["owner_url"] === "string" ? m["owner_url"] : undefined,
    homepage: str(m["homepage"], "[marketplace]", "homepage"),
    repository: str(m["repository"], "[marketplace]", "repository"),
    license: str(m["license"], "[marketplace]", "license"),
    pluginRoot: str(m["plugin_root"], "[marketplace]", "plugin_root"),
    renames,
    plugins: [...plugins].sort((a, b) => a.name.localeCompare(b.name)),
  };
}

/** Read VERSION and validate it is a bare semver string. */
export async function readVersion(repoRoot: string): Promise<string> {
  const path = join(repoRoot, "VERSION");
  if (!existsSync(path)) {
    throw new CatalogError(`missing VERSION file; it is the single version source of truth`, "VERSION");
  }
  const v = (await readFile(path, "utf8")).trim();
  if (!SEMVER_RE.test(v)) {
    throw new CatalogError(`must contain a bare MAJOR.MINOR.PATCH version (got "${v}")`, "VERSION");
  }
  return v;
}

async function dirNames(path: string): Promise<string[]> {
  if (!existsSync(path)) return [];
  const entries = await readdir(path, { withFileTypes: true });
  return entries.filter((e) => e.isDirectory()).map((e) => e.name).sort();
}

async function agentNames(path: string): Promise<string[]> {
  if (!existsSync(path)) return [];
  const entries = await readdir(path, { withFileTypes: true });
  return entries
    .filter((e) => e.isFile() && e.name.endsWith(".md"))
    .map((e) => e.name.slice(0, -3))
    .sort();
}

function sameSet(a: string[], b: string[]): boolean {
  return a.length === b.length && a.every((x, i) => x === b[i]);
}

/**
 * Verify each declared plugin directory holds exactly the components declared.
 * An undeclared skill on disk is an error, not a silent addition: it would ship
 * to users with no description review, no licence check and no budget accounting.
 */
export async function verifyPluginTree(spec: MarketplaceSpec, repoRoot: string): Promise<void> {
  for (const p of spec.plugins) {
    const root = join(repoRoot, spec.pluginRoot, p.dir);
    if (!existsSync(root)) {
      throw new CatalogError(`plugin "${p.name}": directory ${spec.pluginRoot}/${p.dir} does not exist`, "marketplace.toml");
    }
    const onDiskSkills = await dirNames(join(root, "skills"));
    if (!sameSet(onDiskSkills, p.skills)) {
      throw new CatalogError(
        `plugin "${p.name}": skills on disk [${onDiskSkills.join(", ")}] do not match declared [${p.skills.join(", ")}]`,
        "marketplace.toml",
      );
    }
    for (const s of p.skills) {
      if (!existsSync(join(root, "skills", s, "SKILL.md"))) {
        throw new CatalogError(`plugin "${p.name}": skill "${s}" has no SKILL.md`, "marketplace.toml");
      }
    }
    const onDiskAgents = await agentNames(join(root, "agents"));
    if (!sameSet(onDiskAgents, p.agents)) {
      throw new CatalogError(
        `plugin "${p.name}": agents on disk [${onDiskAgents.join(", ")}] do not match declared [${p.agents.join(", ")}]`,
        "marketplace.toml",
      );
    }
  }
}

/** Build the plugin.json object for one plugin. */
export function buildPluginManifest(spec: MarketplaceSpec, p: PluginSpec, version: string): Record<string, unknown> {
  const author: Record<string, string> = { name: spec.ownerName };
  if (spec.ownerEmail) author["email"] = spec.ownerEmail;
  if (spec.ownerUrl) author["url"] = spec.ownerUrl;
  return {
    name: p.name,
    displayName: p.displayName,
    description: p.description,
    version,
    author,
    homepage: spec.homepage,
    repository: spec.repository,
    license: spec.license,
    keywords: p.keywords,
  };
}

/** Build the marketplace.json object. */
export function buildMarketplaceManifest(spec: MarketplaceSpec, version: string): Record<string, unknown> {
  const owner: Record<string, string> = { name: spec.ownerName };
  if (spec.ownerEmail) owner["email"] = spec.ownerEmail;
  if (spec.ownerUrl) owner["url"] = spec.ownerUrl;

  const out: Record<string, unknown> = {
    name: spec.name,
    owner,
    description: spec.description,
    version,
    metadata: { pluginRoot: `./${spec.pluginRoot}` },
    plugins: spec.plugins.map((p) => {
      const author: Record<string, string> = { name: spec.ownerName };
      if (spec.ownerEmail) author["email"] = spec.ownerEmail;
      if (spec.ownerUrl) author["url"] = spec.ownerUrl;
      return {
        name: p.name,
        source: `./${spec.pluginRoot}/${p.dir}`,
        displayName: p.displayName,
        description: p.description,
        // MUST equal the plugin.json version: --strict fails the marketplace
        // otherwise, because plugin.json silently wins at install time.
        version,
        author,
        homepage: spec.homepage,
        repository: spec.repository,
        license: spec.license,
        category: p.category,
        keywords: p.keywords,
      };
    }),
  };
  if (Object.keys(spec.renames).length > 0) out["renames"] = spec.renames;
  return out;
}

export interface GeneratedFile {
  path: string;
  content: string;
}

/** Produce every manifest file without writing anything. */
export async function buildAll(repoRoot: string, specPath: string): Promise<GeneratedFile[]> {
  const spec = await loadMarketplaceSpec(specPath);
  await verifyPluginTree(spec, repoRoot);
  const version = await readVersion(repoRoot);

  const files: GeneratedFile[] = [
    {
      path: join(".claude-plugin", "marketplace.json"),
      content: JSON.stringify(buildMarketplaceManifest(spec, version), null, 2) + "\n",
    },
  ];
  for (const p of spec.plugins) {
    files.push({
      path: join(spec.pluginRoot, p.dir, ".claude-plugin", "plugin.json"),
      content: JSON.stringify(buildPluginManifest(spec, p, version), null, 2) + "\n",
    });
  }
  return files.sort((a, b) => a.path.localeCompare(b.path));
}

/** Write every manifest file. Returns the repo-relative paths written. */
export async function writeAll(repoRoot: string, specPath: string): Promise<string[]> {
  const files = await buildAll(repoRoot, specPath);
  for (const f of files) {
    const abs = join(repoRoot, f.path);
    await mkdir(join(abs, ".."), { recursive: true });
    await writeFile(abs, f.content, "utf8");
  }
  return files.map((f) => f.path);
}

/** Compare committed manifests against a fresh build. Returns stale paths. */
export async function findStale(repoRoot: string, specPath: string): Promise<string[]> {
  const files = await buildAll(repoRoot, specPath);
  const stale: string[] = [];
  for (const f of files) {
    const abs = join(repoRoot, f.path);
    if (!existsSync(abs)) {
      stale.push(f.path);
      continue;
    }
    if ((await readFile(abs, "utf8")) !== f.content) stale.push(f.path);
  }
  return stale;
}