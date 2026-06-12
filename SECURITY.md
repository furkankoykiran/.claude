# Security Policy

## Supported versions

This is a rolling personal configuration repo. Only the latest `main` is
supported — please make sure you are running the most recent `install.sh` /
`install.ps1` before reporting an issue.

## Reporting a vulnerability

Please **do not open a public issue** for security problems.

- Preferred: open a [private security advisory](https://github.com/furkankoykiran/.claude/security/advisories/new)
  on GitHub ("Report a vulnerability").
- Alternatively, email **divimero.com@gmail.com** with the details and steps to
  reproduce.

You can expect an initial response within a few days. Once a fix is ready it
will land on `main` and be credited in [CHANGELOG.md](CHANGELOG.md) (unless you
prefer to stay anonymous).

## Secrets never live in this repo

This repository is public. Secrets are kept out of it by design:

- `config.json` and `settings.json` are git-ignored; only the `.example`
  templates are tracked.
- Credentials and tokens live in `~/.claude/.credentials.json` and
  `~/.claude.json` (mode `600`), both git-ignored.
- A `secret-scan-on-commit` hook ([hooks/secret-scan-on-commit.sh](hooks/secret-scan-on-commit.sh))
  runs before commits to catch accidental secret leakage.

If you ever find a secret committed to history, report it privately as above so
it can be rotated and purged.

## Installer trust

`install.sh` and `install.ps1` download and run third-party tooling (bun, rtk,
gstack, Playwright/Chromium, pip packages). Review the script before piping it
to a shell, especially the `curl ... | bash` / `irm ... | iex` one-liners. The
URLs are pinned to upstream vendor domains and the GitHub `raw` host.