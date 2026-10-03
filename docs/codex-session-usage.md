# Codex session and usage behavior

This page records what Claude Code session and usage surfaces currently show when the toolkit runs Claude Code through `ccs codex`.

The short version: Claude Code's own usage counters are not trustworthy billing or quota data for Codex. The toolkit now has a separate Codex account surface, backed by Codex App Server RPCs, and keeps that provenance visible.

## Verified behavior

Live probes used Claude Code `2.1.273`, Codex CLI `0.159.2`, `ccs codex`, model `gpt-5.5`, and effort `medium`. Current custom-endpoint probes did not forward the actionable user prompt to `/v1/messages`; the gateway now returns a non-retryable failure instead of sending system reminders to Codex. The usage boundary below still applies: Claude Code's local counters are diagnostic, not Codex quota or billing data.

| Surface | Current behavior | Product decision |
| --- | --- | --- |
| Session startup | Interactive Claude Code shows `GPT-5.5 · API Usage Billing`. | Treat as a Claude Code label for the configured gateway path, not proof of Anthropic API billing or Codex quota. |
| Stream JSON result | Current promptless failure runs return `modelUsage: {}` and zero token/cost counters. Older successful text probes also reported zero local counters. | Preserve as raw Claude Code telemetry only. Do not use it for user-facing Codex quota or billing claims. |
| Debug log | Current traces show `/v1/messages` requests containing SDK/system-reminder content but no actionable user prompt. | This proves the fail-closed boundary, not Codex entitlement consumption or text parity. |
| `ccs doctor` | Reports gateway status, selected Codex model, cached provider/Claude model-picker row counts, `Codex pricing estimate: false`, and the raw-discovery caveat for non-`claude` ids. | Keep this explicit. It is safer than pretending local pricing estimates know ChatGPT-plan entitlements. |
| `ccs account` | Reads `account/read` through the local Codex gateway. Shows signed-in/signed-out state, auth mode, redacted account email when supplied, plan type, selected model, reasoning effort, and refresh time. | This is account/auth status, not a quota meter. Email display is deliberately redacted. |
| `ccs usage` | Reads `account/rateLimits/read` and `account/usage/read` through the local Codex gateway. Shows `ordinaryUsageAllowed`, primary and secondary window used percentages/reset timestamps when supplied, reset-credit count when supplied, token-usage summary when supplied, and refresh time. | Missing fields stay unavailable. Do not infer access recovery from reset timestamps when `ordinaryUsageAllowed` says usage is not allowed. |
| `/usage` slash command | A PTY probe did not produce usable `/usage` panel output before the probe was terminated. | Leave `/usage` parity unclaimed until a reliable interactive proof exists. |

## Boundary

`ccs codex` should report provider health, selected Codex model, gateway catalog state, and the fact that local pricing estimates are disabled. `ccs account` and `ccs usage` may report fields returned by supported Codex App Server RPCs. They should not invent Anthropic usage, Codex quota remaining, OpenAI API spend, or ChatGPT Plus/Pro credit accounting.

If Codex App Server cannot return account or usage data, the toolkit should say: `Usage unavailable - open ChatGPT Settings -> Usage.`
