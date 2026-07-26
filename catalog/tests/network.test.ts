/**
 * Opt-in network integration test for the real configured upstream sources.
 *
 * Skipped unless CATALOG_NETWORK_TESTS=1, so ordinary `bun test` runs never
 * depend on the live network. Enable manually:
 *   CATALOG_NETWORK_TESTS=1 bun test catalog/tests/network.test.ts
 */
import { describe, it, expect } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { resolveCatalog } from "../src/resolver.ts";
import { parseManifest } from "../src/manifest.ts";

const ENABLED = process.env["CATALOG_NETWORK_TESTS"] === "1";
const itOrSkip = ENABLED ? it : it.skip;

describe("network: real configured sources (opt-in)", () => {
  itOrSkip("resolves adithya-s-k/manim_skill to 3 skills at origin/HEAD", async () => {
    const work = await mkdtemp(join(tmpdir(), "cat-net-"));
    try {
      const manifest = parseManifest(`
[sources.manim]
type = "git"
display_name = "Manim"
repo = "https://github.com/adithya-s-k/manim_skill.git"
ref = "origin/HEAD"
pack = "manim"
license = "MIT"
redistribution = "full"
install_step = "install_manim_upstream"
selection.kind = "named"
selection.root = "skills"
selection.names = ["manimce-best-practices", "manimgl-best-practices", "manim-composer"]
`);
      const resolved = await resolveCatalog(manifest, {
        mode: "update",
        lock: null,
        cacheDir: join(work, "cache"),
        repoRoot: work,
        timeoutMs: 60_000,
      });
      expect(resolved.skills.length).toBe(3);
      for (const s of resolved.skills) {
        expect(s.digest).toMatch(/^[0-9a-f]{64}$/);
        expect(s.resolvedRevision).toMatch(/^[0-9a-f]{40}$/);
      }
    } finally {
      await rm(work, { recursive: true, force: true });
    }
  });
});