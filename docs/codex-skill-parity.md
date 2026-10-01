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

The checker is intentionally conservative. It passes only the static rows it can prove from the generated catalog and files on disk. The live rows for native Claude and `ccs codex` stay marked as pending until a real Claude Code session exercises them.

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

## What remains live-only

Static evidence does not prove that the model will choose a skill, that Claude Code will launch a subagent, or that a hook fired at the right time. Those need small live sessions under both a native Claude backend, where available, and `ccs codex`. Until those sessions are run, the matrix should be read as structural readiness, not full parity.
