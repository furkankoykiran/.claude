# Global Claude Code Configuration

## Setup
First-time install: run `~/.claude/install.sh` (or the curl one-liner in `README.md`).
The bootstrap installs gstack + rtk, seeds `config.json`/`settings.json` from
the example templates, and optionally configures portable MCP servers. Re-runs
are idempotent.

## Personalization
Edit `~/.claude/config.json` with your profile (user, profiles, paths). Schema lives at
`/root/.claude/utils/lib/config.py`. Skills and utilities read this file automatically.

## Approach Rules (CRITICAL — applies to every task)
- **Plan before executing** on ambiguous or multi-step work. Ask "should I do X or Y?" rather than guess.
- **Analyze ≠ change code.** When asked to analyze or explain a reviewer comment, bug, or file, do not edit code unless explicitly asked.
- **Pick the right tool**: git CLI for local ops (branch, commit, push); GitHub MCP for collaboration (PRs, issues, comments, reviews). Never mix.
- **Start narrow** when investigating — specific file/function first, expand only if needed. Ask which environment/context first when debugging.
- **Research discipline**: when the user asks you to research, do it yourself via WebFetch / WebSearch. Don't ask the user to read pages or check settings manually. Timebox: produce the output, don't spend a whole session exploring.
- **Verification discipline**: run build + lint + typecheck + tests before claiming "done." But don't run extra verification the user didn't request after a config-only edit.
- **Mega-prompt handling**: when a single prompt bundles 5+ tasks, first output a sequenced continuation-prompt plan (one prompt per task, each ending in a merged PR with passing CI). Wait for `go` before executing prompt 1.

## GitHub Workflow
Full reference: @docs/github-workflow.md
- **GitHub MCP first** for collaboration (PRs, issues, comments, reviews). `gh` CLI is fallback only.
- **Git CLI for local ops** (branch creation, commit, push) — never use GitHub MCP API for these.
- **DCO sign-off** (`git commit -s`) when the target repo's `CONTRIBUTING.md` requires it. Check before first commit.
- **NEVER include AI/LLM attribution** anywhere: no "Co-Authored-By: Claude", no "Generated with Claude Code", no "Built with AI" in commits, PR bodies, issue comments, or reviews.
- **Human-toned comments**: use `/github-comment` for issue/PR comments. No emojis in technical reviews, code comments, or PR descriptions. Avoid AI-sounding phrases like "I've implemented", "As requested", "Here's what I did". Match the project's existing communication culture.

## Commit Conventions
- **One commit per file.** Describe *why*, not just what.
- Format: `<type>(<scope>): <description>` — types: feat, fix, refactor, docs, test, chore.
- Examples: `feat(auth): add OAuth2 token refresh logic`, `fix(api): resolve rate limiting issue`.
- No attribution footers of any kind.

## Testing & Code Quality
- **Python**: `pytest`, `ruff` (format + lint), `mypy` (typecheck). Package manager: `uv` or Poetry per project (check `pyproject.toml` / `uv.lock`).
- **TypeScript / Node**: `pnpm` preferred (check `pnpm-lock.yaml`). `eslint`, `prettier`, `pnpm typecheck`, `pnpm test`.
- Prefer single-file test runs for speed: `pytest tests/test_specific.py`.
- Always typecheck after changes: `mypy` or `pnpm typecheck`.
- `.env` edits: diff line counts and keys against `.env.example` before claiming "in sync." For Node/TS, verify `dotenv` is actually loaded before testing auth flows.
- After multi-file changes: run the full relevant suite, not just changed files. After frontend changes: verify page renders without console errors.
- Never mix package managers in one project.
- Address root causes, not symptoms. Don't claim "done" until verification passes.

## Code Style Adaptation
Before writing code in an unfamiliar repo, analyze:
- Recently merged PRs (last 3–6 months) for style patterns the maintainers prefer.
- Naming conventions, file structure, and organization.
- Existing test patterns — match them, don't invent new structures.
- Doc/comment density — match it.

Adapt to project-specific idioms, not generic "best practices."

## Writing Style
- **Blog posts & docs**: lead with "what you can do," not "how it's implemented." Keep technical depth proportional to the audience — default to accessible. Go deep on implementation only when asked.
- **PR descriptions**: concise summary of what changed and why — not a technical essay.
- **Issue comments**: conversational and helpful, not robotic.

## MCP Server Management
Full reference: @docs/mcp-reference.md
Quick rule: env vars (`-e`) go AFTER the server name, BEFORE the `--` separator. Use `-s user` for global.

## Skills
Full reference: @docs/skills-reference.md
Key rule: use `/browse` (gstack) for ALL web browsing. **Never** use `mcp__claude-in-chrome__*`.

## Agents
Full reference: @docs/agents-reference.md
- **ALWAYS spawn `researcher`** before non-trivial changes in unfamiliar code.
- **ALWAYS spawn `code-reviewer`** after multi-file changes, before committing.
- **Spawn `debugger`** when the first fix attempt fails — don't keep guessing.
- **Spawn `planner`** for tasks touching 3+ files or requiring phased delivery.
- **Spawn in parallel** when agents are independent.

## Plan Mode
- Enter Plan Mode for architecture decisions, multi-step strategy, or any "how should we..." question.
- Plan Mode is interactive: present, iterate, wait for approval. Don't skip it by jumping to code.
- For multi-phase work output: (1) approach, (2) files to change, (3) risks, (4) verification steps. Wait for `approved` before writing code.

## Context Management
- `/clear` between unrelated tasks. After two failed corrections, `/clear` and re-prompt with better framing.
- Use subagents for investigation to preserve main context. `/compact` to focus.

## Project-Level Overrides
Use `@`-imports in project-level `CLAUDE.md`:
```
# Additional Instructions
- Git workflow: @docs/git-instructions.md
- Project conventions: @./CLAUDE.project.md
```

## CLI Token Optimization
This setup uses [rtk](https://github.com/rtk-ai/rtk) — a transparent CLI proxy that filters and summarizes shell-tool output before it reaches the model context. Most rewrites happen via a PreToolUse hook (no action needed); a few meta commands (`rtk gain`, `rtk discover`) you call directly.
Reference: @RTK.md
