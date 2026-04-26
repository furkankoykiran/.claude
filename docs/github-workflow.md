# GitHub Workflow Reference

Complete guide for GitHub operations using GitHub MCP and gh CLI.

## GitHub MCP Tools (Preferred - ALWAYS use first)

### Repository Operations
- `mcp__github__search_repositories` - Search repos by org, language, topics
- `mcp__github__get_file_contents` - Read repository files
- `mcp__github__list_commits` - Check commit history/activity

### Issue Operations
- `mcp__github__list_issues` - List issues with filters (state, labels, since)
- `mcp__github__issue_read` - Get issue details, comments, labels
- `mcp__github__issue_write` - Create or update issues
- `mcp__github__add_issue_comment` - Comment on issues
- `mcp__github__search_issues` - Search issues with advanced syntax

### Pull Request Operations
- `mcp__github__list_pull_requests` - List PRs with filters
- `mcp__github__pull_request_read` - Get PR details, files, diffs, reviews, comments
- `mcp__github__create_pull_request` - Create new PR
- `mcp__github__update_pull_request` - Update PR title, description, state
- `mcp__github__merge_pull_request` - Merge a PR
- `mcp__github__pull_request_review_write` - Create/update reviews
- `mcp__github__add_reply_to_pull_request_comment` - Reply to review comments
- `mcp__github__update_pull_request_branch` - Update PR branch with latest base
- `mcp__github__search_pull_requests` - Search PRs with advanced syntax

### Branch Operations
- `mcp__github__create_branch` - Create new branch
- `mcp__github__list_branches` - List branches in repo

## gh CLI Commands (Fallback - only when MCP unavailable)

### Repository
```bash
gh repo view <owner>/<repo>              # View repository details
gh repo set-default <owner>/<repo>       # Set default repo for context
```

### Issues
```bash
gh issue list                            # List open issues
gh issue list --label "good first issue" # Filter by label
gh issue list --limit 100                # More results
gh issue view <number>                   # View issue details
gh issue view <number> --json comments,body,labels  # Full context
gh issue create                          # Create new issue (interactive)
```

### Pull Requests
```bash
gh pr view <number>                      # View PR details
gh pr view <number> --json comments,reviews,files  # Full context
gh pr list                               # List PRs
gh pr diff                               # View diff
gh pr checks                             # View CI status
gh pr status                             # View PR status
gh pr create                             # Create PR (interactive)
```

### Search
```bash
gh search repos --org <org> --lang <lang>  # Search repositories
gh search issues --open <query>             # Search issues
```

### Help
```bash
gh --help          # General help
gh pr --help       # PR commands help
gh issue --help    # Issue commands help
gh help pr         # Alternative help syntax
```

## Usage Patterns

### Pattern 1: Verify No Linked PR Exists
```python
# First check issue's linked PR section
mcp__github__issue_read(method="get", owner=owner, repo=repo, issue_number=number)

# Then search for PRs that reference this issue
mcp__github__search_pull_requests(query=f"issue:{number}")
```

### Pattern 2: Fetch Full PR Context
```python
# Get basic PR info
mcp__github__pull_request_read(method="get", owner=owner, repo=repo, pullNumber=number)

# Get all review comments (threads)
mcp__github__pull_request_read(method="get_review_comments", owner=owner, repo=repo, pullNumber=number)

# Get general comments
mcp__github__pull_request_read(method="get_comments", owner=owner, repo=repo, pullNumber=number)

# Get reviews
mcp__github__pull_request_read(method="get_reviews", owner=owner, repo=repo, pullNumber=number)

# Get changed files
mcp__github__pull_request_read(method="get_files", owner=owner, repo=repo, pullNumber=number)

# Get CI status
mcp__github__pull_request_read(method="get_status", owner=owner, repo=repo, pullNumber=number)
```

### Pattern 3: Reply to Review Comment
```python
mcp__github__add_reply_to_pull_request_comment(
    owner=owner,
    repo=repo,
    pullNumber=pr_number,
    commentId=comment_id,
    body="Your reply here"
)
```

### Pattern 4: Server-Side Filtering for Efficiency

❌ WRONG: Fetch all issues then filter with jq (383KB, slow)
✅ CORRECT: Use since/direction/orderBy parameters (87% less data, fast)

```python
# Efficient - server filters before returning
mcp__github__list_issues(
    owner="langchain-ai",
    repo="langchain",
    since="2025-12-01T00:00:00Z",
    direction="DESC",
    orderBy="UPDATED_AT"
)
```

Available filter parameters:
- since: ISO 8601 timestamp
- direction: ASC/DESC
- orderBy: CREATED_AT/UPDATED_AT/COMMENTS
- state: OPEN/CLOSED/ALL
- labels: Comma-separated
- perPage: 1-100

Why: 87% less data transfer, faster, fewer API calls, better reliability

## Important Notes

1. **ALWAYS try GitHub MCP first** - It's more reliable and doesn't hit rate limits
2. **gh CLI is fallback only** - Use when MCP tools are unavailable or fail
3. **Git CLI for local operations** - Use `git checkout -b`, `git commit`, `git push` directly — do NOT use GitHub MCP for branch creation or local git operations
4. **Check auth status** - `gh auth status` to verify gh is authenticated
5. **Learn new tools** - Use `gh <command> --help` to learn unfamiliar gh commands
6. **Full context** - Use `--json` flags with gh for programmatic output

## DCO Sign-off (Open Source)

When contributing to open source repos:
1. Check `CONTRIBUTING.md` for DCO requirements
2. If required, always use `git commit -s` to add sign-off
3. Follow the repo's PR template if one exists
4. Verify sign-off is present before pushing: `git log -1 --format=%B`

## Communication Guidelines

### Natural, Human-Sounding Interactions
- **Write like a real developer** — natural, conversational, concise
- **Avoid AI-sounding patterns**: "I've implemented", "As requested", "Here's what I did"
- **Match the project's communication culture** — read existing comments first
- **No emojis** in PR descriptions, code reviews, or technical comments
- **Use `/github-comment` skill** when posting issue/PR comments for best tone
- **Be concise and direct** — reviewers appreciate brevity

### Code Style Analysis
Before writing code, analyze:
1. **Recently merged PRs** - What patterns do maintainers prefer?
2. **Existing codebase** - What are the naming conventions and structure?
3. **Test patterns** - How are tests organized and written in this project?
4. **Documentation style** - How much commenting is typical?

Then adapt your approach to match.
