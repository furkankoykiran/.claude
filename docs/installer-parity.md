# Installer and updater parity

This page records the current installer and updater evidence for Linux/macOS/WSL/Git Bash and PowerShell.

## Current scope

| Surface | Status | Evidence | Limit |
| --- | --- | --- | --- |
| POSIX installer staging and update safety | Proven in local tests | `scripts/test-install.sh` passed `50 passed, 0 failed` on 2026-10-01. | This is a function-level regression suite, not a full network bootstrap. |
| POSIX `fkt` updater behavior | Proven in local tests | `scripts/test-fkt.sh` passed `140 passed, 0 failed` after setup/configure work. | Uses local git fixtures and mocked remotes. |
| Provider/config merge during setup | Proven in local tests | `scripts/test-providers.sh` passed `118 passed, 0 failed`; `fkt setup/configure` delegates provider/model writes to `ccs` in a sandbox. | Native PowerShell execution remains separate. |
| PowerShell installer source parity | Partly proven by POSIX tests and code inspection | `scripts/test-install.sh` checks Agent-Reach, UI/UX Pro Max, and BRAG slim PowerShell parity by inspecting `install.ps1`. | `pwsh` is not installed in this Linux environment, so `install.ps1` was not executed here. |
| PATH reliability for `ccs` and `fkt` | Proven for POSIX shell functions | `scripts/test-install.sh` covers clean login shell discovery, lazy default toolkit resolution, custom `CLAUDE_DIR`, duplicate prevention, and legacy function migration. | Native Windows PATH behavior needs live PowerShell verification. |
| Safe upgrade from current release | Proven for `fkt`; partly proven for installer sync | `scripts/test-fkt.sh` covers fast-forward-only update, dirty/diverged refusal, dry-run, migrations, and gstack fast-forward. `scripts/test-install.sh` covers installer sync refusal and channel behavior. | Full end-to-end install-smoke CI remains required. |
| Safe uninstall | Not implemented | No tracked uninstall command or test currently exists. | A18 remains incomplete until uninstall semantics are designed and tested. |
| Interactive/full non-interactive setup | In progress | `fkt setup/configure --dry-run` previews choices; `--yes` currently applies update/provider/model choices with backups. | Full interactive/non-interactive installer setup remains incomplete. |

## PowerShell verification boundary

This environment does not have `pwsh` on PATH, so native PowerShell execution is unverified here. Treat PowerShell parity as source-audited and partially covered by text/parity tests until a Windows or PowerShell-capable runner executes `install.ps1` and `bin/cc-provider.ps1`.

## Current product decision

Do not claim full installer parity yet. The repository has strong POSIX updater/install safety coverage and some PowerShell source parity checks, but final A18 completion still needs:

- live `install.ps1` execution or CI on PowerShell;
- explicit uninstall design and tests;
- end-to-end install smoke coverage for one-command install, idempotent reinstall, dry-run/preview, and safe upgrade;
- confirmation that `ccs` and `fkt` are discoverable from native PowerShell after install;
- verification that no credentials are destroyed or printed during migration/setup.
