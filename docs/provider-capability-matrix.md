# Provider capability matrix

This page is the public boundary for provider support. It is intentionally conservative: a row only says "supported" when this repository has an implementation and a current proof path. A model catalog is not entitlement proof. A green text turn is not proof that every Claude Code feature works.

## Current providers

| Provider | Route | Auth owner | Text | Tools | Model picker | MCP ownership | Usage and quota | Status |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| Anthropic | Claude Code native API | Claude Code | Supported | Supported by Claude Code | Native | Claude Code owns Claude-side MCP | Claude Code native usage surfaces | Stable default |
| Codex | Local `ccs codex` bridge to Codex App Server | Codex CLI / ChatGPT plan | Live-proven for GPT-6.1 Sol on Claude Code 2.1.296 | Live-proven Claude-owned Bash, Penpot execute_code/new-turn routing, and tool-timeout recovery; Codex execution stays read-only | Supported through generated `modelPicker` rows from live `model/list` | Claude Code normally owns Claude-side MCP; Codex-native MCP is opt-in only | `ccs account` / `ccs usage` read supported Codex App Server account and rate-limit RPCs; Claude Code counters are still not quota data | Experimental bridge; narrow Wave 1 live proof |
| Google / Gemini | Direct Anthropic-compatible via `rtk hook claude` | Official Google AI Studio (`GEMINI_API_KEY`) or Vertex credentials | Configured | Provider dependent | Static provider mapping | Claude Code local MCP | Google AI Studio / Vertex billing | Supported template. Personal Antigravity OAuth fails closed; use native `agy` CLI instead |
| NVIDIA hosted | Local LiteLLM gateway | Local API key file | Supported where the selected model supports Claude Code's request shape | Provider dependent | Static provider mapping | Claude Code local MCP | Provider billing, not Claude billing | Experimental |
| NVIDIA NIM | Direct `/v1/messages` endpoint | Local NIM deployment | Supported when the NIM model exposes Messages API behavior | Provider dependent | Static provider mapping | Claude Code local MCP | Your NIM deployment | Advanced |
| Z.ai | Anthropic-compatible endpoint | Local API key file | Supported | Provider dependent | Static provider mapping | Claude Code local MCP | Provider billing | Supported template |
| DeepSeek | Anthropic-compatible endpoint | Local API key file | Configured | Provider dependent | Static provider mapping | Claude Code local MCP | Provider billing | Template, not live key-tested here |
| Kimi | Anthropic-compatible endpoint | Local API key file | Configured | Provider dependent | Static provider mapping | Claude Code local MCP | Provider billing | Template, not live key-tested here |
| MiniMax | Anthropic-compatible endpoint | Local API key file | Configured | Provider dependent | Static provider mapping | Claude Code local MCP | Provider billing | Template, not live key-tested here |
| OpenRouter | Anthropic-compatible endpoint | Local API key file | Configured | Provider/model dependent | Static provider mapping | Claude Code local MCP | Provider billing | Template, not live key-tested here |

## Codex boundary

The Codex bridge keeps Claude Code as the harness. That means:

- Claude Code still owns permission prompts, hooks, local MCP tools, slash commands, and session UI.
- Codex App Server supplies model inference through its documented App Server protocol.
- Codex App Server execution is forced read-only in bridge mode. Hidden Codex-side file writes are not a feature.
- The current request is authoritative. Actionable text starts a fresh turn even when Claude Code merges an old tool result into the same user message. Result-only continuations require a pending tool use in the same session. Reminder-only requests fail closed.
- Fresh Codex threads receive current user text and system context; completed conversation messages are not replayed. Context-dependent resume and long conversations remain unproven.
- [Wave 1 evidence](codex-wave1-evidence.md) records live text, Claude-owned Bash, timeout recovery, and upstream Auto checks on GPT-6.1 Sol with Medium reasoning.
- The gateway exposes `/v1/models`, and `ccs codex` refreshes Claude Code `modelPicker` rows from the live Codex `model/list` catalog.
- The gateway exposes toolkit-owned account and usage endpoints backed by `account/read`, `account/rateLimits/read`, and `account/usage/read`.
- `model/list` is a catalog. Successful inference is the access check.
- ChatGPT/Codex usage, ChatGPT image limits, and OpenAI API billing are different things. The toolkit does not blend them.

## Mode support under Codex

| Mode or feature | Codex bridge status | Notes |
| --- | --- | --- |
| Manual/default | Supported | Claude Code client behavior. |
| Plan | Supported | Live probes showed Plan mode enters and routes model turns through Codex. |
| Auto | Live-proven for GPT-6.1 Sol on Claude Code 2.1.296 | The supported `modelPicker` capability mapping uses Sonnet 4.6 for this model. Claude Code owns the classifier, hooks, permissions, and execution. Other Codex models remain unproven. |
| `acceptEdits` | Unproven in this wave | Claude Code owns file tools; the Codex App Server sandbox remains read-only. |
| `dontAsk` | Safe-denied for Codex-side execution | Codex App Server approval/tool callbacks fail closed in bridge mode. |
| `bypassPermissions` | Not a toolkit default | It may exist in Claude Code, but this toolkit does not encourage it. |
| Fast mode | Not Codex parity | Treated as Anthropic/Claude service behavior, not a Codex feature. |

## What counts as proof

For provider work, use the narrowest honest label:

- `configured`: the repository has a template or docs.
- `starts`: the command starts and reports a healthy status.
- `text-proven`: at least one live text turn completed through that provider.
- `tool-proven`: a live Claude Code tool call completed with the provider active.
- `parity-proven`: each named feature has its own evidence.

Avoid upgrading a row from one label to another because a neighboring feature passed.
