# `.claude` — Furkan Köykıran's Claude Code setup

[![CI](https://github.com/furkankoykiran/.claude/actions/workflows/ci.yml/badge.svg)](https://github.com/furkankoykiran/.claude/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)
![Platform](https://img.shields.io/badge/platform-Linux%20%7C%20macOS%20%7C%20Windows-lightgrey)

My personal [Claude Code](https://claude.com/claude-code) configuration —
`CLAUDE.md`, custom skills, agents, hooks, and utility scripts, plus a
self-contained bootstrap that wires in a handful of upstream tools (gstack, rtk,
manim, graphify, and several skill packs).

It's public so others can fork it, borrow pieces, and leave the rest. The
installer is **idempotent** (safe to re-run) and **fail-soft** (one broken
optional tool never sinks the whole setup).

## Quickstart

### Linux / macOS (and Windows via WSL or Git Bash)

```bash
curl -fsSL https://raw.githubusercontent.com/furkankoykiran/.claude/main/install.sh | bash
```

### Windows (native PowerShell, no WSL)

```powershell
irm https://raw.githubusercontent.com/furkankoykiran/.claude/main/install.ps1 | iex
```

> On native Windows you need **Git for Windows** (it bundles Git Bash, which runs
> gstack's setup) and **Node.js** (Chromium is driven by Node there). The
> installer checks for both and guides you if either is missing.

### Manual

```bash
git clone https://github.com/furkankoykiran/.claude ~/.claude
cd ~/.claude && ./install.sh          # or:  .\install.ps1  on Windows
```

If `~/.claude` already has files, the installer turns it into a git repo
tracking this remote (`git reset --hard origin/main`). Your local `cache/`,
`sessions/`, `.credentials.json`, `config.json`, etc. stay put — they're already
git-ignored.

## Platform support

| Component | Linux | macOS | Windows (native) | Windows (WSL) |
| --- | :---: | :---: | :---: | :---: |
| Core (`CLAUDE.md`, agents, hooks, skills) | ✅ | ✅ | ✅ | ✅ |
| gstack + headless browser | ✅ | ✅ | ✅ (Git Bash + Node) | ✅ |
| rtk token proxy | ✅ | ✅ | ⚠️ filters only¹ | ✅ |
| manim-narration | ✅ | ✅ | ✅ | ✅ |
| graphify | ✅ | ✅ | ✅ | ✅ |

¹ On native Windows, rtk's token *filters* work but its PreToolUse *hook*
auto-install is WSL-only ([rtk#671](https://github.com/rtk-ai/rtk/discussions/671)).

## Installer flags

Both installers honour the same knobs:

| Knob | Effect |
| --- | --- |
| `CLAUDE_DIR=/path` | Install target (default `~/.claude`) |
| `CLAUDE_BOOTSTRAP_MINIMAL=1` / `-Minimal` | Core only (configs + gstack + rtk); skip heavy skill packs |
| `CLAUDE_BOOTSTRAP_NO_SYNC=1` | Use the working tree as-is; skip the git fetch/reset (local testing, offline) |

## What the installer does

1. Syncs the repo at `~/.claude` (unless `CLAUDE_BOOTSTRAP_NO_SYNC=1`).
2. Seeds `config.json` and `settings.json` from the `.example` files — only if
   missing, never overwriting yours.
3. Installs [`bun`](https://bun.sh) (gstack's runtime).
4. Clones [gstack](https://github.com/garrytan/gstack) and runs its setup,
   linking its slash commands (`/qa`, `/review`, `/ship`, `/browse`, `/retro`, …).
   On Linux it first installs Chromium's system libraries so the headless
   browser actually launches (see [Troubleshooting](#troubleshooting)).
5. Installs [rtk](https://github.com/rtk-ai/rtk) and wires its PreToolUse hook.
6. Installs Python deps (`manim`, `edge-tts`) and `ffmpeg` for `manim-narration`.
7. Clones five upstream skill packs into `~/.claude/skills/` (each git-ignored,
   auto-discovered by Claude Code):
   [adithya-s-k/manim_skill](https://github.com/adithya-s-k/manim_skill),
   [multica-ai/andrej-karpathy-skills](https://github.com/multica-ai/andrej-karpathy-skills),
   [coreyhaines31/marketingskills](https://github.com/coreyhaines31/marketingskills),
   [pbakaus/impeccable](https://github.com/pbakaus/impeccable), and
   [Leonxlnx/taste-skill](https://github.com/Leonxlnx/taste-skill).
8. Installs [graphify](https://pypi.org/project/graphifyy/) and wires its skill.
9. Optionally configures portable MCP servers (`github`, `context7`).

Every step except cloning the repo is **fail-soft**: a failure is recorded and
printed in an end-of-run summary instead of aborting the bootstrap. Re-run
`./install.sh` after fixing the cause — it picks up where it left off.

## Personalization

After install, edit:

- `~/.claude/config.json` — your username, blog dir, default language. Read by
  `utils/lib/config.py` and the personal skills.
- `~/.claude/settings.json` — Claude Code permissions, hooks, env vars.

Both are git-ignored, so your edits never conflict with `git pull`.

## MCP servers

`scripts/setup-mcp.sh` configures the two portable ones:

- **github** (HTTP) — needs a personal access token
- **context7** (HTTP) — needs a Context7 API key

Tokens are stored in `~/.claude.json` (mode `600`), never in this repo. For
other MCP servers, use `claude mcp add` directly (or the `/add-mcp` skill).

## Updating

```bash
cd ~/.claude && git pull && ./install.sh      # macOS/Linux
```
```powershell
cd ~/.claude; git pull; .\install.ps1          # Windows
```

## Troubleshooting

<details>
<summary><strong>Linux: "gstack setup failed: Playwright Chromium could not be launched" / <code>libatk-1.0.so.0: cannot open shared object file</code></strong></summary>

The Chromium *binary* downloads fine, but on a clean server/container its
OS-level shared libraries (GTK/graphics: `libatk`, `libnss3`, `libcups`, …) are
missing, so it can't *launch*. The installer now fixes this automatically
(`ensure_browser_deps` + a Playwright `install-deps` retry). To repair an
existing install by hand, as root:

```bash
cd ~/.claude/skills/gstack && bunx playwright install-deps chromium && ./setup --no-prefix
```

On Ubuntu 24.04+ some packages were renamed (`libasound2` → `libasound2t64`,
etc.); Playwright's `install-deps` knows the current names, which is why it's
preferred over a hand-written `apt` list.
</details>

<details>
<summary><strong>Windows: "Git Bash (bash.exe) not found"</strong></summary>

gstack's setup is a bash script. Install [Git for Windows](https://git-scm.com/download/win)
(it bundles Git Bash) and re-run `install.ps1`.
</details>

<details>
<summary><strong>Windows: gstack browser/screenshots don't work</strong></summary>

On Windows, Chromium is driven by **Node.js** (Bun can't launch it there —
[oven-sh/bun#4253](https://github.com/oven-sh/bun/issues/4253)). Install
[Node.js LTS](https://nodejs.org/) (or `winget install OpenJS.NodeJS.LTS`) and
re-run.
</details>

<details>
<summary><strong>A tool didn't install / the run ended with a "skipped or failed" summary</strong></summary>

That's the fail-soft design working — the rest of the setup still completed.
Read the listed step name, fix its cause (often a missing system dependency),
and re-run the installer; it's idempotent.
</details>

## Uninstall

```bash
rm -rf ~/.claude ~/.claude.json ~/.gstack    # macOS/Linux; rtk binary: ~/.local/bin/rtk
```
```powershell
Remove-Item -Recurse -Force $HOME\.claude, $HOME\.claude.json, $HOME\.gstack   # Windows
```

## Layout

```
.
├── CLAUDE.md                 # global instructions (loaded at session start)
├── agents/                   # custom subagents (researcher, code-reviewer, …)
├── hooks/                    # PreToolUse / PostToolUse / pre-push hooks
├── skills/                   # personal + upstream slash commands
├── scripts/                  # helpers (setup-mcp.sh, …)
├── utils/                    # Python utilities (blog-scan, github-scan, …)
├── memory/                   # per-user memory templates
├── .github/                  # CI, issue/PR templates, Dependabot
├── config.json.example       # template for ~/.claude/config.json
├── settings.json.example     # template for ~/.claude/settings.json
├── install.sh                # bootstrap (Linux/macOS/WSL/Git Bash)
└── install.ps1               # bootstrap (native Windows PowerShell)
```

`CLAUDE.md` is kept tight (under Anthropic's ~200-line target); domain knowledge
lives in skills, loaded on demand.

## Contributing & security

- Contributions are welcome — see [CONTRIBUTING.md](CONTRIBUTING.md).
- Found a security issue? See [SECURITY.md](SECURITY.md) (report privately).
- Be kind — see the [Code of Conduct](CODE_OF_CONDUCT.md).
- Notable changes are tracked in [CHANGELOG.md](CHANGELOG.md).

## License

[MIT](LICENSE) — take what you want. Bundled upstream skill packs keep their own
licenses (cloned at install time, not redistributed here).