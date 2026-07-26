/**
 * Safe, isolated git operations for resolving upstream sources.
 *
 * Security invariants (see docs/catalog-architecture.md):
 *   - Isolated temp dir + temp HOME; no system/global git config.
 *   - Hooks disabled (core.hooksPath=/dev/null), LFS skipped, no submodules.
 *   - Only immutable SHAs are checked out in normal (locked) mode.
 *   - Moving refs are resolved with `git ls-remote` (no clone) in update mode.
 *   - All network calls are bounded by a timeout.
 *   - Upstream content is treated as untrusted data; nothing is executed.
 */
import { spawn } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { CatalogError } from "./types.ts";

const DEFAULT_TIMEOUT_MS = 90_000;

export interface GitResult {
  stdout: string;
  stderr: string;
  code: number;
}

/** Run git in a fully isolated environment. Throws CatalogError on non-zero exit or timeout. */
export function runGit(args: string[], opts: { cwd?: string; timeoutMs?: number; env?: Record<string, string> } = {}): Promise<GitResult> {
  const env: Record<string, string> = {
    // Isolate from the developer's git identity and global/system config.
    HOME: opts.env?.["HOME"] ?? process.env["HOME"] ?? "/nonexistent",
    GIT_CONFIG_NOSYSTEM: "1",
    GIT_CONFIG_GLOBAL: "/dev/null",
    GIT_TERMINAL_PROMPT: "0",
    GIT_LFS_SKIP_SMUDGE: "1",
    GIT_SUBMODULE_STRATEGY: "none",
    PATH: process.env["PATH"] ?? "/usr/bin:/bin",
    LANG: "C",
    LC_ALL: "C",
    ...opts.env,
  };
  const timeoutMs = opts.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  return new Promise((resolve, reject) => {
    const child = spawn("git", args, { cwd: opts.cwd, env, stdio: ["ignore", "pipe", "pipe"] });
    const timer = setTimeout(() => {
      child.kill("SIGKILL");
      reject(new CatalogError(`git timed out after ${timeoutMs}ms: git ${args.join(" ")}`, "<git>"));
    }, timeoutMs);
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (d) => (stdout += d.toString()));
    child.stderr.on("data", (d) => (stderr += d.toString()));
    child.on("error", (e) => {
      clearTimeout(timer);
      reject(new CatalogError(`failed to run git: ${e.message}`, "<git>"));
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      if (code !== 0) {
        reject(new CatalogError(`git exited ${code}: git ${args.join(" ")}\n${stderr.trim()}`, "<git>"));
      } else {
        resolve({ stdout, stderr, code });
      }
    });
  });
}

/** Create an isolated temp directory (and an isolated HOME inside it). */
export async function isolatedTemp(prefix: string): Promise<{ dir: string; home: string }> {
  const dir = await mkdtemp(join(tmpdir(), `catalog-${prefix}-`));
  const home = join(dir, "home");
  const { mkdir } = await import("node:fs/promises");
  await mkdir(home, { recursive: true });
  return { dir, home };
}

/** Remove a temp dir recursively, ignoring missing-dir errors. */
export async function cleanupTemp(dir: string): Promise<void> {
  await rm(dir, { recursive: true, force: true }).catch(() => {});
}

/**
 * Resolve a moving ref (e.g. "origin/HEAD", "main", a tag) to a SHA without
 * cloning. `git ls-remote` downloads no objects.
 */
export async function resolveRef(repo: string, ref: string, timeoutMs?: number): Promise<string> {
  const wantHead = ref === "HEAD" || ref === "origin/HEAD";
  try {
    if (wantHead) {
      const r = await runGit(["ls-remote", "--symref", repo, "HEAD"], { timeoutMs });
      for (const line of r.stdout.split("\n")) {
        if (line.startsWith("ref:")) continue;
        const [sha, name] = line.split("\t");
        if (sha && name === "HEAD") return sha.trim();
      }
      // Fallback: first sha line.
      const first = r.stdout.split("\n").find((l) => l && !l.startsWith("ref:") && l.includes("\t"));
      if (first) return first.split("\t")[0]!.trim();
      throw new CatalogError(`ls-remote returned no HEAD for ${repo}`, "<git>");
    }
    // Try as a branch, then as a tag.
    try {
      const r = await runGit(["ls-remote", repo, ref, `refs/heads/${ref}`, `refs/tags/${ref}`], { timeoutMs });
      const line = r.stdout.split("\n").find((l) => l.trim().length > 0);
      if (line) return line.split("\t")[0]!.trim();
    } catch {
      /* fall through */
    }
    throw new CatalogError(`could not resolve ref "${ref}" for ${repo}`, "<git>");
  } catch (e) {
    if (e instanceof CatalogError) throw e;
    throw new CatalogError(`ls-remote failed for ${repo}: ${(e as Error).message}`, "<git>");
  }
}

/**
 * Fetch an immutable SHA into an isolated worktree and check out its tree.
 * Returns the worktree path. Caller owns cleanup via cleanupTemp.
 */
export async function fetchAtSha(
  repo: string,
  sha: string,
  timeoutMs?: number,
): Promise<{ workdir: string; home: string; cleanup: () => Promise<void> }> {
  if (!/^[0-9a-f]{7,40}$/.test(sha)) {
    throw new CatalogError(`refusing to fetch non-SHA revision "${sha}"`, "<git>");
  }
  const { dir, home } = await isolatedTemp("src");
  try {
    await runGit(["init", "--quiet", "-b", "resolved", dir], { timeoutMs, env: { HOME: home } });
    await runGit(["-C", dir, "remote", "add", "origin", repo], { timeoutMs, env: { HOME: home } });
    await runGit(
      [
        "-C",
        dir,
        "-c",
        "core.hooksPath=/dev/null",
        "fetch",
        "--quiet",
        "--depth",
        "1",
        "--no-tags",
        "origin",
        sha,
      ],
      { timeoutMs, env: { HOME: home } },
    );
    await runGit(["-C", dir, "-c", "core.hooksPath=/dev/null", "checkout", "--quiet", "FETCH_HEAD"], {
      timeoutMs,
      env: { HOME: home },
    });
  } catch (e) {
    await cleanupTemp(dir);
    throw e;
  }
  return { workdir: dir, home, cleanup: () => cleanupTemp(dir) };
}

/** Resolve the commit being pointed at by a worktree's FETCH_HEAD (for sanity). */
export async function revParseHead(workdir: string, home: string, timeoutMs?: number): Promise<string> {
  const r = await runGit(["-C", workdir, "rev-parse", "HEAD"], { timeoutMs, env: { HOME: home } });
  return r.stdout.trim();
}