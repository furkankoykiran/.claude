# Extending the toolkit

This repository is meant to be boring to extend. Add the smallest source of truth, regenerate what is generated, and leave credentials in the host that owns them.

## Add a provider

Add a provider when Claude Code can speak to it through the Anthropic Messages shape, or when a small local adapter can translate safely.

1. Add `providers/<name>.json.example` with placeholders only. Never commit a real key, bearer token, cookie, OAuth refresh token, or local account state.
2. Keep provider-owned routing inside the provider file: `env`, `model`, `apiKeyHelper`, `modelPicker`, pricing flags, and gateway variables.
3. If the provider needs a gateway, bind it to loopback and make start/stop/status commands explicit. Do not start long-lived services silently from docs.
4. Run `ccs <name>` in a disposable `CLAUDE_DIR` and confirm `settings.json` keeps the repo-owned safety rules from `settings.base.json`.
5. Add provider tests for the merge behavior. If you cannot live-test the provider with a key, say that in the docs.

Useful checks:

```bash
bash -n bin/cc-provider scripts/test-providers.sh
scripts/test-providers.sh
bun run docs:check
git diff --check
```

A provider is not public-ready until `ccs doctor` can explain the common broken state: missing key, placeholder key, gateway down, stale `settings.json`, or unsupported request shape.

## Add a skill pack

There are two paths.

Use a plugin when this repository owns the skill body or has clear redistribution rights. Plugin skills live under `skills/<plugin>/skills/<skill>/SKILL.md`, with plugin metadata in `skills/<plugin>/plugin.json`.

Use `skills-sources.toml` when the source is upstream-owned. Pin immutable revisions, record license and redistribution decisions, and let the catalog generator write derived files.

Rules:

- Do not hand-edit `catalog/generated/**` or `docs/skills/**`.
- Do not republish skill bodies whose license is missing or incompatible. Metadata-only entries are acceptable when the source cannot be redistributed.
- Keep descriptions short. The enforced repository-owned skill listing budget is small on purpose.
- Add scripts or assets only when the skill genuinely needs them, and expect the capability gate to require review.

Useful checks:

```bash
bun run catalog:generate
bun run catalog:check
bun run catalog:budget
bun run docs:check
git diff --check
```

Run generation twice when changing resolver or generated output. The second run should be byte-identical.

## Add an MCP server

Add MCPs through `mcp-registry.toml`. That registry is the source for both human-facing `fkt mcp` output and generated portable manifests.

For each entry, record:

- id and display name;
- runtime owner, usually Claude Code for Claude-side tools;
- scope, such as no-auth default, native login, or disabled starter;
- endpoint URL;
- auth type;
- duplicate/conflict expectations.

Default-enable only servers that are safe without credentials. Auth-required servers can appear in the registry and in `fkt mcp status`, but users should authenticate through the host that will run them: `claude mcp login <id>` for Claude Code or `codex mcp login <id>` for Codex-native use.

Never copy OAuth tokens between Claude Code and Codex. Never promote a project MCP into user-level Codex config just to make a demo pass.

Useful checks:

```bash
scripts/test-fkt.sh
bun run docs:check
git diff --check
```

For live machines, also run:

```bash
fkt mcp doctor
claude mcp list
codex mcp list
```

The expected bridge shape is no duplicate endpoint/toolset inside one session. In `ccs codex` bridge mode, Claude Code normally owns Claude-side MCP tools.

## Add docs

Public docs should say what is proven, what is configured, and what remains experimental. Avoid launch-copy language. If a feature depends on billing, a paid plan, a local key, a browser login, or a host-specific UI, say so where the user first sees the feature.

Run:

```bash
bun run docs:check
git diff --check
```
