---
name: solve-issue
description: Solve a GitHub issue and create a pull request
disable-model-invocation: true
---

Solve the GitHub issue at `$ISSUE_URL` and create a pull request.

## Context
- **Your GitHub Username**: `$GITHUB_USERNAME` (from global CLAUDE.md or prompt)
- **Current Workspace**: This is your fork of the original repository
- **Remote Origin**: Set to `$GITHUB_USERNAME/[original-repo-name]`
- **Target**: All commits/pushes go to your fork, PR opens to original repository

## GitHub Tools
- **GitHub MCP**: Preferred - see @docs/github-workflow.md for complete tool reference
- **gh CLI**: Fallback when MCP unavailable - `gh --help` for commands
- Check auth: `gh auth status`

## Steps

1. **Fetch Issue Details** (GitHub MCP):
   - Get issue description, labels, comments
   - Understand the problem completely

2. **Examine Repository and Code Patterns**:
   - Find and read relevant files
   - **Study recently merged PRs** (last 3-6 months) to understand:
     * Code style and patterns preferred by maintainers
     * Naming conventions and structure
     * Test approaches and coverage patterns
     * Comment style and documentation preferences
   - Reference similar working implementations
   - Read CONTRIBUTING.md if exists, follow rules
   - **Adapt your code style to match the project's existing patterns**

3. **Create Solution Plan** and get approval BEFORE implementing:
   - Which files will change (with line numbers)
   - Expected behavior difference (before/after)

4. **Implement Changes** (after approval):
   - Make small, focused changes
   - Verify after each file change

5. **Run Tests**:
   - Run existing test suite
   - Write new unit tests (follow test infrastructure)
   - Verify all tests pass
   - **Run commands SEPARATELY, do not chain with &&** (need to see output)

6. **Commit & Create PR**:
   - Use conventional commit format (fix:, feat:, test:, etc.)
   - Create feature branch, push to fork
   - Open PR to upstream repo via GitHub MCP
   - PR description: what changed, why, test results

## Rules
- Run commands one at a time, don't chain (no &&)
- Explain what you're doing at each step briefly
- Don't make assumptions - ask if unsure
- GitHub username: `$GITHUB_USERNAME`

## Usage
```
/solve-issue ISSUE_URL=https://github.com/owner/repo/issues/123
```
