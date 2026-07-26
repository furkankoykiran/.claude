/**
 * Same-digest policy detection.
 *
 * A skill is not unchanged merely because its bytes are unchanged. The same
 * content can be re-pointed at a different repository, relocated, downgraded to
 * metadata-only, or have its detected licence change underneath it. Every case
 * below keeps the digest IDENTICAL and asserts the change is still detected and
 * classified.
 */
import { describe, it, expect } from "bun:test";
import { diffCatalogs, changedPolicyFields, policyView, normalizeRepo } from "../src/diff.ts";
import type { Catalog, CatalogSkillEntry, SecurityProfile } from "../src/types.ts";

const DIGEST = "a".repeat(64);

const S = (o: Partial<SecurityProfile> = {}): SecurityProfile => ({
  hasBashOrPowershell: false, hasDynamicShell: false, hasHooks: false, hasMcpOrLsp: false,
  hasAgents: false, hasCredentialRef: false, hasHiddenFiles: false, hasExecutable: false,
  hasNetworkRef: false, toolCount: 0, flags: [], ...o,
});

const sk = (o: Partial<CatalogSkillEntry> = {}): CatalogSkillEntry => ({
  canonicalInvocation: "/a", namespacedInvocations: ["/a"], skillName: "a",
  sourceId: "src", pack: "p", sourceType: "git", relativePath: "skills/a/SKILL.md",
  digest: DIGEST,
  license: { redistribution: "full", detected: "MIT", declared: "MIT", matchesDeclaration: true },
  security: S(), redistribution: "full", generated: true, warnings: [], frontmatter: {},
  repo: "https://github.com/owner/repo.git",
  ...o,
});

const cat = (s: CatalogSkillEntry[]): Catalog => ({
  schemaVersion: 1, resolverVersion: "1", generated: true,
  totals: { sources: 1, skills: s.length, redistributable: s.length, runtimeOnly: 0, warnings: 0 },
  sources: [], skills: s,
});

/** Diff two entries that share a digest. */
const sameDigest = (curOverrides: Partial<CatalogSkillEntry>, prevOverrides: Partial<CatalogSkillEntry> = {}) =>
  diffCatalogs(cat([sk(curOverrides)]), cat([sk(prevOverrides)]), "base");

describe("same-digest detection: is the change seen at all?", () => {
  const cases: Array<[string, Partial<CatalogSkillEntry>, Partial<CatalogSkillEntry>]> = [
    ["repository identity change", { repo: "https://github.com/attacker/repo.git" }, {}],
    ["undefined repo -> external repo", { repo: "https://github.com/attacker/repo.git" }, { repo: undefined }],
    ["source id change", { sourceId: "other-source" }, {}],
    ["source type change", { sourceType: "repo-owned" }, {}],
    ["relative path change", { relativePath: "skills/elsewhere/SKILL.md" }, {}],
    ["redistribution downgrade", { redistribution: "metadata-only" }, {}],
    ["declared license change", {
      license: { redistribution: "full", detected: "MIT", declared: "GPL-3.0", matchesDeclaration: false },
    }, {}],
    ["detected license change", {
      license: { redistribution: "full", detected: "GPL-3.0", declared: "MIT", matchesDeclaration: false },
    }, {}],
    ["license declaration match flips", {
      license: { redistribution: "full", detected: "MIT", declared: "MIT", matchesDeclaration: false },
    }, {}],
    ["security profile expansion", { security: S({ hasHooks: true }) }, {}],
    ["tool permission expansion", { security: S({ toolCount: 4 }) }, { security: S({ toolCount: 1 }) }],
    ["tool list composition change at equal count", { allowedTools: ["Bash"] }, { allowedTools: ["Read"] }],
  ];

  for (const [label, cur, prev] of cases) {
    it(`detects ${label} with an unchanged digest`, () => {
      const d = sameDigest(cur, prev);
      expect(d.summary.updated, `${label} was invisible`).toBe(1);
      expect(d.changes[0]!.detail).toContain("digest unchanged");
      expect(d.changes[0]!.manualReviewRequired, `${label} did not require review`).toBe(true);
      expect(d.changes[0]!.reasons.length).toBeGreaterThan(0);
    });
  }
});

describe("same-digest detection: no false positives", () => {
  it("exact no-change input produces no change at all", () => {
    const d = sameDigest({}, {});
    expect(d.summary.updated).toBe(0);
    expect(d.changes).toEqual([]);
    expect(d.summary.manualReviewRequired).toBe(false);
  });

  it("a cosmetic repo URL difference is not a change", () => {
    const d = sameDigest({ repo: "https://github.com/Owner/Repo/" }, { repo: "https://github.com/owner/repo.git" });
    expect(d.summary.updated).toBe(0);
  });

  it("scp-style and https remotes normalize to the same identity", () => {
    expect(normalizeRepo("git@github.com:Owner/Repo.git")).toBe(normalizeRepo("https://github.com/owner/repo"));
    expect(normalizeRepo("ssh://git@github.com/Owner/Repo.git")).toBe(normalizeRepo("https://github.com/owner/repo"));
    expect(normalizeRepo("git+https://github.com/owner/repo.git")).toBe(normalizeRepo("https://github.com/owner/repo/"));
  });

  it("a revision-only change is not a policy change and never escalates", () => {
    // Pinned SHA advanced; content and every policy field identical.
    const d = sameDigest({ resolvedRevision: "b".repeat(40) }, { resolvedRevision: "c".repeat(40) });
    expect(d.summary.updated).toBe(0);
    expect(d.summary.manualReviewRequired).toBe(false);
    expect(changedPolicyFields(sk({ resolvedRevision: "b".repeat(40) }), sk({ resolvedRevision: "c".repeat(40) }))).toEqual([]);
  });

  it("resolvedRevision is deliberately absent from the policy view", () => {
    expect(Object.keys(policyView(sk()))).not.toContain("resolvedRevision");
  });

  it("a shrinking tool count alone stays routine", () => {
    const d = sameDigest({ security: S({ toolCount: 1 }) }, { security: S({ toolCount: 5 }) });
    // Reported as updated (the profile did change) but not escalated.
    expect(d.summary.updated).toBe(1);
    expect(d.summary.manualReviewRequired).toBe(false);
  });
});

describe("same-digest detection: reasons name the field", () => {
  it("source identity", () => {
    expect(sameDigest({ repo: "https://github.com/attacker/x.git" }).changes[0]!.reasons)
      .toContain("source-identity-changed");
  });
  it("relocation", () => {
    expect(sameDigest({ relativePath: "skills/other/SKILL.md" }).changes[0]!.reasons)
      .toContain("policy-changed:relativePath");
  });
  it("ownership", () => {
    expect(sameDigest({ sourceId: "elsewhere" }).changes[0]!.reasons)
      .toContain("policy-changed:sourceId");
  });
  it("redistribution downgrade is named specifically", () => {
    expect(sameDigest({ redistribution: "metadata-only" }).changes[0]!.reasons)
      .toContain("redistribution-downgraded");
  });
  it("license change carries old -> new", () => {
    const r = sameDigest({
      license: { redistribution: "full", detected: "GPL-3.0", declared: "MIT", matchesDeclaration: false },
    }).changes[0]!.reasons;
    expect(r.join(",")).toContain("license-changed:MIT->GPL-3.0");
  });
});

describe("changedPolicyFields", () => {
  it("returns a sorted, stable field list", () => {
    const prev = sk();
    const cur = sk({ sourceId: "z", relativePath: "skills/z/SKILL.md", redistribution: "metadata-only" });
    expect(changedPolicyFields(prev, cur)).toEqual(["redistribution", "relativePath", "sourceId"]);
  });

  it("is empty for identical entries", () => {
    expect(changedPolicyFields(sk(), sk())).toEqual([]);
  });
});