# Free Claude Code Pattern Review

Last checked: 2026-10-01.

Source studied: `https://github.com/alksnd/free-claude-code` README as crawled from GitHub. No code was copied. The repository is presented with an MIT license, but this toolkit only adopted product patterns that fit its own security and provenance model.

## What Free Claude Code does

Free Claude Code is a local Anthropic-compatible proxy for Claude Code and related clients. Its README describes a broad provider router: multiple hosted and local backends, per-tier model routing for Opus/Sonnet/Haiku traffic, `/v1/models` support for Claude Code's model picker, streaming/tool/thinking translation, an admin UI, installer scripts, auto-compact environment tuning, VS Code and JetBrains setup notes, and optional Discord/Telegram bot wrappers.

That is a different product shape from this toolkit. Free Claude Code is a replacement routing proxy. This toolkit keeps Claude Code as the upstream harness and adds safe provider bridges, setup UX, skills, MCP registry management, and honest capability boundaries.

## Adopted patterns

| Pattern | How this toolkit uses it |
| --- | --- |
| Provider/model catalog surfaced through Claude Code | `ccs codex` refreshes supported `modelPicker` rows from live Codex App Server `model/list`; `ccs models` and `ccs doctor` expose the catalog and caveats. |
| Gateway model discovery | The gateway exposes `/v1/models`, but docs explain Claude Code's raw gateway filter for ids without `claude` or `anthropic`. Generated `modelPicker` rows are the supported Codex path. |
| Clear provider capability metadata | Existing Codex docs now separate text inference, modes, usage telemetry, model switching, MCP ownership, continuation, and image generation. |
| Health/doctor commands | `ccs doctor`, `fkt doctor`, and `fkt mcp doctor` report current state without pretending unsupported features work. |
| Setup and reconfiguration UX | `fkt presets`, `fkt setup --dry-run`, and `fkt configure --dry-run` use the same product idea of guided configuration, but write mode remains incremental and backed by tests. |
| Auto-compaction as a tunable preference | `fkt setup/configure --yes --compaction auto|off` writes documented auto-compaction settings and keeps manual `/compact` available; token-window tuning remains pending until it has an explicit value. |
| Provider-specific caveats | Docs call out ChatGPT/Codex entitlement limits, the unproven ImageGen bridge boundary, and usage telemetry boundaries. |

## Rejected patterns

| Pattern | Why it is rejected here |
| --- | --- |
| Replacing Claude Code with a broad all-provider proxy | The product goal is Claude-Code-first with Claude Code as the original harness, not a fork or wholesale replacement. |
| Copying provider adapters or routing code | Provenance and security rules require reviewable local implementation. We studied product behavior only. |
| Treating free-tier access as stable | Free tiers change and rate-limit. This toolkit avoids "free" claims and requires live inference to prove entitlement. |
| Same-session hot switching by default | It is not shipped unless conversation semantics, tool results, subagents, and resume boundaries are proven safe. Current docs keep the supported switch boundary narrower. |
| Automatic failover chains | Silent fallback can mask provider failures and alter model behavior. The current policy is explicit provider/model choice and honest failures. |
| Remote Discord/Telegram bot control | That expands the attack surface and does not serve the core Claude Code desktop/terminal setup. |
| Key pooling or token copying | Credentials stay in native provider storage. OAuth tokens are not copied between Claude Code, Codex, or OpenAI API paths. |
| Claiming Claude Code gateway media generation | Native Codex ImageGen is the preferred path when the host exposes it. The rejected pattern is pretending the Claude Code `ccs codex` gateway can call it before a live App Server `imageGeneration` item proves that route. |

## Product decisions carried forward

- Keep the setup surface calm and explicit: preview first, write only with `--yes`, and back up existing config before replacing anything.
- Keep provider catalog data separate from entitlement proof. A catalog can populate choices; only a successful inference proves access.
- Keep capability matrices honest. If a mode, skill, MCP server, usage display, or media tool is not proven, mark it pending, limited, or experimental.
- Prefer small native commands over an always-on admin server. A local UI can be reconsidered later, but the CLI must remain complete and scriptable.
- Avoid copying secrets, provider code, or broad failover behavior. The point is safer interoperability, not the biggest possible router.
