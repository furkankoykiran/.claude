# Cross-agent modernization evidence

This work keeps Claude Code as the foreground harness and adds explicit Codex
adapters. A working native Codex installation is separate from a working
Claude Code-to-Codex gateway. Neither proves the other.

## Starting point

The audit started at `baf86d8`, version `0.6.1`, on
`codex-parity-20260912`. Implementation uses `feat/cross-agent-modernization`.
Existing untracked `codex/`, `hooks/codex/`,
`scripts/install-codex-parity.sh`, `scripts/codex-mcp-headers-helper.js`, and
`state/mcp-discover-verdicts.json` were re-inspected during the PR #70 final
pass. They were removed from the workspace rather than committed: the tracked
portable marketplace generator owns plugin and MCP manifests, `mcp-registry.toml`
now owns reviewed MCP discovery, the untracked installer copied personal Claude
HTTP MCP headers into Codex config, the hook bundle depended on unverified Codex
hook semantics and hardcoded `/root/.claude`, and the agent TOMLs duplicated
tracked repository agent skills. The generated live gateway log created during
acceptance testing was also removed.

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
| 2 | Provider UX, auth, command installation, experimental gateway | Disposable HOME installs, clean shells, switch safety, protocol fixtures, lifecycle checks, and current fail-closed live proof |
| 3 | Portable manifests, requested sources, MCP registry, prompt export | Immutable revisions, component licenses, supporting-file capabilities, runtime manifests, auth-state fixtures, deterministic export |
| 4 | Automation, documentation, release readiness | Policy classifications, all applicable lint/install/platform checks, two clean generations, final runtime evidence |

Each wave is committed only after its checks pass. A skipped or unavailable
runtime test is recorded as unverified. Sensitive capability additions retain
human review; the program does not authorize bypassing repository gates.

## Audit findings

- `marketplace.toml` already owns plugin inventory; extend its generator rather
  than maintaining another inventory. Skill bodies remain in their current
  canonical directories.
- Starting point: provider switching treated `effortLevel` and `enabledPlugins`
  as provider-owned. Wave 2 changed those to preserved user policy.
- Starting point: Unix command installation relied on shell functions in
  `.bashrc`; Windows also needed a command path that worked without a profile.
  Wave 2 replaced these with real command shims.
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


## Wave 2 evidence

Wave 2 adds the provider/auth command surface, real command shims for `ccs` and
`fkt`, and an isolated experimental Codex gateway adapter.

`ccs codex` is now a provider switch and gateway supervisor. It writes Claude
Code routing variables for a loopback gateway at `127.0.0.1:4545`, starts or
reuses the Codex app-server bridge, disables documented nonessential Anthropic
surfaces where practical, and preserves the repo-owned safety denies and hooks.
It does not copy Codex or ChatGPT tokens. `ccs login codex` delegates to the
official `codex login` flow; `ccs api codex` is rejected because ChatGPT
entitlement is not an API-key billing path. Claude Code keeps a known
Claude-facing model alias for local catalog compatibility while
`CODEX_GATEWAY_MODEL` carries the user-selected Codex model id such as
`gpt-5.5`, so Codex model choice is independent from Claude aliases.

The Codex gateway code is still experimental, but it now runs a real local
Codex app-server loopback. Current implementation covers the translation
boundary with fixtures for streaming, system instructions, multi-turn state,
client tool calls, tool results, command-output deltas, duplicate retries,
errors, cancellation, and clean shutdown. Historical live acceptance on
2026-09-30 reported a shell-command turn through the loopback provider, but
newer Claude Code `2.1.273` custom-endpoint probes did not forward the
actionable user prompt to `/v1/messages`. The gateway now fails closed in that
case instead of sending system reminders to Codex or producing fake tool
success. The health endpoint still reports the selected Codex provider, model,
and reasoning effort; no Anthropic API key or ChatGPT token file is read or
copied.

The old installer-managed shell functions are migrated away. Unix, WSL, and Git
Bash installs now write `~/.local/bin/ccs` and `~/.local/bin/fkt`; native Windows
writes `ccs.ps1` and `fkt.ps1` under `$HOME\.local\bin` and updates the user
PATH. Tests use disposable HOME directories.

Wave 2 checks passed:

```bash
bash -n bin/cc-provider install.sh scripts/test-providers.sh scripts/test-install.sh scripts/test-fkt.sh
shellcheck bin/cc-provider install.sh scripts/test-providers.sh scripts/test-install.sh scripts/test-fkt.sh
scripts/test-providers.sh
scripts/test-install.sh
scripts/test-fkt.sh
bun test catalog/tests/codex-anthropic-gateway.test.ts
bun run instructions:check
bun run catalog:budget
bun run marketplace:check
git diff --check
LC_ALL=C grep -n "[^ -~]" bin/cc-provider.ps1 install.ps1 || true
bun install --frozen-lockfile && bun run typecheck && bun test catalog/tests && bun run catalog:check && bun run docs:check
```

Results: provider tests `110 passed`; installer tests `42 passed`; updater tests
`120 passed`; Codex gateway tests `8 passed`; instruction budget `3592 / 8192`
bytes and Codex discovery `3140 / 4096` bytes; Claude skill listing `1974 / 2048`
chars; mandatory catalog tests `332 passed`, one opt-in network test skipped, no
failures. PowerShell runtime checks remain unrun in this Linux container because
neither `pwsh` nor Windows PowerShell is installed; the PowerShell files were
kept ASCII-only and covered by shell-side parity tests where possible.

## Wave 3 evidence

Wave 3 adds portable plugin manifests and a curated MCP registry without duplicating skill bodies. `marketplace.toml` remains the plugin inventory; the generator now writes Claude manifests, portable root `plugin.json` files, the repo-scoped `.agents/plugins/marketplace.json`, and plugin `mcp.json` files where `mcp-registry.toml` assigns no-auth default servers. The default MCP is OpenAI Developer Docs at `https://developers.openai.com/mcp`; auth-required MCP entries remain in the canonical registry and `fkt mcp` UX, but are not emitted into portable defaults.

The requested upstreams are now installer-managed in full bootstrap and pinned to immutable revisions: Agent-Reach `a19a171fa980a0785849596492e0af4db800c82f`, UI/UX Pro Max `09170eec67eefd46a7ae85de61b40c194020f997`, and BRAG slim from BRAG `c893c5ed52aed84e3e2ee56787de869fccdae6b0`. Agent-Reach installs only `agent_reach/skill`; bootstrap never runs its browser, cookie, runtime, or `--system` installer path. UI/UX Pro Max installs the approved `.claude/skills` set. BRAG slim installs the lightweight `skills/brag-slim` skill. Full BRAG remains metadata-only because its runtime and bundled media boundary is not safe to redistribute or install automatically.

The ChatGPT Project prompt-architect bundle now routes by target runtime: Claude Code, Codex, or cross-agent. It uses `AGENTS.md` as shared policy, `CLAUDE.md` as the Claude adapter, current Codex/GPT-6 and Agent Plugin guidance for Codex prompts, and keeps generated implementation prompts in English with runnable verification.

## Wave 4 evidence

Wave 4 found one automation gap introduced by portable manifests: `skills-catalog-update.yml` already regenerated manifests after a VERSION bump, but it staged only the Claude marketplace and `.claude-plugin` plugin manifests. Portable root `skills/*/plugin.json` also embeds VERSION. The workflow now stages those files, and `catalog/tests/workflow-guards.test.ts` asserts the VERSION-bearing manifest set so the gap cannot return quietly.

No redundant workflow named "Human PR Review" exists. Sensitive catalog changes still stop at the existing deterministic `manual-review-required` boundary; routine automation remains limited to protected squash auto-merge and never uses `--admin`, ruleset bypass, or direct merge fallback.
