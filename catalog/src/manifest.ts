/**
 * Parse and validate skills-sources.toml into a typed Manifest.
 *
 * The manifest is the declarative source of truth for every component the
 * installer touches. install.sh is NOT refactored to consume it (that would be
 * a disproportionate, risky rewrite of a carefully-tuned fail-soft script);
 * instead a strict parity test (catalog/src/parity.ts) asserts the two never
 * drift. The manifest contains no executable logic — only data.
 */
import { parse as tomlParse } from "smol-toml";
import { readFile } from "node:fs/promises";
import type {
  GitSourceConfig,
  GitSelection,
  Manifest,
  RepoOwnedSourceConfig,
  RuntimeSourceConfig,
  SourceConfig,
} from "./types.ts";
import { CatalogError } from "./types.ts";

const KNOWN_GIT_KINDS = new Set(["all-skills", "named", "whole-repo", "subpath"]);

function need<T = unknown>(obj: Record<string, unknown>, key: string, who: string): T {
  if (!(key in obj) || obj[key] === undefined || obj[key] === null) {
    throw new CatalogError(`manifest source "${who}" is missing required field "${key}"`, "skills-sources.toml");
  }
  return obj[key] as T;
}

function asString(v: unknown, who: string, field: string): string {
  if (typeof v !== "string" || v.length === 0) {
    throw new CatalogError(`manifest source "${who}" field "${field}" must be a non-empty string`, "skills-sources.toml");
  }
  return v;
}

function asStringArray(v: unknown, who: string, field: string): string[] {
  if (!Array.isArray(v) || v.some((x) => typeof x !== "string")) {
    throw new CatalogError(`manifest source "${who}" field "${field}" must be an array of strings`, "skills-sources.toml");
  }
  return v as string[];
}

function parseSelection(raw: unknown, id: string): GitSelection {
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) {
    throw new CatalogError(`git source "${id}" requires a "selection" table`, "skills-sources.toml");
  }
  const sel = raw as Record<string, unknown>;
  const kind = asString(sel["kind"], id, "selection.kind");
  if (!KNOWN_GIT_KINDS.has(kind)) {
    throw new CatalogError(`git source "${id}" has unknown selection.kind "${kind}"`, "skills-sources.toml");
  }
  switch (kind) {
    case "all-skills":
      return {
        kind: "all-skills",
        // root="" means the repo root itself (flat layout, e.g. gstack).
        root: typeof sel["root"] === "string" ? sel["root"] : "",
        requireSkillMd: sel["require_skill_md"] === true,
      };
    case "named":
      return {
        kind: "named",
        root: asString(sel["root"], id, "selection.root"),
        names: asStringArray(sel["names"], id, "selection.names"),
      };
    case "whole-repo":
      return { kind: "whole-repo", dest: asString(sel["dest"], id, "selection.dest") };
    case "subpath":
      return {
        kind: "subpath",
        path: asString(sel["path"], id, "selection.path"),
        dest: asString(sel["dest"], id, "selection.dest"),
      };
    default:
      throw new CatalogError(`git source "${id}" has unknown selection.kind "${kind}"`, "skills-sources.toml");
  }
}

function parseGit(id: string, raw: Record<string, unknown>): GitSourceConfig {
  const redistribution = raw["redistribution"] === "metadata-only" ? "metadata-only" : "full";
  const licenseNotice = Array.isArray(raw["license_notice_files"])
    ? asStringArray(raw["license_notice_files"], id, "license_notice_files")
    : ["LICENSE"];
  return {
    type: "git",
    id,
    displayName: asString(need(raw, "display_name", id), id, "display_name"),
    repo: asString(need(raw, "repo", id), id, "repo"),
    ref: asString(need(raw, "ref", id), id, "ref"),
    selection: parseSelection(need(raw, "selection", id), id),
    destinationPrefix: typeof raw["destination_prefix"] === "string" ? raw["destination_prefix"] : "skills/",
    pack: asString(need(raw, "pack", id), id, "pack"),
    license: typeof raw["license"] === "string" ? raw["license"] : "unknown",
    redistribution,
    licenseNoticeFiles: licenseNotice,
    installStep: asString(need(raw, "install_step", id), id, "install_step"),
    notes: typeof raw["notes"] === "string" ? raw["notes"] : undefined,
  };
}

function parseRuntime(id: string, raw: Record<string, unknown>): RuntimeSourceConfig {
  const kind = asString(need(raw, "runtime_kind", id), id, "runtime_kind");
  if (!["plugin-marketplace", "pypi-package", "installer-script"].includes(kind)) {
    throw new CatalogError(`runtime source "${id}" has unknown runtime_kind "${kind}"`, "skills-sources.toml");
  }
  const out: RuntimeSourceConfig = {
    type: "runtime",
    id,
    displayName: asString(need(raw, "display_name", id), id, "display_name"),
    runtimeKind: kind as RuntimeSourceConfig["runtimeKind"],
    reason: asString(need(raw, "reason", id), id, "reason"),
  };
  if (Array.isArray(raw["marketplaces"])) out.marketplaces = asStringArray(raw["marketplaces"], id, "marketplaces");
  if (Array.isArray(raw["plugins"])) out.plugins = asStringArray(raw["plugins"], id, "plugins");
  if (typeof raw["pypi_package"] === "string") out.pypiPackage = raw["pypi_package"];
  if (typeof raw["installer_url"] === "string") out.installerUrl = raw["installer_url"];
  return out;
}

function parseRepoOwned(id: string, raw: Record<string, unknown>): RepoOwnedSourceConfig {
  return {
    type: "repo-owned",
    id,
    displayName: asString(need(raw, "display_name", id), id, "display_name"),
    root: typeof raw["root"] === "string" ? raw["root"] : "skills",
  };
}

export function parseManifest(text: string): Manifest {
  let parsed: Record<string, unknown>;
  try {
    parsed = tomlParse(text) as Record<string, unknown>;
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    throw new CatalogError(`failed to parse skills-sources.toml: ${msg}`, "skills-sources.toml");
  }

  const schemaVersion = typeof parsed["schema_version"] === "number" ? parsed["schema_version"] : 1;
  const sourcesRaw = parsed["sources"];
  if (typeof sourcesRaw !== "object" || sourcesRaw === null || Array.isArray(sourcesRaw)) {
    throw new CatalogError("manifest must contain a [sources] table", "skills-sources.toml");
  }

  const sources: Record<string, SourceConfig> = {};
  for (const [id, raw] of Object.entries(sourcesRaw as Record<string, unknown>)) {
    if (typeof raw !== "object" || raw === null || Array.isArray(raw)) {
      throw new CatalogError(`source "${id}" must be a table`, "skills-sources.toml");
    }
    const r = raw as Record<string, unknown>;
    const type = asString(r["type"], id, "type");
    if (type === "git") sources[id] = parseGit(id, r);
    else if (type === "runtime") sources[id] = parseRuntime(id, r);
    else if (type === "repo-owned") sources[id] = parseRepoOwned(id, r);
    else throw new CatalogError(`source "${id}" has unknown type "${type}"`, "skills-sources.toml");
  }

  return { sources, schemaVersion };
}

export async function loadManifest(path: string): Promise<Manifest> {
  const text = await readFile(path, "utf8");
  return parseManifest(text);
}
