# Codex mode parity

This page records which Claude Code modes are client-local, provider-dependent, or Anthropic-service-dependent when the toolkit runs Claude Code through `ccs codex`. It is intentionally conservative: a row says "supported" only when the behavior is either client-local by official design or has live evidence in this branch.

## Sources

- Claude Code permissions documentation lists permission modes: `default` / Manual, `acceptEdits`, `plan`, `auto`, `dontAsk`, and `bypassPermissions`.
- Claude Code command documentation lists `/fast` as a separate fast-mode command, not a permission mode.
- Live evidence in this branch used Claude Code `2.1.273`, Codex CLI `0.159.2`, `ccs codex`, model `gpt-5.5`, and effort `medium`.

## Matrix

| Mode | Official category | Classification under `ccs codex` | Status | Evidence and limits |
| --- | --- | --- | --- | --- |
| `default` / Manual | Permission mode | Claude Code client-local permission policy; inference still goes to the selected provider | Supported | Live Shift+Tab probe under `ccs codex` returned `manual mode on`. Tool prompts and deny rules remain Claude Code behavior. |
| `acceptEdits` | Permission mode | Claude Code client-local permission policy | Structurally supported, not yet live write-tested | Official behavior auto-accepts file edits and common filesystem commands inside allowed directories. This branch has not yet run a live edit probe under `ccs codex`; repo safety denies and hooks still apply. |
| `plan` | Permission mode | Mostly Claude Code client-local, with model responses routed through the active provider | Supported | Live `/plan` probe under `ccs codex` returned `Enabled plan mode` and `plan mode on`. Read-only exploration remains subject to Claude Code permissions and hooks. |
| `auto` | Permission mode with background classifier | Provider/model/service-dependent; not a generic third-party-provider guarantee | Unsupported for verified Codex setup | Live debug under `gpt-5.5` reported `modelSupported=false`, `canEnterAuto=false`, and `auto mode unavailable for this model`. The toolkit must not expose Auto as working for Codex until a supported model/session proves it. |
| `dontAsk` | Permission mode | Claude Code client-local hard-deny policy for anything that would otherwise prompt | Structurally supported, not yet live-tested | This mode should not require Anthropic inference for permission decisions. A live denial probe remains pending before claiming runtime parity. |
| `bypassPermissions` | Permission mode | Claude Code client-local permission bypass with remaining hooks/protected-action safeguards | Technically available, intentionally not enabled by toolkit defaults | This is dangerous outside isolated environments. The productization program has not live-tested it because no requested work requires bypassing prompts, and the toolkit should not encourage it. |
| `/fast` | Model/service toggle command | Anthropic-service and model-dependent, not a Codex capability | Unsupported under Codex | Live `/fast` opened a dialog for an Opus usage-credit research preview. Official docs also describe `/fast` as a separate command. Treat it as unavailable for `ccs codex` unless upstream explicitly supports it. |

## Product behavior

`ccs codex` should leave mode ownership with Claude Code. The toolkit can report mode support and limitations, but it should not fake Auto mode, Fast mode, or Anthropic usage-credit behavior for a Codex-backed session.

For the verified `gpt-5.5` configuration, the safe defaults are Manual or Plan. `acceptEdits` and `dontAsk` need targeted live probes before final parity claims. Auto remains unavailable until Claude Code itself accepts the active model/session for Auto.
