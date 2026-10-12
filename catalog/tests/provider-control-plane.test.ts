import { describe, expect, it } from "bun:test";
import { join } from "node:path";
import {
  loadProviderRegistry,
  resolveProvider,
  listAllProviderNames,
  validateProviderRegistry,
  resolveCapabilityPrecedence,
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
    expect(names).toContain("agy");
    expect(names).toContain("gemini");
    expect(names).not.toContain("google");
    expect(names).not.toContain("antigravity");
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

    expect(resolveProvider(registry, "google")).toBeNull();
    expect(resolveProvider(registry, "antigravity")).toBeNull();
    expect(resolveProvider(registry, "agy")?.id).toBe("agy");
    expect(resolveProvider(registry, "gemini")?.id).toBe("gemini");

    // Other aliases
    expect(resolveProvider(registry, "nim")?.id).toBe("nvidia-nim");
    expect(resolveProvider(registry, "glm")?.id).toBe("zai");
    expect(resolveProvider(registry, "moonshot")?.id).toBe("kimi");
    expect(resolveProvider(registry, "orca")?.id).toBe("orcarouter");
    expect(resolveProvider(registry, "one")?.id).toBe("onerouter");
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

    const google = resolveProvider(registry, "gemini")!;
    expect(google.transportType).toBe("local-sidecar");
    expect(google.lifecycle).toBe("session-sidecar");
    expect(google.authMethod).toBe("vertex-gemini-key");
    expect(google.compatibility.nativeCli).toBeUndefined();
    const agy = resolveProvider(registry, "agy")!;
    expect(agy.authMethod).toBe("delegated-cli");
    expect(agy.compatibility.nativeCli).toBe("agy");
    const auth = evaluateProviderAuth(agy, null, { claudeDir: "/tmp", env: {} });
    expect(auth.redactedDisplay).toContain("native preflight");
    expect(auth.configured).toBe(false);
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

  it("requires separate API/Vertex credentials for Gemini", async () => {
    const registry = await loadProviderRegistry(REGISTRY_PATH);
    const google = resolveProvider(registry, "gemini")!;

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
      env: { VERTEX_PROJECT_ID: "fixture-project", GOOGLE_OAUTH_TOKEN: "fixture-cloud-token" },
    });
    expect(withVertex.configured).toBe(true);
    expect(withVertex.redactedDisplay).toContain("Vertex AI credentials");

    const adcOnly = evaluateProviderAuth(google, null, { claudeDir: "/tmp", env: { GOOGLE_APPLICATION_CREDENTIALS: "/fixture/adc.json" } });
    expect(adcOnly.configured).toBe(false);

    // Scenario 3: Only consumer Antigravity auth present -> FAILS clearly, suggests native agy
    const consumerOnly = evaluateProviderAuth(google, null, {
      claudeDir: "/tmp",
      env: { ANTIGRAVITY_AGENT: "1" },
    });
    expect(consumerOnly.configured).toBe(false);
    expect(consumerOnly.consumerOAuthDetected).toBe(true);
    expect(consumerOnly.nativeFallbackMessage).toContain("ccs agy");
    expect(consumerOnly.nativeFallbackMessage).toContain("does not use the AGY session");
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

describe("Dynamic Capability Resolution & Precedence", () => {
  it("enforces explicit user override over live discovery and registry metadata", async () => {
    const registry = await loadProviderRegistry(REGISTRY_PATH);
    const orca = resolveProvider(registry, "orcarouter")!;

    const result = resolveCapabilityPrecedence({
      providerId: "orcarouter",
      model: "z-ai/glm-5.3-flash",
      userOverrideContext: 32000,
      userOverrideRetries: 4,
      liveModelCatalog: [{ id: "z-ai/glm-5.3-flash", context_length: 1000000 }],
      providerDefinition: orca,
    });

    expect(result.maxContextTokens).toBe(32000);
    expect(result.contextSource).toBe("user-override");
    expect(result.maxRetries).toBe(4);
    expect(result.retriesSource).toBe("user-override");
    expect(result.supportsToolSearch).toBe(false);
  });

  it("prefers authoritative live /v1/models metadata over registry metadata", async () => {
    const registry = await loadProviderRegistry(REGISTRY_PATH);
    const orca = resolveProvider(registry, "orcarouter")!;

    const result = resolveCapabilityPrecedence({
      providerId: "orcarouter",
      model: "z-ai/glm-5.3-flash",
      liveModelCatalog: [{ id: "z-ai/glm-5.3-flash", context_length: 1000000 }],
      providerDefinition: orca,
    });

    expect(result.maxContextTokens).toBe(1000000);
    expect(result.contextSource).toBe("live-discovery");
    expect(result.maxRetries).toBe(2);
    expect(result.retriesSource).toBe("registry-metadata");
  });

  it("falls back to registry capability metadata when live metadata is null or missing", async () => {
    const registry = await loadProviderRegistry(REGISTRY_PATH);
    const orca = resolveProvider(registry, "orcarouter")!;

    // Live metadata returns null for free alias
    const result = resolveCapabilityPrecedence({
      providerId: "orcarouter",
      model: "z-ai/glm-5.3-flash-free",
      liveModelCatalog: [{ id: "z-ai/glm-5.3-flash-free", context_length: null }],
      providerDefinition: orca,
    });

    expect(result.maxContextTokens).toBe(1000000);
    expect(result.contextSource).toBe("registry-metadata");
    expect(result.maxRetries).toBe(2);
  });

  it("derives exact context length for OneRouter Qwen models from live metadata", async () => {
    const registry = await loadProviderRegistry(REGISTRY_PATH);
    const one = resolveProvider(registry, "onerouter")!;

    const result = resolveCapabilityPrecedence({
      providerId: "onerouter",
      model: "qwen/qwen3.8-27b-abliterated-cyber:free",
      liveModelCatalog: [{ id: "qwen/qwen3.8-27b-abliterated-cyber:free", context_length: 256000 }],
      providerDefinition: one,
    });

    expect(result.maxContextTokens).toBe(256000);
    expect(result.contextSource).toBe("live-discovery");
    expect(result.maxRetries).toBe(2);
    expect(result.supportsToolSearch).toBe(false);
  });

  it("never guesses context size from model names and falls back conservatively to 200k", async () => {
    const registry = await loadProviderRegistry(REGISTRY_PATH);
    const zai = resolveProvider(registry, "zai")!;

    // Model name mentions 1m or 128k, but no live or registry metadata exists
    const result = resolveCapabilityPrecedence({
      providerId: "zai",
      model: "custom/unregistered-model-1m-tokens",
      liveModelCatalog: null,
      providerDefinition: zai,
    });

    expect(result.maxContextTokens).toBe(200000);
    expect(result.contextSource).toBe("conservative-fallback");
  });
});

