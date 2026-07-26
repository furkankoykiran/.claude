#!/usr/bin/env bun
/**
 * Render a diff report as review-facing markdown.
 *
 *   bun run catalog/src/change-summary.ts <diff.json> [--limit N]
 *
 * Every number and verdict comes from the ONE diff passed in, so the PR body
 * and the auto-merge decision can never disagree. (They used to: the body
 * printed catalog-wide totals computed against an empty base while the gate
 * used the diff against main.)
 */
import { readFileSync } from "node:fs";
import type { DiffReport } from "./diff.ts";

export function renderChangeSummary(d: DiffReport, limit = 40): string {
  const s = d.summary;
  const counts = `+${s.added} ~${s.updated} -${s.removed} >${s.renamed}`;
  const L: string[] = [];

  L.push(`**Change vs base:** \`${counts}\``);
  L.push("");
  L.push(
    s.manualReviewRequired
      ? `> **Manual review required.** This PR will NOT auto-merge.`
      : `> Routine change. Eligible for squash auto-merge once required checks pass.`,
  );
  L.push("");

  if (s.reviewReasons.length) {
    L.push("**Why review is required**");
    L.push("");
    for (const r of s.reviewReasons) L.push(`- \`${r}\``);
    L.push("");
  }

  if (d.changes.length) {
    L.push("| change | skill | source | review | reasons |");
    L.push("| --- | --- | --- | --- | --- |");
    for (const c of d.changes.slice(0, limit)) {
      const reasons = c.reasons.length ? c.reasons.map((r) => `\`${r}\``).join(" ") : "—";
      L.push(
        `| ${c.kind} | \`${c.key}\` | \`${c.sourceId ?? "?"}\` | ${c.manualReviewRequired ? "**yes**" : "no"} | ${reasons} |`,
      );
    }
    if (d.changes.length > limit) {
      L.push(`| … | _${d.changes.length - limit} more_ | | | |`);
    }
    L.push("");
  }

  L.push(
    `<sub>${s.licenseRestricted} metadata-only, ${s.runtimeOnly} runtime-only, ` +
      `${s.securitySensitive} security-sensitive${s.massChange ? ", mass change" : ""}.</sub>`,
  );
  return L.join("\n");
}

if (import.meta.main) {
  const path = process.argv[2];
  if (!path) {
    process.stderr.write("usage: change-summary.ts <diff.json> [--limit N]\n");
    process.exit(1);
  }
  const li = process.argv.indexOf("--limit");
  const limit = li > 0 ? Number(process.argv[li + 1]) : 40;
  const diff = JSON.parse(readFileSync(path, "utf8")) as DiffReport;
  process.stdout.write(renderChangeSummary(diff, limit) + "\n");
}