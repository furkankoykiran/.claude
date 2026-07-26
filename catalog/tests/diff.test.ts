import { describe, it, expect } from "bun:test";
import { diffCatalogs } from "../src/diff.ts";
import type { Catalog, CatalogSkillEntry } from "../src/types.ts";

function skill(inv: string, digest: string, overrides: Partial<CatalogSkillEntry> = {}): CatalogSkillEntry {
  return {
    canonicalInvocation: inv,
    namespacedInvocations: [inv],
    skillName: inv.replace(/^\//, ""),
    sourceId: "s",
    pack: "p",
    sourceType: "git",
    relativePath: "skills/x/SKILL.md",
    digest,
    license: { redistribution: "full", detected: "MIT", declared: "MIT", matchesDeclaration: true },
    security: {
      hasBashOrPowershell: false, hasDynamicShell: false, hasHooks: false, hasMcpOrLsp: false,
      hasAgents: false, hasCredentialRef: false, hasHiddenFiles: false, hasExecutable: false,
      hasNetworkRef: false, toolCount: 0, flags: [],
    },
    redistribution: "full",
    generated: true,
    warnings: [],
    frontmatter: {},
    ...overrides,
  };
}

function catalog(skills: CatalogSkillEntry[]): Catalog {
  return {
    schemaVersion: 1, resolverVersion: "1", generated: true,
    totals: { sources: 1, skills: skills.length, redistributable: skills.length, runtimeOnly: 0, warnings: 0 },
    sources: [], skills,
  };
}

describe("diff", () => {
  it("classifies added when there is no base", () => {
    const d = diffCatalogs(catalog([skill("/a", "d1")]), null, null);
    expect(d.summary.added).toBe(1);
    expect(d.summary.manualReviewRequired).toBe(false);
  });

  it("classifies updated on digest change", () => {
    const base = catalog([skill("/a", "old")]);
    const cur = catalog([skill("/a", "new")]);
    const d = diffCatalogs(cur, base, "base");
    expect(d.summary.updated).toBe(1);
    expect(d.summary.added).toBe(0);
  });

  it("classifies removed", () => {
    const base = catalog([skill("/a", "d1"), skill("/b", "d2")]);
    const cur = catalog([skill("/a", "d1")]);
    const d = diffCatalogs(cur, base, "base");
    expect(d.summary.removed).toBe(1);
  });

  it("classifies rename when digest is unchanged but invocation differs", () => {
    const base = catalog([skill("/old-name", "same")]);
    const cur = catalog([skill("/new-name", "same")]);
    const d = diffCatalogs(cur, base, "base");
    expect(d.summary.renamed).toBe(1);
    expect(d.summary.added).toBe(0);
    expect(d.summary.removed).toBe(0);
  });

  it("flags manual-review-required when a new skill introduces hooks", () => {
    const cur = catalog([skill("/x", "d", {
      security: { hasBashOrPowershell: false, hasDynamicShell: false, hasHooks: true, hasMcpOrLsp: false, hasAgents: false, hasCredentialRef: false, hasHiddenFiles: false, hasExecutable: false, hasNetworkRef: false, toolCount: 0, flags: ["hooks"] },
    })]);
    const d = diffCatalogs(cur, null, null);
    expect(d.summary.manualReviewRequired).toBe(true);
  });

  it("flags manual-review-required on license downgrade", () => {
    const base = catalog([skill("/x", "d1", { redistribution: "full", license: { redistribution: "full", detected: "MIT", declared: "MIT", matchesDeclaration: true } })]);
    const cur = catalog([skill("/x", "d2", { redistribution: "metadata-only", license: { redistribution: "metadata-only", detected: "unknown", declared: "MIT", matchesDeclaration: false } })]);
    const d = diffCatalogs(cur, base, "base");
    expect(d.summary.manualReviewRequired).toBe(true);
  });
});