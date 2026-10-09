import { describe, expect, it } from "bun:test";
import { join } from "node:path";
import {
  loadProviderRegistry,
  resolveProvider,
  listAllProviderNames,
  validateProviderRegistry,
} from "../src/providers/registry.ts";
import { evaluateProviderAuth, detectConsumerAntigravityAuth } from "../src/providers/auth.ts";
import { checkProviderIntegrity } from "../src/providers/watcher.ts";

const REPO_ROOT = join(import.meta.dirname, "..", "..");
const REGISTRY_PATH = join(REPO_ROOT, "providers", "registry.json");

describe("Unified Provider Control Plane Registry", () => {
  it("loads and validates canonical providers/registry.json", async () => {
    const registry = await loadProviderRegistry(REGISTRY_PATH);
    expect(registry.version).toBe(1);
    expect(registry.providers.length).toBeGreaterThanOrEqual(9);

    const names = listAllProviderNames(registry);
    expect(names).toContain("anthropic");
    expect(names).toContain("codex");
    expect(names).toContain("google");
    expect(names).toContain("zai");
    expect(names).toContain("nvidia-nim");
    expect(names).toContain("nvidia");
  });

  it("resolves all required UX aliases", async () => {
    const registry = await loadProviderRegistry(REGISTRY_PATH);

    // Codex
    expect(resolveProvider(registry, "codex")?.id).toBe("codex");
    expect(resolveProvider(registry, "chatgpt")?.id).toBe("codex");
    expect(resolveProvider(registry, "chatgpt-entitlement")?.id).toBe("codex");

    // Google / Antigravity aliases
    expect(resolveProvider(registry, "google")?.id).toBe("google");
    expect(resolveProvider(registry, "agy")?.id).toBe("google");
    expect(resolveProvider(registry, "antigravity")?.id).toBe("google");
    expect(resolveProvider(registry, "gemini")?.id).toBe("google");

    // Other aliases
    expect(resolveProvider(registry, "nim")?.id).toBe("nvidia-nim");
    expect(resolveProvider(registry, "glm")?.id).toBe("zai");
    expect(resolveProvider(registry, "moonshot")?.id).toBe("kimi");
  });

  it("classifies transport types and lifecycles correctly", async () => {
    const registry = await loadProviderRegistry(REGISTRY_PATH);

    const codex = resolveProvider(registry, "codex")!;
    expect(codex.transportType).toBe("local-sidecar");
    expect(codex.lifecycle).toBe("session-sidecar");
    expect(codex.authMethod).toBe("delegated-cli");
    expect(codex.compatibility.claudeCode).toBe("experimental");

    const nim = resolveProvider(registry, "nvidia-nim")!;
    expect(nim.transportType).toBe("direct-anthropic");
    expect(nim.lifecycle).toBe("none");

    const google = resolveProvider(registry, "google")!;
    expect(google.transportType).toBe("local-sidecar");
    expect(google.lifecycle).toBe("session-sidecar");
    expect(google.authMethod).toBe("vertex-gemini-key");
    expect(google.compatibility.nativeCli).toBe("agy");
  });

  it("rejects duplicate provider IDs or alias collisions in validation", () => {
    expect(() =>
      validateProviderRegistry({
        version: 1,
        providers: [
          {
            id: "a",
            name: "A",
            aliases: ["shared"],
            authMethod: "environment",
            transportType: "direct-anthropic",
            modelDiscovery: false,
            lifecycle: "none",
            compatibility: { claudeCode: "supported" },
            requiredRuntime: "none",
            description: "",
          },
          {
            id: "b",
            name: "B",
            aliases: ["shared"],
            authMethod: "environment",
            transportType: "direct-anthropic",
            modelDiscovery: false,
            lifecycle: "none",
            compatibility: { claudeCode: "supported" },
            requiredRuntime: "none",
            description: "",
          },
        ],
      })
    ).toThrow("alias collision");
  });
});

describe("Centralized Auth UX", () => {
  it("preserves official Codex auth ownership", async () => {
    const registry = await loadProviderRegistry(REGISTRY_PATH);
    const codex = resolveProvider(registry, "codex")!;

    const status = evaluateProviderAuth(codex, null, { claudeDir: "/tmp" });
    expect(status.authMethod).toBe("delegated-cli");
    expect(status.configured).toBe(true);
    expect(status.redactedDisplay).toContain("official codex CLI entitlement");
  });

  it("requires official Gemini API or Vertex credentials for Google provider", async () => {
    const registry = await loadProviderRegistry(REGISTRY_PATH);
    const google = resolveProvider(registry, "google")!;

    // Scenario 1: GEMINI_API_KEY present in environment
    const withKey = evaluateProviderAuth(google, null, {
      claudeDir: "/tmp",
      env: { GEMINI_API_KEY: "AIzaSyTest12345" },
    });
    expect(withKey.configured).toBe(true);
    expect(withKey.redactedDisplay).toContain("****2345");

    // Scenario 2: Vertex credentials present
    const withVertex = evaluateProviderAuth(google, null, {
      claudeDir: "/tmp",
      env: { GOOGLE_APPLICATION_CREDENTIALS: "/path/to/sa.json" },
    });
    expect(withVertex.configured).toBe(true);
    expect(withVertex.redactedDisplay).toContain("Vertex AI credentials");

    // Scenario 3: Only consumer Antigravity auth present -> FAILS clearly, suggests native agy
    const consumerOnly = evaluateProviderAuth(google, null, {
      claudeDir: "/tmp",
      env: { ANTIGRAVITY_AGENT: "1" },
    });
    expect(consumerOnly.configured).toBe(false);
    expect(consumerOnly.consumerOAuthDetected).toBe(true);
    expect(consumerOnly.nativeFallbackMessage).toContain("agy -p");
    expect(consumerOnly.nativeFallbackMessage).toContain("Personal Antigravity consumer OAuth cannot be reused");
  });

  it("handles environment-based API key providers", async () => {
    const registry = await loadProviderRegistry(REGISTRY_PATH);
    const zai = resolveProvider(registry, "zai")!;

    const configured = evaluateProviderAuth(zai, null, {
      claudeDir: "/tmp",
      env: { ANTHROPIC_AUTH_TOKEN: "secret-token-1234" },
    });
    expect(configured.configured).toBe(true);
    expect(configured.redactedDisplay).toContain("****1234");

    const missing = evaluateProviderAuth(zai, null, {
      claudeDir: "/tmp",
      env: {},
    });
    expect(missing.configured).toBe(false);
    expect(missing.redactedDisplay).toBe("missing");
  });
});

describe("Provider Watcher and Integrity", () => {
  it("verifies template parity and pinned runtime integrity", async () => {
    const res = await checkProviderIntegrity(REPO_ROOT);
    expect(res.findings).toEqual([]);
    expect(res.ok).toBe(true);
    expect(res.providersChecked).toBeGreaterThanOrEqual(9);
    expect(res.runtimesChecked).toBeGreaterThanOrEqual(7);
  });

  it("watches upstream gateways and tracks Hermes advisory compatibility signals", async () => {
    const { watchUpstreamGatewaysAndHermes } = await import("../src/providers/watcher.ts");
    const registry = await loadProviderRegistry(REGISTRY_PATH);
    const findings = await watchUpstreamGatewaysAndHermes(registry);
    expect(findings.length).toBe(3);
    const codex = findings.find((f) => f.component === "claude-codex-gateway");
    expect(codex?.status).toBe("up-to-date");
    const gemini = findings.find((f) => f.component === "claude-gemini-gateway");
    expect(gemini?.status).toBe("up-to-date");
    const hermes = findings.find((f) => f.component === "NousResearch/hermes-agent");
    expect(hermes?.kind).toBe("advisory-signal");
  });
});
