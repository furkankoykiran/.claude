# Claude Code Prompt Engineering Canon

Upload this file to the ChatGPT project unchanged.

It is the assistant's offline baseline: the distilled prompt engineering canon plus the
allowlist of canonical sources it browses. When browsing succeeds, the live source
overrides this file, and the assistant is instructed to say which line changed.

Last verified: 2026-07-27. Every URL in section 10 returned HTTP 200 on that date.
Re-verify when the assistant reports a contradiction it could not resolve.

---

## 0. The one constraint everything derives from

> "Claude's context window fills up fast, and performance degrades as it fills."
> — Claude Code Best Practices

Most prompt technique is context economy in disguise. Every rule below traces back here.

---

## 1. Give Claude a check it can run

The highest-leverage rule in the entire canon. Claude stops when work *looks* done.
Without a runnable check, the human becomes the verification loop.

A check is anything returning a pass/fail signal in-conversation: a test suite, a build
exit code, a linter, a script diffing output against a fixture, a browser screenshot
compared to a design.

| Strategy | Weak | Strong |
|---|---|---|
| Provide verification criteria | `implement a function that validates email addresses` | `write a validateEmail function. example test cases: user@example.com is true, invalid is false, user@.com is false. run the tests after implementing` |
| Verify UI visually | `make the dashboard look better` | `[screenshot] implement this design. take a screenshot of the result and compare it to the original. list differences and fix them` |
| Root cause, not symptom | `the build is failing` | `the build fails with this error: [error]. fix it and verify the build succeeds. address the root cause, don't suppress the error` |

Escalation ladder, cheapest first:
1. Ask for the check inside the prompt itself.
2. `/goal` condition — re-checked by a separate evaluator after every turn.
3. Stop hook — a script that blocks the turn from ending until it passes.
4. Verification subagent — a fresh model tries to refute the result.

Always demand **evidence**, not assertion: the test output, the command run and its
return, or a screenshot. Reviewing evidence is faster than re-running verification.

---

## 2. Specific context beats clever phrasing

| Strategy | Weak | Strong |
|---|---|---|
| Scope the task | `add tests for foo.py` | `write a test for foo.py covering the edge case where the user is logged out. avoid mocks.` |
| Point to sources | `why does ExecutionFactory have such a weird api?` | `look through ExecutionFactory's git history and summarize how its api came to be` |
| Reference existing patterns | `add a calendar widget` | `look at how existing widgets are implemented on the home page to understand the patterns. HotDogWidget.php is a good example. follow the pattern to implement a new calendar widget... build from scratch without libraries other than the ones already used in the codebase.` |
| Describe the symptom | `fix the login bug` | `users report that login fails after session timeout. check the auth flow in src/auth/, especially token refresh. write a failing test that reproduces the issue, then fix it` |

Counterpoint worth preserving: vague prompts are *correct* during exploration.
`what would you improve in this file?` surfaces things you wouldn't think to ask.

---

## 3. Explore → Plan → Implement → Commit

1. **Explore** (plan mode): `read /src/auth and understand how we handle sessions and login. also look at how we manage environment variables for secrets.`
2. **Plan**: `I want to add Google OAuth. What files need to change? What's the session flow? Create a plan.` (`Ctrl+G` opens the plan in an editor.)
3. **Implement**: `implement the OAuth flow from your plan. write tests for the callback handler, run the test suite and fix any failures.`
4. **Commit**: `commit with a descriptive message and open a PR`

Plan mode costs overhead. The official heuristic: **"If you could describe the diff in
one sentence, skip the plan."** Plan when the approach is uncertain, the change spans
multiple files, or the code is unfamiliar.

---

## 4. Let Claude interview you (for anything large)

```
I want to build [brief description]. Interview me in detail using the AskUserQuestion tool.

Ask about technical implementation, UI/UX, edge cases, concerns, and tradeoffs.
Don't ask obvious questions, dig into the hard parts I might not have considered.

Keep interviewing until we've covered everything, then write a complete spec to SPEC.md.
```

Then execute the spec in a **fresh session**. Good specs name the files and interfaces
involved, state what is out of scope, and end with an end-to-end verification step.

---

## 5. CLAUDE.md economics

Loaded every session, so it competes with actual work for context.

Test each line: *"Would removing this cause Claude to make mistakes?"* If no, cut it.

| Include | Exclude |
|---|---|
| Bash commands Claude can't guess | Anything inferable from reading code |
| Style rules that differ from defaults | Standard language conventions |
| Testing instructions, preferred runners | Detailed API docs (link instead) |
| Repo etiquette (branches, PR conventions) | Frequently-changing information |
| Project-specific architectural decisions | Long explanations or tutorials |
| Environment quirks (required env vars) | Self-evident advice like "write clean code" |

> "Bloated CLAUDE.md files cause Claude to ignore your actual instructions!"

Diagnostic: if Claude repeatedly violates a rule that *is* in the file, the file is too
long and the rule is lost in noise. Sometimes-relevant knowledge belongs in a **skill**
(loaded on demand), not CLAUDE.md (loaded always).

---

## 6. Session hygiene

- Correct early — `Esc` to interrupt, `Esc Esc` / `/rewind` to restore, "undo that".
- **After two failed corrections, `/clear`.** Context is now polluted with dead ends.
  "A clean session with a better prompt almost always outperforms a long session with
  accumulated corrections."
- `/clear` between unrelated tasks.
- `/compact <instruction>` for directed compaction: `/compact Focus on the API changes`.
- Delegate research to subagents — they read files in *their* context, return summaries:
  `use subagents to investigate how our authentication system handles token refresh, and whether we have any existing OAuth utilities I should reuse`

---

## 7. Model-side technique

- **Golden rule:** show the prompt to a colleague with minimal context. If they'd be
  confused, Claude will be.
- **Explain the why.** `NEVER use ellipses` → `Your response will be read aloud by a
  text-to-speech engine, so never use ellipses since the text-to-speech engine will not
  know how to pronounce them.` Claude generalizes from the reason.
- **Ask for "above and beyond" explicitly.** `Create an analytics dashboard` →
  `Create an analytics dashboard. Include as many relevant features and interactions as
  possible. Go beyond the basics to create a fully-featured implementation.`
- **Examples:** 3–5, wrapped in `<example>` tags, diverse enough to cover edge cases.
- **Long context (20k+ tokens):** long documents at the **top**, the query at the
  **bottom**. Queries at the end improved response quality by up to 30% in Anthropic's tests.

**Outdated advice to actively avoid** (still common in blog listicles):
- Heavy XML scaffolding — modern models read headings and whitespace fine.
- `"Act as a senior X with 10 years experience"` — state the perspective plainly instead.
- Manual chain-of-thought — extended thinking covers it.

---

## 8. Proven multi-session patterns

**Writer/Reviewer** — fresh context isn't biased toward code it just wrote:
```
Session A: Implement a rate limiter for our API endpoints
Session B: Review the rate limiter implementation in @src/middleware/rateLimiter.ts.
           Look for edge cases, race conditions, and consistency with our existing
           middleware patterns.
Session A: Here's the review feedback: [B's output]. Address these issues.
```

**Adversarial review before "done":**
```
Use a subagent to review the rate limiter diff against PLAN.md. Check that
every requirement is implemented, the listed edge cases have tests, and
nothing outside the task's scope changed. Report gaps, not style preferences.
```
Caveat from the docs: a reviewer told to find gaps will find some even when the work is
sound. Chasing all of them produces over-engineering. Restrict findings to correctness
and stated requirements.

**Fan-out** — test on 2-3 items, refine the prompt, then run at scale:
```bash
for file in $(cat files.txt); do
  claude -p "Migrate $file from React to Vue. Return OK or FAIL." \
    --allowedTools "Edit,Bash(git commit *)"
done
```

---

## 9. Failure patterns

| Pattern | Fix |
|---|---|
| Kitchen sink session — unrelated tasks interleaved | `/clear` between tasks |
| Correcting over and over | After 2 failures, `/clear` + a better initial prompt |
| Over-specified CLAUDE.md | Prune ruthlessly; convert enforceable rules to hooks |
| Trust-then-verify gap | Always provide verification; if you can't verify it, don't ship it |
| Infinite exploration | Scope investigations or delegate to subagents |

---

## 10. Canonical sources (verified 2026-07-27)

Primary — Anthropic:
- https://code.claude.com/docs/en/best-practices
- https://code.claude.com/docs/en/common-workflows
- https://platform.claude.com/docs/en/build-with-claude/prompt-engineering/claude-prompting-best-practices
- https://claude.com/blog/best-practices-for-prompt-engineering
- https://www.anthropic.com/engineering/effective-context-engineering-for-ai-agents
- https://www.anthropic.com/engineering/building-effective-agents
- https://www.anthropic.com/engineering/writing-tools-for-agents
- https://www.anthropic.com/engineering/multi-agent-research-system
- https://claude.com/blog/how-anthropic-teams-use-claude-code
- https://code.claude.com/docs/en/memory
- https://code.claude.com/docs/en/skills
- https://code.claude.com/docs/en/sub-agents
- https://code.claude.com/docs/en/hooks-guide
- https://code.claude.com/docs/en/context-window
- https://code.claude.com/docs/en/prompt-library
- https://code.claude.com/docs/llms.txt  ← full docs index, feed this to fetch any page
- https://www.anthropic.com/engineering  ← hub, check for new posts

Community (secondary, verify before trusting):
- https://github.com/hesreallyhim/awesome-claude-code
- https://claudelog.com/
- https://github.com/anthropics/claude-code
- https://github.com/anthropics/claude-cookbooks
