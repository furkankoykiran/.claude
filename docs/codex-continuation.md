# Codex continuation and usage-limit resets

This page records the current boundary for opt-in continuation after usage limits or quota resets.

## Supported primitives

Claude Code exposes supported session primitives:

- `claude --resume <session-id>` resumes a specific saved conversation.
- `claude --continue` continues the most recent conversation in the current directory.
- `claude --bg`, `claude attach`, `claude logs`, and `claude stop` manage background sessions.

The Codex bridge has live proof that `--resume` preserves conversation context and can accept an explicit Codex model switch. See [Codex model switching](codex-model-switching.md).

## Current product decision

The toolkit should not ship automatic usage-limit continuation yet. The missing piece is a supported, machine-readable signal that says:

- the current turn stopped specifically because of a usage limit;
- the reset time is known;
- the session can be resumed safely after that time;
- the resume action will not bypass user intent or permission state.

Claude Code's documented CLI gives us resume and continue, but not a stable usage-reset scheduler contract. `ccs codex` also cannot treat Claude Code usage counters as Codex quota or billing data. Those counters are currently diagnostic only.

## What is allowed experimentally

A future experimental command may record a session id and print the exact command a user can run after a known reset:

```bash
claude --resume <session-id>
```

It may also accept an explicit user-provided wake time and schedule a local reminder. That would be a reminder, not a claim that the provider limit has reset.

## What is not allowed

Do not implement any of these as product behavior:

- scraping terminal text to find reset times;
- polling private Claude Code files for quota state;
- fabricating Codex quota from Claude Code `usage` or `modelUsage`;
- auto-resuming a session after a limit without an explicit opt-in;
- bypassing Claude Code permission prompts or mode state on resume.

## Evidence

Live probes on 2026-10-01 under `ccs codex` showed that persisted `--resume` works for text sessions and preserves context across an explicit `--model gpt-5.6-luna` switch. The official Claude Code CLI reference documents `--resume` and `--continue`, but no supported usage-reset scheduling interface was found during this investigation.

Reference: <https://docs.anthropic.com/en/docs/claude-code/cli-usage>
