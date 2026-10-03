# Codex mode parity

This page records which Claude Code modes are client-local, provider-dependent, or Anthropic-service-dependent when the toolkit runs Claude Code through `ccs codex`. It is intentionally conservative: a row says "supported" only when the behavior is either client-local by official design or has live evidence in this branch.

## Sources

- Claude Code permissions documentation lists permission modes: `default` / Manual, `acceptEdits`, `plan`, `auto`, `dontAsk`, and `bypassPermissions`.
- Claude Code command documentation lists `/fast` as a separate fast-mode command, not a permission mode.
- Live evidence in this branch used Claude Code `2.1.273`, Codex CLI `0.159.2`, `ccs codex`, model `gpt-5.5`, and effort `medium`. Current smoke tests show `ccs doctor`/`ccs codex-status` with the selected model set to `gpt-5.5` medium and show the gateway failing closed when Claude Code sends only SDK/system-reminder content. Do not treat older Manual or Plan text probes as current parity evidence until a supported prompt-forwarding path is proven again.

## Matrix

| Mode | Official category | Classification under `ccs codex` | Status | Evidence and limits |
| --- | --- | --- | --- | --- |
| `default` / Manual | Permission mode | Claude Code client-local permission policy; inference still goes to the selected provider when a user turn reaches the provider | Client mode supported; Codex inference path pending | Claude Code still exposes Manual/default mode, hooks, and tool policy locally. Current custom-endpoint probes did not forward the actionable prompt, so text/tool parity for Manual under `ccs codex` is not currently claimed. |
| `acceptEdits` | Permission mode | Claude Code client-local permission policy, but Codex App Server execution is forced read-only by the gateway | Limited | Live probes found Codex-side hidden writes could bypass Claude Code prompts before the gateway fix. The bridge now rejects Codex-side writes with a read-only sandbox, so `acceptEdits` must not be advertised as write-capable for `ccs codex` until true Claude Code tool passthrough is implemented. |
| `plan` | Permission mode | Claude Code client-local planning policy; model responses still need a forwarded user turn | Client mode supported; Codex inference path pending | Live `/plan` probes showed Claude Code can enter Plan mode. Current custom-endpoint probes did not forward the actionable prompt to the Codex gateway, so Plan-mode Codex inference remains unclaimed. |
| `auto` | Permission mode with background classifier | Provider/model/service-dependent; not a generic third-party-provider guarantee | Unsupported for verified Codex setup | Live debug under `gpt-5.5` reported `modelSupported=false`, `canEnterAuto=false`, and `auto mode unavailable for this model`. The toolkit must not expose Auto as working for Codex until a supported model/session proves it. |
| `dontAsk` | Permission mode | Claude Code client-local hard-deny policy; gateway also forces Codex-side execution read-only | Supported for denying Codex-side writes | Live probe under `ccs codex` attempted to create `dontask-proof.txt`. After the gateway fix, no file appeared in `/tmp` or the repo root, and the gateway log reported the write was blocked by read-only sandbox and approval settings. |
| `bypassPermissions` | Permission mode | Claude Code client-local permission bypass with remaining hooks/protected-action safeguards | Technically available, intentionally not enabled by toolkit defaults | This is dangerous outside isolated environments. The productization program has not live-tested it because no requested work requires bypassing prompts, and the toolkit should not encourage it. |
| `/fast` | Model/service toggle command | Anthropic-service and model-dependent, not a Codex capability | Unsupported under Codex | Live `/fast` opened a dialog for an Opus usage-credit research preview. Official docs also describe `/fast` as a separate command. Treat it as unavailable for `ccs codex` unless upstream explicitly supports it. |

## Product behavior

`ccs codex` should leave mode ownership with Claude Code. The toolkit can report mode support and limitations, but it should not fake Auto mode, Fast mode, or Anthropic usage-credit behavior for a Codex-backed session.

For the `gpt-5.5` configuration, the safe defaults are still Manual or Plan from Claude Code's point of view, but Codex-backed inference is not considered live-proven until Claude Code forwards an actionable user turn to the gateway. `dontAsk` has a denial proof for Codex-side writes. `acceptEdits` remains limited because the gateway intentionally keeps Codex App Server read-only; write-capable parity requires future Claude Code-owned tool passthrough. Auto remains unavailable until Claude Code itself accepts the active model/session for Auto.
