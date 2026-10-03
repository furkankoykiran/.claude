# Codex prompt forwarding

This page records the current prompt-forwarding boundary for `ccs codex`.

## Current result

With Claude Code `2.1.273`, Codex CLI `0.159.2`, `CODEX_GATEWAY_MODEL=gpt-5.5`,
and `CODEX_GATEWAY_REASONING_EFFORT=medium`, Claude Code forwards the real user
prompt to `/v1/messages` as a later text block in the same `user` message that
starts with Claude Code system-reminder text blocks.

The gateway now filters promptless system-reminder blocks at block granularity:
system reminders never start a Codex inference turn, but a later actionable user
text block in the same message is forwarded to Codex. Requests that contain only
system reminders still fail closed with the structured non-retryable error:

```text
Claude Code did not forward an actionable user prompt to the Codex gateway; refusing to run Codex on system reminders only.
```

## Probes tested

The failing request shape was reproduced with one canary:

```bash
claude -p "Say exactly FORWARDING_CANARY_7F3A" \
  --model gpt-5.5 \
  --verbose \
  --output-format=stream-json \
  --permission-mode manual
```

The redacted gateway capture for that single turn showed one request:

| Field | Observed value |
| --- | --- |
| sequence | `1` |
| model | `gpt-5.5` |
| stream | `true` |
| system presence | `true` |
| message roles | `["user"]` |
| content-block types | eleven `text` blocks |
| exact canary appears | `true` |
| request class | `main` (`x-claude-code-request-class`) |
| response status | `200` from the capture harness |

Blocks `0` through `9` started with `<system-reminder>`. Block `10` was the
real user prompt:

```text
Say exactly FORWARDING_CANARY_7F3A
```

`CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC=1`,
`CLAUDE_CODE_ENABLE_PROMPT_SUGGESTION=false`, and
`CLAUDE_CODE_DISABLE_EXPERIMENTAL_BETAS=1` were tested one at a time against the
same capture harness. None changed this request shape.

After the extractor fix, the same canary completed through the real local
gateway with `model: "codex-app-server"` and result
`FORWARDING_CANARY_7F3A`.

## Product boundary

`ccs codex` now supports no-tool text turns when Claude Code forwards the
actionable user prompt in a later text block of the main request. The supported
pieces are:

- gateway lifecycle and health reporting;
- Codex model catalog discovery and generated picker rows;
- `ccs account` / `ccs usage` through supported Codex App Server RPCs;
- read-only Codex App Server sandboxing in bridge mode;
- fail-closed handling for promptless requests, failed tool calls, duplicate
  retries, and terminal turn errors.

Claude-owned tool turns, subagent forwarding, resume, and long-running workflow
parity still require separate live evidence before this page should claim them.
