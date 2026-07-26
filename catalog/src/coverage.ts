/**
 * Coverage contract: what "all skills" means for every configured source.
 *
 * Answers, deterministically and offline from skills-sources.toml +
 * skills-source.lock.json:
 *
 *   - which skills each source contributes to the catalog;
 *   - which upstream skills a `named` / `subpath` selection deliberately
 *     leaves out (curation is visible, not silent);
 *   - which selected skills have VANISHED upstream (a selected skill silently
 *     disappearing is the failure this module exists to catch);
 *   - which sources are runtime/metadata-only, so their bodies are not
 *     reproducible from committed inputs;
 *   - duplicate or conflicting canonical invocations.
 *
 * `problems` are hard failures wired into `catalog:check`. `observations` are
 * reviewable facts (e.g. newly available upstream skills) that must be visible
 * but must never auto-ingest curated or unlicensed content.
 */
import type { Lockfile, Manifest, SourceConfig, GitSourceConfig } from "./types.ts";

export type SelectionMode =
  | "all-skills"
  | "named"
  | "subpath"
  | "whole-repo"
  | "repo-owned"
  | "runtime";

export interface SourceCoverage {
  sourceId: string;
  displayName: string;
  selectionMode: SelectionMode;
  /** Human-readable statement of what the selection asks for. */
  selection: string;
  /** Names explicitly requested (only meaningful for `named`). */
  configuredNames: string[];
  /** Canonical invocations this source contributes. */
  catalogedSkills: string[];
  /** Requested names that produced no skill. Non-empty => hard problem. */
  missingSelected: string[];
  /**
   * Upstream skill directories present but not selected. `null` means the lock
   * predates upstream-availability recording, so this is genuinely unknown
   * rather than empty.
   */
  unselectedUpstream: string[] | null;
  /** False for runtime/metadata-only sources whose bodies are not republished. */
  bodiesReproducible: boolean;
  notes?: string;
}

export interface CoverageReport {
  schemaVersion: number;
  totals: {
    sources: number;
    /** Every canonical invocation the catalog exposes, runtime placeholders included. */
    catalogedSkills: number;
    /** Skills with a content digest in the lock (runtime placeholders have none). */
    digestTracked: number;
    curatedOut: number;
    bodiesNotReproducible: number;
  };
  sources: SourceCoverage[];
  /** Canonical invocations claimed by more than one source. */
  duplicateInvocations: string[];
  /** Hard failures: a selected skill vanished, or invocations collide. */
  problems: string[];
  /** Reviewable, non-fatal facts. */
  observations: string[];
}

function selectionOf(cfg: SourceConfig): { mode: SelectionMode; text: string; names: string[] } {
  if (cfg.type === "repo-owned") {
    return { mode: "repo-owned", text: `every skill under ${cfg.root}/`, names: [] };
  }
  if (cfg.type === "runtime") {
    return { mode: "runtime", text: `runtime (${cfg.runtimeKind}) — not resolvable from files`, names: [] };
  }
  const sel = (cfg as GitSourceConfig).selection;
  switch (sel.kind) {
    case "all-skills":
      return { mode: "all-skills", text: `every <dir>/SKILL.md under ${sel.root || "<repo root>"}/`, names: [] };
    case "named":
      return { mode: "named", text: `${sel.names.length} named skill(s) under ${sel.root}/`, names: [...sel.names] };
    case "subpath":
      return { mode: "subpath", text: `single skill at ${sel.path}`, names: [sel.path.split("/").pop() ?? sel.path] };
    case "whole-repo":
      return { mode: "whole-repo", text: `whole repo scanned for <dir>/SKILL.md`, names: [] };
  }
}

export function buildCoverageReport(manifest: Manifest, lock: Lockfile): CoverageReport {
  const sources: SourceCoverage[] = [];
  const problems: string[] = [];
  const observations: string[] = [];

  for (const cfg of Object.values(manifest.sources).sort((a, b) => a.id.localeCompare(b.id))) {
    const locked = lock.sources.find((s) => s.id === cfg.id);
    const { mode, text, names } = selectionOf(cfg);
    const cataloged = [...(locked?.canonicalSkills ?? [])].sort();

    // A selected name is satisfied when a selected path ends with that dir name.
    const selectedDirs = new Set(
      (locked?.selectedPaths ?? []).map((p) => p.split("/").filter(Boolean).pop() ?? p),
    );
    const missingSelected =
      mode === "named" || mode === "subpath"
        ? names.filter((n) => !selectedDirs.has(n)).sort()
        : [];

    const available = locked?.availableSkillDirs;
    const unselectedUpstream =
      available === undefined ? null : available.filter((d) => !selectedDirs.has(d)).sort();

    const bodiesReproducible =
      cfg.type !== "runtime" && (locked?.redistribution ?? "metadata-only") === "full";

    if (missingSelected.length > 0) {
      problems.push(
        `${cfg.id}: selected skill(s) missing upstream: ${missingSelected.join(", ")} — ` +
          `they were renamed or removed at ${locked?.resolvedRevision ?? "<unresolved>"}. ` +
          `Update selection.names in skills-sources.toml (and install.sh) or restore them.`,
      );
    }
    if (locked === undefined) {
      problems.push(`${cfg.id}: declared in skills-sources.toml but absent from the lock — run "bun run catalog:resolve".`);
    }
    if (unselectedUpstream && unselectedUpstream.length > 0) {
      observations.push(
        `${cfg.id}: ${unselectedUpstream.length} upstream skill(s) available but not selected: ${unselectedUpstream.join(", ")}`,
      );
    }
    if (unselectedUpstream === null && (mode === "named" || mode === "subpath")) {
      observations.push(
        `${cfg.id}: upstream availability not recorded in the lock yet; run "bun run catalog:resolve" to enable new-skill detection for this curated source.`,
      );
    }
    if (!bodiesReproducible) {
      observations.push(
        `${cfg.id}: metadata-only — bodies are not republished (${cfg.type === "runtime" ? (cfg as { reason: string }).reason.slice(0, 80) : "license does not permit redistribution"}).`,
      );
    }

    sources.push({
      sourceId: cfg.id,
      displayName: cfg.displayName,
      selectionMode: mode,
      selection: text,
      configuredNames: names,
      catalogedSkills: cataloged,
      missingSelected,
      unselectedUpstream,
      bodiesReproducible,
      notes: cfg.type === "git" ? cfg.notes : undefined,
    });
  }

  // Invocation integrity across the whole catalog. Uses each source's declared
  // canonical skills (not lock.skills) so runtime placeholders are included —
  // a runtime source colliding with a git skill is exactly the kind of
  // conflicting invocation this must catch.
  const seen = new Map<string, string[]>();
  for (const src of lock.sources) {
    for (const inv of src.canonicalSkills) {
      seen.set(inv, [...(seen.get(inv) ?? []), src.id]);
    }
  }
  const duplicateInvocations = [...seen.entries()]
    .filter(([, owners]) => owners.length > 1)
    .map(([inv, owners]) => `${inv} (${owners.sort().join(", ")})`)
    .sort();
  for (const dup of duplicateInvocations) {
    problems.push(`duplicate canonical invocation: ${dup}`);
  }

  return {
    schemaVersion: 1,
    totals: {
      sources: sources.length,
      catalogedSkills: sources.reduce((n, s) => n + s.catalogedSkills.length, 0),
      digestTracked: lock.skills.length,
      curatedOut: sources.reduce((n, s) => n + (s.unselectedUpstream?.length ?? 0), 0),
      bodiesNotReproducible: sources.filter((s) => !s.bodiesReproducible).length,
    },
    sources,
    duplicateInvocations,
    problems: problems.sort(),
    observations: observations.sort(),
  };
}

/** Deterministic markdown rendering (stable ordering, no timestamps). */
export function renderCoverageMarkdown(r: CoverageReport): string {
  const L: string[] = [];
  L.push("# Skills Catalog coverage");
  L.push("");
  L.push(
    `${r.totals.sources} sources, ${r.totals.catalogedSkills} cataloged skills ` +
      `(${r.totals.digestTracked} digest-tracked; the rest are runtime placeholders), ` +
      `${r.totals.curatedOut} upstream skill(s) deliberately not selected, ` +
      `${r.totals.bodiesNotReproducible} source(s) metadata-only.`,
  );
  L.push("");
  L.push("| source | selection | cataloged | not selected | bodies |");
  L.push("| --- | --- | ---: | ---: | --- |");
  for (const s of r.sources) {
    const unsel = s.unselectedUpstream === null ? "not recorded" : String(s.unselectedUpstream.length);
    L.push(
      `| \`${s.sourceId}\` | ${s.selectionMode}: ${s.selection} | ${s.catalogedSkills.length} | ${unsel} | ${s.bodiesReproducible ? "full" : "metadata-only"} |`,
    );
  }
  L.push("");
  if (r.problems.length) {
    L.push("## Problems");
    L.push("");
    for (const p of r.problems) L.push(`- ${p}`);
    L.push("");
  }
  if (r.observations.length) {
    L.push("## Observations");
    L.push("");
    for (const o of r.observations) L.push(`- ${o}`);
    L.push("");
  }
  return L.join("\n");
}