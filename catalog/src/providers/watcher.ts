/**
 * Upstream Watcher and Verification for Provider Control Plane
 *
 * Watches provider registry data, adapters and external runtime versions:
 * - Detects upstream updates for pinned external runtimes
 * - Validates compatibility and schema invariants
 * - Enforces deterministic pins and last-known-good behavior
 */

import { readFile, readdir } from "node:fs/promises";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { loadProviderRegistry } from "./registry.ts";
import type { ProviderRegistry } from "./types.ts";

export interface ProviderCheckResult {
  ok: boolean;
  providersChecked: number;
  runtimesChecked: number;
  templatesChecked: number;
  findings: string[];
}

export async function checkProviderIntegrity(
  repoRoot: string,
  registryPath?: string
): Promise<ProviderCheckResult> {
  const regPath = registryPath ?? join(repoRoot, "providers", "registry.json");
  const providersDir = join(repoRoot, "providers");
  const findings: string[] = [];

  let registry: ProviderRegistry;
  try {
    registry = await loadProviderRegistry(regPath);
  } catch (e) {
    return {
      ok: false,
      providersChecked: 0,
      runtimesChecked: 0,
      templatesChecked: 0,
      findings: [(e as Error).message],
    };
  }

  // 1. Verify all .json.example templates have registered provider definitions
  const entries = await readdir(providersDir);
  const templateNames = entries
    .filter((f) => f.endsWith(".json.example"))
    .map((f) => f.replace(/\.json\.example$/, ""));

  const registeredIds = new Set(registry.providers.map((p) => p.id));

  for (const t of templateNames) {
    if (!registeredIds.has(t)) {
      findings.push(`Template providers/${t}.json.example has no entry in providers/registry.json`);
    }
  }

  for (const id of registeredIds) {
    if (!templateNames.includes(id)) {
      findings.push(`Registered provider '${id}' is missing template providers/${id}.json.example`);
    }
  }

  // 2. Check runtime pins integrity
  const runtimes = registry.runtimes ?? {};
  const requiredRuntimes = ["claude-code", "codex", "agy", "litellm", "bun"];
  for (const req of requiredRuntimes) {
    if (!runtimes[req]) {
      findings.push(`Missing external runtime definition for '${req}'`);
    } else if (!runtimes[req]?.pinnedVersion) {
      findings.push(`External runtime '${req}' has unpinned version`);
    }
  }

  // 3. Check CI workflow pin parity with claude-code runtime pin
  const ciPath = join(repoRoot, ".github", "workflows", "ci.yml");
  if (existsSync(ciPath)) {
    const ciContent = await readFile(ciPath, "utf8");
    const m = ciContent.match(/CLAUDE_CODE_VERSION:\s*([^\s]+)/);
    if (m && m[1] && runtimes["claude-code"]) {
      if (m[1] !== runtimes["claude-code"].pinnedVersion) {
        findings.push(
          `Parity mismatch: CI CLAUDE_CODE_VERSION (${m[1]}) differs from registry pin (${runtimes["claude-code"].pinnedVersion})`
        );
      }
    }
  }

  return {
    ok: findings.length === 0,
    providersChecked: registry.providers.length,
    runtimesChecked: Object.keys(runtimes).length,
    templatesChecked: templateNames.length,
    findings,
  };
}
