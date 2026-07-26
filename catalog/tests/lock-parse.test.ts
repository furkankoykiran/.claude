import { describe, it, expect } from "bun:test";
import { readFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import type { Lockfile } from "../src/types.ts";

const REPO_ROOT = join(import.meta.dirname, "..", "..");
const LOCK_PATH = join(REPO_ROOT, "skills-source.lock.json");
const INSTALL_SH = join(REPO_ROOT, "install.sh");

/**
 * install.sh reads skills-source.lock.json with awk, because it runs before bun
 * is guaranteed to exist. That is only safe while the awk extraction agrees
 * with a real JSON parse — this test is what makes it safe.
 *
 * If the lock's serialization ever changes shape (different indentation, keys
 * reordered, revisions nested differently), these assertions fail here rather
 * than silently installing an unpinned upstream HEAD on every user's machine.
 */
/** Shell source with comment-only lines dropped, for "the code must not do X". */
function codeLines(source: string): string[] {
  return source
    .split("\n")
    .map((l) => l.trim())
    .filter((l) => l.length > 0 && !l.startsWith("#"));
}

function awkLockedRevision(id: string): string {
  // Same program as `locked_revision` in install.sh. Kept in sync by the
  // "matches install.sh" test below.
  const program = `
    $0 ~ "\\"id\\": \\"" want "\\"" { found = 1; next }
    found && /"resolvedRevision":/ {
      line = $0
      sub(/^.*"resolvedRevision"[[:space:]]*:[[:space:]]*"/, "", line)
      sub(/".*$/, "", line)
      print line
      exit
    }
    found && /^    \\}/ { exit }
  `;
  const r = spawnSync("awk", ["-v", `want=${id}`, program, LOCK_PATH], { encoding: "utf8" });
  if (r.status !== 0) throw new Error(r.stderr);
  return r.stdout.trim();
}

describe("install.sh lock extraction", () => {
  it("agrees with a real JSON parse for every git source", async () => {
    const lock = JSON.parse(await readFile(LOCK_PATH, "utf8")) as Lockfile;
    const gitSources = lock.sources.filter((s) => s.type === "git");
    expect(gitSources.length).toBeGreaterThan(0);
    for (const s of gitSources) {
      expect(s.resolvedRevision).toMatch(/^[0-9a-f]{40}$/);
      expect(awkLockedRevision(s.id)).toBe(s.resolvedRevision!);
    }
  });

  it("returns nothing for a source that has no revision", () => {
    expect(awkLockedRevision("rtk")).toBe("");
    expect(awkLockedRevision("no-such-source")).toBe("");
  });

  it("keeps the awk program identical to the one install.sh ships", async () => {
    // A copy-paste drift here would make the test above prove nothing.
    const sh = await readFile(INSTALL_SH, "utf8");
    for (const fragment of [
      `$0 ~ "\\"id\\": \\"" want "\\""`,
      `found && /"resolvedRevision":/`,
      `sub(/^.*"resolvedRevision"[[:space:]]*:[[:space:]]*"/, "", line)`,
      `found && /^    \\}/ { exit }`,
    ]) {
      expect(sh).toContain(fragment);
    }
  });

  it("pins every git source that install.sh stages", async () => {
    const sh = await readFile(INSTALL_SH, "utf8");
    const lock = JSON.parse(await readFile(LOCK_PATH, "utf8")) as Lockfile;
    const staged = [...sh.matchAll(/stage_source "([a-z0-9-]+)"/g)].map((m) => m[1]!);
    expect(staged.length).toBeGreaterThan(0);
    for (const id of staged) {
      const src = lock.sources.find((s) => s.id === id);
      expect(src, `install.sh stages "${id}" but the lock has no such source`).toBeDefined();
      expect(src!.resolvedRevision, `source "${id}" is staged but not pinned`).toMatch(/^[0-9a-f]{40}$/);
    }
  });

  it("leaves no unpinned third-party clone behind in install.sh", async () => {
    // Every UPSTREAM clone must go through stage_source; a bare `git clone` of a
    // third-party repo is exactly the non-determinism this replaced. Cloning
    // $REPO_URL (this repository, in sync_repo) is the one legitimate case.
    const offenders = codeLines(await readFile(INSTALL_SH, "utf8")).filter(
      (l) => /\bgit clone\b/.test(l) && /\$[A-Z_]*REPO/.test(l) && !/\$REPO_URL/.test(l),
    );
    expect(offenders).toEqual([]);
  });

  it("never resets or cleans the user's checkout", async () => {
    // The historical bug: `git reset --hard origin/main` on ~/.claude silently
    // destroyed every tracked local change on each re-run. Comments may still
    // describe it — code may not do it.
    const offenders = codeLines(await readFile(INSTALL_SH, "utf8")).filter((l) =>
      /\bgit\b.*\breset\s+--hard\b/.test(l) || /\bgit\b.*\bclean\s+-[a-z]*[fdx]/.test(l),
    );
    expect(offenders).toEqual([]);
  });
});

describe("repository invariants", () => {
  it("ships the updater and its migrations", () => {
    expect(existsSync(join(REPO_ROOT, "bin", "fkt"))).toBe(true);
    expect(existsSync(join(REPO_ROOT, "migrations"))).toBe(true);
  });

  it("keeps VERSION in step with the generated manifests", async () => {
    const version = (await readFile(join(REPO_ROOT, "VERSION"), "utf8")).trim();
    const market = JSON.parse(
      await readFile(join(REPO_ROOT, ".claude-plugin", "marketplace.json"), "utf8"),
    ) as { version: string; plugins: Array<{ version: string; source: string }> };
    expect(market.version).toBe(version);
    for (const p of market.plugins) {
      expect(p.version).toBe(version);
      const manifest = JSON.parse(
        await readFile(join(REPO_ROOT, p.source, ".claude-plugin", "plugin.json"), "utf8"),
      ) as { version: string };
      expect(manifest.version).toBe(version);
    }
  });
});