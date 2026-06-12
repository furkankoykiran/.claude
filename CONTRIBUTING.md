# Contributing

Thanks for taking the time to contribute. This repo is a personal Claude Code
setup that others are welcome to fork, borrow from, and improve. Issues and pull
requests are welcome.

## Ways to contribute

- **Report a bug** — open an issue with the [bug template](.github/ISSUE_TEMPLATE/bug_report.yml).
  Include your OS, shell, and the failing step from `install.sh` / `install.ps1`.
- **Suggest a feature** — open an issue with the
  [feature template](.github/ISSUE_TEMPLATE/feature_request.yml).
- **Send a fix** — fork, branch, and open a PR against `main`.

## Development setup

```bash
git clone https://github.com/furkankoykiran/.claude
cd .claude
# Try the bootstrap in an isolated dir so it doesn't touch your real ~/.claude:
CLAUDE_DIR="$(mktemp -d)" CLAUDE_BOOTSTRAP_MINIMAL=1 ./install.sh
```

`CLAUDE_BOOTSTRAP_MINIMAL=1` installs only the core (configs + gstack + rtk) and
skips the heavy upstream skill packs, which keeps iteration fast.

## Before you open a PR

Run the same checks CI runs. All you need is Docker.

```bash
# 1. Lint shell scripts
docker run --rm -v "$PWD:/mnt" -w /mnt koalaman/shellcheck:stable install.sh hooks/*.sh scripts/*.sh

# 2. Lint the PowerShell installer
docker run --rm -v "$PWD:/mnt" -w /mnt mcr.microsoft.com/powershell:latest \
  pwsh -NoProfile -Command 'Install-Module PSScriptAnalyzer -Force -Scope CurrentUser; \
  Invoke-ScriptAnalyzer -Path ./install.ps1 -Settings ./PSScriptAnalyzerSettings.psd1'

# 3. Smoke-test the installer end-to-end on a clean Ubuntu (proves the bootstrap works)
docker run --rm -v "$PWD:/repo:ro" ubuntu:24.04 bash -c '
  apt-get update && apt-get install -y git curl unzip ca-certificates &&
  cp -r /repo /root/.claude && cd /root/.claude &&
  CLAUDE_DIR=/root/.claude CLAUDE_BOOTSTRAP_MINIMAL=1 ./install.sh'
```

## Style and conventions

- **Commits**: `<type>(<scope>): <description>` (Conventional Commits). Types:
  `feat`, `fix`, `refactor`, `docs`, `test`, `chore`. Explain *why* in the body,
  not just what. One logical change per commit.
- **Shell**: keep `install.sh` POSIX-friendly bash, `shellcheck`-clean, and
  idempotent (safe to re-run). Optional steps must be fail-soft — never let one
  failed tool abort the whole bootstrap.
- **PowerShell**: keep `install.ps1` clean under
  [`PSScriptAnalyzerSettings.psd1`](PSScriptAnalyzerSettings.psd1), ASCII-only
  (no smart quotes / em dashes — they corrupt under Windows PowerShell 5.1), and
  compatible with PowerShell 5.1+.
- **Keep changes surgical.** Match the existing style; don't refactor unrelated code.

## License

By contributing, you agree that your contributions are licensed under the
[MIT License](LICENSE) that covers this project.