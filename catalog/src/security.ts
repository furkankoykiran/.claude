/**
 * Security analysis: extract a SecurityProfile from a parsed skill.
 *
 * Treats skill content as software supply-chain data. We detect capability
 * surface (bash, dynamic `!` shell, hooks, MCP/LSP, agents, network, exec) and
 * secret material — but we NEVER print a matched secret, only that one was
 * detected. The profile feeds both the change report and the auto-merge gate.
 */
import type { SecurityProfile } from "./types.ts";

export interface DirFile {
  name: string;
  executable: boolean;
  isBinary: boolean;
}

// Patterns that indicate embedded credentials. Matches are never surfaced.
const SECRET_PATTERNS: RegExp[] = [
  /(?:api[_-]?key|secret|password|passwd|token|auth|bearer)["'\s:=]+[A-Za-z0-9._\-]{16,}/i,
  /AKIA[0-9A-Z]{16}/,
  /-----BEGIN (?:RSA |EC |DSA |OPENSSH |PGP |)PRIVATE KEY-----/,
  /gh[pousr]_[A-Za-z0-9]{36,}/,
  /github_pat_[A-Za-z0-9_]{40,}/i,
  /xox[baprs]-[A-Za-z0-9-]{10,}/,
  /nvapi-[A-Za-z0-9_\-]{16,}/,
  /\bsk-[A-Za-z0-9]{20,}/,
  /\bAIza[0-9A-Za-z_\-]{30,}\b/,
];

const BENIGN_HIDDEN = new Set([".gitkeep", ".gitignore", ".keep", ".npmignore"]);

/** True if text contains a likely secret. Never returns the secret itself. */
export function containsSecret(text: string): boolean {
  return SECRET_PATTERNS.some((re) => re.test(text));
}

export function buildSecurityProfile(
  frontmatter: Record<string, unknown>,
  body: string,
  dirFiles: DirFile[],
  rawFrontmatter: string,
): SecurityProfile {
  const flags: string[] = [];
  const allowedTools = (frontmatter["allowed-tools"] as unknown) ?? [];
  const allowedArr = Array.isArray(allowedTools)
    ? allowedTools
    : typeof allowedTools === "string"
      ? [allowedTools]
      : [];
  const fullText = rawFrontmatter + "\n" + body;

  const hasBashOrPowershell =
    allowedArr.some((t) => typeof t === "string" && /^(Bash|PowerShell|BashOutput)$/i.test(t.trim())) ||
    /\b(pwsh|powershell)\b/i.test(body);

  // Dynamic shell context: `!cmd` or ```! fenced blocks.
  const hasDynamicShell = /(^|\n)!\s*[`A-Za-z0-9_]/.test(body) || /```!/.test(body);

  const hasHooks = "hooks" in frontmatter && frontmatter["hooks"] !== undefined;
  const hasAgents = "agent" in frontmatter || "agents" in frontmatter || dirFiles.some((f) => f.name === "agents");

  const hiddenFiles = dirFiles
    .filter((f) => f.name.startsWith(".") && !BENIGN_HIDDEN.has(f.name))
    .map((f) => f.name);
  const hasHiddenFiles = hiddenFiles.length > 0;

  const hasMcpOrLsp =
    dirFiles.some((f) => f.name === ".mcp.json" || f.name === ".lsp.json") ||
    /\.mcp\.json|\.lsp\.json/.test(fullText);

  const executables = dirFiles.filter((f) => f.executable && !f.isBinary).map((f) => f.name);
  const binaries = dirFiles.filter((f) => f.isBinary).map((f) => f.name);
  const hasExecutable = executables.length > 0 || binaries.length > 0;

  const hasNetworkRef = /\b(curl|wget|fetch\(|http\.get|Invoke-WebRequest|Invoke-RestMethod)\b/.test(body);

  const hasCredentialRef = containsSecret(fullText);

  if (hasBashOrPowershell) flags.push("bash/powershell tool");
  if (hasDynamicShell) flags.push("dynamic-shell-context");
  if (hasHooks) flags.push("hooks");
  if (hasMcpOrLsp) flags.push("mcp/lsp");
  if (hasAgents) flags.push("agents");
  if (hasNetworkRef) flags.push("network-access");
  if (hasCredentialRef) flags.push("credential-reference-detected");
  if (hasHiddenFiles) flags.push(`hidden-files:${hiddenFiles.length}`);
  if (executables.length) flags.push(`executables:${executables.length}`);
  if (binaries.length) flags.push(`binaries:${binaries.length}`);

  return {
    hasBashOrPowershell,
    hasDynamicShell,
    hasHooks,
    hasMcpOrLsp,
    hasAgents,
    hasCredentialRef,
    hasHiddenFiles,
    hasExecutable,
    hasNetworkRef,
    toolCount: allowedArr.length,
    flags,
  };
}

/**
 * Whether a change from old -> new security profile is an escalation (new
 * capability surface introduced). Used by the auto-merge gate: escalations of
 * certain kinds force manual review.
 */
export function isCapabilityEscalation(oldP: SecurityProfile, newP: SecurityProfile): boolean {
  const grew = (a: boolean, b: boolean) => !a && b;
  return (
    grew(oldP.hasHooks, newP.hasHooks) ||
    grew(oldP.hasMcpOrLsp, newP.hasMcpOrLsp) ||
    grew(oldP.hasAgents, newP.hasAgents) ||
    grew(oldP.hasDynamicShell, newP.hasDynamicShell) ||
    grew(oldP.hasCredentialRef, newP.hasCredentialRef) ||
    newP.toolCount - oldP.toolCount > 0 ||
    grew(oldP.hasExecutable, newP.hasExecutable)
  );
}