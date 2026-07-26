/**
 * Strict installer/manifest parity test.
 *
 * install.sh is NOT refactored to consume skills-sources.toml (a disproportionate
 * rewrite of a carefully-tuned fail-soft script). Instead we parse install.sh's
 * own source declarations and assert they match the manifest, so the two can
 * never silently drift. This runs in CI and in `catalog:check`.
 *
 * What we extract from install.sh:
 *   - *_REPO="<git url>" / RTK_INSTALLER="<url>"   (git + installer sources)
 *   - `git clone ... <repo>`                       (gstack, fetched via clone)
 *   - plugin marketplaces + curated plugins         (register_plugin_marketplaces)
 *   - curated skill name lists (manim, anthropic)   (for/for-name loops)
 *   - pypi package (graphifyy)
 */
import { readFile } from "node:fs/promises";
import type { Manifest } from "./types.ts";
import { CatalogError } from "./types.ts";

export interface ParityResult {
  ok: boolean;
  installerGitRepos: string[];
  installerMarketplaces: string[];
  installerPlugins: string[];
  installerPypi: string[];
  installerInstallers: string[];
  missingInManifest: string[];
  extraInManifest: string[];
}

const QUOTE = `"([^"]+)"`;

function allMatches(re: RegExp, text: string): string[] {
  const out: string[] = [];
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) {
    out.push(m[1]!);
  }
  return out;
}

export function extractInstallerSources(installSh: string): {
  gitRepos: string[];
  marketplaces: string[];
  plugins: string[];
  pypi: string[];
  installers: string[];
} {
  const gitRepos = new Set<string>();
  // The repo's own URL (sync_repo clones it) is NOT an upstream source.
  const repoUrlMatch = installSh.match(/REPO_URL\s*=\s*"([^"]+)"/);
  const ownRepoUrl = repoUrlMatch?.[1] ?? "";
  // *_REPO="https://...git" and explicit git clone URLs.
  for (const url of allMatches(new RegExp(`_REPO=${QUOTE}`, "g"), installSh)) gitRepos.add(url);
  for (const url of allMatches(new RegExp(`git clone[^\\n]*?${QUOTE}`, "g"), installSh)) {
    if (url === ownRepoUrl) continue; // the repository itself
    if (url.endsWith(".git") || url.includes("github.com")) gitRepos.add(url);
  }
  // Installer script URLs (RTK_INSTALLER=...).
  const installers = allMatches(new RegExp(`_INSTALLER=${QUOTE}`, "g"), installSh);

  // Plugin marketplaces: the `for repo in ... ; do` loop whose body calls
  // `claude plugin marketplace add`. (Other for-loops use different vars.)
  const marketplaces: string[] = [];
  const mpIdx = installSh.indexOf("claude plugin marketplace add");
  if (mpIdx >= 0) {
    const head = installSh.slice(0, mpIdx);
    const matches = [...head.matchAll(/for repo in([\s\S]*?);(?:\s|\\)*do\b/g)];
    const last = matches[matches.length - 1];
    if (last) {
      for (const tok of last[1]!.replace(/\\\n/g, " ").split(/\s+/)) {
        if (tok.includes("/")) marketplaces.push(tok);
      }
    }
  }
  // Curated plugins: the `for p in ... ; do` loop whose body calls
  // `claude plugin install` (the dpkg loop also uses `for p in "$@"`).
  const plugins: string[] = [];
  const plugIdx = installSh.indexOf("claude plugin install");
  if (plugIdx >= 0) {
    const head = installSh.slice(0, plugIdx);
    const matches = [...head.matchAll(/for p in([\s\S]*?);(?:\s|\\)*do\b/g)];
    const last = matches[matches.length - 1];
    if (last) {
      for (const tok of last[1]!.replace(/\\\n/g, " ").split(/\s+/)) {
        if (tok && /^[a-z0-9][a-z0-9-]*$/i.test(tok)) plugins.push(tok);
      }
    }
  }

  // PyPI packages (pip install ... <pkg>).
  const pypi = new Set<string>();
  for (const pkg of allMatches(/pip(?:x)? install(?:\s+--?\S+)*\s+([a-zA-Z0-9_\-]+)/g, installSh)) {
    // only keep ones that look like real package installs (lowercase, not flags)
    if (/^[a-z][a-z0-9_-]*$/.test(pkg) && !["upgrade", "user", "install", "manim", "edge-tts"].includes(pkg)) {
      pypi.add(pkg);
    }
  }
  // manim/edge-tts are deps of a repo-owned skill; graphifyy is the standalone source.
  // We only surface graphifyy as a runtime source; others are repo-owned skill deps.

  return {
    gitRepos: [...gitRepos].sort(),
    marketplaces: marketplaces.sort(),
    plugins: plugins.sort(),
    pypi: [...pypi].sort(),
    installers: installers.sort(),
  };
}

/** Compare installer declarations to the manifest; returns a structured result. */
export function checkParity(manifest: Manifest, installSh: string): ParityResult {
  const ext = extractInstallerSources(installSh);

  const manifestGitRepos = new Set<string>();
  const manifestMarketplaces = new Set<string>();
  const manifestPlugins = new Set<string>();
  const manifestPypi = new Set<string>();
  const manifestInstallers = new Set<string>();
  for (const s of Object.values(manifest.sources)) {
    if (s.type === "git") manifestGitRepos.add(s.repo);
    else if (s.type === "runtime") {
      if (s.runtimeKind === "plugin-marketplace") {
        for (const m of s.marketplaces ?? []) manifestMarketplaces.add(m);
        for (const p of s.plugins ?? []) manifestPlugins.add(p);
      } else if (s.runtimeKind === "pypi-package" && s.pypiPackage) {
        manifestPypi.add(s.pypiPackage);
      } else if (s.runtimeKind === "installer-script" && s.installerUrl) {
        manifestInstallers.add(s.installerUrl);
      }
    }
  }

  // A git URL in install.sh should map to a manifest git source. Compare by the
  // owner/repo tail so http vs https / trailing .git differences don't cause drift.
  const tail = (url: string) => url.replace(/\.git$/, "").replace(/^[^/]*\/\//, "").replace(/^[^/]+\//, "").toLowerCase();
  const missingInManifest = ext.gitRepos.filter((u) => !manifestGitRepos.has(u) && ![...manifestGitRepos].some((m) => tail(m) === tail(u)));
  const extraInManifest = [...manifestGitRepos].filter((u) => !ext.gitRepos.some((m) => tail(m) === tail(u)));

  const missingMarketplaces = ext.marketplaces.filter((m) => !manifestMarketplaces.has(m) && ![...manifestMarketplaces].some((mm) => mm.includes(m)));
  const missingPlugins = ext.plugins.filter((p) => !manifestPlugins.has(p) && ![...manifestPlugins].some((pp) => pp.includes(p)));
  const missingPypi = ext.pypi.filter((p) => !manifestPypi.has(p));
  const missingInstallers = ext.installers.filter((u) => !manifestInstallers.has(u) && ![...manifestInstallers].some((mm) => mm.includes(u)));

  const allMissing = [...missingInManifest, ...missingMarketplaces, ...missingPlugins, ...missingPypi, ...missingInstallers];
  const ok = allMissing.length === 0 && extraInManifest.length === 0;

  return {
    ok,
    installerGitRepos: ext.gitRepos,
    installerMarketplaces: ext.marketplaces,
    installerPlugins: ext.plugins,
    installerPypi: ext.pypi,
    installerInstallers: ext.installers,
    missingInManifest: allMissing,
    extraInManifest,
  };
}

export async function checkParityFiles(manifestPath: string, installShPath: string): Promise<ParityResult> {
  const { loadManifest } = await import("./manifest.ts");
  const manifest = await loadManifest(manifestPath);
  const installSh = await readFile(installShPath, "utf8");
  const result = checkParity(manifest, installSh);
  if (!result.ok) {
    const bits: string[] = [];
    if (result.missingInManifest.length) bits.push(`declared in install.sh but missing from manifest: ${result.missingInManifest.join(", ")}`);
    if (result.extraInManifest.length) bits.push(`declared in manifest but absent from install.sh: ${result.extraInManifest.join(", ")}`);
    throw new CatalogError(`installer/manifest parity FAILED\n${bits.join("\n")}\nUpdate skills-sources.toml (or install.sh) so both agree.`, "parity");
  }
  return result;
}