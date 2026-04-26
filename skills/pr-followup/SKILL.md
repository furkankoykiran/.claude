---
name: pr-followup
description: Analyze a GitHub pull request, understand the latest state of discussion, and dynamically act on any pending requests or feedback
---

Analyze the pull request at `$PR_URL` and take any necessary action based on the current state of discussion.

## Context
- **Your GitHub Username**: `$GITHUB_USERNAME` (from global CLAUDE.md or prompt)
- **Current Workspace**: This is your fork of the original repository
- **Remote Origin**: Set to `$GITHUB_USERNAME/[original-repo-name]`
- **Target**: All commits/pushes go to your fork, PR updates the existing PR

## GitHub Tools
- **GitHub MCP**: Preferred - see @docs/github-workflow.md for complete tool reference
- **gh CLI**: Fallback when MCP unavailable - `gh --help` for commands

## Steps

### 1. Fetch Full PR Context (GitHub MCP)

Using GitHub MCP tools, collect:
- PR title, description, base branch, head branch
- All **review comments** (inline code comments with threads)
- All **issue comments** (general discussion)
- All **review submissions** (approved / changes requested / commented)
- Current PR **status** (open / closed / merged / draft)
- CI/check statuses (passing / failing)
- List of **changed files** and their diffs

### 2. Build a Timeline

Reconstruct the full conversation in chronological order:
- Who said what, when
- Which comments are on which lines/files
- Which comments are resolved vs. unresolved
- Identify **your last action** (your last commit, comment, or reply) using `$GITHUB_USERNAME`

### 3. Identify Everything That Happened After Your Last Action

Focus only on events **after your last commit or comment**:
- New review requests or change requests
- New inline comments on code
- Reviewer replies to your responses
- Automated bot messages (CI failures, size checks, etc.)
- Any explicit instructions or requests made to you

### 4. Dynamically Determine What Needs to Be Done

Do NOT use a static checklist. Instead, reason about the current situation:

- Read each unresolved comment or request carefully
- Understand the **intent** behind each message (not just the literal words)
- Group related requests together
- Determine which are **actionable by you right now** vs. waiting on someone else
- Prioritize: blocking issues first, then suggestions, then nits

Examples of things you might discover (non-exhaustive):
- A reviewer asked you to revert a specific change
- Someone requested a test be added or removed
- A CI check is failing and a fix is implied
- A reviewer approved but left a minor suggestion
- Someone asked for clarification and is waiting for your reply
- A merge conflict appeared that needs resolution
- The PR description needs to be updated

### 5. Present Your Action Plan

Before doing anything, clearly summarize:
- What has happened since your last action (brief timeline)
- What you believe needs to be done, and **why** (reasoning from the comments)
- Exact steps you plan to take (files, changes, replies, etc.)
- Anything ambiguous that you need clarification on

**Wait for approval before proceeding.**

### 6. Execute (After Approval)

Carry out each action:
- Make code changes as requested
- Run tests and verify they pass
- Commit with conventional format (fix:, revert:, test:, etc.) referencing the PR
- Push to your fork
- **Use GitHub MCP** to reply to reviewer comments and mark them as addressed
- If a change is reverted, explain why in the commit message and PR comment

## Rules
- **ALWAYS use GitHub MCP** for GitHub operations (comments, replies, PR updates)
- Run commands one at a time — never chain with `&&`
- Never assume intent — if a comment is ambiguous, ask
- Do not make unrelated changes while addressing feedback
- Always reply to reviewers after making their requested changes
- **NO emojis in PR comments or replies** - keep communication professional
- Match the communication style of existing project comments
- Be concise and technical in feedback responses
- GitHub username: `$GITHUB_USERNAME`

## Usage
```
/pr-followup PR_URL=https://github.com/microsoft/playwright/pull/39401
```