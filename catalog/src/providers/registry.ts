/**
 * Canonical Data-Driven Provider Registry
 *
 * Resolves provider names and aliases, validates provider entries,
 * and classifies transports and lifecycles.
 */

import { readFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { join } from "node:path";
import type { ProviderDefinition, ProviderRegistry } from "./types.ts";

export class ProviderRegistryError extends Error {
  constructor(message: string) {
    super(`ProviderRegistry: ${message}`);
    this.name = "ProviderRegistryError";
  }
}

export async function loadProviderRegistry(registryPath: string): Promise<ProviderRegistry> {
  if (!existsSync(registryPath)) {
    throw new ProviderRegistryError(`registry file not found: ${registryPath}`);
  }
  const raw = await readFile(registryPath, "utf8");
  let data: unknown;
  try {
    data = JSON.parse(raw);
  } catch (e) {
    throw new ProviderRegistryError(`failed to parse JSON from ${registryPath}: ${(e as Error).message}`);
  }
  return validateProviderRegistry(data);
}

export function validateProviderRegistry(data: unknown): ProviderRegistry {
  if (!data || typeof data !== "object") {
    throw new ProviderRegistryError("registry data must be an object");
  }
  const reg = data as Partial<ProviderRegistry>;
  if (typeof reg.version !== "number") {
    throw new ProviderRegistryError("registry version must be a number");
  }
  if (!reg.providers || !Array.isArray(reg.providers)) {
    throw new ProviderRegistryError("registry must declare a 'providers' array");
  }

  const seenIds = new Set<string>();
  const seenAliases = new Map<string, string>();

  for (const p of reg.providers) {
    if (!p.id || typeof p.id !== "string") {
      throw new ProviderRegistryError("every provider must have a string 'id'");
    }
    if (seenIds.has(p.id)) {
      throw new ProviderRegistryError(`duplicate provider id: ${p.id}`);
    }
    seenIds.add(p.id);

    if (!p.name || typeof p.name !== "string") {
      throw new ProviderRegistryError(`provider ${p.id} must have a string 'name'`);
    }
    if (!Array.isArray(p.aliases)) {
      throw new ProviderRegistryError(`provider ${p.id} must declare 'aliases' array`);
    }

    for (const a of p.aliases) {
      if (seenIds.has(a) || (seenAliases.has(a) && seenAliases.get(a) !== p.id)) {
        throw new ProviderRegistryError(`alias collision: '${a}' conflicts with provider '${seenAliases.get(a) ?? a}'`);
      }
      seenAliases.set(a, p.id);
    }

    if (!["official-subscription", "delegated-cli", "vertex-gemini-key", "environment"].includes(p.authMethod)) {
      throw new ProviderRegistryError(`provider ${p.id} has invalid authMethod '${p.authMethod}'`);
    }
    if (!["direct-anthropic", "local-sidecar"].includes(p.transportType)) {
      throw new ProviderRegistryError(`provider ${p.id} has invalid transportType '${p.transportType}'`);
    }
    if (!["none", "session-sidecar"].includes(p.lifecycle)) {
      throw new ProviderRegistryError(`provider ${p.id} has invalid lifecycle '${p.lifecycle}'`);
    }
    if (!p.compatibility || !["supported", "experimental", "unsupported"].includes(p.compatibility.claudeCode)) {
      throw new ProviderRegistryError(`provider ${p.id} has invalid compatibility`);
    }
  }

  return reg as ProviderRegistry;
}

export function resolveProvider(registry: ProviderRegistry, nameOrAlias: string): ProviderDefinition | null {
  const norm = nameOrAlias.trim().toLowerCase();
  for (const p of registry.providers) {
    if (p.id.toLowerCase() === norm) return p;
    if (p.aliases.some((a) => a.toLowerCase() === norm)) return p;
  }
  return null;
}

export function listAllProviderNames(registry: ProviderRegistry): string[] {
  return registry.providers.map((p) => p.id);
}

export function listAllAliases(registry: ProviderRegistry): Record<string, string> {
  const map: Record<string, string> = {};
  for (const p of registry.providers) {
    for (const a of p.aliases) {
      map[a] = p.id;
    }
  }
  return map;
}

export interface CapabilityResolutionInput {
  providerId: string;
  model?: string;
  userOverrideContext?: number | null;
  userOverrideRetries?: number | null;
  liveModelCatalog?: Array<{
    id: string;
    context_length?: number | null;
    max_context_length?: number | null;
    context_window?: number | null;
  }> | null;
  providerDefinition?: ProviderDefinition | null;
}

export interface CapabilityResolutionResult {
  maxContextTokens: number;
  contextSource: "user-override" | "live-discovery" | "registry-metadata" | "conservative-fallback";
  maxRetries: number;
  retriesSource: "user-override" | "registry-metadata" | "default";
  supportsToolSearch: boolean;
}

export function resolveCapabilityPrecedence(input: CapabilityResolutionInput): CapabilityResolutionResult {
  // Precedence 1: Explicit user override
  if (
    typeof input.userOverrideContext === "number" &&
    Number.isInteger(input.userOverrideContext) &&
    input.userOverrideContext > 0
  ) {
    return {
      maxContextTokens: input.userOverrideContext,
      contextSource: "user-override",
      maxRetries: resolveRetries(input),
      retriesSource: resolveRetriesSource(input),
      supportsToolSearch: Boolean(input.providerDefinition?.capabilities?.supportsToolSearch),
    };
  }

  // Precedence 2: Authoritative live provider metadata (/v1/models)
  if (input.model && Array.isArray(input.liveModelCatalog)) {
    const liveMatch = input.liveModelCatalog.find((m) => m && m.id === input.model);
    const liveLength = liveMatch?.context_length ?? liveMatch?.max_context_length ?? liveMatch?.context_window;
    if (typeof liveLength === "number" && Number.isInteger(liveLength) && liveLength > 0) {
      return {
        maxContextTokens: liveLength,
        contextSource: "live-discovery",
        maxRetries: resolveRetries(input),
        retriesSource: resolveRetriesSource(input),
        supportsToolSearch: Boolean(input.providerDefinition?.capabilities?.supportsToolSearch),
      };
    }
  }

  // Precedence 3: Registry capability metadata
  const capabilities = input.providerDefinition?.capabilities;
  if (capabilities) {
    if (input.model && capabilities.knownModels?.[input.model]) {
      const knownTokens = capabilities.knownModels[input.model]?.contextTokens;
      if (typeof knownTokens === "number" && Number.isInteger(knownTokens) && knownTokens > 0) {
        return {
          maxContextTokens: knownTokens,
          contextSource: "registry-metadata",
          maxRetries: resolveRetries(input),
          retriesSource: resolveRetriesSource(input),
          supportsToolSearch: Boolean(capabilities.supportsToolSearch),
        };
      }
    }
    if (
      typeof capabilities.defaultContextTokens === "number" &&
      Number.isInteger(capabilities.defaultContextTokens) &&
      capabilities.defaultContextTokens > 0
    ) {
      return {
        maxContextTokens: capabilities.defaultContextTokens,
        contextSource: "registry-metadata",
        maxRetries: resolveRetries(input),
        retriesSource: resolveRetriesSource(input),
        supportsToolSearch: Boolean(capabilities.supportsToolSearch),
      };
    }
  }

  // Precedence 4: Conservative Claude Code fallback
  return {
    maxContextTokens: 200000,
    contextSource: "conservative-fallback",
    maxRetries: resolveRetries(input),
    retriesSource: resolveRetriesSource(input),
    supportsToolSearch: Boolean(capabilities?.supportsToolSearch),
  };
}

function resolveRetries(input: CapabilityResolutionInput): number {
  if (typeof input.userOverrideRetries === "number" && input.userOverrideRetries >= 0) {
    return input.userOverrideRetries;
  }
  if (typeof input.providerDefinition?.capabilities?.defaultRetries === "number") {
    return input.providerDefinition.capabilities.defaultRetries;
  }
  return 10;
}

function resolveRetriesSource(input: CapabilityResolutionInput): "user-override" | "registry-metadata" | "default" {
  if (typeof input.userOverrideRetries === "number" && input.userOverrideRetries >= 0) {
    return "user-override";
  }
  if (typeof input.providerDefinition?.capabilities?.defaultRetries === "number") {
    return "registry-metadata";
  }
  return "default";
}

