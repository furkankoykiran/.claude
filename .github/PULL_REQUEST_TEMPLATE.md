<!-- Thanks for contributing! Keep changes surgical and the bootstrap fail-soft. -->

## What & why

<!-- What does this change and why? Link any related issue (Fixes #123). -->

## Type of change

- [ ] Bug fix
- [ ] New feature (skill / agent / hook / installer capability)
- [ ] Docs
- [ ] Refactor / chore

## Checklist

- [ ] `shellcheck install.sh hooks/*.sh scripts/*.sh migrations/*.sh bin/cc-provider bin/fkt` passes
- [ ] `scripts/test-providers.sh` passes (if the provider system changed)
- [ ] `scripts/test-fkt.sh` passes (if the updater, hooks or migrations changed)
- [ ] `bun run typecheck && bun test catalog && bun run catalog:check
      && bun run marketplace:check && bun run catalog:budget && bun run docs:check`
      passes (if anything under `catalog/`, `skills/fk-*` or `marketplace.toml` changed)
- [ ] `install.ps1`, `bin/cc-provider.ps1`, `scripts/nim-gateway.ps1` are clean
      under `PSScriptAnalyzerSettings.psd1` (whichever you touched)
- [ ] Installer changes are idempotent (safe to re-run) and fail-soft
- [ ] Verified on the platform(s) affected (note which below)
- [ ] Docs updated if behaviour changed
- [ ] `VERSION` bumped if this is user-facing — see
      [the release process](../docs/release-process.md). There is no CHANGELOG
      to edit; release notes come from the commit subjects, so write a
      Conventional Commit and mark breaking changes with `!` or a
      `BREAKING CHANGE:` footer.

## Tested on

<!-- e.g. Ubuntu 24.04, macOS 14, Windows 11 PowerShell 7 -->