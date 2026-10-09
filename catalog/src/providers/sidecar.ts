/**
 * Session-Scoped Sidecar Lifecycle Supervisor
 *
 * Rules:
 * - Start only the required FK-owned process for providers needing a local sidecar.
 * - Launch / configure Claude Code for that session.
 * - Stop the sidecar when the Claude process exits.
 * - Support concurrent sessions safely.
 * - Never use broad pkill / killall; manage only owned PIDs.
 * - Do not leave idle daemons.
 */

import { existsSync } from "node:fs";
import { readFile, writeFile, unlink, mkdir } from "node:fs/promises";
import { join } from "node:path";
import { spawn, type ChildProcess } from "node:child_process";
import type { SidecarConfig } from "./types.ts";

export interface SidecarSession {
  sessionId: string;
  providerId: string;
  pid: number;
  port: number;
  pidFile: string;
}

export class SidecarError extends Error {
  constructor(message: string) {
    super(`Sidecar: ${message}`);
    this.name = "SidecarError";
  }
}

export function isPidAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

export async function stopOwnedPid(pid: number, timeoutMs = 2000): Promise<boolean> {
  if (!isPidAlive(pid)) return true;

  try {
    // Send SIGTERM to the owned process
    process.kill(pid, "SIGTERM");
  } catch {
    return !isPidAlive(pid);
  }

  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    if (!isPidAlive(pid)) return true;
    await new Promise((r) => setTimeout(r, 100));
  }

  // Force kill if still alive
  if (isPidAlive(pid)) {
    try {
      process.kill(pid, "SIGKILL");
    } catch {
      // ignore
    }
  }

  return !isPidAlive(pid);
}

export async function waitForHealth(
  port: number,
  healthPath: string,
  timeoutMs = 10000
): Promise<boolean> {
  const url = `http://127.0.0.1:${port}${healthPath}`;
  const start = Date.now();

  while (Date.now() - start < timeoutMs) {
    try {
      const res = await fetch(url, { signal: AbortSignal.timeout(1000) });
      if (res.ok) return true;
    } catch {
      // retry
    }
    await new Promise((r) => setTimeout(r, 200));
  }
  return false;
}
