/**
 * Centralized Auth UX for Unified Provider Control Plane
 *
 * Rules:
 * - Delegates authentication to official provider mechanisms.
 * - Codex: preserves official Codex authentication/login ownership.
 * - AGY delegates inference and authentication to the official local CLI.
 * - Gemini API / Vertex never reuse native AGY credentials.
 * - API-key providers retain simple environment-based auth.
 * - No silent provider fallback.
 */

import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import type { AuthStatus, ProviderDefinition } from "./types.ts";

export interface AuthContext {
  claudeDir: string;
  env?: Record<string, string | undefined>;
  homeDir?: string;
}

export function detectConsumerAntigravityAuth(ctx: AuthContext): boolean {
  const env = ctx.env ?? process.env;
  const home = ctx.homeDir ?? env["HOME"] ?? homedir();

  // Check consumer Antigravity indicators
  if (env["ANTIGRAVITY_AGENTAPI_EXE"] || env["ANTIGRAVITY_AGENT"] || env["ANTIGRAVITY_LS_ADDRESS"]) {
    return true;
  }
  const geminiDir = join(home, ".gemini");
  if (existsSync(geminiDir)) {
    return true;
  }
  return false;
}

export function evaluateProviderAuth(
  provider: ProviderDefinition,
  providerConfig: Record<string, unknown> | null,
  ctx: AuthContext
): AuthStatus {
  const env = ctx.env ?? process.env;

  switch (provider.authMethod) {
    case "official-subscription": {
      return {
        providerId: provider.id,
        authMethod: provider.authMethod,
        configured: true,
        redactedDisplay: "official claude.ai / API subscription",
      };
    }

    case "delegated-cli": {
      const runtime = provider.compatibility.nativeCli;
      if (runtime !== "codex") return {
        providerId: provider.id, authMethod: provider.authMethod, configured: false,
        redactedDisplay: `official ${runtime ?? "provider"} CLI session; authentication requires native preflight`,
      };
      // Preserve existing Codex entitlement UX.
      return {
        providerId: provider.id,
        authMethod: provider.authMethod,
        configured: true,
        redactedDisplay: "official codex CLI entitlement",
      };
    }

    case "vertex-gemini-key": {
      // Check official Gemini API / Vertex credentials
      const configEnv = (providerConfig?.["env"] as Record<string, string> | undefined) ?? {};
      const geminiKey =
        (env["GEMINI_API_KEY"] && !env["GEMINI_API_KEY"].startsWith("<") ? env["GEMINI_API_KEY"] : undefined) ||
        (configEnv["GEMINI_API_KEY"] && !configEnv["GEMINI_API_KEY"].startsWith("<")
          ? configEnv["GEMINI_API_KEY"]
          : undefined);
      const vertexProject = env["ANTHROPIC_VERTEX_PROJECT_ID"] || env["VERTEX_PROJECT_ID"] || env["GOOGLE_CLOUD_PROJECT"]
        || configEnv["ANTHROPIC_VERTEX_PROJECT_ID"] || configEnv["VERTEX_PROJECT_ID"] || configEnv["GOOGLE_CLOUD_PROJECT"];
      const vertexToken = env["GOOGLE_OAUTH_TOKEN"] || configEnv["GOOGLE_OAUTH_TOKEN"];
      const vertexCreds = vertexProject && !vertexProject.startsWith("<") && vertexToken && !vertexToken.startsWith("<");

      if (geminiKey) {
        const masked = geminiKey.length > 4 ? `****${geminiKey.slice(-4)}` : "****";
        return {
          providerId: provider.id,
          authMethod: provider.authMethod,
          configured: true,
          redactedDisplay: `configured (GEMINI_API_KEY: ${masked})`,
        };
      }

      if (vertexCreds) {
        return {
          providerId: provider.id,
          authMethod: provider.authMethod,
          configured: true,
          redactedDisplay: "configured (Vertex AI credentials)",
        };
      }

      // No official credentials. Check if personal Antigravity consumer OAuth exists.
      const consumerAuth = detectConsumerAntigravityAuth(ctx);
      return {
        providerId: provider.id,
        authMethod: provider.authMethod,
        configured: false,
        redactedDisplay: "missing",
        consumerOAuthDetected: consumerAuth,
        nativeFallbackMessage: consumerAuth
          ? "Gemini API/Vertex does not use the AGY session. Use ccs agy for the official native CLI adapter, " +
            "or configure GEMINI_API_KEY / supported Vertex credentials and run ccs gemini. No OAuth copying or silent fallback."
          : undefined,
      };
    }

    case "environment": {
      const configEnv = (providerConfig?.["env"] as Record<string, string> | undefined) ?? {};
      const token =
        env["ANTHROPIC_AUTH_TOKEN"] ||
        env["ANTHROPIC_API_KEY"] ||
        (configEnv["ANTHROPIC_AUTH_TOKEN"] && !configEnv["ANTHROPIC_AUTH_TOKEN"].startsWith("<")
          ? configEnv["ANTHROPIC_AUTH_TOKEN"]
          : undefined) ||
        (configEnv["ANTHROPIC_API_KEY"] && !configEnv["ANTHROPIC_API_KEY"].startsWith("<")
          ? configEnv["ANTHROPIC_API_KEY"]
          : undefined);

      if (provider.id === "nvidia-nim") {
        // NIM connects directly to local/remote container
        return {
          providerId: provider.id,
          authMethod: provider.authMethod,
          configured: true,
          redactedDisplay: "direct container connection (unauthenticated)",
        };
      }

      if (token) {
        const masked = token.length > 4 ? `****${token.slice(-4)}` : "****";
        return {
          providerId: provider.id,
          authMethod: provider.authMethod,
          configured: true,
          redactedDisplay: `configured (${masked})`,
        };
      }

      return {
        providerId: provider.id,
        authMethod: provider.authMethod,
        configured: false,
        redactedDisplay: "missing",
      };
    }
  }
}
