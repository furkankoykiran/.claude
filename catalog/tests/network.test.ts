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
  itOrSkip("resolves multica-ai/andrej-karpathy-skills to 1 skill at origin/HEAD", async () => {
    const work = await mkdtemp(join(tmpdir(), "cat-net-"));
    try {
      const manifest = parseManifest(`
[sources.karpathy]
type = "git"
display_name = "Karpathy guidelines"
repo = "https://github.com/multica-ai/andrej-karpathy-skills.git"
ref = "origin/HEAD"
pack = "karpathy"
license = "unknown"
redistribution = "metadata-only"
license_notice_files = []
install_step = "install_karpathy_skill"
selection.kind = "named"
selection.root = "skills"
selection.names = ["karpathy-guidelines"]
`);
      const resolved = await resolveCatalog(manifest, {
        mode: "update",
        lock: null,
        cacheDir: join(work, "cache"),
        repoRoot: work,
        timeoutMs: 60_000,
      });
      expect(resolved.skills.length).toBe(1);
      for (const s of resolved.skills) {
        expect(s.digest).toMatch(/^[0-9a-f]{64}$/);
        expect(s.resolvedRevision).toMatch(/^[0-9a-f]{40}$/);
      }
    } finally {
      await rm(work, { recursive: true, force: true });
    }
  });
});