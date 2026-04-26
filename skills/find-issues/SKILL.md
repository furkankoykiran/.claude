---
name: find-issues
description: Search a specific GitHub repository for open issues suitable to contribute to, based on your profile
---

Analyze the repository at `$REPO_URL` and find open issues that match your profile.

## Your Profile (from config.json)

Profile information is read from `~/.claude/config.json`:
- **Website**: From `profiles.website`
- **Blog**: From `profiles.blog`
- **GitHub**: From `profiles.github`

## Step 1: Discover Interests (Single Parallel Call)

Launch these two MCP calls **in one parallel batch** — nothing else:

```
mcp__github__get_me()
mcp__github__search_repositories(query="user:{username}", sort="updated")
```

Extract from results:
- Bio, languages, topics from repos
- Primary tech stack (infer from top 10 most recent repos)

**Do NOT** fetch website/blog — it's slow and rarely adds signal beyond GitHub data.

## Step 2: Fetch Issues (Use GraphQL API, NOT Search API)

**CRITICAL**: Use `mcp__github__list_issues` (GraphQL), NOT `mcp__github__search_issues` (REST).
The REST search API triggers **secondary rate limits (403)** when making multiple parallel calls.
GraphQL `list_issues` is more reliable and supports server-side filtering.

```
mcp__github__list_issues(
  owner="{owner}",
  repo="{repo}",
  state="OPEN",
  since="6 months ago ISO 8601",
  direction="DESC",
  orderBy="UPDATED_AT",
  perPage=50
)
```

**If the result is too large** (>50KB), delegate filtering to a **sonnet subagent** with this prompt pattern:
> "Read the file at {path} in chunks. Find issues that are: unassigned, no linked PRs,
> have labels like bug/feature-request/documentation/open-to-a-pull-request, and match
> the user's profile: {tech_stack_summary}. Return top 10-15 candidates."

**Label strategy**: Do NOT filter by labels in the API call. Many repos (including large ones like
microsoft/playwright) don't consistently use "good first issue" or "help wanted". Fetch broadly,
filter locally by reading labels from results.

**Priority labels** (in order of contribution-friendliness):
1. `open-to-a-pull-request` — explicit maintainer invitation
2. `good first issue`, `help wanted` — standard contribution labels
3. `bug`, `feature-request`, `documentation`, `enhancement` — general work
4. No labels — still consider if the issue is well-defined and unassigned

## Step 3: Verify No Open PRs (Batched)

Use `mcp__github__search_pull_requests` to verify candidates have no linked PRs.

**CRITICAL constraint**: GitHub search allows max **5 AND/OR/NOT operators** per query.
Batch issue numbers in groups of **4 max**:

```
# Batch 1 (max 4 issue numbers with OR)
mcp__github__search_pull_requests(
  query="repo:{owner}/{repo} is:open {num1} OR {num2} OR {num3} OR {num4}",
  owner="{owner}",
  repo="{repo}"
)

# Batch 2
mcp__github__search_pull_requests(
  query="repo:{owner}/{repo} is:open {num5} OR {num6} OR {num7} OR {num8}",
  owner="{owner}",
  repo="{repo}"
)
```

Run batches **in parallel**. If total_count > 0, read results and exclude matched issues.

## Step 4: Compile Results

Select max **5-7 issues** (one per distinct topic/area). Present as a table:

| # | Issue | Brief Task Summary | Difficulty | Tech | Last Updated | No Open PR | Why It Fits |
|---|-------|-------------------|------------|------|-------------|------------|-------------|

Difficulty heuristics:
- **Easy**: Single-file change, UI fix, add a field/property, documentation
- **Medium**: Multi-file change, new tool/API, requires understanding architecture
- **Hard**: Cross-cutting concern, protocol changes, complex state management

## Step 5: Present & Await Approval

- Highlight **top 3** with one-sentence reasoning each
- If no suitable issues found, explain why and suggest alternatives
- Await user's pick before taking any action

## Execution Pipeline Summary

```
[1] get_me + search_repositories  ──parallel──>  Profile ready
[2] list_issues (GraphQL, 50 items)  ────────>  Raw issues
[3] Subagent filters if large  ──────────────>  10-15 candidates
[4] search_pull_requests (batches of 4)  ──parallel──>  PR verification
[5] Compile table + top 3  ──────────────────>  Present to user
```

Total API calls: ~4-6 (vs 8-12 in naive approach). No rate limit risk.

## Rules
- **ALWAYS use GitHub MCP** for GitHub operations
- **NEVER make more than 2 `search_issues`/`search_pull_requests` calls in parallel** — triggers 403
- Do not suggest issues that already have an open PR
- Do not suggest issues assigned to someone else
- Prefer issues where maintainer has responded (comments > 0)
- If an issue is ambiguous, note it rather than skipping silently
- If working directory IS the target repo, skip the "is it maintained?" check

## Usage
```
/find-issues REPO_URL=https://github.com/microsoft/playwright
```
