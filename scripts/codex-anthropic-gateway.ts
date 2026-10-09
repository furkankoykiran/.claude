#!/usr/bin/env bun
/**
 * Thin compatibility launcher delegating to canonical submodule runtime:
 * gateways/claude-codex-gateway
 */
export * from "../gateways/claude-codex-gateway/src/index.ts";

if (import.meta.main) {
  const { spawn } = await import("node:child_process");
  const { resolve } = await import("node:path");
  const target = resolve(import.meta.dirname, "../gateways/claude-codex-gateway/src/index.ts");
  const child = spawn(process.execPath, [target, ...process.argv.slice(2)], { stdio: "inherit" });
  for (const sig of ["SIGTERM", "SIGINT", "SIGHUP"] as const) {
    process.on(sig, () => {
      child.kill(sig);
    });
  }
  child.on("exit", (code, signal) => {
    if (signal) process.kill(process.pid, signal);
    else process.exit(code ?? 0);
  });
}
