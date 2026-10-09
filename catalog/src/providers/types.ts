/**
 * Unified FK Provider Control Plane - Type Definitions
 *
 * Designed to be clean and modular so the core can be extracted
 * into a standalone package in the future.
 */

export type TransportType = "direct-anthropic" | "local-sidecar";

export type AuthMethod =
  | "official-subscription"
  | "delegated-cli"
  | "vertex-gemini-key"
  | "environment";

export type LifecycleType = "none" | "session-sidecar";

export interface SidecarConfig {
  script: string;
  defaultPort: number;
  healthEndpoint: string;
}

export interface ProviderCompatibility {
  claudeCode: "supported" | "experimental" | "unsupported";
  nativeCli?: string;
  notes?: string;
}

export interface ProviderDefinition {
  id: string;
  name: string;
  aliases: string[];
  authMethod: AuthMethod;
  transportType: TransportType;
  modelDiscovery: boolean | string;
  lifecycle: LifecycleType;
  compatibility: ProviderCompatibility;
  requiredRuntime: string;
  sidecar?: SidecarConfig;
  description: string;
}

export interface RuntimePin {
  name: string;
  pinnedVersion: string;
  upstream: string;
  protocol?: string;
}

export interface ProviderRegistry {
  $schema?: string;
  version: number;
  runtimes: Record<string, RuntimePin>;
  providers: ProviderDefinition[];
}

export interface AuthStatus {
  providerId: string;
  authMethod: AuthMethod;
  configured: boolean;
  redactedDisplay: string;
  consumerOAuthDetected?: boolean;
  nativeFallbackMessage?: string;
}
