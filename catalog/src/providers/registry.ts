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
