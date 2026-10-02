# Installer and updater parity

This page records the current installer and updater evidence for Linux/macOS/WSL/Git Bash and PowerShell.

## Current scope

| Surface | Status | Evidence | Limit |
| --- | --- | --- | --- |
| POSIX installer staging and update safety | Proven in local tests | `scripts/test-install.sh` passed `50 passed, 0 failed` on 2026-10-01. | This is a function-level regression suite, not a full network bootstrap. |
| POSIX `fkt` updater behavior | Proven in local tests | `scripts/test-fkt.sh` passed `154 passed, 0 failed` after safe uninstall work. | Uses local git fixtures and mocked remotes. |
| Provider/config merge during setup | Proven in local tests | `scripts/test-providers.sh` passed `118 passed, 0 failed`; `fkt setup/configure` delegates provider/model writes to `ccs` in a sandbox and writes documented runtime preferences with backups. | Native PowerShell execution remains separate. |
| PowerShell installer execution | CI-proven once remote workflow is green | `.github/workflows/ci.yml` now includes `powershell-install-smoke` on `windows-latest`, running `install.ps1 -Minimal` with `CLAUDE_BOOTSTRAP_NO_SYNC=1` and checking `ccs.ps1`/`fkt.ps1`. | Local Linux still has no `pwsh`; final proof must come from remote CI. |
| PATH reliability for `ccs` and `fkt` | Proven for POSIX shell functions | `scripts/test-install.sh` covers clean login shell discovery, lazy default toolkit resolution, custom `CLAUDE_DIR`, duplicate prevention, and legacy function migration. | Native Windows PATH behavior needs live PowerShell verification. |
| Safe upgrade from current release | Proven for `fkt`; partly proven for installer sync | `scripts/test-fkt.sh` covers fast-forward-only update, dirty/diverged refusal, dry-run, migrations, and gstack fast-forward. `scripts/test-install.sh` covers installer sync refusal and channel behavior. | Full end-to-end install-smoke CI remains required. |
| Safe uninstall | Proven for POSIX `fkt` behavior | `fkt uninstall --dry-run` is non-mutating; `fkt uninstall --yes` removes toolkit-owned shims, moves checkout/config/state to backup, and preserves Claude/Codex/gstack credential and state files in `scripts/test-fkt.sh`. | Native PowerShell execution remains unverified here. |
| Interactive/full non-interactive setup | In progress | `fkt setup/configure --dry-run` previews choices; `--yes` currently applies update/provider/model choices with backups. | Full interactive/non-interactive installer setup remains incomplete. |

## PowerShell verification boundary

This environment does not have `pwsh` on PATH, so native PowerShell execution is not locally verified here. Remote CI now has a Windows install smoke job that runs `install.ps1 -Minimal`, installs the PowerShell command shims, and exercises `ccs.ps1 list` plus `fkt.ps1 doctor`. Treat PowerShell parity as pending until that remote job is green on the PR.

## Current product decision

Do not claim full installer parity yet. The repository has strong POSIX updater/install safety coverage and now has a Windows PowerShell install-smoke job, but final A18 completion still needs:

- green `powershell-install-smoke` on the PR;
- broader end-to-end Windows coverage for idempotent reinstall, dry-run/preview, safe upgrade, and uninstall;
- continued confirmation that no credentials are destroyed or printed during migration/setup.
