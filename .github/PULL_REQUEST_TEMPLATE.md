<!-- Thanks for contributing! Keep changes surgical and the bootstrap fail-soft. -->

## What & why

<!-- What does this change and why? Link any related issue (Fixes #123). -->

## Type of change

- [ ] Bug fix
- [ ] New feature (skill / agent / hook / installer capability)
- [ ] Docs
- [ ] Refactor / chore

## Checklist

- [ ] `shellcheck install.sh hooks/*.sh scripts/*.sh bin/cc-provider` passes
- [ ] `scripts/test-providers.sh` passes (if the provider system changed)
- [ ] `install.ps1`, `bin/cc-provider.ps1`, `scripts/nim-gateway.ps1` are clean
      under `PSScriptAnalyzerSettings.psd1` (whichever you touched)
- [ ] Installer changes are idempotent (safe to re-run) and fail-soft
- [ ] Verified on the platform(s) affected (note which below)
- [ ] Docs updated (README / CHANGELOG) if behaviour changed

## Tested on

<!-- e.g. Ubuntu 24.04, macOS 14, Windows 11 PowerShell 7 -->