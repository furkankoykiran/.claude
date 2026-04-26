# Agents Reference

Custom agents live in `~/.claude/agents/`. Use them to delegate specialized work while keeping the main context clean.

## Available Agents

### researcher
Deep codebase / API research before making changes. Use **before** starting any non-trivial implementation to prevent wrong-approach waste.

### code-reviewer
Pre-commit review for bugs, security, and quality. Use **after** implementation, **before** committing.

### debugger
Systematic root-cause analysis. Use when a bug isn't obvious — always verifies environment first.

### planner
Break complex tasks into dependency-aware execution waves. Use for multi-file or multi-phase work.

## When to Spawn

| Situation | Agent |
|---|---|
| Changing unfamiliar code | `researcher` (mandatory) |
| Finished multi-file changes | `code-reviewer` (mandatory before commit) |
| First fix attempt failed | `debugger` |
| Task touches 3+ files or phases | `planner` |

**Spawn in parallel** when work is independent (e.g., one researcher for frontend + one for backend).

## Agent Rules

- Agents do NOT see the current conversation — brief them fully in the prompt.
- Include file paths, context, and what you need from them.
- Agents report back; the main session decides what to do with findings.
- Use `model: sonnet` for speed on research/review; keep `opus` for complex architecture.
