# gstack Use Cases

**Personalized usage guide**

---

## What is gstack?

gstack transforms Claude Code from a generic assistant into **specialized cognitive modes** for different tasks. It provides 8 slash commands, each optimized for a specific mindset:

| Command | Mode | Purpose |
|---------|------|---------|
| `/plan-ceo-review` | Founder/CEO | Product thinking, user value, 10-star product vision |
| `/plan-eng-review` | Eng Manager | Architecture, data flow, edge cases, test strategy |
| `/review` | Paranoid Staff Engineer | Production bugs, N+1 queries, race conditions, trust boundaries |
| `/ship` | Release Engineer | Sync, test, push, create PR - for ready branches |
| `/browse` | QA Engineer | Browser automation, screenshots, console checks |
| `/qa` | QA Lead | Diff-aware testing, full exploration, regression testing |
| `/setup-browser-cookies` | Session Manager | Import cookies from real browsers |
| `/retro` | Engineering Manager | Weekly retro, commit analysis, per-person feedback |

---

## Use Case 1: Open Source Contribution Pipeline

**Goal:** Make high-quality contributions to open source projects systematically

**Workflow:**

```
1. Find Issues
   /find-issues REPO_URL=https://github.com/owner/repo
   → Lists issues with "good first issue", "help wanted" labels
   → Filters by your tech stack and interests
   → Verifies no linked PRs exist

2. CEO Review (Product Perspective)
   /plan-ceo-review
   → Questions the real user value of the issue
   → "Is this the right feature to build?"
   → Suggests alternative approaches
   → Finds the 10-star product hiding in the request

3. Engineering Review (Technical Planning)
   /plan-eng-review
   → Architecture diagrams
   → State machines
   → Data flow
   → Failure modes
   → Edge cases
   → Test strategy
   → System boundaries

4. Implementation
   → Write code based on the plan
   → Write tests following project patterns
   → Run test suite

5. Code Review (Paranoid Mode)
   /review
   → Finds bugs that pass CI but blow up in production
   → N+1 queries
   → Race conditions
   → Trust boundary violations
   → Missing edge cases
   → Broken invariants

6. Shipping
   /ship
   → Sync with main
   → Run tests
   → Push branch
   → Create PR with proper description
```

**Value:** Higher contribution quality, easier reviews, faster merges, better learning.

---

## Use Case 2: PR Feedback Learning Loop

**Goal:** Learn from feedback on your PRs to improve as a developer

**Workflow:**

```
1. PR Follow-up
   /pr-followup PR_URL=https://github.com/owner/repo/pull/123
   → Builds comment timeline
   → Identifies your last action
   → Lists pending feedback
   → Creates action plan
   → Executes fixes after approval

2. Weekly Retro
   /retro
   → Commit analysis
   → LOC, test ratio, PR sizes
   → Biggest ship of the week
   → Growth opportunities
   → Per-person praise and feedback
   → Trend tracking (compare with previous weeks)
```

**Value:** Systematic improvement, pattern recognition, better understanding of project norms.

---

## Use Case 3: Automated QA for Web Applications

**Goal:** Replace manual QA testing with automated, diff-aware testing

**Workflow:**

```
1. Post-Development QA (Local)
   /qa
   → Analyzes git diff against main
   → Identifies affected routes/pages
   → Tests each affected page on localhost:3000
   → Generates health score (0-100)
   → Saves screenshots and report

2. Staging QA with Auth
   /setup-browser-cookies staging.example.com
   → Imports login cookies from your browser

   /qa https://staging.example.com --full
   → 10-15 minute systematic exploration
   → Tests navigation, forms, flows
   → Takes screenshots
   → Checks console errors
   → Health score with prioritized issues

3. Regression Testing
   /qa https://staging.example.com --regression baseline.json
   → Compares new build against baseline
   → Lists fixed issues
   → Lists new issues
   → Score delta
```

**Value:** Manual QA time savings, fewer production bugs, deployment confidence.

---

## Use Case 4: Documentation Research + Integration Planning

**Goal:** Quickly learn new framework features and plan integration

**Workflow:**

```
1. Browse Documentation
   /browse https://docs.example.com/new-feature
   → Crawls documentation
   → Extracts key changes
   → Finds code examples
   → Summarizes important points

2. CEO Review (Strategic Evaluation)
   /plan-ceo-review
   → "How does this feature impact our products?"
   → "What 10-star product can we build with this?"
   → "Should we deprecate existing features?"
   → User value analysis

3. Engineering Review (Technical Integration)
   /plan-eng-review
   → Integration architecture
   → Migration path
   → Breaking changes
   → Version compatibility
   → Rollback strategy
   → Test requirements
```

**Value:** Faster learning, strategic adoption, reduced integration risk.

---

## Use Case 5: Content Creation from Development Activity

**Goal:** Auto-generate blog posts and technical content from work

**Workflow:**

```
1. Weekly Retro
   /retro
   → Analyzes week's commits
   → Identifies key contributions
   → Lists learning moments
   → Team breakdown (if working with others)

2. Blog Post Creation
   /blog-from-chat
   → Generates blog post from retro
   → Multi-language support
   → Markdown format
   → Saves to blog directory

3. GitHub Activity Blog
   /github-profile-blog
   → Creates educational content from PRs/issues
   → Explains contributions
   → Technical deep-dives
```

**Value:** Automated content creation, community building, personal brand.

---

## Use Case 6: Parallel Work with Multiple Sessions

**Goal:** Run 10 different tasks simultaneously (requires Conductor)

**Workflow:**

```
10 parallel workspaces:

Workspace 1:  /qa staging.example.com
Workspace 2:  /review open-source PR
Workspace 3:  /plan-ceo-review new feature idea
Workspace 4:  /ship ready branch
Workspace 5:  /browse docs.example.com
Workspace 6:  /solve-issue open-source issue
Workspace 7:  /pr-followup pending PR
Workspace 8:  /qa localhost:3000 --quick
Workspace 9:  /retro
Workspace 10: /plan-eng-review new architecture

Each workspace:
→ Isolated browser instance
→ Separate cookie storage
→ Separate cwd
→ Separate Claude Code session
→ No interference between sessions
```

**Value:** 10x productivity, context isolation, parallel execution.

---

## Quick Reference

### Planning Commands
```
/plan-ceo-review    → Product thinking, user value, founder taste
/plan-eng-review    → Architecture, engineering rigor, technical depth
```

### Review Commands
```
/review             → Paranoid code review, production bug focus
```

### Ship Commands
```
/ship               → Release engineering for ready branches
```

### QA Commands
```
/browse <url>       → Manual browser automation
/qa                 → Diff-aware testing on feature branches
/qa <url>           → Full systematic testing
/qa <url> --quick   → 30-second smoke test
/qa <url> --regression <baseline>  → Regression testing
```

### Session Commands
```
/setup-browser-cookies       → Interactive domain picker
/setup-browser-cookies <url> → Direct cookie import
```

### Retro Commands
```
/retro              → Weekly retrospective analysis
/retro compare      → Week-over-week comparison
```

---

## Tips & Tricks

### `/browse` Tips
- First call: ~3s (browser startup)
- Subsequent calls: ~100-200ms (persistent daemon)
- Session closes after 30 min idle
- Cookies and localStorage persist between calls

### `/qa` Tips
- Auto-detects feature branches and runs diff-aware tests
- `--quick`: Homepage + 5 pages, 30 seconds
- `--full`: 10-15 minutes, comprehensive exploration
- Reports saved to `.gstack/qa-reports/`

### `/review` Tips
- Greptile integration for automated PR review
- False positive tracking in `~/.gstack/greptile-history.md`
- Auto-reply to already-fixed issues
- Focus on production bugs, not style nits

### `/ship` Tips
- Only for ready branches, not for planning
- Sync → Test → Push → PR workflow
- Changelog/version bump support for projects that expect it

### `/retro` Tips
- JSON snapshots saved to `.context/retros/`
- Trend tracking across weeks
- Team-aware: different treatment for each contributor
- Computes: commits, LOC, test ratio, PR sizes, fix ratio

---

## Troubleshooting

### Skills not showing up?
```bash
cd ~/.claude/skills/gstack && ./setup
```

### `/browse` failing or binary not found?
```bash
cd ~/.claude/skills/gstack && bun install && bun run build
```

### Project copy out of date?
```bash
/gstack-upgrade
```

### `bun` not installed?
```bash
curl -fsSL https://bun.sh/install | bash
```

---

## Upgrade

```bash
/gstack-upgrade
```

For automatic upgrades, add to `~/.gstack/config.yaml`:
```yaml
auto_upgrade: true
```

---

## Links

- [gstack GitHub](https://github.com/garrytan/gstack)
- [Claude Code Documentation](https://docs.anthropic.com/en/docs/claude-code)
- [Conductor](https://conductor.build) - For running parallel Claude Code sessions

---

**Note:** This document provides general use cases. Adapt workflows to your specific projects and requirements.
