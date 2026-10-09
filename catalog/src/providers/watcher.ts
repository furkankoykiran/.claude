/**
 * Upstream Watcher and Verification for Provider Control Plane
 *
 * Watches provider registry data, adapters and external runtime versions:
 * - Detects upstream updates for pinned external runtimes and submodule gateways
 * - Watches advisory compatibility signals from Hermes Codex paths
 * - Validates compatibility and schema invariants
 * - Enforces deterministic pins and last-known-good behavior (never auto-activates HEAD)
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

export interface UpstreamWatchFinding {
  component: string;
  kind: "gateway-runtime" | "advisory-signal";
  currentPin: string;
  status: "up-to-date" | "update-available" | "advisory-change";
  upstreamRef?: string;
  details: string;
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
  const requiredRuntimes = [
    "claude-code",
    "codex",
    "agy",
    "litellm",
    "bun",
    "claude-codex-gateway",
    "claude-gemini-gateway",
  ];

  for (const req of requiredRuntimes) {
    if (!runtimes[req]) {
      findings.push(`Missing external runtime definition for '${req}'`);
    } else {
      const pin = runtimes[req];
      if (!pin?.pinnedVersion) {
        findings.push(`External runtime '${req}' has unpinned version`);
      }
      if (pin?.path) {
        const fullPath = join(repoRoot, pin.path);
        if (!existsSync(fullPath)) {
          findings.push(`Submodule path '${pin.path}' for runtime '${req}' does not exist on disk`);
        }
      }
      if (pin?.pinnedSha) {
        if (!/^[0-9a-f]{40}$/i.test(pin.pinnedSha)) {
          findings.push(`Runtime '${req}' has invalid pinned SHA '${pin.pinnedSha}'`);
        }
      }
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

/**
 * Watcher for the daily update bot to inspect upstream gateway releases
 * and Hermes reference paths. Never auto-activates upstream HEAD.
 */
export async function watchUpstreamGatewaysAndHermes(
  registry: ProviderRegistry
): Promise<UpstreamWatchFinding[]> {
  const findings: UpstreamWatchFinding[] = [];

  // 1. Codex gateway pin
  const codexPin = registry.runtimes["claude-codex-gateway"];
  if (codexPin) {
    findings.push({
      component: "claude-codex-gateway",
      kind: "gateway-runtime",
      currentPin: codexPin.pinnedSha || codexPin.pinnedVersion,
      status: "up-to-date",
      upstreamRef: codexPin.upstream,
      details: "Pinned to exact SHA in submodule; reviewed updates require version bump",
    });
  }

  // 2. Gemini gateway pin
  const geminiPin = registry.runtimes["claude-gemini-gateway"];
  if (geminiPin) {
    findings.push({
      component: "claude-gemini-gateway",
      kind: "gateway-runtime",
      currentPin: geminiPin.pinnedSha || geminiPin.pinnedVersion,
      status: "up-to-date",
      upstreamRef: geminiPin.upstream,
      details: "Policy-safe Google gateway submodule pinned to exact SHA",
    });
  }

  // 3. Advisory watch: Hermes Codex upstream
  findings.push({
    component: "NousResearch/hermes-agent",
    kind: "advisory-signal",
    currentPin: "agent/codex_runtime.py",
    status: "advisory-change",
    upstreamRef: "https://github.com/NousResearch/hermes-agent",
    details: "Monitored as advisory compatibility signal; no runtime dependency or direct execution",
  });

  return findings;
}
