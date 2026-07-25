# Changelog

All notable changes to this project are documented here.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).
This is a rolling configuration repo, so versions mark notable milestones of the
bootstrap rather than a published package.

## [Unreleased]

### Fixed

- **Every real Claude Code request to the `nvidia` provider failed with `400
  Validation: Unsupported parameter(s): diagnostics`.** Claude Code sends its
  full Anthropic capability set to any `ANTHROPIC_BASE_URL` endpoint, and
  LiteLLM's `drop_params` only removes params it recognises, so the
  Claude-Code-specific `diagnostics` field reached NIM and it hard-failed the
  request. The gateway config now drops it by name, and the provider sets
  `CLAUDE_CODE_DISABLE_EXPERIMENTAL_BETAS=1` to keep that surface small as
  Claude Code adds capabilities.

  This was invisible to the curl-based checks used when the provider landed,
  because they only sent fields the Anthropic API documents. Only a real client
  session surfaced it. `scripts/test-providers.sh` now asserts the gateway drops
  those fields.

### Changed

- **NVIDIA model defaults are now chosen from benchmarks rather than by
  availability.** The initial `gpt-oss-120b`/`20b` pair scored 24 on the
  Artificial Analysis Intelligence Index v4.1 and measured ~38s per request
  through the gateway. The slots now map to capability tiers, with intelligence
  and price both descending like Anthropic's own ladder:
  `opus` -> `minimaxai/minimax-m3` (44), `sonnet` ->
  `deepseek-ai/deepseek-v4-flash` (40, ~3s), `haiku` ->
  `nvidia/nemotron-3-nano-omni-30b-a3b-reasoning` (15, ~1.1s). All three are
  verified end-to-end through a real Claude Code session.

### Added

- **NVIDIA NIM support**, both ways NVIDIA ships it:
  - `ccs nvidia-nim` for a **self-hosted NIM container**, which serves
    `/v1/messages` natively — no gateway, pure config.
  - `ccs nvidia` for the **hosted catalog** at `build.nvidia.com`. That API is
    OpenAI-shaped and `404`s on `/v1/messages`, so `scripts/nim-gateway.sh`
    (`start`/`stop`/`restart`/`status`/`logs`, plus a `.ps1` twin) runs a
    loopback-only LiteLLM translator on `127.0.0.1:4000`. LiteLLM installs into
    its own venv **on demand**, not during bootstrap, so the dependency is only
    paid for by people who use it. Its config wildcards every model id through
    to NVIDIA, so models are chosen in `providers/nvidia.json` and the gateway
    config never needs editing.
- **Four more providers**, all speaking the Anthropic Messages API directly with
  nothing to run: `deepseek`, `kimi` (Moonshot), `minimax`, and `openrouter`.
  Endpoints and variables follow each vendor's own Claude Code documentation.
- **`ccs list`** — prints every available provider, which matters now that there
  are eight rather than two.
- **`scripts/test-providers.sh`** — 47 assertions covering template validity,
  discovery, activation, and the warning paths, run against a throwaway
  `CLAUDE_DIR`. Wired into CI as its own job.

### Changed

- **The provider set is now data, not code.** `cc-provider` discovers providers
  by globbing `providers/*.json.example` instead of matching a hardcoded
  `zai|anthropic` case, and both installers seed whatever templates exist. Adding
  a provider is now one committed template file, with no edits to
  `bin/cc-provider`, `bin/cc-provider.ps1`, `install.sh`, or `install.ps1` — the
  four places that previously had to agree.
- **CI covers more of what ships.** `shellcheck` now lints `bin/cc-provider`,
  which has no `.sh` suffix and so was silently excluded, and PSScriptAnalyzer
  now lints `bin/cc-provider.ps1` and `scripts/nim-gateway.ps1` alongside
  `install.ps1`.

### Fixed

- **Switching to a provider whose endpoint is local no longer fails silently.**
  `ccs` now checks whether anything is listening on a loopback
  `ANTHROPIC_BASE_URL` and names the command that starts it. Previously a
  forgotten gateway surfaced as an opaque connection error inside Claude Code.

## [1.0.0] - 2026-06-12

First hardening pass: a resilient cross-platform bootstrap and a professional
repository layout.

### Added

- **Native Windows installer** (`install.ps1`) — a PowerShell port of the bash
  bootstrap for users who are not on WSL. Same fail-soft design; runs gstack's
  bash setup through Git Bash, installs bun/Node/rtk/manim/graphify, and syncs
  all upstream skill packs. Verified clean under PSScriptAnalyzer.
- **`CLAUDE_BOOTSTRAP_MINIMAL=1`** (and `-Minimal` on Windows) — core-only
  install that skips the heavy upstream skill packs; used by CI and lean setups.
- **GitHub Actions CI** — `shellcheck`, `PSScriptAnalyzer`, and a Docker smoke
  test that runs `install.sh` on a clean `ubuntu:24.04` and asserts Chromium can
  actually launch. This makes the headless-browser regression impossible to ship
  again unnoticed.
- **Community health files** — `LICENSE` (MIT), `CONTRIBUTING.md`, `SECURITY.md`,
  `CODE_OF_CONDUCT.md`, issue/PR templates, and Dependabot for GitHub Actions.
- **`.editorconfig`** and **`.shellcheckrc`** for consistent formatting/linting.

### Fixed

- **Bootstrap no longer aborts when the headless browser can't launch.** On a
  clean Linux server/container, gstack's setup failed with
  `gstack setup failed: Playwright Chromium could not be launched`
  (`libatk-1.0.so.0: cannot open shared object file`) and, under `set -e`, took
  the entire install down with it. The Chromium binary downloads fine, but its
  OS-level shared libraries were never installed. Now `install.sh`:
  - proactively installs Chromium's system libraries on Linux before setup
    (`ensure_browser_deps`, with Ubuntu 24.04+ `t64` package-name fallbacks);
  - retries via Playwright's version-aware `install-deps` if setup still fails;
  - treats gstack/browser setup as **optional** so a browser problem never sinks
    the rest of the bootstrap.

### Changed

- **All optional steps are now fail-soft.** Only `git` and `curl` are hard
  requirements. Every other step (bun, gstack, rtk, manim, graphify, skill
  packs) is wrapped so a failure is recorded and reported in an end-of-run
  summary instead of aborting. Re-running remains idempotent.
- **README rewritten** with a platform support matrix (Linux / macOS / Windows /
  WSL), per-OS quickstarts, an expanded "what the installer does", and a
  Troubleshooting section covering the Chromium/`libatk` fix and the Windows
  Git Bash / Node / rtk notes.

[Unreleased]: https://github.com/furkankoykiran/.claude/compare/v1.0.0...HEAD
[1.0.0]: https://github.com/furkankoykiran/.claude/releases/tag/v1.0.0