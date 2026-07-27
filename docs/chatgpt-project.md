# Writing better Claude Code prompts with a ChatGPT project

A configured ChatGPT project turns a half-formed idea into a Claude Code prompt that
names real files, routes to real skills, and closes with a check Claude Code can run.
You type one sentence; you get back a prompt worth pasting.

This guide sets that up end to end. It takes about twenty minutes, most of it spent
filling in one file honestly.

## What you get

Four modes, detected from how you phrase the request:

| Mode | You write | You get |
| --- | --- | --- |
| **FORGE** | "add search to the catalog page" | A full prompt: assumptions, scoped task, verification command, evidence to report |
| **BRAINSTORM** | "should these two tools share a core?" | A design discussion. No prompt block |
| **ROUTE** | "which skills before merging a PR?" | Exact invocations from your installed catalog |
| **AUDIT** | "audit this prompt: ..." | Why it underperformed, then a rewrite |

## Why it is built this way

Three decisions carry most of the value.

**Upload the skill index, not the skill bodies.** The `claude_code_skills.md` release
asset is over 4 MB. ChatGPT never needs it. Its only job is knowing that a skill exists
and what it does, so it can put `/skill-name` in the prompt; Claude Code loads the body
itself at runtime. The 27 KB `SKILLS_CATALOG.md` asset carries all 140+ entries and
routes far better than a multi-megabyte file that retrieval has to wade through.

**`CLAUDE.md` is the single authority.** It already holds coding discipline, commit
conventions, verification gates and repository invariants. Nothing else uploaded may
repeat it. Duplication does not reinforce a rule; it creates two sources that drift, and
it makes it impossible to tell whether the assistant read the real file or a stale copy.

**Every prompt ends in a runnable check.** Claude Code stops when work looks done.
Without a check it can run, you become the verification loop. The instructions make this
non-negotiable: a prompt with no verification is treated as a failed prompt, and if no
check exists, creating one becomes the prompt's first instruction.

For the reasoning behind the skill listing budget, see
[Skill context economy](skill-context-economy.md).

## Before you start

**Requirements.** A ChatGPT plan with projects and file uploads. Web browsing enabled,
since the assistant is instructed to check canonical Anthropic sources before non-trivial
answers. Use the strongest reasoning model available; prompt synthesis degrades
noticeably on cheaper models.

**File limits.** As of 16 July 2026: 5 files on Free, 25 on Go and Plus, 40 on Edu, Pro,
Business and Enterprise. Ten files may be uploaded at once. This setup uses seven.

### The one decision you cannot undo

When you create a project, ChatGPT asks whether its memory is **project-only** or
**default**. This is settable only at creation, and sharing a project forces it to
project-only permanently.

Choose **default**. Project-only isolates the project from everything ChatGPT already
knows about you and your work, which defeats the purpose of the setup. If you have
already created the project with project-only memory, delete it and start again. No
other setting in this guide matters as much.

## Step 1: Create the project

Create a new ChatGPT project. Name it whatever you like. Set memory to **default**, per
above. Leave instructions and files empty for now.

## Step 2: Collect the seven files

Filenames matter. The instructions reference each file by name, so upload them exactly
as named below.

### Two release assets

```bash
gh release download --repo furkankoykiran/.claude \
  --pattern "SKILLS_CATALOG.md" \
  --pattern "skills-catalog.json"
```

Without the `gh` CLI:

```bash
curl -fLO https://github.com/furkankoykiran/.claude/releases/latest/download/SKILLS_CATALOG.md
curl -fLO https://github.com/furkankoykiran/.claude/releases/latest/download/skills-catalog.json
```

`SKILLS_CATALOG.md` is the routing table: every skill with its invocation and
description. `skills-catalog.json` is the same data structured, for exact matching.

Do not download `claude_code_skills.md` or `docs-skills.tar.gz`. They are large and
they degrade retrieval, for the reason given above.

### Four from this repository

```bash
BASE=https://raw.githubusercontent.com/furkankoykiran/.claude/main
curl -fLO $BASE/docs/chatgpt-project/PROMPT-CANON.md
curl -fLO $BASE/docs/chatgpt-project/PROJECTS.md
curl -fLO $BASE/docs/chatgpt-project/PROMPT-LIBRARY.md
curl -fLO $BASE/docs/skills/impeccable/impeccable.md
```

- [PROMPT-CANON.md](chatgpt-project/PROMPT-CANON.md) is the distilled prompt engineering
  canon plus the allowlist of sources the assistant browses. It is the offline baseline
  for when browsing fails.
- [PROJECTS.md](chatgpt-project/PROJECTS.md) is a template. You fill it in at step 5.
- [PROMPT-LIBRARY.md](chatgpt-project/PROMPT-LIBRARY.md) starts empty and becomes the
  feedback loop.
- `impeccable.md` is the quality bar for design and hardening work.

`karpathy-guidelines.md` is deliberately absent. Its upstream is redistributed as
metadata only, so the generated file carries the description rather than the skill body,
and the discipline it encodes already lives in `CLAUDE.md`. See
[Provenance](provenance.md) for what is redistributed in full and what is only pointed at.

### One from your own machine

Your `~/.claude/CLAUDE.md`. This is your configuration, not a file to download. If you
have not written one yet, run `/init` inside Claude Code to generate a starting point,
then prune it before uploading.

## Step 3: Upload

Upload all seven files to the project. Confirm the names survived the upload; a renamed
file is a file the instructions cannot find.

## Step 4: Paste the instructions

Copy [PROJECT-INSTRUCTIONS.md](chatgpt-project/PROJECT-INSTRUCTIONS.md) into the
project's instructions field, in full.

```bash
curl -fL https://raw.githubusercontent.com/furkankoykiran/.claude/main/docs/chatgpt-project/PROJECT-INSTRUCTIONS.md
```

The file is deliberately plain ASCII and sits under the 8,000 character limit with room
to spare. It is written in English even if you converse in another language: it specifies
behaviour drawn from English sources, and translating terms like plan mode, subagent or
context window introduces drift. The instructions tell the assistant to reply in your
language while emitting prompts in English.

Do not upload this file as project knowledge. It belongs in the instructions field.

## Step 5: Fill in PROJECTS.md

This is the step that determines whether the setup is useful or merely tidy.

`PROJECTS.md` holds only what is **not** in `CLAUDE.md` and **not** derivable from a
repository's own files. No stacks, no languages, no package managers, no commit
conventions, no invariants; all of that is already covered. What remains:

- Which repositories are live, one line each on what they are for. ChatGPT has no
  repository access, so these lines are its only routing signal.
- The current goal in each, where you have one.
- **Known friction**: what Claude Code gets wrong repeatedly in your repositories.

The friction section is the highest-value part of the whole setup and the slowest to
fill. Every entry becomes a warning carried into future prompts. It is honest for it to
start empty; add entries as you hit them.

Re-upload the file after editing.

## Step 6: Verify the setup

Run these five prompts. Each targets a specific behaviour, and each has a visible
failure mode, so you can tell a working setup from a plausible-looking one.

**1. Skill discipline.**

> before I open a PR, let's get this change reviewed end to end

Expect at most one leading `/skill-name`, with any others named in prose. Claude Code
parses a single leading slash command and treats the rest of the message as its
arguments, so stacked commands silently fail. A response that stacks two invocations
means the skill rules are not being applied.

**2. Discovery delegation.**

> I don't know where ordering happens in the catalog generator, let's make sure it's
> deterministic

Expect the prompt to delegate the search to a subagent rather than reading files in the
main context, and to recall the determinism constraint from `CLAUDE.md` without being
told: no timestamps, no unordered map iteration, no locale-dependent sorting.

**3. Audit with live sources.**

> audit this prompt: "add a cache to the catalog generator so builds get faster"

Expect three things: the missing verification called out, the risk that caching breaks
deterministic output and fails the drift check, and a `Sources` line with real links
rather than `[canon only]`. Audits are required to browse.

**4. Task splitting.**

> add Windows support to install.sh, speed up the catalog generator, update the README,
> add CI caching, parallelize the tests and cut a release

Expect a refusal to produce one prompt, and a sequence instead, each ending in a verified
state.

**5. Rule precedence.**

> let's hand-fix the broken descriptions under docs/skills, without touching the generator

This deliberately conflicts with a hard rule. Expect the assistant to decline to generate
a hand-editing prompt, explain that the change would be erased by the next build and fail
the drift check, and route to the authoritative source instead. If it produces a
hand-editing prompt, rule precedence is inverted and the instructions need adjusting.

## Using it day to day

Describe what you want in one or two sentences. Do not pre-write the prompt; that is the
assistant's job and it has context you would have to restate.

Correct the assumptions rather than answering questions. The instructions cap
clarification at three questions and push toward stating an assumption and delivering, so
the fastest loop is to let it assume and then correct the one bullet it got wrong.

Type `/fast` to skip browsing when the task is trivial and you want the answer now.

## Maintenance

**After each real session**, append one entry to `PROMPT-LIBRARY.md` and re-upload: what
you asked, whether it worked, and the reusable lesson. This is the only mechanism by
which the setup improves.

**When your skills change**, re-download both catalog assets from the latest release and
replace them. Stale routing tables produce invocations for skills you no longer have.

**When `CLAUDE.md` changes**, re-upload it. It is the authority; a stale copy is worse
than none.

**When the assistant reports an unresolved contradiction** between a live source and
`PROMPT-CANON.md`, refresh the canon. The live source wins by design, but the baseline
should not drift far behind it.

## Troubleshooting

**The instructions are rejected as too long.** The field caps at 8,000 characters. Verify
you copied the file rather than an edited version, and that your editor did not convert
line endings. The published file is plain ASCII specifically so character and byte counts
agree.

**Citation markers appear in generated prompts.** ChatGPT sometimes renders its own
footnote tokens into copied text. The instructions forbid them inside the prompt code
block; if they appear there, re-paste the instructions. Markers in the surrounding prose
are normal and harmless.

**Skills are invoked that you do not have.** The routing table is stale. Re-download both
catalog files from the latest release.

**Answers ignore your conventions.** Confirm `CLAUDE.md` uploaded under that exact name.
If it did, the file is likely too long, and important rules are being lost in the noise.
The pruning guidance in [Getting started](getting-started.md) applies to it directly.

**It asks too many questions instead of delivering.** Check that the instructions were
pasted in full; the clarification cap sits near the end of the file and is easy to lose
to a truncated paste.
