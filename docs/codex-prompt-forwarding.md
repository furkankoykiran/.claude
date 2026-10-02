# Codex prompt forwarding

This page records the current prompt-forwarding boundary for `ccs codex`.

## Current result

With Claude Code `2.1.273`, Codex CLI `0.159.2`, `CODEX_GATEWAY_MODEL=gpt-5.5`,
and `CODEX_GATEWAY_REASONING_EFFORT=medium`, the local Codex gateway receives
Claude Code requests at `/v1/messages`, but current custom-endpoint probes do
not include the actionable user prompt. The only user message reaching the
gateway is SDK/system-reminder context.

The gateway now treats that as a bridge failure. It returns a structured,
non-retryable error instead of sending system reminders to Codex. This prevents
the old failure mode where Codex could produce text that looked like a successful
tool result even though Claude Code had rejected the tool call.

## Probes tested

These supported Claude Code CLI shapes were tested against the local gateway:

```bash
claude -p "Say exactly codex-option-order-ok" --verbose --output-format=stream-json --permission-mode manual --allowedTools=Bash
claude --print --verbose --output-format=stream-json --permission-mode manual --allowedTools=Bash "Say exactly codex-option-order-ok"
printf '%s\n' '{"type":"user","message":{"role":"user","content":[{"type":"text","text":"Say exactly codex-stream-json-ok"}]}}' \
  | claude -p --output-format=stream-json --input-format=stream-json --verbose --permission-mode manual --allowedTools=Bash
claude -p "Say exactly codex-bare-prompt-ok" --bare --verbose --output-format=stream-json --permission-mode manual --allowedTools=Bash
claude --print --verbose --output-format=stream-json --permission-mode manual --allowedTools=Bash --system-prompt-snapshot off "Say exactly codex-no-snapshot-ok"
```

In each case, gateway trace showed request keys such as `messages`, `system`,
`metadata`, `tools`, and `thinking`, but no actionable prompt in `messages`,
`system`, or metadata. The response was:

```text
API Error: 400 Claude Code did not forward an actionable user prompt to the Codex gateway; refusing to run Codex on system reminders only.
```

## Product boundary

Until a supported Claude Code path forwards the actual user turn to the custom
provider, `ccs codex` must not claim live text, MCP, tool, skill, subagent, or
resume parity. The supported pieces remain:

- gateway lifecycle and health reporting;
- Codex model catalog discovery and generated picker rows;
- `ccs account` / `ccs usage` through supported Codex App Server RPCs;
- read-only Codex App Server sandboxing in bridge mode;
- fail-closed handling for promptless requests, failed tool calls, duplicate
  retries, and terminal turn errors.

The next proof is simple: a live Claude Code request must show the user prompt in
the gateway input, complete a no-tool text turn, then complete a Claude-owned
tool turn with one real `tool_use` and one matching `tool_result`.
