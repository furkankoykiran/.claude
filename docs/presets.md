# Setup presets and runtime profiles

`fkt setup` and `fkt configure` are the toolkit's calm path for changing a live install. They preview first, write only with `--yes`, and back up local runtime files before changing them.

## Install presets

| Preset | Intent | Current behavior |
| --- | --- | --- |
| Minimal | Core safety files, updater, provider switcher, and the smallest useful toolkit surface | Preview vocabulary today; installer support exists through `CLAUDE_BOOTSTRAP_MINIMAL=1` |
| Recommended | Default personal developer setup | Preview vocabulary; write mode applies only explicit flags, not the preset as a bundle |
| Full | Include heavier skill packs and optional integrations | Preview vocabulary; final installer composition still follows existing installer flags |
| Custom | Choose each category yourself | Preview vocabulary with explicit flags |

Presets are not permission to replace a user's config. `fkt setup --yes` applies only the flags you pass and backs up files it changes.

## Runtime profiles

| Profile | Intent | Current write support |
| --- | --- | --- |
| Safe | More prompts, conservative provider behavior | Use `--permission-mode manual` or `--permission-mode plan` explicitly |
| Balanced | Default day-to-day setup | Use explicit provider/model/update flags |
| Autonomous | Fewer prompts where Claude Code supports that safely | Use explicit `--permission-mode` values; bypass mode is not a toolkit default |
| Long Session / Endurance | Reduce surprise compactions and preserve restart state | Use `--compaction off` to disable automatic compaction while keeping `/compact` available |
| Custom | Set each option directly | Fully explicit flags |

## Supported write flags

These flags are implemented and tested:

```bash
fkt setup --yes --updates enabled|disabled
fkt setup --yes --provider codex
fkt configure --yes --model gpt-5.5 --effort medium
fkt configure --yes --permission-mode manual|plan|acceptEdits|dontAsk|auto
fkt configure --yes --compaction auto|off
```

`--permission-mode manual` is stored as Claude Code's `default` mode. `--compaction off` writes `autoCompactEnabled=false`; it does not disable the manual `/compact` command.

These choices remain preview-only in the combined setup flow:

- skill pack installation/removal;
- auth orchestration beyond delegating to native host commands;
- MCP installation from setup, although `fkt mcp enable|disable|auth|doctor` already manage MCP preferences and diagnostics;
- token-window compaction through `--compaction tokens`, until the command accepts an explicit token window value.

## Dry run examples

```bash
fkt setup --dry-run --preset recommended --profile balanced --provider codex
fkt configure --dry-run --permission-mode plan --compaction off
```

Dry runs write nothing and do not touch credentials.

## Backups

Write mode stores backups under the `fkt` state directory, usually `~/.local/state/fk-toolkit/backups` on Linux. It backs up the files it may change, such as `settings.json`, `providers/.active`, provider files, or the `fkt` config file.
