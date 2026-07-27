# Project Context

Upload this file to the ChatGPT project after filling it in. Replace every example below
with your own repositories.

One rule governs this file: it holds only what is **not** in `CLAUDE.md` and **not**
derivable from a repository's own files.

`CLAUDE.md` already owns coding discipline, commit conventions, tool split, verification
gates and per-repository invariants. Claude Code reads the repository itself for stack,
languages, package manager and structure. Repeating any of that here makes both files
worse: the assistant gets two sources for one fact, and they drift.

What is left is what actually belongs here. Which repositories are live right now, what
each one is for in a single line, what you are trying to achieve in it, and the
non-obvious things that bite. ChatGPT has no repository access, so these one-liners are
its only routing signal.

## Format

Only the identity line is required. Add `Goal:` and `Watch out:` when you have something
real to put there. Delete a block once the project goes dormant; a stale block is worse
than a missing one.

```
### <repo> - <what it is, one line>
Goal: <what you are trying to achieve right now>
Watch out: <the non-obvious thing that bites>
```

## Live

Replace these with your own. Two worked examples, one minimal entry:

### example-api - public REST API for the billing service
Goal: cut p99 latency on the invoice endpoint below 200ms.
Watch out: the integration suite needs a live database; it fails silently against the
in-memory fixture and reports green.

### example-cli - installer and update client shipped to end users
Goal: add Windows support without a second code path.
Watch out: the published release asset names are a compatibility contract. Files may
move in the tree; the names may not change.

### example-worker - nightly batch that rebuilds the search index

## Cross-project

Relationships the assistant cannot infer from any single repository. Overlapping
responsibilities, shared contracts, one service that must ship before another.

Example: two of your tools both generate prompts. Record which one owns the final
output, so they do not drift into two competing standards.

## Known friction

The highest-value section in this file, and the one that takes longest to fill.

Record what Claude Code gets wrong repeatedly in these repositories, so every generated
prompt carries the warning up front. Add entries as you hit them. An empty section is
honest until you do.

Example: it edits generated output instead of the generator that produces it, so the
change disappears on the next build and CI fails on the drift check.
