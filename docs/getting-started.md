# Getting started

Installing, updating, verifying and removing the toolkit.

Every command is safe to re-run: the installer is idempotent and fail-soft, so a
partial failure leaves your existing setup intact rather than half-migrated.

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
   browser actually launches (see [Troubleshooting](troubleshooting.md)).
5. Installs [rtk](https://github.com/rtk-ai/rtk) and wires its PreToolUse hook.
6. Seeds `providers/*.json` from every committed template and adds the `ccs`
   shell function, so [switching API providers](configuration.md#api-provider-switching) works
   out of the box. Nothing is activated until you run `ccs <name>` yourself.
7. Installs Python deps (`manim`, `edge-tts`) and `ffmpeg` for `manim-narration`.
8. Clones five upstream skill packs into `~/.claude/skills/` (each git-ignored,
   auto-discovered by Claude Code):
   [adithya-s-k/manim_skill](https://github.com/adithya-s-k/manim_skill),
   [multica-ai/andrej-karpathy-skills](https://github.com/multica-ai/andrej-karpathy-skills),
   [coreyhaines31/marketingskills](https://github.com/coreyhaines31/marketingskills),
   [pbakaus/impeccable](https://github.com/pbakaus/impeccable), and
   [Leonxlnx/taste-skill](https://github.com/Leonxlnx/taste-skill).
9. File-copies a curated, always-on subset of Anthropic's official
   [anthropics/skills](https://github.com/anthropics/skills) — the
   office-document and authoring skills (`docx`, `pdf`, `pptx`, `xlsx`,
   `doc-coauthoring`) plus `mcp-builder`, `skill-creator`, and
   `web-artifacts-builder`. Overlapping skills and the name-colliding
   `claude-api` are skipped.
10. Installs (or upgrades) [graphify](https://pypi.org/project/graphifyy/) and
    wires its skill — re-running the bootstrap pulls the latest `graphifyy`, just
    like the git skill packs above.
11. Registers four [plugin marketplaces](configuration.md#plugin-marketplaces) and installs a
    curated set of workflow plugins (see below). Skipped if the `claude` CLI
    isn't on `PATH` yet.
12. Optionally configures portable MCP servers (`github`, `context7`).

Every step except cloning the repo is **fail-soft**: a failure is recorded and
printed in an end-of-run summary instead of aborting the bootstrap. Re-run
`./install.sh` after fixing the cause — it picks up where it left off.

## Updating

```bash
cd ~/.claude && git pull && ./install.sh      # macOS/Linux
```
```powershell
cd ~/.claude; git pull; .\install.ps1          # Windows
```

## Uninstall

```bash
rm -rf ~/.claude ~/.claude.json ~/.gstack    # macOS/Linux; rtk binary: ~/.local/bin/rtk
```
```powershell
Remove-Item -Recurse -Force $HOME\.claude, $HOME\.claude.json, $HOME\.gstack   # Windows
```

## Verifying a release

Every release publishes `SHA256SUMS` covering all content assets.

```bash
gh release download <tag> --dir /tmp/cct && cd /tmp/cct
sha256sum -c SHA256SUMS
```

Asset names are a compatibility contract and do not change when files move
inside the repository.
