# Doctor and troubleshooting guide

Start with the command that owns the layer you are debugging. The toolkit has several doctors because one giant health check would either touch too much or hide the useful detail.

## Quick map

| Symptom | First command | Why |
| --- | --- | --- |
| Provider switch behaves oddly | `ccs doctor` | Checks active provider, safety merge, `jq`, stale `settings.json`, and gateway hints |
| Codex bridge stalls or model list looks wrong | `ccs status` then `ccs doctor` | Shows selected Codex model/effort and gateway diagnostics |
| Setup/update state looks wrong | `fkt doctor` | Read-only checkout and config summary |
| MCP tools duplicate or disappear | `fkt mcp doctor` | Compares registry preferences with live Claude/Codex MCP URLs when available |
| Installer issue | `scripts/test-install.sh` in a disposable home | Exercises install and update paths without touching your real home |
| Catalog or marketplace drift | `bun run catalog:check` | Verifies resolver output, digests, policy, and deterministic generation |

## Provider checks

Run:

```bash
ccs status
ccs doctor
```

Common fixes:

- If `settings.json` is stale, re-run `ccs <provider>`.
- If a provider key is a placeholder, run `ccs api <provider>` or edit the git-ignored provider file.
- If Codex auth is missing, run `ccs login codex`. The toolkit delegates to official `codex login` and does not copy tokens.
- If a loopback gateway is down, start it with the provider's documented start command, then re-run the provider switch.

For Codex, also check:

```bash
ccs models
ccs model gpt-5.5 medium
ccs codex-status
```

`ccs models` is catalog discovery, not access proof. Send a real prompt through `ccs codex` to prove entitlement for that model.

## MCP checks

Run:

```bash
fkt mcp status
fkt mcp doctor
claude mcp list
codex mcp list
```

The healthy `ccs codex` bridge shape is usually Claude Code owning Claude-side MCP servers and Codex native config having no duplicate copy of the same endpoint. If both hosts register the same URL, disable one side unless you have a specific reason to keep both.

Authenticate in the host that runs the server. For Claude Code, use `/mcp` or `claude mcp login <id>`. For Codex-native use, use `codex mcp login <id>` when the server supports OAuth. Do not copy tokens between hosts.

## Setup and updater checks

Run:

```bash
fkt status
fkt doctor
fkt check --force
```

`fkt update` is fast-forward only. If it refuses because the checkout is dirty or diverged, inspect the git state and decide what to keep. The updater will not stash, reset, clean, or force-push for you.

## Repository gates

For normal changes, start narrow and then widen:

```bash
bun install --frozen-lockfile
bun run typecheck
bun test catalog/tests
bun run catalog:check
bun run docs:check
bun run instructions:check
```

Provider, installer, marketplace, security, and context changes have their own focused tests. Run the one that matches the files you changed before running the full gate.

## What not to do

- Do not delete Codex session history to quiet unrelated warnings.
- Do not restore stale helper scripts such as `scripts/codex-mcp-headers-helper.js`.
- Do not copy OAuth tokens between Claude Code and Codex.
- Do not treat Claude Code usage counters as Anthropic billing, Codex quota, OpenAI API spend, or ChatGPT plan credits.
- Do not use `--admin`, force merges, direct ruleset bypasses, or skipped checks to land a change.
