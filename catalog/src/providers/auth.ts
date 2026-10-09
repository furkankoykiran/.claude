/**
 * Centralized Auth UX for Unified Provider Control Plane
 *
 * Rules:
 * - Delegates authentication to official provider mechanisms.
 * - Codex: preserves official Codex authentication/login ownership.
 * - Google / agy / antigravity: Claude Code inference may use only officially
 *   supported Gemini API / Vertex credentials. Never reuse, copy or proxy
 *   personal Antigravity consumer OAuth into Claude Code. If only consumer
 *   Antigravity auth exists, fail clearly and offer native agy usage instead.
 * - API-key providers retain simple environment-based auth.
 * - No silent provider fallback.
 */

import { existsSync } from "node:fs";
import { join } from "node:path";
import type { AuthStatus, ProviderDefinition } from "./types.ts";

export interface AuthContext {
  claudeDir: string;
  env?: Record<string, string | undefined>;
  homeDir?: string;
}

export function detectConsumerAntigravityAuth(ctx: AuthContext): boolean {
  const env = ctx.env ?? process.env;
  const home = ctx.homeDir ?? env["HOME"] ?? "/root";

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
      // Codex: preserve official Codex login ownership
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
        env["GEMINI_API_KEY"] ||
        (configEnv["GEMINI_API_KEY"] && !configEnv["GEMINI_API_KEY"].startsWith("<")
          ? configEnv["GEMINI_API_KEY"]
          : undefined);
      const vertexCreds =
        env["GOOGLE_APPLICATION_CREDENTIALS"] ||
        env["ANTHROPIC_VERTEX_PROJECT_ID"] ||
        configEnv["GOOGLE_APPLICATION_CREDENTIALS"] ||
        configEnv["ANTHROPIC_VERTEX_PROJECT_ID"];

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
          ? "Personal Antigravity consumer OAuth cannot be reused or proxied into Claude Code.\n" +
            "Claude Code inference requires an official GEMINI_API_KEY or Vertex credentials.\n" +
            "To use your existing Antigravity session natively, run:\n" +
            "  agy -p \"your prompt\" --model gemini-3.8-flash --effort medium\n" +
            "To configure Claude Code with Gemini API:\n" +
            "  export GEMINI_API_KEY=\"your-key\"\n" +
            "  or run: ccs api google"
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
