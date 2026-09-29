import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { mkdir, mkdtemp, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import {
  buildInstructionBudgetReport,
  instructionImports,
  INSTRUCTION_BUDGET_BYTES,
} from "../src/instruction-budget.ts";
import { loadMarketplaceSpec, type MarketplaceSpec } from "../src/marketplace.ts";

let root: string;
const spec: MarketplaceSpec = {
  name: "test", displayName: "Test", description: "Test", ownerName: "Test",
  homepage: "https://example.com", repository: "https://example.com", license: "MIT",
  pluginRoot: "skills", renames: {}, plugins: [],
};

async function write(path: string, content: string): Promise<void> {
  await mkdir(dirname(join(root, path)), { recursive: true });
  await writeFile(join(root, path), content);
}

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), "fkt-instructions-"));
  await write("AGENTS.md", "Shared policy.\n");
  await write("CLAUDE.md", "@AGENTS.md\n");
});

afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

describe("repository instruction budget", () => {
  it("counts shared instructions once while reporting each runtime separately", async () => {
    const r = await buildInstructionBudgetReport(root, spec);
    expect(r.instructionBytes).toBe(Buffer.byteLength("Shared policy.\n@AGENTS.md\n"));
    expect(r.claudeInstructionBytes).toBe(r.instructionBytes);
    expect(r.codexInstructionBytes).toBe(Buffer.byteLength("Shared policy.\n"));
    expect(r.files).toEqual(["AGENTS.md", "CLAUDE.md"]);
    expect(r.withinBudget).toBe(true);
  });

  it("resolves nested imports relative to their containing file", async () => {
    await write("CLAUDE.md", "@AGENTS.md\n@docs/extra.md\n");
    await write("docs/extra.md", "@more.md\n");
    await write("docs/more.md", "日本語\n");
    const r = await buildInstructionBudgetReport(root, spec);
    expect(r.files).toEqual(["AGENTS.md", "CLAUDE.md", "docs/extra.md", "docs/more.md"]);
    expect(r.instructionBytes).toBe(Buffer.byteLength("Shared policy.\n@AGENTS.md\n@docs/extra.md\n@more.md\n日本語\n"));
  });

  it("fails for a missing imported file", async () => {
    await write("CLAUDE.md", "@missing.md\n");
    await expect(buildInstructionBudgetReport(root, spec)).rejects.toThrow();
  });

  it("fails for cycles including aliases of the same file", async () => {
    await write("AGENTS.md", "@./CLAUDE.md\n");
    await expect(buildInstructionBudgetReport(root, spec)).rejects.toThrow("cycle");
  });

  it("counts repeated imports once", async () => {
    await write("CLAUDE.md", "@AGENTS.md\n@./AGENTS.md\n");
    expect((await buildInstructionBudgetReport(root, spec)).files.length).toBe(2);
  });

  it("rejects imports outside the repository", async () => {
    await write("CLAUDE.md", "@../outside.md\n");
    await expect(buildInstructionBudgetReport(root, spec)).rejects.toThrow();
  });

  it("rejects symlink imports outside the repository", async () => {
    const outside = await mkdtemp(join(tmpdir(), "fkt-outside-"));
    try {
      await writeFile(join(outside, "policy.md"), "external");
      await symlink(join(outside, "policy.md"), join(root, "external.md"));
      await write("CLAUDE.md", "@external.md\n");
      await expect(buildInstructionBudgetReport(root, spec)).rejects.toThrow("escapes repository");
    } finally {
      await rm(outside, { recursive: true, force: true });
    }
  });

  it("ignores fenced examples and rejects unsupported import syntax", () => {
    expect(instructionImports("```md\n@/example.md\n```\n@AGENTS.md\n", "CLAUDE.md")).toEqual(["AGENTS.md"]);
    for (const value of ["@https://example.com/policy", "@~/policy.md", "@file with spaces.md"]) {
      expect(() => instructionImports(value, "CLAUDE.md")).toThrow("standalone repository-relative");
    }
  });

  it("fails the budget for oversized UTF-8 instructions", async () => {
    await write("AGENTS.md", "語".repeat(INSTRUCTION_BUDGET_BYTES / 2));
    const r = await buildInstructionBudgetReport(root, spec);
    expect(r.withinBudget).toBe(false);
    expect(r.codexInstructionBytes).toBeGreaterThan(INSTRUCTION_BUDGET_BYTES);
  });
});

describe("candidate Codex discovery metadata", () => {
  const skillSpec: MarketplaceSpec = {
    ...spec, plugins: [{
      name: "test", dir: "test", displayName: "Test", description: "Test",
      category: "development", keywords: [], skills: ["one"], agents: [],
    }],
  };

  it("measures UTF-8 name, description and path even for Claude-hidden skills", async () => {
    const path = "skills/test/skills/one/SKILL.md";
    await write(path, "---\nname: one\ndescription: 語\ndisable-model-invocation: true\n---\nbody");
    const r = await buildInstructionBudgetReport(root, skillSpec);
    expect(r.skillCount).toBe(1);
    expect(r.codexDiscoveryBytes).toBe(Buffer.byteLength(JSON.stringify([{ name: "one", description: "語", path }])));
    expect((await buildInstructionBudgetReport(root, skillSpec, 8192, 1)).withinBudget).toBe(false);
  });

  it("rejects missing discovery metadata", async () => {
    await write("skills/test/skills/one/SKILL.md", "---\nname: one\n---\nbody");
    await expect(buildInstructionBudgetReport(root, skillSpec)).rejects.toThrow("requires a name and description");
  });

  it("checks the real repository as part of the mandatory test suite", async () => {
    const repository = resolve(import.meta.dir, "../..");
    const report = await buildInstructionBudgetReport(repository, await loadMarketplaceSpec(join(repository, "marketplace.toml")));
    expect(report.withinBudget).toBe(true);
    expect(report.skillCount).toBeGreaterThan(0);
  });
});
