# Skills Reference

Full catalog of installed skills. Keep behavioral rules for skill selection in CLAUDE.md; details live here.

_Last updated: 2026-04-18_

## Workflow Skills

- `/add-mcp <json-config>` — Add MCP server from JSON config
- `/find-repos ORGANIZATION=<name>` — Find suitable issues to contribute to
- `/solve-issue ISSUE_URL=<url>` — Solve a GitHub issue and create PR
- `/find-issues REPO_URL=<url>` — Find issues in a specific repository
- `/pr-followup PR_URL=<url>` — Follow up on PR feedback
- `/github-comment` — Write natural, human-toned GitHub comments
- `/blog-from-chat` — Write blog post from chat summary
- `/github-profile-blog` — Write blog from GitHub activity
- `/linkedin-post` — Generate LinkedIn posts from URLs, blog content, or chat context
- `/humanizer` — Remove AI-writing signals from text

## gstack Skills (Web / Browser / Review)

Use `/browse` for ALL web browsing tasks. Never use `mcp__claude-in-chrome__*`.

- `/browse` — QA engineer mode for browser automation and testing
- `/qa` — QA lead mode for systematic testing
- `/setup-browser-cookies` — Import cookies from real browsers
- `/review` — Paranoid staff engineer mode for code review
- `/ship` — Release engineer mode for shipping ready branches
- `/retro` — Engineering manager mode for weekly retrospectives
- `/plan-ceo-review` — Founder/CEO mode for product thinking
- `/plan-eng-review` — Engineering manager mode for technical planning
- `/gstack-upgrade` — Upgrade gstack to latest version

If gstack skills aren't working: `cd ~/.claude/skills/gstack && ./setup`

See [gstack-use-cases.md](gstack-use-cases.md) for detailed scenarios.

## Selection Rules

- **Web browsing** → `/browse` (never claude-in-chrome MCP)
- **Issue / PR comments** → `/github-comment` (for human tone)
- **Finding work** → `/find-repos` (org-wide) or `/find-issues` (single repo)
- **Solving issues end-to-end** → `/solve-issue`
- **PR review follow-up** → `/pr-followup`
- **Pre-merge code review** → `/review`
- **Pre-ship readiness** → `/ship`
