#!/usr/bin/env bun
/**
 * Compute the next release tag for the release workflow.
 *
 *   bun run catalog/src/release-tag.ts <latestTag|""> <diffJsonPath> [labelsCsv]
 *
 * Prints the next tag (e.g. v0.1.0) or "none" when no release should be cut.
 * Labels are a comma-separated list of PR labels (release:major|minor|patch).
 */
import { readFile } from "node:fs/promises";
import { nextTag } from "./semver.ts";
import type { DiffReport } from "./diff.ts";

async function main() {
  const latestTag = process.argv[2] && process.argv[2] !== '""' ? process.argv[2] : null;
  const diffPath = process.argv[3];
  const labelsCsv = process.argv[4] ?? "";
  const labels = labelsCsv ? labelsCsv.split(",").map((s) => s.trim()).filter(Boolean) : [];

  let diff: DiffReport | null = null;
  if (diffPath) {
    try {
      diff = JSON.parse(await readFile(diffPath, "utf8")) as DiffReport;
    } catch {
      diff = null;
    }
  }
  const result = nextTag(latestTag, diff, labels);
  process.stdout.write((result?.tag ?? "none") + "\n");
}

await main();