/**
 * Regression tests for the auto-merge gate.
 *
 * Two failure modes matter and both are covered here:
 *   FALSE NEGATIVE — a security-sensitive change classified as routine, which
 *                    would let it squash auto-merge without a human.
 *   FALSE POSITIVE — an unchanged pre-existing capability re-reported as an
 *                    escalation, which makes every PR manual-review and trains
 *                    reviewers to ignore the label.
 */
import { describe, it, expect } from "bun:test";
import { diffCatalogs, MASS_CHANGE_THRESHOLD, previousSecurityProfile } from "../src/diff.ts";
import { capabilityEscalations, presentCapabilities, ESCALATION_CAPABILITIES } from "../src/security.ts";
import type { Catalog, CatalogSkillEntry, SecurityProfile } from "../src/types.ts";

const S = (o: Partial<SecurityProfile> = {}): SecurityProfile => ({
  hasBashOrPowershell: false, hasDynamicShell: false, hasHooks: false, hasMcpOrLsp: false,
  hasAgents: false, hasCredentialRef: false, hasHiddenFiles: false, hasExecutable: false,
  hasNetworkRef: false, toolCount: 0, flags: [], ...o,
});

const sk = (inv: string, digest: string, o: Partial<CatalogSkillEntry> = {}): CatalogSkillEntry => ({
  canonicalInvocation: inv, namespacedInvocations: [inv], skillName: inv.slice(1),
  sourceId: "s", pack: "p", sourceType: "git", relativePath: "skills/x/SKILL.md", digest,
  license: { redistribution: "full", detected: "MIT", declared: "MIT", matchesDeclaration: true },
  security: S(), redistribution: "full", generated: true, warnings: [], frontmatter: {}, ...o,
});

const cat = (skills: CatalogSkillEntry[]): Catalog => ({
  schemaVersion: 1, resolverVersion: "1", generated: true,
  totals: { sources: 1, skills: skills.length, redistributable: skills.length, runtimeOnly: 0, warnings: 0 },
  sources: [], skills,
});

/** Diff one skill against itself with a changed digest. */
const update = (prevSec: SecurityProfile, curSec: SecurityProfile, o: Partial<CatalogSkillEntry> = {}) =>
  diffCatalogs(
    cat([sk("/a", "new", { security: curSec, ...o })]),
    cat([sk("/a", "old", { security: prevSec })]),
    "base",
  );

/** The SecurityProfile boolean that backs each escalation-table capability. */
const CAPABILITY_FIELD: Record<string, keyof SecurityProfile> = {
  "hooks": "hasHooks",
  "mcp/lsp": "hasMcpOrLsp",
  "agents": "hasAgents",
  "dynamic-shell": "hasDynamicShell",
  "credential-reference": "hasCredentialRef",
  "executable/binary": "hasExecutable",
  "bash/powershell": "hasBashOrPowershell",
  "network-access": "hasNetworkRef",
  "hidden-files": "hasHiddenFiles",
};

/** A profile with exactly one capability switched on. */
const only = (capName: string): SecurityProfile => {
  const field = CAPABILITY_FIELD[capName];
  if (!field) throw new Error(`capability "${capName}" has no field mapping — update CAPABILITY_FIELD`);
  return S({ [field]: true } as Partial<SecurityProfile>);
};

describe("review policy — every tracked capability escalates on a new skill", () => {
  for (const cap of ESCALATION_CAPABILITIES) {
    it(`new skill carrying "${cap.name}" requires manual review`, () => {
      const on = only(cap.name);
      const d = diffCatalogs(cat([sk("/n", "d", { security: on })]), cat([]), "base");
      expect(d.summary.added).toBe(1);
      expect(d.summary.manualReviewRequired).toBe(true);
      expect(d.changes[0]!.reasons.join(",")).toContain(cap.name);
    });
  }

  it("a new skill with no capability surface stays routine", () => {
    const d = diffCatalogs(cat([sk("/plain", "d")]), cat([]), "base");
    expect(d.summary.added).toBe(1);
    expect(d.summary.manualReviewRequired).toBe(false);
    expect(d.changes[0]!.reasons).toEqual([]);
  });
});

describe("review policy — escalation only on false -> true (no false positives)", () => {
  for (const cap of ESCALATION_CAPABILITIES) {
    it(`pre-existing "${cap.name}" is not re-flagged as an ESCALATION`, () => {
      const on = only(cap.name);
      const d = update(on, on);
      expect(d.summary.updated).toBe(1);
      // The capability was already there, so nothing went false -> true.
      expect(d.changes[0]!.reasons.filter((r) => r.startsWith("capability-introduced:"))).toEqual([]);

      // Severe capabilities are the exception: a content rewrite of a skill
      // that already ships an executable, hooks, MCP config, an agent or a
      // credential reference still needs a human, because no boolean moves.
      const severe = ["credential-reference", "executable/binary", "hooks", "mcp/lsp", "agents"];
      if (severe.includes(cap.name)) {
        expect(d.summary.manualReviewRequired, `${cap.name} rewrite must be reviewed`).toBe(true);
        expect(d.changes[0]!.reasons.join(",")).toContain(`content-changed-with-capability:${cap.name}`);
      } else {
        // Bounded noise: the common capabilities do not make every edit manual.
        expect(d.summary.manualReviewRequired, `${cap.name} rewrite should stay routine`).toBe(false);
        expect(d.changes[0]!.reasons).toEqual([]);
      }
    });

    it(`newly introduced "${cap.name}" IS flagged`, () => {
      const d = update(S(), only(cap.name));
      expect(d.summary.manualReviewRequired).toBe(true);
      expect(d.changes[0]!.securitySensitive).toBe(true);
    });
  }

  it("a capability being REMOVED is not an escalation", () => {
    const d = update(S({ hasExecutable: true, hasHooks: true }), S());
    expect(d.summary.manualReviewRequired).toBe(false);
  });

  it("every SecurityProfile boolean is gated by the escalation table", () => {
    // Guards against adding a capability to SecurityProfile and forgetting to
    // wire it into ESCALATION_CAPABILITIES, which would silently widen what
    // auto-merges.
    const booleanFields = Object.entries(S())
      .filter(([, v]) => typeof v === "boolean")
      .map(([k]) => k as keyof SecurityProfile);
    const gatedFields = new Set(Object.values(CAPABILITY_FIELD));
    expect([...booleanFields].sort()).toEqual([...gatedFields].sort());

    for (const field of booleanFields) {
      const on = S({ [field]: true } as Partial<SecurityProfile>);
      expect(capabilityEscalations(S(), on).length).toBeGreaterThan(0);
      expect(presentCapabilities(on).length).toBeGreaterThan(0);
    }
  });

  it("CAPABILITY_FIELD covers exactly the escalation table", () => {
    expect(ESCALATION_CAPABILITIES.map((c) => c.name).sort()).toEqual(Object.keys(CAPABILITY_FIELD).sort());
  });
});

describe("review policy — tool surface", () => {
  it("expanding allowed-tools requires review", () => {
    const d = update(S({ toolCount: 2 }), S({ toolCount: 5 }));
    expect(d.summary.manualReviewRequired).toBe(true);
    expect(d.changes[0]!.reasons.join(",")).toContain("tool-surface(2->5)");
  });

  it("shrinking allowed-tools is routine", () => {
    expect(update(S({ toolCount: 5 }), S({ toolCount: 2 })).summary.manualReviewRequired).toBe(false);
  });
});

describe("review policy — structural and supply-chain events", () => {
  it("a removal requires manual review", () => {
    const d = diffCatalogs(cat([]), cat([sk("/gone", "d")]), "base");
    expect(d.summary.removed).toBe(1);
    expect(d.summary.manualReviewRequired).toBe(true);
    expect(d.changes[0]!.reasons).toContain("skill-removed");
  });

  it("a rename requires manual review even though the digest is unchanged", () => {
    const d = diffCatalogs(cat([sk("/new", "same")]), cat([sk("/old", "same")]), "base");
    expect(d.summary.renamed).toBe(1);
    expect(d.summary.manualReviewRequired).toBe(true);
    expect(d.changes[0]!.reasons).toContain("skill-renamed");
  });

  it("a source repository change requires review, including undefined -> defined", () => {
    const d = update(S(), S(), { repo: "https://github.com/evil/x.git" });
    expect(d.summary.manualReviewRequired).toBe(true);
    expect(d.changes[0]!.reasons).toContain("source-identity-changed");
  });

  it("cosmetic repo URL differences are NOT an identity change", () => {
    const d = diffCatalogs(
      cat([sk("/a", "n", { repo: "https://github.com/Owner/Repo/" })]),
      cat([sk("/a", "o", { repo: "https://github.com/owner/repo.git" })]),
      "base",
    );
    expect(d.summary.manualReviewRequired).toBe(false);
  });

  it("a redistribution downgrade requires review", () => {
    const d = update(S(), S(), { redistribution: "metadata-only" });
    expect(d.changes[0]!.reasons).toContain("redistribution-downgraded");
  });

  it("a detected-license change requires review", () => {
    const d = update(S(), S(), {
      license: { redistribution: "full", detected: "GPL-3.0", declared: "MIT", matchesDeclaration: false },
    });
    expect(d.changes[0]!.reasons.join(",")).toContain("license-changed:MIT->GPL-3.0");
  });
});

describe("review policy — mass change threshold", () => {
  const many = (n: number, suffix = "") =>
    Array.from({ length: n }, (_, i) => sk(`/s${i}`, `d${i}${suffix}`));

  it(`more than ${MASS_CHANGE_THRESHOLD} changes forces review even when each is routine`, () => {
    const n = MASS_CHANGE_THRESHOLD + 1;
    const d = diffCatalogs(cat(many(n, "x")), cat(many(n)), "base");
    expect(d.summary.updated).toBe(n);
    expect(d.summary.massChange).toBe(true);
    expect(d.summary.manualReviewRequired).toBe(true);
    expect(d.summary.reviewReasons.join(",")).toContain("mass-change");
  });

  it("a batch at the threshold stays routine", () => {
    const d = diffCatalogs(cat(many(MASS_CHANGE_THRESHOLD, "x")), cat(many(MASS_CHANGE_THRESHOLD)), "base");
    expect(d.summary.massChange).toBe(false);
    expect(d.summary.manualReviewRequired).toBe(false);
  });

  it("the bootstrap diff (no base) is exempt from the mass-change rule", () => {
    const d = diffCatalogs(cat(many(MASS_CHANGE_THRESHOLD + 50)), null, null);
    expect(d.summary.massChange).toBe(false);
  });
});

describe("previous security profile", () => {
  it("uses the persisted profile rather than reconstructing from frontmatter", () => {
    // Body-derived capabilities (network, dynamic shell, executables) cannot be
    // recovered from frontmatter. Persisting them is what stops the gate from
    // re-flagging them forever.
    const persisted = S({ hasNetworkRef: true, hasExecutable: true, hasDynamicShell: true });
    const prev = sk("/a", "old", { security: persisted });
    expect(previousSecurityProfile(prev)).toBe(persisted);
    expect(capabilityEscalations(previousSecurityProfile(prev), persisted)).toEqual([]);
  });

  it("falls back to frontmatter reconstruction for pre-schema entries, failing safe", () => {
    // Older catalogs have no `security`. The fallback under-reports, so the gate
    // over-escalates rather than under-escalating.
    const legacy = { ...sk("/a", "old"), frontmatter: { "allowed-tools": ["Bash"] } } as CatalogSkillEntry;
    delete (legacy as { security?: SecurityProfile }).security;
    const p = previousSecurityProfile(legacy);
    expect(p.hasBashOrPowershell).toBe(true);
    expect(p.hasNetworkRef).toBe(false);
    // A body-derived capability now looks "new" -> review. Fail-safe direction.
    expect(capabilityEscalations(p, S({ hasBashOrPowershell: true, hasNetworkRef: true }))).toContain("network-access");
  });
});