# Global Claude Code Configuration

## Setup
First-time install: run `~/.claude/install.sh` (or the curl one-liner in `README.md`). The bootstrap installs gstack + rtk, seeds `config.json`/`settings.json` from the example templates, and optionally configures portable MCP servers. Re-runs are idempotent.

## Personalization
Edit `~/.claude/config.json` with your profile (user, profiles, paths). Schema lives at `utils/lib/config.py`. Skills and utilities read this file automatically.

## Coding Discipline (CRITICAL — applies to every task)

Derived from [multica-ai/andrej-karpathy-skills](https://github.com/multica-ai/andrej-karpathy-skills) and personal experience. Bias: caution over speed. For trivial tasks (typo fixes, one-liners), use judgment.

**Think before coding.** State assumptions explicitly. If multiple interpretations exist, present them — don't pick silently. Push back when a simpler approach exists. Stop and ask when confused; don't paper over ambiguity.

**Simplicity first.** Minimum code that solves the problem. No speculative abstractions, no "flexibility" you weren't asked for, no error handling for impossible cases. If 200 lines could be 50, rewrite it. Self-test: would a senior engineer call this overcomplicated?

**Surgical changes.** Every changed line must trace to the user's request. Don't "improve" adjacent code, don't refactor unprompted, don't rewrite comments. Match existing style. Spot unrelated dead code → mention it, don't delete it. Only clean up orphans *your* changes created.

**Goal-driven execution.** Transform imperatives into verifiable goals: "fix bug" → "write a failing test, then pass it"; "refactor X" → "tests green before and after". For multi-step work, state a numbered plan with explicit verify steps. Strong success criteria let you loop independently.

**Analyze ≠ change.** When asked to analyze, explain, or review — do not edit code unless explicitly asked.

**Right tool for the job.** Git CLI for local ops (branch, commit, push); GitHub MCP for collaboration (PRs, issues, comments, reviews). Never mix.

**Research discipline.** When asked to research, do it yourself via WebFetch/WebSearch. Don't ask the user to read pages. Timebox: produce the output, don't spend a whole session exploring.

**Mega-prompt handling.** When a single prompt bundles 5+ tasks, first output a sequenced continuation-prompt plan (one prompt per task, each ending in a merged PR with passing CI). Wait for `go` before executing prompt 1.

## GitHub Workflow

- **GitHub MCP first** for collaboration (PRs, issues, comments, reviews); `gh` CLI is fallback only. Use `gh <cmd> --help` to learn unfamiliar commands.
- **Git CLI for local ops** (branch creation, commit, push). Never use GitHub MCP for these.
- **DCO sign-off** (`git commit -s`) when the target repo's `CONTRIBUTING.md` requires it. Check before first commit.
- **NEVER include AI/LLM attribution** anywhere: no "Co-Authored-By: Claude", no "Generated with Claude Code", no "Built with AI" in commits, PR bodies, issue comments, or reviews.
- **Human-toned comments.** Use `/github-comment` for issue/PR comments. No emojis in technical reviews or PR descriptions. Avoid AI-sounding phrases like "I've implemented", "As requested", "Here's what I did". Match the project's existing communication culture.
- **Efficient queries.** Use `since`, `direction`, `orderBy`, `state`, `labels`, `perPage` on `list_*` MCP tools — server-side filtering beats fetching everything and grepping.

## Commit Conventions
- **One commit per file** (or one logical change). Describe *why*, not just what.
- Format: `<type>(<scope>): <description>` — types: feat, fix, refactor, docs, test, chore.
- Example: `fix(api): resolve rate limiting issue` — explain root cause in body.
- No attribution footers of any kind.

## Testing & Code Quality
- **Verification discipline**: run build + lint + typecheck + tests before claiming "done" — but don't run extra verification the user didn't request after a config-only edit.
- Prefer single-file test runs for speed: `pytest tests/test_specific.py`.
- After multi-file changes: run the full relevant suite, not just changed files. After frontend changes: verify page renders without console errors.
- `.env` edits: diff line counts and keys against `.env.example` before claiming "in sync." For Node/TS, verify `dotenv` is actually loaded.
- Never mix package managers in one project. Check lock file (`uv.lock` / `pnpm-lock.yaml` / etc.) before invoking any.
- Address root causes, not symptoms. Don't claim "done" until verification passes.

## Skills
Skills are auto-discovered from `~/.claude/skills/`. The full catalog appears in the available-skills system message. Invoke via `/skill-name` or let Claude pick when the description matches.

- **Web browsing**: always use `/browse` (gstack). **Never** use `mcp__claude-in-chrome__*`.
- **Issue / PR comments**: use `/github-comment` for human tone.
- **Pre-merge code review**: `/review`.
- **Pre-ship readiness**: `/ship`.
- **Knowledge graph from any input**: `/graphify` (also fired by the [graphify hook](#graphify) below).

## Agents
Custom agents live in `~/.claude/agents/`. Brief them fully in the prompt — they don't see the current conversation.

- **`researcher`**: deep codebase/API research before non-trivial changes in unfamiliar code. Spawn before implementation.
- **`code-reviewer`**: post-implementation, pre-commit review for bugs/security/quality. Spawn after multi-file changes.
- **`debugger`**: systematic root-cause analysis when the first fix attempt fails.
- **`planner`**: dependency-aware execution waves for tasks touching 3+ files or multiple phases.
- **Spawn in parallel** when work is independent (e.g., frontend + backend research).

## MCP Servers
Parameter order: `claude mcp add -s <scope> <name> -e <KEY=value> -- <command> [args...]`. Env vars (`-e`) go **after** the server name, **before** the `--` separator. Use `-s user` for global scope. For JSON-configured servers, use the `/add-mcp` skill.

## Plan Mode
- Enter Plan Mode for architecture decisions, multi-step strategy, or "how should we..." questions.
- Plan Mode is interactive: present, iterate, wait for approval. Don't jump to code.
- Multi-phase output: (1) approach, (2) files to change, (3) risks, (4) verification steps. Wait for `approved` before writing code.

## Context Management
- `/clear` between unrelated tasks. After two failed corrections, `/clear` and re-prompt with better framing.
- Use subagents for investigation to preserve main context. `/compact` to focus.

## Project-Level Overrides
Use `@`-imports in project-level `CLAUDE.md`:
```
@./CLAUDE.project.md
@docs/git-instructions.md
```

## CLI Token Optimization
This setup uses [rtk](https://github.com/rtk-ai/rtk) — a transparent CLI proxy that filters and summarizes shell-tool output before it reaches the model context. Most rewrites happen via a PreToolUse hook (no action needed); a few meta commands (`rtk gain`, `rtk discover`) you call directly.

## graphify
- **graphify** (`~/.claude/skills/graphify/SKILL.md`) — any input to knowledge graph. Trigger: `/graphify`.
When the user types `/graphify`, invoke the Skill tool with `skill: "graphify"` before doing anything else.
