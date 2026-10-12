# Provider capability matrix

This page is the public boundary for provider support. It is intentionally conservative: a row only says "supported" when this repository has an implementation and a current proof path. A model catalog is not entitlement proof. A green text turn is not proof that every Claude Code feature works.

## Current providers

| Provider | Route | Auth owner | Text | Tools | Model picker | MCP ownership | Usage and quota | Status |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| Anthropic | Claude Code native API | Claude Code | Supported | Supported by Claude Code | Native | Claude Code owns Claude-side MCP | Claude Code native usage surfaces | Stable default |
| Codex | Local `ccs codex` bridge to Codex App Server | Codex CLI / ChatGPT plan | Live-proven for GPT-6.1 Sol on Claude Code 2.1.296 | Live-proven Claude-owned Bash, Penpot execute_code/new-turn routing, and tool-timeout recovery; Codex execution stays read-only | Supported through generated `modelPicker` rows from live `model/list` | Claude Code owns MCP execution; Codex-native MCP parity is unproven | `ccs account` / `ccs usage` read supported Codex App Server account and rate-limit RPCs; Claude Code counters are still not quota data | Experimental bridge; narrow Wave 1 live proof |
| AGY | Local `ccs agy` -> Google gateway -> official native CLI | AGY owns Google login/session; no API key | Live-proven two distinct sequential Claude turns | Live-proven Claude-owned read-only MCP result and fresh next turn; native tools denied | Live native `agy models` / `ccs models` catalog | Claude Code owns execution | AGY native quota/billing | Experimental; no broad parity claim |
| Gemini API / Vertex | Local `ccs gemini` -> Google gateway API adapters | Own API key or explicit Cloud project/access token | Activation credential-gated; live credentials unavailable | Contract-tested; live inference unproven | Live Developer API discovery; configured-only Vertex | Claude Code owns execution | API / Vertex billing | Experimental; no AGY fallback, ADC-file-only unsupported |
| NVIDIA hosted | Local LiteLLM gateway | Local API key file | Supported where the selected model supports Claude Code's request shape | Provider dependent | Static provider mapping | Claude Code local MCP | Provider billing, not Claude billing | Experimental |
| NVIDIA NIM | Direct `/v1/messages` endpoint | Local NIM deployment | Supported when the NIM model exposes Messages API behavior | Provider dependent | Static provider mapping | Claude Code local MCP | Your NIM deployment | Advanced |
| Z.ai | Anthropic-compatible endpoint | Local API key file | Supported | Provider dependent | Static provider mapping | Claude Code local MCP | Provider billing | Supported template |
| DeepSeek | Anthropic-compatible endpoint | Local API key file | Configured | Provider dependent | Static provider mapping | Claude Code local MCP | Provider billing | Template, not live key-tested here |
| Kimi | Anthropic-compatible endpoint | Local API key file | Configured | Provider dependent | Static provider mapping | Claude Code local MCP | Provider billing | Template, not live key-tested here |
| MiniMax | Anthropic-compatible endpoint | Local API key file | Configured | Provider dependent | Static provider mapping | Claude Code local MCP | Provider billing | Template, not live key-tested here |
| OpenRouter | Anthropic-compatible endpoint | Local API key file | Configured | Provider/model dependent | Static provider mapping | Claude Code local MCP | Provider billing | Template, not live key-tested here |
| OrcaRouter | Anthropic-compatible router (`api.orcarouter.ai`) | Local API key file | Supported | Provider dependent (eager loading; Tool Search deferred) | Static provider mapping with dynamic discovery (1M context for GLM-5.3) | Claude Code local MCP | Provider billing; bounded retries (2) | Supported router; dynamic context & bounded retries |
| OneRouter | Anthropic-compatible router (`llm.onerouter.pro`) | Local API key file | Supported | Provider dependent (eager loading; Tool Search deferred) | Static provider mapping with dynamic discovery (256k context for Qwen 3.8) | Claude Code local MCP | Provider billing; bounded retries (2) | Supported router; dynamic context & bounded retries |

## Codex boundary

The Codex bridge keeps Claude Code as the harness. That means:

- Claude Code still owns permission prompts, hooks, local MCP tools, slash commands, and session UI.
- Codex App Server supplies model inference through its documented App Server protocol.
- Codex App Server execution is forced read-only in bridge mode. Hidden Codex-side file writes are not a feature.
- The current request is authoritative. Actionable text starts a fresh turn even when Claude Code merges an old tool result into the same user message. Result-only continuations require a pending tool use in the same session. Reminder-only requests fail closed.
- Provider protocol details belong to the [Codex gateway contract](../gateways/claude-codex-gateway/docs/contract.md). Context-dependent resume and long conversations remain unproven.
- Historical GPT-6.1 Sol text/tool/Auto evidence lives in the [gateway repository](../gateways/claude-codex-gateway/docs/codex-wave1-evidence.md). Fresh family checks are recorded in [integration evidence](gateway-family/EVIDENCE.md).
- The gateway exposes `/v1/models`, and `ccs codex` refreshes Claude Code `modelPicker` rows from the live Codex `model/list` catalog.
- The gateway exposes toolkit-owned account and usage endpoints backed by `account/read`, `account/rateLimits/read`, and `account/usage/read`.
- `model/list` is a catalog. Successful inference is the access check.
- ChatGPT/Codex usage, ChatGPT image limits, and OpenAI API billing are different things. The toolkit does not blend them.

## Mode support under Codex

| Mode or feature | Codex bridge status | Notes |
| --- | --- | --- |
| Manual/default | Supported | Claude Code client behavior. |
| Plan | Prior model-specific live probe | Do not infer support for other models or current Claude versions from the older probe. |
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

## Google adapter boundaries

AGY and Gemini are distinct providers. Legacy `google` and `antigravity` commands produce migration errors without switching. Health is process/configuration evidence; activation additionally requires a real nonce response. A failed preflight leaves `.active` and settings unchanged. Native AGY tools are denied by a transport guard, while proposed external tools and their actual results remain Claude-owned. See [AGY correction evidence](agy-adapter/EVIDENCE.md) and the [gateway contract](../gateways/claude-gemini-gateway/docs/contract.md).

## API Routers and Dynamic Runtime Resolution

OrcaRouter and OneRouter provide multi-model Anthropic-compatible routing. The provider runtime resolves capabilities according to strict precedence:

1. **Explicit user override**: User-configured `CLAUDE_CODE_MAX_CONTEXT_TOKENS` and `CLAUDE_CODE_MAX_RETRIES` in `providers/<provider>.json` take unconditional precedence.
2. **Authoritative live provider metadata**: When `ANTHROPIC_BASE_URL` exposes `/v1/models`, dynamic context discovery probes the endpoint during activation and derives `context_length` (e.g. 1M for GLM-5.3-Flash, 256k for Qwen 3.8 27B).
3. **Registry capability metadata**: Pinned in `providers/registry.json` as authoritative static capability definitions for known models and default fallbacks.
4. **Conservative Claude Code fallback**: Unknown models without discovery fall back safely to 200k. Model context size is never guessed from model names.

### Failure behavior and retry bounding

Third-party routers can return 429 errors for permanent account conditions (e.g. GitHub qualification or team balance requirements). Claude Code's Anthropic client retries rate limits up to 10 times by default with exponential backoff (>116s). The router templates configure `CLAUDE_CODE_MAX_RETRIES: "2"`, bounding retries so permanent failures surface in <2 seconds while transient glitches retain retry recovery. Upstream `x-should-retry: false` headers natively halt retries immediately.

### Tool Search and MCP Context Economy

Claude Code eagerly loads tool schemas (~57.8k tokens for system and MCP tools) when Tool Search is disabled. For third-party routers hosting models like GLM and Qwen that lack Anthropic `tool_reference` block support, eager tool loading is intentionally retained. Forcing Tool Search on unsupported models causes schema misses or runtime request validation failures.

