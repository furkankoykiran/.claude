import { describe, it, expect } from "bun:test";
import { buildSecurityProfile, containsSecret, isCapabilityEscalation } from "../src/security.ts";

const profile = (fm: Record<string, unknown>, body: string) =>
  buildSecurityProfile(fm, body, [], "");

describe("security", () => {
  it("detects bash tool allowance", () => {
    const p = profile({ "allowed-tools": ["Bash", "Read"] }, "");
    expect(p.hasBashOrPowershell).toBe(true);
    expect(p.toolCount).toBe(2);
  });

  it("detects dynamic ! shell context", () => {
    expect(profile({}, "run this:\n!`date`\n").hasDynamicShell).toBe(true);
    expect(profile({}, "```\n!echo hi\n```").hasDynamicShell).toBe(true);
  });

  it("detects hooks and agents in frontmatter", () => {
    expect(profile({ hooks: { x: 1 } }, "").hasHooks).toBe(true);
    expect(profile({ agent: "foo" }, "").hasAgents).toBe(true);
  });

  it("detects network references", () => {
    expect(profile({}, "fetch with curl https://x").hasNetworkRef).toBe(true);
  });

  it("detects secrets without printing them", () => {
    expect(containsSecret("api_key=sk-1234567890abcdef1234567890")).toBe(true);
    expect(containsSecret("AKIAIOSFODNN7EXAMPLE")).toBe(true);
    expect(containsSecret("-----BEGIN RSA PRIVATE KEY-----")).toBe(true);
    expect(containsSecret("ghp_" + "a".repeat(36))).toBe(true);
    expect(containsSecret("just normal text")).toBe(false);
    // The secret must never appear in the profile flags.
    const p = profile({}, "token = sk-1234567890abcdef1234567890");
    expect(JSON.stringify(p.flags)).not.toContain("sk-1234567890");
  });

  it("flags hidden files and executables from dir listing", () => {
    const p = buildSecurityProfile({}, "", [
      { name: ".env", executable: false, isBinary: false },
      { name: "run.sh", executable: true, isBinary: false },
      { name: ".gitkeep", executable: false, isBinary: false }, // benign, ignored
    ], "");
    expect(p.hasHiddenFiles).toBe(true);
    expect(p.hasExecutable).toBe(true);
  });

  it("escalation: introducing hooks/mcp/agents is an escalation", () => {
    const plain = profile({}, "");
    const withHooks = profile({ hooks: {} }, "");
    expect(isCapabilityEscalation(plain, withHooks)).toBe(true);
    expect(isCapabilityEscalation(withHooks, withHooks)).toBe(false);
  });
});