# Cross-agent modernization evidence

This work keeps Claude Code as the foreground harness and adds explicit Codex
adapters. A working native Codex installation is separate from a working
Claude Code-to-Codex gateway. Neither proves the other.

## Starting point

The audit started at `baf86d8`, version `0.6.1`, on
`codex-parity-20260912`. Implementation uses `feat/cross-agent-modernization`.
Existing untracked `codex/`, `hooks/codex/`,
`scripts/install-codex-parity.sh`, `scripts/codex-mcp-headers-helper.js`, and
`state/` belong to the local checkout and are excluded from this change.

The mandatory baseline command passed:

```bash
bun install --frozen-lockfile && bun run typecheck && bun test catalog/tests && bun run catalog:check && bun run docs:check
```

Result: 312 tests passed, one optional network test skipped, no failures.
Catalog parity, 142 cached skill digests, two-generation determinism, and
33 authored documents passed their checks. Installed CLIs reported
Claude Code `2.1.273` and Codex `0.153.4`. Native `codex login status` reported
ChatGPT authentication; no credential files were read or copied.

## Four commit boundaries

| Wave | Scope | Acceptance beyond the mandatory gate |
| --- | --- | --- |
| 1 | Shared repository policy and context accounting | Instruction imports, missing files, cycles, size ceilings; existing Claude listing budget and marketplace check |
| 2 | Provider UX, auth, command installation, experimental gateway | Disposable HOME installs, clean shells, switch safety, protocol fixtures, lifecycle and tool round trip; process-scoped live network proof |
| 3 | Portable manifests, requested sources, MCP registry, prompt export | Immutable revisions, component licenses, supporting-file capabilities, runtime manifests, auth-state fixtures, deterministic export |
| 4 | Automation, documentation, release readiness | Policy classifications, all applicable lint/install/platform checks, two clean generations, final runtime evidence |

Each wave is committed only after its checks pass. A skipped or unavailable
runtime test is recorded as unverified. Sensitive capability additions retain
human review; the program does not authorize bypassing repository gates.

## Audit findings

- `marketplace.toml` already owns plugin inventory; extend its generator rather
  than maintaining another inventory. Skill bodies remain in their current
  canonical directories.
- Provider switching currently treats `effortLevel` and `enabledPlugins` as
  provider-owned. Those settings need to survive provider changes.
- Unix command installation relies on shell functions in `.bashrc`. Windows
  also needs a command path that works without a profile.
- License resolution checks the root and immediate skill directory but misses
  intermediate component licenses. Supporting-file contents also need evidence
  beyond a filename count before adding runtimes.
- The ChatGPT support bundle already exists under `docs/chatgpt-project/`.
  Upgrade and export it rather than creating a competing copy.
- No tracked workflow is named "Human PR Review". The current catalog policy
  protects catalog changes, not every provider, executable, or workflow edit.

## Runtime evidence boundary

The current [Claude Code gateway documentation](https://code.claude.com/docs/en/llm-gateway)
does not support routing Claude Code to non-Claude models. Any Codex route here
is experimental, including after a successful local test.

The installed official Codex command generated its public experimental protocol
schema with:

```bash
codex app-server generate-json-schema --experimental --out /tmp/fkt-codex-schema
```

This proves schema availability only. It does not prove translation correctness,
tool execution, concurrency, or zero Anthropic inference. Those claims require
the Wave 2 acceptance evidence.

## Current documentation discrepancies

The [Claude skill documentation](https://code.claude.com/docs/en/skills)
now describes a 1% context-based listing budget. Earlier repository measurements
used 2%. Historical measurements remain historical; the toolkit's existing
2,048-character ceiling remains a separate repository policy.

The [portable plugin specification used by OpenAI](https://developers.openai.com/plugins/build/plugins)
uses a root `plugin.json` with fixed component paths. New portable manifests
should follow that format; `.codex-plugin/plugin.json` is a compatibility
format, not a reason to duplicate canonical skill bodies.

The official [GPT-6 Astra prompting guidance](https://developers.openai.com/blog/rethinking-skills-and-prompts-for-gpt-6-astra)
is available. Model-specific guidance belongs in the prompt export and task
references, not every repository session.


## Requested source decisions

These source audits are recorded now so later waves can work from pinned facts,
not README guesses.

| Source | Current revision | Decision |
| --- | --- | --- |
| `Panniantong/Agent-Reach` | `a19a171fa980a0785849596492e0af4db800c82f` | Candidate skill content is MIT-licensed. The optional runtime has network, browser, cookie, media, MCP, and system-install capabilities; later integration must keep system-changing install modes opt-in. |
| `nextlevelbuilder/ui-ux-pro-max-skill` | `09170eec67eefd46a7ae85de61b40c194020f997` | Current CLI is `uipro`. The core skill can be considered for redistribution, but component licenses override the root license where present: `ui-styling` is Apache-2.0 and bundled canvas fonts include OFL-1.1 notices. |
| `latent-spaces/brag` | `c893c5ed52aed84e3e2ee56787de869fccdae6b0` | The slim skill is the safer lightweight candidate. Full BRAG carries runtime, binary, and media dependencies; the shipped music rights are unresolved, so the full variant stays metadata-only unless licensing is settled. |
