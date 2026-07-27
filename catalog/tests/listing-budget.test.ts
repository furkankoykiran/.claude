import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { mkdtemp, mkdir, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  entryCost,
  parseFrontmatter,
  buildListingBudgetReport,
  renderListingBudgetReport,
  PER_SKILL_DESCRIPTION_CAP,
  LISTING_BUDGET_CHARS,
  BUDGET_FRACTION,
  REFERENCE_CONTEXT_TOKENS,
  TOOLKIT_BUDGET_SHARE,
} from "../src/listing-budget.ts";
import type { MarketplaceSpec } from "../src/marketplace.ts";
import { CatalogError } from "../src/types.ts";

let root: string;

function spec(skills: string[]): MarketplaceSpec {
  return {
    name: "fk-toolkit",
    displayName: "T",
    description: "d",
    ownerName: "O",
    homepage: "h",
    repository: "r",
    license: "MIT",
    pluginRoot: "skills",
    renames: {},
    plugins: [
      {
        name: "fk-alpha",
        dir: "fk-alpha",
        displayName: "A",
        description: "a",
        category: "c",
        keywords: [],
        skills,
        agents: [],
      },
    ],
  };
}

async function writeSkill(skill: string, frontmatter: string): Promise<void> {
  const dir = join(root, "skills", "fk-alpha", "skills", skill);
  await mkdir(dir, { recursive: true });
  await writeFile(join(dir, "SKILL.md"), `---\n${frontmatter}\n---\n\nbody\n`);
}

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), "fkt-budget-"));
});

afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

describe("budget constants", () => {
  // These encode measured Claude Code 2.1.220 behaviour. If any of them changes,
  // docs/skill-context-economy.md must change with it — hence the assertions.
  it("derives the budget from the documented 2%-of-context rule", () => {
    expect(BUDGET_FRACTION).toBe(0.02);
    expect(REFERENCE_CONTEXT_TOKENS).toBe(204_800);
    expect(TOOLKIT_BUDGET_SHARE).toBe(0.5);
    expect(LISTING_BUDGET_CHARS).toBe(2048);
  });

  it("uses Claude Code's per-skill description cap", () => {
    expect(PER_SKILL_DESCRIPTION_CAP).toBe(1536);
  });
});

describe("entryCost", () => {
  it("counts the invocation, the separator and the description", () => {
    expect(entryCost("p:s", "abc")).toBe(2 + 3 + 2 + 3 + 1);
  });

  it("never counts more than the per-skill cap", () => {
    const huge = "x".repeat(PER_SKILL_DESCRIPTION_CAP * 3);
    expect(entryCost("p:s", huge)).toBe(2 + 3 + 2 + PER_SKILL_DESCRIPTION_CAP + 1);
  });
});

describe("parseFrontmatter", () => {
  it("rejects a file with no frontmatter", () => {
    expect(() => parseFrontmatter("# hello\n", "f")).toThrow(CatalogError);
  });

  it("rejects unterminated frontmatter", () => {
    expect(() => parseFrontmatter("---\nname: x\n", "f")).toThrow(CatalogError);
  });

  it("reads name and description", () => {
    const fm = parseFrontmatter("---\nname: x\ndescription: d\n---\nbody", "f");
    expect(fm.name).toBe("x");
    expect(fm.description).toBe("d");
  });
});

describe("buildListingBudgetReport", () => {
  it("charges a model-discoverable skill and reports it per plugin", async () => {
    await writeSkill("one", "name: one\ndescription: short");
    const r = await buildListingBudgetReport(root, spec(["one"]));
    expect(r.modelVisibleSkills).toBe(1);
    expect(r.hiddenSkills).toBe(0);
    expect(r.totalChars).toBe(entryCost("fk-alpha:one", "short"));
    expect(r.plugins[0]!.cost).toBe(r.totalChars);
    expect(r.withinBudget).toBe(true);
  });

  it("charges nothing for a user-invocable-only skill", async () => {
    await writeSkill("one", "name: one\ndescription: a very long description indeed\ndisable-model-invocation: true");
    const r = await buildListingBudgetReport(root, spec(["one"]));
    expect(r.totalChars).toBe(0);
    expect(r.hiddenSkills).toBe(1);
    expect(r.plugins[0]!.skills[0]!.modelHidden).toBe(true);
    expect(r.plugins[0]!.skills[0]!.hiddenBy).toBe("disable-model-invocation");
  });

  it("collapses whitespace so a folded YAML description is measured fairly", async () => {
    await writeSkill("one", "name: one\ndescription: |\n  line one\n  line two");
    const r = await buildListingBudgetReport(root, spec(["one"]));
    expect(r.plugins[0]!.skills[0]!.descriptionChars).toBe("line one line two".length);
  });

  it("warns when a description exceeds the cap Claude Code truncates at", async () => {
    await writeSkill("one", `name: one\ndescription: ${"x".repeat(PER_SKILL_DESCRIPTION_CAP + 10)}`);
    const r = await buildListingBudgetReport(root, spec(["one"]));
    expect(r.warnings.join(" ")).toMatch(/truncates at 1536/);
  });

  it("warns when a skill has no description at all", async () => {
    await writeSkill("one", "name: one");
    const r = await buildListingBudgetReport(root, spec(["one"]));
    expect(r.warnings.join(" ")).toMatch(/cannot route/);
  });

  it("warns when the frontmatter name disagrees with the directory", async () => {
    await writeSkill("one", "name: other\ndescription: d");
    const r = await buildListingBudgetReport(root, spec(["one"]));
    expect(r.warnings.join(" ")).toMatch(/does not match directory/);
  });

  it("reports over-budget with the exact overage", async () => {
    await writeSkill("one", `name: one\ndescription: ${"x".repeat(200)}`);
    const r = await buildListingBudgetReport(root, spec(["one"]), 50);
    expect(r.withinBudget).toBe(false);
    expect(r.overBy).toBe(r.totalChars - 50);
    expect(renderListingBudgetReport(r)).toMatch(/OVER BUDGET/);
  });

  it("fails loudly when a declared skill has no SKILL.md", async () => {
    await expect(buildListingBudgetReport(root, spec(["ghost"]))).rejects.toThrow(CatalogError);
  });

  it("orders plugins and skills by cost, so the breakdown is actionable", async () => {
    await writeSkill("small", "name: small\ndescription: s");
    await writeSkill("large", `name: large\ndescription: ${"x".repeat(300)}`);
    const r = await buildListingBudgetReport(root, spec(["small", "large"]));
    expect(r.plugins[0]!.skills.map((s) => s.skill)).toEqual(["large", "small"]);
  });
});