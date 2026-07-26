import { describe, it, expect } from "bun:test";
import { extractInstallerSources, checkParity } from "../src/parity.ts";
import { parseManifest } from "../src/manifest.ts";

const INSTALL_SH = `#!/usr/bin/env bash
REPO_URL="https://github.com/furkankoykiran/.claude.git"
GSTACK_REPO="https://github.com/garrytan/gstack.git"
MANIM_UPSTREAM_REPO="https://github.com/adithya-s-k/manim_skill.git"
RTK_INSTALLER="https://raw.githubusercontent.com/rtk-ai/rtk/master/install.sh"

sync_repo() {
  git clone "$REPO_URL" "$CLAUDE_DIR"
}
install_gstack() {
  git clone --depth 1 "$GSTACK_REPO" "$gstack_dir"
}
install_manim_upstream() {
  git clone --depth 1 "$MANIM_UPSTREAM_REPO" "$stage"
}
install_graphify() {
  python3 -m pip install --user --upgrade graphifyy
}
register_plugin_marketplaces() {
  for repo in anthropics/skills wshobson/agents obra/superpowers \\
              mukul975/Anthropic-Cybersecurity-Skills; do
    claude plugin marketplace add "$repo"
  done
  for p in backend-development data-engineering cloud-infrastructure \\
           cicd-automation database-design; do
    claude plugin install "$p@claude-code-workflows"
  done
}
apt_install_best_effort() {
  for p in "$@"; do dpkg -s "$p"; done
}
`;

describe("parity", () => {
  it("extracts git repos, marketplaces, plugins, pypi, installers", () => {
    const ext = extractInstallerSources(INSTALL_SH);
    expect(ext.gitRepos).toContain("https://github.com/garrytan/gstack.git");
    expect(ext.gitRepos).toContain("https://github.com/adithya-s-k/manim_skill.git");
    expect(ext.gitRepos).not.toContain("https://github.com/furkankoykiran/.claude.git"); // repo itself excluded
    expect(ext.installers).toContain("https://raw.githubusercontent.com/rtk-ai/rtk/master/install.sh");
    expect(ext.marketplaces.sort()).toEqual([
      "anthropics/skills",
      "mukul975/Anthropic-Cybersecurity-Skills",
      "obra/superpowers",
      "wshobson/agents",
    ]);
    expect(ext.plugins.sort()).toEqual([
      "backend-development",
      "cicd-automation",
      "cloud-infrastructure",
      "data-engineering",
      "database-design",
    ]);
    expect(ext.pypi).toContain("graphifyy");
  });

  it("reports drift between installer and manifest", () => {
    const manifest = parseManifest(`
[sources.gstack]
type = "git"
display_name = "g"
repo = "https://github.com/garrytan/gstack.git"
ref = "origin/HEAD"
pack = "g"
license = "MIT"
redistribution = "full"
install_step = "install_gstack"
selection.kind = "all-skills"
selection.root = ""
`);
    const r = checkParity(manifest, INSTALL_SH);
    // manim is declared in install.sh but missing from this manifest.
    expect(r.ok).toBe(false);
    expect(r.missingInManifest.some((m) => m.includes("manim_skill"))).toBe(true);
  });

  it("the real manifest and install.sh agree", async () => {
    const { readFile } = await import("node:fs/promises");
    const { join } = await import("node:path");
    const root = join(import.meta.dirname, "..", "..");
    const manifest = parseManifest(await readFile(join(root, "skills-sources.toml"), "utf8"));
    const installSh = await readFile(join(root, "install.sh"), "utf8");
    expect(checkParity(manifest, installSh).ok).toBe(true);
  });
});