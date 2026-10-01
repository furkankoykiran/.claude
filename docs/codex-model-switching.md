# Codex model switching

This page records the model-switching behavior that is currently supported by the Codex bridge.

## Supported path

`ccs codex-model <model> <effort>` sets the default Codex model and reasoning effort in the provider config. That default is used when Claude Code sends a Claude model alias, including aliases from older sessions or commands such as `/model sonnet`.

Claude Code cannot use raw gateway discovery for plain Codex ids, so `ccs codex` generates `modelPicker` rows from the live Codex App Server catalog. When Claude Code sends one of those explicit Codex ids, the gateway honors the requested model for that turn instead of forcing the configured default.

In practical terms:

| Request model | Gateway route |
| --- | --- |
| `claude-sonnet-4-5` with `CODEX_GATEWAY_MODEL=gpt-5.5` | `gpt-5.5` |
| `gpt-5.6-luna` with `CODEX_GATEWAY_MODEL=gpt-5.5` | `gpt-5.6-luna` |

This makes generated `/model` rows useful for same-session text turns without requiring a provider restart. `ccs codex-model` remains the right command for changing the default model, startup model, and resumed Claude-alias sessions.

## Evidence

Live probes on 2026-10-01 used an active gateway with default `gpt-5.5` and effort `medium`.

- A `/v1/messages` request with `model: "gpt-5.6-luna"` returned `model: "gpt-5.6-luna"` and the expected text.
- A `/v1/messages` request with `model: "claude-sonnet-4-5"` returned `model: "gpt-5.5"` and the expected text.
- Unit coverage asserts both `turn/start` and `thread/start` use the same resolver.

## Limits

This is a gateway-routing guarantee, not full semantic proof for every Claude Code workflow. Claude Code normally carries multi-turn context in the message history it sends to `/v1/messages`, so text turns are safe at the bridge boundary. Tool execution remains intentionally read-only on the Codex App Server side, and subagent/model-change boundaries still need live Claude Code probes before broader parity claims.

If a model change ever appears to confuse a resumed session, use `ccs codex-model <model> <effort>`, restart with `ccs codex`, and resume from Claude Code so the default and picker state agree.
