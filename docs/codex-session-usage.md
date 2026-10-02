# Codex session and usage behavior

This page records what Claude Code session and usage surfaces currently show when the toolkit runs Claude Code through `ccs codex`.

The short version: the session works, but Claude Code usage numbers are not trustworthy billing or quota data for Codex. The toolkit must not present them as Anthropic usage, ChatGPT entitlement usage, or OpenAI API usage.

## Verified behavior

Live probes on 2026-10-01 used Claude Code `2.1.273`, Codex CLI `0.159.2`, `ccs codex`, model `gpt-5.5`, and effort `medium`. A later smoke pass after `4cdf212` repeated Manual and Plan stream-json turns successfully and kept the same usage boundary: Claude Code returned working text, connected Claude-owned MCP servers, and zero local token/cost counters.

| Surface | Current behavior | Product decision |
| --- | --- | --- |
| Session startup | Interactive Claude Code shows `GPT-5.5 · API Usage Billing`. | Treat as a Claude Code label for the configured gateway path, not proof of Anthropic API billing or Codex quota. |
| Stream JSON result | `modelUsage.gpt-5.5` is present, but `inputTokens`, `outputTokens`, and `costUSD` are all `0`; `canonicalModel` is `claude-sonnet-4-5`; `costBasis` is `list`. Latest Manual and Plan smoke tests returned `manual codex ok` and `plan codex ok` with the same zero counters. | Preserve as raw Claude Code telemetry only. Do not use it for user-facing Codex quota or billing claims. |
| Debug log | The turn dispatched to `/v1/messages` with `model=gpt-5.5` and ended with `usage in=0 out=0 cost=$0.0000`. | This proves routing and the absence of fabricated nonzero Anthropic usage; it does not measure Codex entitlement consumption. |
| `ccs doctor` | Reports gateway status, selected Codex model, cached provider/Claude model-picker row counts, `Codex pricing estimate: false`, and the raw-discovery caveat for non-`claude` ids. | Keep this explicit. It is safer than pretending local pricing estimates know ChatGPT-plan entitlements. |
| `/usage` slash command | A PTY probe did not produce usable `/usage` panel output before the probe was terminated. | Leave `/usage` parity unclaimed until a reliable interactive proof exists. |

## Boundary

`ccs codex` should report provider health, selected Codex model, gateway catalog state, and the fact that local pricing estimates are disabled. It should not invent Anthropic usage, Codex quota remaining, OpenAI API spend, or ChatGPT Plus/Pro credit accounting.

If future Codex App Server protocol versions expose supported quota or usage fields, the toolkit can surface them with a separate label and provenance. Until then, usage displays under `ccs codex` are best read as Claude Code session diagnostics, not account metering.
