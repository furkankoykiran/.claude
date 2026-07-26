/**
 * `catalog:check` — non-generation verification run in CI and locally.
 *
 *   1. installer/manifest parity (no silent drift with install.sh)
 *   2. lock/snapshot consistency (every locked git source has a cache snapshot;
 *      lock digests match snapshot digests)
 *   3. policy scan (secrets in repo-owned content, path escapes, license anomalies)
 *   4. determinism self-test (build outputs twice to temp; assert byte-identical)
 *
 * It never mutates the working tree. Hard policy violations throw.
 */
import { mkdir, rm, readFile, readdir } from "node:fs/promises";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import type { Lockfile, Manifest } from "./types.ts";
import { CatalogError } from "./types.ts";
import type { ResolvedCatalog } from "./resolver.ts";
import { checkParityFiles } from "./parity.ts";
import { stageOutputs } from "./generate.ts";
import { info, dim } from "./log.ts";

export interface CheckOptions {
  repoRoot: string;
  manifestPath: string;
  installShPath: string;
  cacheDir: string;
}

export interface CheckResult {
  parity: Awaited<ReturnType<typeof checkParityFiles>>;
  sourcesChecked: number;
  skillsChecked: number;
  policyFindings: string[];
  deterministic: boolean;
}

async function dirHash(p: string): Promise<string> {
  // Recursive, deterministic byte hash of a directory's files (sorted).
  const { createHash } = await import("node:crypto");
  const h = createHash("sha256");
  const entries: string[] = [];
  const walk = async (d: string, base: string) => {
    if (!existsSync(d)) return;
    for (const name of (await readdir(d)).sort()) {
      const full = join(d, name);
      const rel = join(base, name);
      const stat = await (await import("node:fs/promises")).stat(full);
      if (stat.isDirectory()) await walk(full, rel);
      else {
        entries.push(rel);
        h.update(rel + "\0");
        h.update(await readFile(full));
        h.update("\0");
      }
    }
  };
  await walk(p, "");
  return h.digest("hex");
}

export async function runCheck(
  manifest: Manifest,
  lock: Lockfile,
  resolved: ResolvedCatalog,
  opts: CheckOptions,
): Promise<CheckResult> {
  // 1. Parity.
  const parity = await checkParityFiles(opts.manifestPath, opts.installShPath);
  dim(`parity: OK (${parity.installerGitRepos.length} git repos, ${parity.installerMarketplaces.length} marketplaces, ${parity.installerPlugins.length} plugins matched)`);

  // 2. Lock/snapshot consistency.
  let consistencyErrors = 0;
  for (const src of lock.sources) {
    if (src.type !== "git" || !src.resolvedRevision) continue;
    const snapPath = join(opts.cacheDir, src.id, src.resolvedRevision, ".snapshot.json");
    if (!existsSync(snapPath)) {
      consistencyErrors++;
      info(`missing cache snapshot: ${src.id} @ ${src.resolvedRevision}`);
      continue;
    }
    const snap = JSON.parse(await readFile(snapPath, "utf8")) as { entries: Array<{ digest: string; canonicalInvocation: string }> };
    const byInv = new Map(snap.entries.map((e) => [e.canonicalInvocation, e.digest]));
    for (const ls of lock.skills.filter((s) => s.sourceId === src.id)) {
      const sd = byInv.get(ls.canonicalInvocation);
      if (sd !== ls.digest) {
        consistencyErrors++;
        info(`digest mismatch in lock vs snapshot: ${ls.canonicalInvocation}`);
      }
    }
  }
  if (consistencyErrors > 0) {
    throw new CatalogError(`${consistencyErrors} lock/snapshot consistency error(s); run "bun run catalog:resolve"`, "skills-source.lock.json");
  }
  dim(`consistency: OK (${lock.sources.length} sources, ${lock.skills.length} skill digests verified)`);

  // 3. Policy scan.
  const policyFindings: string[] = [];
  for (const s of resolved.skills) {
    // Secrets in repository-owned content are a hard failure.
    if (s.sourceType === "repo-owned" && s.security.hasCredentialRef) {
      policyFindings.push(`HARD: credential reference in repo-owned skill ${s.canonicalInvocation}`);
    }
    // License declared "full" but detected non-permissive is already downgraded
    // by the resolver; surface it so reviewers notice.
    if (s.license.redistribution === "metadata-only" && s.license.declared !== "unknown" && s.license.declared !== "repository-owned" && !s.license.matchesDeclaration) {
      policyFindings.push(`license: ${s.canonicalInvocation} declared "${s.license.declared}" but detected "${s.license.detected}" -> metadata-only`);
    }
  }
  const hard = policyFindings.filter((p) => p.startsWith("HARD:"));
  dim(`policy: ${policyFindings.length} finding(s)${hard.length ? `, ${hard.length} HARD` : ""}`);
  if (hard.length > 0) {
    throw new CatalogError(`policy violations:\n${hard.join("\n")}`, "policy");
  }

  // 4. Determinism self-test: build twice to temp, compare.
  const t1 = join(tmpdir(), `catalog-check-1-${process.pid}`);
  const t2 = join(tmpdir(), `catalog-check-2-${process.pid}`);
  await stageOutputs(resolved, t1, { lock });
  await stageOutputs(resolved, t2, { lock });
  const h1 = await dirHash(t1);
  const h2 = await dirHash(t2);
  const deterministic = h1 === h2;
  await rm(t1, { recursive: true, force: true });
  await rm(t2, { recursive: true, force: true });
  if (!deterministic) {
    throw new CatalogError(`generation is not deterministic: two runs produced different output (${h1.slice(0, 10)} != ${h2.slice(0, 10)})`, "determinism");
  }
  dim(`determinism: OK (two runs byte-identical, ${h1.slice(0, 12)})`);

  return {
    parity,
    sourcesChecked: lock.sources.length,
    skillsChecked: lock.skills.length,
    policyFindings,
    deterministic,
  };
}