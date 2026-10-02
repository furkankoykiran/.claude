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

This keeps generated `/model` rows aligned with the Codex catalog and lets the gateway resolve Claude aliases consistently. `ccs codex-model` remains the right command for changing the default model, startup model, and resumed Claude-alias sessions. A live Claude Code text turn is still required before treating a selected row as inference proof.

## Evidence

Gateway-level probes used an active gateway with default `gpt-5.5` and effort `medium`.

- A `/v1/messages` request with `model: "gpt-5.6-luna"` returned `model: "gpt-5.6-luna"` and the expected text.
- A `/v1/messages` request with `model: "claude-sonnet-4-5"` returned `model: "gpt-5.5"` and the expected text.
- A multi-message `/v1/messages` request preserved prior assistant context and returned the remembered token `basalt-17`.
- A synthetic `tool_result` content block was flattened into the Codex turn and returned the expected value `amber-42`.
- A persisted Claude Code print session created with `--session-id` resumed with `--resume` and returned the remembered token `cedar-314`.
- The same resumed session accepted `--model gpt-5.6-luna`, preserved the token `cedar-314`, and reported `modelUsage.gpt-5.6-luna`.
- Unit coverage asserts both `turn/start` and `thread/start` use the same resolver.

## Limits

This is a gateway-routing guarantee, not full semantic proof for every Claude Code workflow. Direct `/v1/messages` fixtures and gateway-level probes prove the resolver behavior. Current Claude Code custom-endpoint probes did not forward the actionable user prompt, so same-session Claude Code text and resume behavior remain pending until a supported prompt-forwarding path is proven.

Subagent dispatch is not proven. A live `--agents` probe exposed the `echoer` agent and Task tool to Claude Code, but the Codex-backed turn returned plain text and `subagent_stats.spawned` stayed `0`. Treat subagents as unsupported under `ccs codex` until the bridge can return Claude-compatible tool-use blocks or another supported mechanism is proven. Tool execution also remains intentionally read-only on the Codex App Server side.

If a model change ever appears to confuse a resumed session, use `ccs codex-model <model> <effort>`, restart with `ccs codex`, and resume from Claude Code so the default and picker state agree.
