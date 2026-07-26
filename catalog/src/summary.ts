#!/usr/bin/env bun
/**
 * Catalog summary / release-notes helper for CI.
 *
 *   bun run catalog/src/summary.ts                 # markdown totals bullets
 *   bun run catalog/src/summary.ts --oneline       # single line of counts
 *   bun run catalog/src/summary.ts --release-notes # full release notes (needs TAG, SHA env)
 *
 * Replaces fragile inline `bun -e` snippets in the workflows.
 */
import { readFile } from "node:fs/promises";
import { createHash } from "node:crypto";

async function readJson(p: string): Promise<any | null> {
  try {
    return JSON.parse(await readFile(p, "utf8"));
  } catch {
    return null;
  }
}

const args = new Set(process.argv.slice(2));

async function main() {
  const catalog = await readJson("catalog/generated/skills-catalog.json");
  const diff = await readJson("catalog/generated/skills-catalog-diff.json");

  if (args.has("--oneline")) {
    const t = catalog?.totals ?? {};
    let line = `sources=${t.sources ?? 0} skills=${t.skills ?? 0} redistributable=${t.redistributable ?? 0} runtimeOnly=${t.runtimeOnly ?? 0}`;
    if (diff?.summary) {
      const s = diff.summary;
      line += ` added=${s.added} updated=${s.updated} removed=${s.removed} renamed=${s.renamed} securitySensitive=${s.securitySensitive} manualReviewRequired=${s.manualReviewRequired}`;
    }
    process.stdout.write(line + "\n");
    return;
  }

  if (args.has("--release-notes")) {
    const TAG = process.env["TAG"] ?? "";
    const SHA = process.env["SHA"] ?? "";
    const s = diff?.summary ?? { added: 0, updated: 0, removed: 0, renamed: 0, securitySensitive: 0, manualReviewRequired: false };
    const lock = (await readJson("skills-source.lock.json")) ?? { sources: [] };
    const revs = (lock.sources as Array<{ id: string; resolvedRevision?: string }>)
      .filter((x) => x.resolvedRevision)
      .map((x) => `- ${x.id}: ${x.resolvedRevision!.slice(0, 12)}`)
      .join("\n");
    process.stdout.write(
      `## ${TAG}\n\nAutomated SemVer release from main (${SHA.slice(0, 10)}).\n\n` +
        `### Changes vs previous release\n` +
        `- added: ${s.added}\n- updated: ${s.updated}\n- removed: ${s.removed}\n- renamed: ${s.renamed}\n` +
        `- security-sensitive: ${s.securitySensitive}\n- manual-review-required: ${s.manualReviewRequired}\n\n` +
        `### Source revisions\n${revs}\n`,
    );
    return;
  }

  // Default: markdown totals bullets.
  const t = catalog?.totals ?? {};
  process.stdout.write(
    `## Skills Catalog\n` +
      `- sources: ${t.sources ?? 0}\n` +
      `- skills: ${t.skills ?? 0}\n` +
      `- redistributable: ${t.redistributable ?? 0}\n` +
      `- runtime-only: ${t.runtimeOnly ?? 0}\n`,
  );
}

await main();