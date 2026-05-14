---
name: find-repos
description: Discover open-source contribution opportunities across an entire GitHub organization. Use when the user wants to find suitable issues across all repos in a given org (e.g. `microsoft`, `vercel`) and have them ranked by fit against the profile in `~/.claude/config.json`.
---

Find repositories in `$ORGANIZATION` organization with open issues that match your profile.

## Your Profile (from config.json)

Profile information is read from `~/.claude/config.json`:
- **Website**: From `profiles.website`
- **Blog**: From `profiles.blog`
- **GitHub**: From `profiles.github`

## Discovering My Interests (Do this first!)
Before searching for issues, dynamically discover my current interests:
1. Use GitHub MCP to fetch my repositories and starred repos
2. Read my website (from `config.json` profiles.website) to understand my focus
3. Analyze my blog (from `config.json` profiles.blog) for recent topics
4. Look for patterns in languages, frameworks, and domains
5. Infer interests dynamically - don't use static assumptions

## GitHub Tools
- **GitHub MCP**: Preferred for collaboration (PRs, issues, comments, reviews). Tool names follow `mcp__github__*`.
- **gh CLI**: Fallback when MCP unavailable - `gh --help` for commands

## Search Steps

1. **Search Repositories**: Using GitHub MCP, search for repositories in `$ORGANIZATION` that:
   - Are actively maintained
   - Have open issues
   - Use languages/technologies aligned with your interests (check your profile)

2. **Filter Issues**: From these repos, identify **at most one** most suitable issue per repository. Apply strict filters:
   - ✅ Open state
   - ✅ No linked or referencing PRs (verify via linked PRs section or PR search)
   - ✅ Created or updated within last 6 months
   - ✅ Has labels: `good first issue`, `help wanted`, `bug`, `documentation`, or `enhancement`
   - ✅ Not assigned to anyone
   - ✅ Tech stack aligns with your interests (Python, TypeScript, MCP, AI/LLM, Telegram, etc.)

3. **Compile Results**: For final selected issues (one per repo, max 5-7), create a table with:
   - Repository Name (URL)
   - Issue Number & Title (direct link)
   - Brief task summary
   - Difficulty Level (Easy/Medium/Hard)
   - Primary Languages/Technologies
   - Date of Last Update
   - No Open PR confirmation ("✅ Verified, no linked PR")
   - **Why This Fits Your Profile**: Short relevance explanation

4. **Present**: Show the list clearly, highlight top 3 with reasoning, and await approval to contribute.

## Usage
```
/find-repos ORGANIZATION=microsoft
```
