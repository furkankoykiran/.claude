# Codex skill parity evidence

The toolkit keeps Claude Code as the harness. Skills are still Claude Code skills; `ccs codex` changes the inference backend behind the local Anthropic-compatible adapter. That means skill parity has two layers:

1. **Static compatibility**: the skill exists, has an invocation, keeps its references/assets/scripts, declares tool access, and stays present in plugin/catalog metadata.
2. **Runtime compatibility**: Claude Code actually selects or invokes the skill while routed through a backend, and any tools, hooks, subagents, or scripts behave the same way.

Run the static matrix with:

```bash
bun run skills:compat
```

For a table view:

```bash
bun ./scripts/skill-compatibility-matrix.ts --markdown
```

The checker is intentionally conservative. It passes the static rows it can prove from the generated catalog and files on disk, and it reads tracked live probes from `docs/codex-skill-parity-live.json`. Any live surface without tracked evidence stays marked as pending.

## Current static coverage

The matrix covers:

- automatic discovery metadata in `catalog/generated/skills-catalog.json`;
- explicit slash invocations;
- namespaced plugin skills such as `/fk-writing-kit:humanizer`;
- references, scripts, and asset/template files;
- allowed-tool declarations;
- repository plugin skill files;
- hook files and base settings presence;
- subagent files from `fk-eng-agents`;
- representative gstack skills: `spec`, `review`, `ship`, and `plan-devex-review`;
- Agent-Reach, UI/UX Pro Max, BRAG slim, and the repo-owned humanizer.

## Live evidence so far

`docs/codex-skill-parity-live.json` currently records one `ccs codex` probe: an explicit `/fk-writing-kit:humanizer` invocation in a real Claude Code session routed to `gpt-5.5`. Claude Code loaded the `fk-writing-kit` plugin skills, sent the turn to `/v1/messages`, and returned the expected plain-language rewrite.

## What remains live-only

Static evidence does not prove that the model will choose a skill, that Claude Code will launch a subagent, or that a hook fired at the right time. The current live probe proves one explicit namespaced text skill under `ccs codex`; it does not prove automatic skill selection, script or asset execution, skill-driven hooks, subagents, representative gstack flows, or native Claude backend parity. Those need separate small live sessions.
