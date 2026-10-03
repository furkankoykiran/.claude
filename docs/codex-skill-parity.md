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

`docs/codex-skill-parity-live.json` records several historical `ccs codex` probes:

- explicit `/fk-writing-kit:humanizer` invocation in a real Claude Code session routed to `gpt-5.5`;
- explicit `/careful` invocation that registered a skill hook and returned the expected destructive-command risk summary without executing the command;
- SessionStart hook lifecycle events in stream-json output;
- a custom subagent boundary probe that exposed the agent and Task tool but did not spawn a subagent;
- a native Claude comparison attempt for `/fk-writing-kit:humanizer` that loaded the skill surface but stopped before inference because the Claude OAuth session was expired.

Those probes are useful history, but they are not enough for a current PASS. The latest custom-endpoint smoke tests show Claude Code sending only SDK/system-reminder content to the gateway, so the bridge now fails closed before Codex inference. Until a supported path forwards the actionable user turn, live skill parity under `ccs codex` is pending. The native Claude comparison is recorded as attempted but not proven; an expired OAuth session is not parity evidence.

## What remains live-only

Static evidence does not prove that the model will choose a skill, that Claude Code will launch a subagent, or that every hook fired at the right time. Current live evidence proves skill catalog presence and Claude-side SessionStart hook visibility, but not Codex-backed skill inference. It does not prove automatic skill selection, script or asset execution, or native Claude backend parity. Subagents are currently documented as unsupported for the Codex bridge.
