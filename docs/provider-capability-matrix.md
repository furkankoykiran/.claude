# Provider capability matrix

This page is the public boundary for provider support. It is intentionally conservative: a row only says "supported" when this repository has an implementation and a current proof path. A model catalog is not entitlement proof. A green text turn is not proof that every Claude Code feature works.

## Current providers

| Provider | Route | Auth owner | Text | Tools | Model picker | MCP ownership | Usage and quota | Status |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| Anthropic | Claude Code native API | Claude Code | Supported | Supported by Claude Code | Native | Claude Code owns Claude-side MCP | Claude Code native usage surfaces | Stable default |
| Codex | Local `ccs codex` bridge to Codex App Server | Codex CLI / ChatGPT plan | Supported for live-tested text turns | Limited: Claude Code owns tools; Codex App Server execution is read-only | Supported through generated `modelPicker` rows from live `model/list` | Claude Code normally owns Claude-side MCP; Codex-native MCP is opt-in only | Do not treat Claude Code counters as Codex quota or Anthropic spend | Experimental bridge |
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
- The gateway exposes `/v1/models`, and `ccs codex` refreshes Claude Code `modelPicker` rows from the live Codex `model/list` catalog.
- `model/list` is a catalog. Successful inference is the access check.
- ChatGPT/Codex usage, ChatGPT image limits, and OpenAI API billing are different things. The toolkit does not blend them.

See the detailed pages for [models](codex-model-switching.md), [modes](codex-mode-parity.md), [skills](codex-skill-parity.md), [sessions and usage](codex-session-usage.md), [continuation](codex-continuation.md), and [image generation](codex-image-generation.md).

## Mode support under Codex

| Mode or feature | Codex bridge status | Notes |
| --- | --- | --- |
| Manual/default | Supported | Claude Code client behavior. |
| Plan | Supported | Live probes showed Plan mode enters and routes model turns through Codex. |
| Auto | Model dependent | Claude Code reports Auto unavailable for the verified GPT-5.5 setup. Do not expose it as proven parity until a model supports it live. |
| `acceptEdits` | Limited | The bridge is read-only on the Codex App Server side. True write acceptance requires Claude Code tool passthrough, not hidden Codex execution. |
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
