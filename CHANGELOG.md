# Changelog

All notable changes to this project are documented here.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).
This is a rolling configuration repo, so versions mark notable milestones of the
bootstrap rather than a published package.

## [Unreleased]

### Fixed

- **The Skills Catalog update workflow could not finish a run.** Its
  no-change and dry-run guards used `exit 0`, which ends only the *step*, so
  every later step still ran: a scheduled run with nothing to update went on to
  `git commit` an empty tree and failed, and `dry_run=true` would still have
  pushed, opened a PR, minted an App token, and merged. Both guards are now a
  single `changed=true|false` step output that every mutating step is gated on.
- **The update workflow's auto-merge had an unsafe fallback.** When
  `gh pr merge --auto` failed it fell through to a direct `gh pr merge --squash`,
  merging without waiting for checks. Removed; auto-merge is now `--auto` only,
  never `--admin`, with no fallback.
- **The second and later update runs would have failed to push.**
  `--force-with-lease` with no remote-tracking ref is rejected as `stale info`
  once `automation/skills-catalog` exists on the remote. The branch is now
  fetched first and the expected value passed explicitly.
- **Automated commits were attributed to a generic actor.** They now carry the
  App's real `<app-slug>[bot]` name and no-reply email, resolved from the token
  step at run time.
- **`release:*` label overrides never applied.** The release workflow declared
  only `contents: write`, so its best-effort PR-label lookup was silently denied.
  It now also requests `pull-requests: read`.
- **Every automation PR was classified `manual-review-required`, so auto-merge
  could never fire.** The update workflow read the committed
  `skills-catalog-diff.json`, which `catalog:generate` writes against an *empty*
  base — the invariant CI enforces on `main`. All 141 skills therefore read as
  newly added with 14 security-sensitive entries on every run. Classification
  now uses `catalog diff --base HEAD:skills-catalog.json`, i.e. what this run
  actually changed relative to `main`. No committed artifact changes.
- **The release workflow would have failed on every push to `main` once a tag
  existed.** Its staleness guard regenerated the catalog against the previous
  *tag* and then compared the result to the committed files, which are generated
  against an empty base — so the two diff-derived artifacts could never match.
  The reproducibility guard now uses the same plain regeneration CI asserts, and
  the release-relative diff is rebuilt in a separate step for the SemVer bump and
  release notes.
- **Pinning a model broke the `nvidia` provider entirely.** `/model opus`,
  `--model`, or a resumed session that recorded its model makes Claude Code send
  the literal Anthropic id, and `ANTHROPIC_DEFAULT_*_MODEL` does not rewrite
  those — so the gateway's wildcard handed `claude-opus-5` to NVIDIA and every
  request came back `404 page not found. Received Model Group=claude-opus-5`.
  The gateway now maps the Anthropic ids onto the same three tiers.
- **NVIDIA's hosted tier rate-limited Claude Code's parallel subagents**, failing
  turns mid-stream with `ResourceExhausted: Worker local total request limit
  reached (64/48)`. The gateway now caps concurrency at 12 per model and retries
  the transient rejections instead of surfacing them.
- **The `haiku` model silently discarded context.**
  `nvidia/nemotron-3-nano-omni-30b-a3b-reasoning` advertises 256k but counted a
  400KB prompt as 1,869 input tokens — answering normally on a prompt it had
  thrown away. Replaced with `openai/gpt-oss-20b`, which accounts for tokens
  honestly and is faster. The other four candidates tested all accounted
  honestly; only the multimodal `omni` variant truncated.
- **`CLAUDE_CODE_AUTO_COMPACT_WINDOW` was set to 1M on models that do not serve
  1M.** `minimax-m3` and `deepseek-v4-flash` advertise 1M context, but measured
  ceilings through the hosted API are lower, so auto-compaction never triggered
  before the upstream started rejecting the conversation. Now 200k, comfortably
  under every measured ceiling.
- **The API key had to be edited in four places** in the gateway config once
  per-tier model mappings were added. It is now declared once via a YAML anchor,
  so rotating a key touches one line and cannot be half-applied.

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