# `.claude` — Furkan Köykıran's Claude Code Setup

This is my personal Claude Code configuration: `CLAUDE.md`, custom skills,
agents, hooks, and utility scripts. Sharing it so others can pick what's
useful and leave the rest.

## Quickstart

One-liner (clones into `~/.claude` and runs the bootstrap):

```bash
curl -fsSL https://raw.githubusercontent.com/furkankoykiran/.claude/main/install.sh | bash
```

Or do it manually:

```bash
git clone https://github.com/furkankoykiran/.claude ~/.claude
cd ~/.claude && ./install.sh
```

If `~/.claude` already exists with files in it, the installer turns it into a
git repo tracking this remote (with `git reset --hard origin/main`) — your
local `cache/`, `sessions/`, `.credentials.json`, etc. stay put because
they're already in `.gitignore`.

## What `install.sh` does

1. Syncs the repo at `~/.claude` (`git fetch && git reset --hard origin/main`)
2. Seeds `config.json` and `settings.json` from the `.example` files (only if
   missing — never overwrites yours)
3. Installs [`bun`](https://bun.sh) if missing (gstack needs it)
4. Clones [gstack](https://github.com/garrytan/gstack) into
   `~/.claude/skills/gstack` and runs its setup, which links its slash commands
   (`/qa`, `/review`, `/ship`, `/browse`, `/retro`, etc.) into `~/.claude/skills/`
5. Installs [rtk](https://github.com/rtk-ai/rtk) if missing and runs `rtk init -g`
   to wire its PreToolUse hook into `~/.claude/settings.json`
6. Installs Python deps (`manim`, `edge-tts`) via `pip install --user`, and
   `ffmpeg`/`ffprobe` via `apt-get` or `brew` if missing
7. Clones MIT-licensed [`adithya-s-k/manim_skill`](https://github.com/adithya-s-k/manim_skill)
   and copies its three skills (`manimce-best-practices`, `manimgl-best-practices`,
   `manim-composer`) into `~/.claude/skills/`, alongside the locally-authored
   `manim-narration` skill that adds edge-tts narration plus a `/browse`-driven
   screenshot pipeline
8. Optionally prompts to configure two portable MCP servers (`github`, `context7`)
   via `scripts/setup-mcp.sh`

Re-running is safe — every step checks "already done?" first.

## Personalization

After install, edit:

- `~/.claude/config.json` — your username, blog dir, default language. Read by
  `utils/lib/config.py` and the personal skills.
- `~/.claude/settings.json` — Claude Code permissions, hooks, env vars.

Both are gitignored, so your edits won't conflict with `git pull`.

## MCP servers

`scripts/setup-mcp.sh` configures the two portable ones:

- **github** (HTTP) — needs a personal access token
- **context7** (HTTP) — needs a Context7 API key

Tokens are stored in `~/.claude.json` (mode 600), never in this repo.

For other MCP servers (your own DEV.to, image search, whatever), use
`claude mcp add` directly. They live in your local `~/.claude.json` and stay
out of the public repo.

## Updating

```bash
cd ~/.claude && git pull && ./install.sh
```

## Uninstall

```bash
rm -rf ~/.claude ~/.claude.json ~/.gstack
# rtk binary lives at ~/.local/bin/rtk if you want to remove it too
```

## Layout

```
.
├── CLAUDE.md                # global instructions (loaded at session start, ~95 lines)
├── agents/                  # custom subagents (researcher, code-reviewer, ...)
├── hooks/                   # PreToolUse / PostToolUse / pre-push hooks
├── skills/                  # personal + upstream slash commands (gstack, manim, graphify, ...)
├── scripts/                 # helpers (setup-mcp.sh, ...)
├── utils/                   # Python utilities (blog-scan, github-scan, ...)
├── memory/                  # per-user memory templates
├── config.json.example      # template for ~/.claude/config.json
├── settings.json.example    # template for ~/.claude/settings.json
└── install.sh               # the bootstrap entrypoint
```

CLAUDE.md is intentionally kept tight (under Anthropic's 200-line target). Domain-specific knowledge lives in skills (loaded on demand), not in CLAUDE.md.

## License

MIT — take what you want. PRs welcome if you spot a personal reference I missed.
