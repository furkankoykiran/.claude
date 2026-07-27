# Skill context economy

Every model-discoverable skill costs context in every session, before you have
typed anything. This page documents how much, how it was measured, and what the
toolkit does about it.

## How Claude Code budgets the skill listing

At session start Claude Code injects a listing of `name` + `description` for
every model-discoverable skill. Three facts govern it, all from the Claude Code
2.1.220 changelog:

| Behaviour | Value |
| --- | --- |
| Global listing budget | **2% of the context window**, in characters |
| Per-description cap | **1,536 characters** (raised from 250) |
| Warning when it overflows | **none** at startup — only `/doctor` reports it |

The last row is what makes this worth a CI check. Overflow is not an error and
not a warning. Descriptions are simply dropped, the skill is listed by name
alone, and the model can no longer route to it. Nothing tells you.

### Verifying it yourself

```
/doctor
```

inside a Claude Code session gives the full breakdown, including how many
descriptions were truncated.

## The measurement

Taken on this repository's install, on a 1M-token context session.

**Before:** 141 skills in `~/.claude/skills/`, **54,529 characters** of listing
metadata.

| Pack | Characters | Share |
| --- | --- | --- |
| marketing | 33,695 | 62% |
| taste | 4,814 | 9% |
| gstack | 4,604 | 8% |
| anthropic | 4,379 | 8% |
| repository (ours) | 3,944 | 7% |
| manim | 1,894 | 3% |
| impeccable | 910 | 2% |
| karpathy | 243 | <1% |

2% of a 1,024,000-token context is 20,480 characters. The session confirmed the
model: descriptions were included in name order until roughly 20,000 characters
were consumed, after which only descriptions small enough to fit the remainder
were kept.

**Roughly fifty skills were listed by name alone.** Everything alphabetically
after `humanizer` with a description longer than the few hundred characters left
in the budget — `image`, `launch`, `offers`, `pdf`, `pptx`, `popups`, `pricing`,
`manim-narration` and the rest of the marketing pack — was unroutable by the
model for the entire session.

On the 200k-token context most users are on, the budget is 4,096 characters. The
same install was **13× over**.

**After:** the toolkit's own listing is **1,974 characters** across 10
model-visible skills, measured by `bun run catalog:budget`. Third-party packs are
unchanged in size but are now the user's explicit choice rather than something
the bootstrap installs by default reasoning.

## The enforced budget

```
2% × 204,800 tokens = 4,096 characters   (the smallest realistic context)
× 50% toolkit share  = 2,048 characters
```

The halving is the important half. The budget belongs to the *user's session*,
which also holds their own skills, their project's skills and any other plugins.
A toolkit that consumes the whole thing has not solved the problem, it has
claimed it.

```bash
bun run catalog:budget
```

```
skill listing budget: 1974 / 2048 chars (96%)
  10 model-visible skill(s), 2 user-invocable-only

  fk-writing-kit         819 chars
      humanizer              248 chars
      blog-from-chat         203 chars
      github-profile-blog    191 chars
      linkedin-post          177 chars
  fk-gh-flow             746 chars
      github-comment         228 chars
      find-issues            198 chars
      find-repos             189 chars
      pr-followup            131 chars
      solve-issue            hidden (disable-model-invocation)
  fk-manim-video         248 chars
      manim-narration        248 chars
  fk-toolkit-ops         161 chars
      add-mcp                161 chars
      toolkit-update         hidden (disable-model-invocation)
  fk-eng-agents            0 chars
```

CI fails above the budget with this breakdown, so the fix is always obvious:
shorten the entry at the top, or make it user-invocable-only.

The check covers **this repository's plugins only**. Installer-fetched packs are
reported by `bun run catalog:coverage` instead — failing a build over someone
else's description length would be noise we cannot act on.

## Invocation modes, and how they were chosen

| Mode | Frontmatter | Listing cost | Still reachable by |
| --- | --- | --- | --- |
| Model-discoverable | *(default)* | `name` + `description` | the model, and `/plugin:skill` |
| User-invocable only | `disable-model-invocation: true` | **zero** | `/plugin:skill` |
| Hidden entirely | `skillOverrides` in settings.json | zero | nothing |

`disable-model-invocation` is not a way to cheat the budget. It is a claim that
automatic routing adds nothing, and it has to be true. Two skills qualify:

- **`solve-issue`** — a heavyweight multi-step action that opens a pull request.
  You do not want that inferred from an ambiguous sentence.
- **`toolkit-update`** — updating is deliberate, and the SessionStart hook
  already hands Claude the exact command when an update exists. Paying listing
  budget for discovery would buy nothing.

Everything else stays discoverable. "Make this sound less like AI" should reach
`humanizer` without the user knowing the skill exists — that is the whole value
of model routing, and trading it for characters would be a false economy.

`fk-eng-agents` costs **zero**: agents are not in the skill listing at all.

## Writing a description that survives

The rewrite that got this from 4,147 to 1,974 characters kept every routing
signal. The pattern:

**Lead with the action, then the trigger phrases the user will actually say.**
Drop restatement, dependency notes, and anything the model does not need until
after it has already chosen the skill — that belongs in the body.

`manim-narration` went from 1,143 characters to 248:

> Build a Manim video with spoken narration synced to the animation. Use for a
> "narrated Manim video", "anlatımlı manim", "manim with voice", a PR
> walkthrough video, or code that imports NarratedScene. ManimCE only.

What came out: the edge-tts and ffmpeg implementation notes, the `NarratedScene`
API description, the screenshot pipeline, the pip and system dependency list.
All of it still exists — in the body, where it is read *after* routing succeeds,
and costs nothing until then.

## Finding a skill you cannot remember

Shorter descriptions and opt-in plugins both make discovery harder, so the
catalog carries the full index:

```bash
bun run catalog:coverage                    # what every source contributes
grep -i <topic> catalog/generated/SKILLS_CATALOG.md
```

`docs/skills/` has a generated page per skill with its full frontmatter, source
revision, licence and digest. Inside a session, `/plugin` lists installed plugins
and their contents, and typing `/` shows every skill including the
user-invocable-only ones.