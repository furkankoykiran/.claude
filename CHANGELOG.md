# Changelog

All notable changes to this project are documented here.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).
This is a rolling configuration repo, so versions mark notable milestones of the
bootstrap rather than a published package.

## [Unreleased]

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