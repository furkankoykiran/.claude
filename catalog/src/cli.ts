#!/usr/bin/env bun
/**
 * Skills Catalog CLI.
 *
 *   bun run catalog/src/cli.ts resolve [--update]
 *   bun run catalog/src/cli.ts generate [--base path/to/skills-catalog.json]
 *   bun run catalog/src/cli.ts check
 *   bun run catalog/src/cli.ts diff    [--base path/to/skills-catalog.json]
 *   bun run catalog/src/cli.ts marketplace [--check]
 *   bun run catalog/src/cli.ts budget      [--json]
 *
 * `resolve` may touch the network (fetches pinned SHAs; `--update` advances
 * moving refs). Everything else runs strictly offline from the committed
 * manifest + lock + cache + marketplace.toml.
 */
import { readFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { join, resolve as pathResolve } from "node:path";
import { loadManifest } from "./manifest.ts";
import { resolveCatalog, type ResolveMode } from "./resolver.ts";
import { generateAll, buildCatalogJson } from "./generate.ts";
import { diffCatalogs } from "./diff.ts";
import { runCheck } from "./check.ts";
import { info, warn, error, dim } from "./log.ts";
import type { Catalog, Lockfile } from "./types.ts";

const REPO_ROOT = pathResolve(import.meta.dirname, "..", "..");
const MANIFEST_PATH = join(REPO_ROOT, "skills-sources.toml");
const LOCK_PATH = join(REPO_ROOT, "skills-source.lock.json");
const CACHE_DIR = join(REPO_ROOT, "catalog", "cache");
const INSTALL_SH = join(REPO_ROOT, "install.sh");
const MARKETPLACE_TOML = join(REPO_ROOT, "marketplace.toml");

function arg(name: string): string | null {
  const i = process.argv.indexOf(name);
  return i >= 0 && process.argv[i + 1] ? process.argv[i + 1]! : null;
}
function has(name: string): boolean {
  return process.argv.includes(name);
}

async function loadLock(): Promise<Lockfile | null> {
  if (!existsSync(LOCK_PATH)) return null;
  return JSON.parse(await readFile(LOCK_PATH, "utf8")) as Lockfile;
}

async function loadBaseCatalog(path: string | null): Promise<{ catalog: Catalog | null; name: string | null }> {
  if (!path) return { catalog: null, name: null };
  if (!existsSync(path)) {
    warn(`base catalog not found at ${path}; diffing against empty base`);
    return { catalog: null, name: path };
  }
  const catalog = JSON.parse(await readFile(path, "utf8")) as Catalog;
  return { catalog, name: path };
}

async function doResolve(update: boolean): Promise<void> {
  const manifest = await loadManifest(MANIFEST_PATH);
  const lock = await loadLock();
  const mode: ResolveMode = update ? "update" : "lock";
  info(`resolving ${Object.keys(manifest.sources).length} sources (mode=${mode})`);
  const resolved = await resolveCatalog(manifest, { mode, lock, cacheDir: CACHE_DIR, repoRoot: REPO_ROOT });

  const { writeFile } = await import("node:fs/promises");
  await writeFile(LOCK_PATH, JSON.stringify(resolved.lock, null, 2) + "\n", "utf8");

  const totalSkills = resolved.skills.length;
  const redistributable = resolved.skills.filter((s) => s.license.redistribution === "full").length;
  dim(`resolved ${resolved.sourceMeta.length} sources, ${totalSkills} skills (${redistributable} redistributable)`);
  for (const w of resolved.warnings) warn(w);
  info(`lock written: ${LOCK_PATH}`);
}

async function doGenerate(): Promise<void> {
  const manifest = await loadManifest(MANIFEST_PATH);
  const lock = await loadLock();
  if (!lock) throw new Error("no skills-source.lock.json; run `bun run catalog:resolve` first");
  const base = await loadBaseCatalog(arg("--base"));
  const resolved = await resolveCatalog(manifest, { mode: "cache", lock, cacheDir: CACHE_DIR, repoRoot: REPO_ROOT });
  const catalog = buildCatalogJson(resolved);
  const diff = diffCatalogs(catalog, base.catalog, base.name);
  const { written } = await generateAll(resolved, { outDir: REPO_ROOT, lock, diff });
  dim(`catalog: ${catalog.totals.skills} skills across ${catalog.totals.sources} sources`);
  dim(`diff vs ${base.name ?? "(none)"}: +${diff.summary.added} ~${diff.summary.updated} -${diff.summary.removed} >${diff.summary.renamed}${diff.summary.manualReviewRequired ? " [manual-review-required]" : ""}`);
  info(`generated ${written.length} files`);
}

async function doCheck(): Promise<void> {
  const manifest = await loadManifest(MANIFEST_PATH);
  const lock = await loadLock();
  if (!lock) throw new Error("no skills-source.lock.json; run `bun run catalog:resolve` first");
  const resolved = await resolveCatalog(manifest, { mode: "cache", lock, cacheDir: CACHE_DIR, repoRoot: REPO_ROOT });
  const result = await runCheck(manifest, lock, resolved, {
    repoRoot: REPO_ROOT,
    manifestPath: MANIFEST_PATH,
    installShPath: INSTALL_SH,
    cacheDir: CACHE_DIR,
  });
  info(`check: OK (${result.skillsChecked} skills, ${result.sourcesChecked} sources, deterministic=${result.deterministic})`);
}

async function doCoverage(): Promise<void> {
  const { buildCoverageReport, renderCoverageMarkdown } = await import("./coverage.ts");
  const manifest = await loadManifest(MANIFEST_PATH);
  const lock = await loadLock();
  if (!lock) throw new Error("no skills-source.lock.json; run `bun run catalog:resolve` first");
  const report = buildCoverageReport(manifest, lock);
  if (has("--json")) {
    process.stdout.write(JSON.stringify(report, null, 2) + "\n");
  } else {
    process.stdout.write(renderCoverageMarkdown(report) + "\n");
  }
  if (report.problems.length > 0) process.exitCode = 1;
}

async function doMarketplace(): Promise<void> {
  const { writeAll, findStale } = await import("./marketplace.ts");
  if (has("--check")) {
    const stale = await findStale(REPO_ROOT, MARKETPLACE_TOML);
    if (stale.length > 0) {
      for (const p of stale) error(`stale or missing: ${p}`);
      throw new Error(`${stale.length} marketplace manifest(s) out of date; run "bun run marketplace:generate"`);
    }
    info("marketplace: OK (manifests match marketplace.toml + VERSION)");
    return;
  }
  const written = await writeAll(REPO_ROOT, MARKETPLACE_TOML);
  for (const p of written) dim(`  ${p}`);
  info(`generated ${written.length} manifest(s)`);
}

async function doBudget(): Promise<void> {
  const { loadMarketplaceSpec } = await import("./marketplace.ts");
  const { buildListingBudgetReport, renderListingBudgetReport } = await import("./listing-budget.ts");
  const spec = await loadMarketplaceSpec(MARKETPLACE_TOML);
  const report = await buildListingBudgetReport(REPO_ROOT, spec);
  if (has("--json")) {
    process.stdout.write(JSON.stringify(report, null, 2) + "\n");
  } else {
    process.stdout.write(renderListingBudgetReport(report) + "\n");
  }
  if (!report.withinBudget) {
    error(`skill listing is ${report.overBy} char(s) over the ${report.budgetChars}-char budget`);
    process.exitCode = 1;
  }
}

async function doDiff(): Promise<void> {
  const manifest = await loadManifest(MANIFEST_PATH);
  const lock = await loadLock();
  if (!lock) throw new Error("no skills-source.lock.json; run `bun run catalog:resolve` first");
  const base = await loadBaseCatalog(arg("--base"));
  const resolved = await resolveCatalog(manifest, { mode: "cache", lock, cacheDir: CACHE_DIR, repoRoot: REPO_ROOT });
  const catalog = buildCatalogJson(resolved);
  const diff = diffCatalogs(catalog, base.catalog, base.name);
  process.stdout.write(JSON.stringify(diff, null, 2) + "\n");
  dim(`summary: +${diff.summary.added} ~${diff.summary.updated} -${diff.summary.removed} >${diff.summary.renamed}`);
}

async function main(): Promise<void> {
  const cmd = process.argv[2];
  try {
    switch (cmd) {
      case "resolve":
        return await doResolve(has("--update"));
      case "generate":
        return await doGenerate();
      case "check":
        return await doCheck();
      case "diff":
        return await doDiff();
      case "coverage":
        return await doCoverage();
      case "marketplace":
        return await doMarketplace();
      case "budget":
        return await doBudget();
      default:
        process.stderr.write(
          `usage: bun run catalog/src/cli.ts <resolve [--update] | generate [--base F] | check | diff [--base F] | coverage [--json] | marketplace [--check] | budget [--json]>\n`,
        );
        process.exit(cmd ? 1 : 0);
    }
  } catch (e) {
    error((e as Error).message);
    process.exit(1);
  }
}

await main();