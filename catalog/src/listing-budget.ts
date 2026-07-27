/**
 * Model-visible skill-listing budget.
 *
 * WHY THIS EXISTS
 * ---------------
 * Every model-discoverable skill contributes `name` + `description` to a listing
 * that Claude Code injects into the system prompt at session start. That listing
 * has a hard character budget. When the budget runs out, Claude Code does not
 * error — it silently drops descriptions and lists the remaining skills by name
 * alone, which makes them effectively unroutable by the model.
 *
 * MEASURED BEHAVIOUR (Claude Code 2.1.220, see docs/skill-context-economy.md)
 * --------------------------------------------------------------------------
 * From the shipped changelog:
 *   - "Improved skill description handling: raised the listing cap from 250 to
 *      1,536 characters and added a startup warning when descriptions are
 *      truncated"                                            -> PER_SKILL_DESCRIPTION_CAP
 *   - "Skill character budget now scales with context window (2% of context),
 *      so users with larger context windows can see more skill descriptions
 *      without truncation"                                   -> BUDGET_FRACTION
 *   - "Skill-listing truncation is no longer shown as a startup notification —
 *      run /doctor for the full breakdown"                   -> why it goes unnoticed
 *
 * Corroborated against a live 1M-context session: descriptions were included
 * greedily in name order until roughly 20,000 characters were consumed, after
 * which only descriptions small enough to fit the remainder were kept. 2% of a
 * 1,024,000-token window is 20,480 characters, which matches.
 *
 * THE ENFORCED NUMBER
 * -------------------
 * The budget is a property of the *user's session*, not of this repository, so
 * we size ours against the smallest window a user is realistically on — a
 * 200k-token context — and then take only half of it, because the toolkit is a
 * guest in a session that also holds the user's own skills, project skills and
 * other plugins. 2% x 204,800 = 4,096; half is 2,048 characters.
 *
 * That is well inside the ~8,000-character target while staying derived from
 * behaviour we actually measured rather than from a round number.
 */
import { readFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { parse as yamlParse } from "yaml";
import { CatalogError } from "./types.ts";
import type { MarketplaceSpec } from "./marketplace.ts";

/** Claude Code truncates any single description to this many characters. */
export const PER_SKILL_DESCRIPTION_CAP = 1536;

/** Claude Code's listing budget as a fraction of the context window. */
export const BUDGET_FRACTION = 0.02;

/** The smallest context window we size against. */
export const REFERENCE_CONTEXT_TOKENS = 204_800;

/** Share of the user's listing budget this toolkit is allowed to occupy. */
export const TOOLKIT_BUDGET_SHARE = 0.5;

/** Characters this repository's model-visible listing may not exceed. */
export const LISTING_BUDGET_CHARS = Math.floor(
  REFERENCE_CONTEXT_TOKENS * BUDGET_FRACTION * TOOLKIT_BUDGET_SHARE,
);

export interface SkillListingEntry {
  plugin: string;
  skill: string;
  /** How the model sees it: `plugin:skill`. */
  invocation: string;
  /** Characters this entry contributes, or 0 when hidden from the model. */
  cost: number;
  /** Raw description length before the per-skill cap. */
  descriptionChars: number;
  /** True when frontmatter keeps it out of the model-visible listing. */
  modelHidden: boolean;
  hiddenBy?: string;
  /** Non-fatal observations (over-cap description, missing description, ...). */
  warnings: string[];
}

export interface PluginListingCost {
  plugin: string;
  cost: number;
  skills: SkillListingEntry[];
}

export interface ListingBudgetReport {
  budgetChars: number;
  totalChars: number;
  overBy: number;
  withinBudget: boolean;
  perSkillCap: number;
  modelVisibleSkills: number;
  hiddenSkills: number;
  plugins: PluginListingCost[];
  warnings: string[];
}

/**
 * Cost of one listing entry.
 *
 * Modelled as `name: description` plus the two-character bullet and the newline
 * that separate entries. The exact framing Claude Code uses is not documented;
 * this over-counts slightly per entry, which is the safe direction for a budget.
 */
export function entryCost(invocation: string, description: string): number {
  return 2 + invocation.length + 2 + Math.min(description.length, PER_SKILL_DESCRIPTION_CAP) + 1;
}

interface Frontmatter {
  name?: unknown;
  description?: unknown;
  "disable-model-invocation"?: unknown;
  "user-invocable"?: unknown;
}

/** Parse a SKILL.md's YAML frontmatter block. */
export function parseFrontmatter(source: string, file: string): Frontmatter {
  if (!source.startsWith("---")) {
    throw new CatalogError(`missing YAML frontmatter`, file);
  }
  const end = source.indexOf("\n---", 3);
  if (end === -1) {
    throw new CatalogError(`unterminated YAML frontmatter`, file);
  }
  const block = source.slice(source.indexOf("\n") + 1, end + 1);
  const parsed = yamlParse(block) as unknown;
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    throw new CatalogError(`frontmatter must be a YAML mapping`, file);
  }
  return parsed as Frontmatter;
}

/**
 * Build the listing-cost report for every skill this repository ships.
 *
 * Only repo-owned plugins are measured. Installer-fetched third-party packs are
 * the user's explicit choice and are reported separately by `catalog:coverage`;
 * failing CI on someone else's description length would be noise we cannot fix.
 */
export async function buildListingBudgetReport(
  repoRoot: string,
  spec: MarketplaceSpec,
  budgetChars: number = LISTING_BUDGET_CHARS,
): Promise<ListingBudgetReport> {
  const plugins: PluginListingCost[] = [];
  const warnings: string[] = [];
  let total = 0;
  let visible = 0;
  let hidden = 0;

  for (const p of spec.plugins) {
    const entries: SkillListingEntry[] = [];
    for (const skill of p.skills) {
      const rel = join(spec.pluginRoot, p.dir, "skills", skill, "SKILL.md");
      const abs = join(repoRoot, rel);
      if (!existsSync(abs)) throw new CatalogError(`declared skill has no SKILL.md`, rel);
      const fm = parseFrontmatter(await readFile(abs, "utf8"), rel);

      const skillWarnings: string[] = [];
      if (fm.name !== skill) {
        skillWarnings.push(`frontmatter name "${String(fm.name)}" does not match directory "${skill}"`);
      }
      const description = typeof fm.description === "string" ? fm.description.replace(/\s+/g, " ").trim() : "";
      if (!description) skillWarnings.push("no description — the model cannot route to it");

      // `disable-model-invocation: true` removes a skill from the model-visible
      // listing entirely while leaving /<plugin>:<skill> working for the user.
      const disabled = fm["disable-model-invocation"] === true;
      const invocation = `${p.name}:${skill}`;
      const cost = disabled ? 0 : entryCost(invocation, description);

      if (!disabled && description.length > PER_SKILL_DESCRIPTION_CAP) {
        skillWarnings.push(
          `description is ${description.length} chars; Claude Code truncates at ${PER_SKILL_DESCRIPTION_CAP}`,
        );
      }

      entries.push({
        plugin: p.name,
        skill,
        invocation,
        cost,
        descriptionChars: description.length,
        modelHidden: disabled,
        hiddenBy: disabled ? "disable-model-invocation" : undefined,
        warnings: skillWarnings,
      });
      for (const w of skillWarnings) warnings.push(`${invocation}: ${w}`);
      total += cost;
      if (disabled) hidden += 1;
      else visible += 1;
    }
    plugins.push({
      plugin: p.name,
      cost: entries.reduce((n, e) => n + e.cost, 0),
      skills: entries.sort((a, b) => b.cost - a.cost || a.skill.localeCompare(b.skill)),
    });
  }

  return {
    budgetChars,
    totalChars: total,
    overBy: Math.max(0, total - budgetChars),
    withinBudget: total <= budgetChars,
    perSkillCap: PER_SKILL_DESCRIPTION_CAP,
    modelVisibleSkills: visible,
    hiddenSkills: hidden,
    plugins: plugins.sort((a, b) => b.cost - a.cost || a.plugin.localeCompare(b.plugin)),
    warnings,
  };
}

/** Human-readable breakdown, per package and per skill. */
export function renderListingBudgetReport(r: ListingBudgetReport): string {
  const pct = r.budgetChars > 0 ? Math.round((r.totalChars / r.budgetChars) * 100) : 0;
  const lines: string[] = [
    `skill listing budget: ${r.totalChars} / ${r.budgetChars} chars (${pct}%)`,
    `  ${r.modelVisibleSkills} model-visible skill(s), ${r.hiddenSkills} user-invocable-only`,
    "",
  ];
  for (const p of r.plugins) {
    lines.push(`  ${p.plugin.padEnd(20)} ${String(p.cost).padStart(5)} chars`);
    for (const s of p.skills) {
      const tag = s.modelHidden ? `hidden (${s.hiddenBy})` : `${s.cost} chars`;
      lines.push(`      ${s.skill.padEnd(22)} ${tag}`);
    }
  }
  if (r.warnings.length > 0) {
    lines.push("", "  warnings:");
    for (const w of r.warnings) lines.push(`    - ${w}`);
  }
  if (!r.withinBudget) {
    lines.push(
      "",
      `  OVER BUDGET by ${r.overBy} chars.`,
      `  Shorten the largest descriptions above, or set "disable-model-invocation: true"`,
      `  on skills a user always reaches for by name.`,
    );
  }
  return lines.join("\n");
}