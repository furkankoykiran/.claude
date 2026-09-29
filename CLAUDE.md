# Claude Code adapter

@AGENTS.md

Claude Code is the preferred foreground harness. Shared repository policy lives
in `AGENTS.md`; this file contains only Claude-specific conventions.

- Use installed skills through Claude's native skill interface. Read the skill
  before following it; do not assume a named skill is installed.
- Use `browse` for browser work, `github-comment` for collaboration prose,
  `review` before merge, and `ship` for release readiness when applicable.
- Custom Claude agents live in `skills/fk-eng-agents/agents/`. Give them a
  bounded task and enough context to work independently. Use parallel agents
  for independent research.
- Claude hooks and the rtk command proxy are configured separately in settings.
  Confirm their actual configuration before relying on them.
- `config.json` holds local personalization; its schema is `utils/lib/config.py`.
  Bootstrap and provider instructions live in `docs/`; load them when needed.
