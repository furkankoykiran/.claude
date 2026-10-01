# Configuration sources

The toolkit has to keep three kinds of configuration separate. Mixing them is how provider switches lose safety rules, leak stale credentials, or turn a local preference into a product promise.

## Current source model

| Source | Owner | Purpose | Notes |
| --- | --- | --- | --- |
| `settings.base.json` | Repository | Safety and policy defaults | Owns deny rules, core hooks, and cleanup retention. `ccs <provider>` reapplies it on every switch. |
| `settings.json.example` | Repository | Optional first-run preferences | Seeds new installs together with `settings.base.json`. It must not duplicate safety policy. |
| `settings.json` | User and Claude Code runtime | Generated active settings plus local preferences | Built by merging carried runtime settings, `settings.base.json`, and the active provider. It can contain local-only keys such as `autoContinueAtUsageLimit`, `agentPushNotifEnabled`, `modelSettings`, `tui`, and plugin state. |
| `providers/*.json.example` | Repository | Provider templates | Track routing shape and placeholders, not real secrets. |
| `providers/*.json` | User | Local provider credentials and selected provider-owned routing | Gitignored/local. API keys stay here for API-backed providers. Codex uses ChatGPT entitlement through the official Codex auth flow and must not copy OAuth tokens. |
| `providers/.active` | User/runtime | Active provider name | Reapplied by installers and `ccs`. |

## Merge rules

`ccs <provider>` writes `settings.json` with this order:

1. current `settings.json`, after removing provider-owned routing keys;
2. `settings.base.json`;
3. `providers/<active>.json`.

Provider-owned objects such as `env` are replaced wholesale so stale base URLs and tokens cannot blend across providers. Safety deny rules and hooks are unioned so repo-owned policy survives provider changes. Unknown user/runtime keys are carried unless they are explicitly provider-owned.

## Product boundary

`autoContinueAtUsageLimit` can appear in a user's live `settings.json`, but the toolkit does not currently treat it as proof of a reliable usage-reset continuation feature. See [Codex continuation](codex-continuation.md).

Future setup UX should preserve this split:

1. canonical repository-owned safety and policy source;
2. canonical repository-owned preset/default source;
3. generated runtime `settings.json`;
4. backwards-compatible migration that keeps local credentials and runtime preferences intact.

## Read-only UX commands

`fkt presets` lists the product preset/profile vocabulary without changing files. `fkt doctor` prints a read-only summary of the checkout, settings files, active provider, safety deny count, hook count, model-picker count, and MCP registry state. These commands are scaffolding for the later interactive setup/configure flow; they do not write credentials or rewrite `settings.json`.
