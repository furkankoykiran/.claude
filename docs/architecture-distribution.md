# Distribution and update architecture

Why the toolkit ships the way it does. This is the design record: the decisions,
what they were measured against, and what was rejected.

Claude Code version everything here was verified against: **2.1.220**.

## The problem

The toolkit had one distribution mechanism — a bootstrap script that cloned a
repository into `~/.claude` and copied files around — and it was doing three
jobs badly.

1. **It could destroy your work.** `sync_repo` ran `git reset --hard origin/main`
   against `~/.claude` on every invocation. That directory holds settings,
   memory and provider config. One re-run discarded every tracked local edit,
   silently.
2. **It was not reproducible.** Every upstream pack was cloned at whatever HEAD
   happened to be. Two machines bootstrapped an hour apart got different skills,
   and `skills-source.lock.json` — which recorded reviewed revisions — described
   neither of them.
3. **It was all-or-nothing.** 141 skills landed in `~/.claude/skills/`, every
   description going into the model's context whether you wanted that skill or
   not. Measured: **54,529 characters** of listing metadata.

That last number is the one that turned out to matter most.

## Finding: the skill listing was already being silently truncated

Claude Code injects `name` + `description` for every model-discoverable skill at
session start. That listing has a budget. From the shipped changelog:

> Improved skill description handling: raised the listing cap from 250 to 1,536
> characters and added a startup warning when descriptions are truncated

> Skill character budget now scales with context window (2% of context), so
> users with larger context windows can see more skill descriptions without
> truncation

> Skill-listing truncation is no longer shown as a startup notification — run
> `/doctor` for the full breakdown

So: a global budget of **2% of the context window**, a **1,536-character** cap
per description, and — since the startup warning was removed — **no visible
signal** when it overflows.

Confirmed against a live session on a 1M-token context: descriptions were
included in name order until roughly 20,000 characters were consumed, after
which only descriptions small enough to fit the remainder were kept. 2% of
1,024,000 is 20,480. Roughly fifty skills were listed by **name alone**, with no
description at all — which means the model could not route to them.

At 54,529 characters the toolkit was not "a bit over budget". It was 2.7× over
on a 1M context and **13× over** on the 200k context most users are on, and the
cost was paid by whichever skills sorted late in the alphabet.

This reframed the work. The context problem is not solved by writing shorter
descriptions — it is solved by not installing skills the user did not ask for.

## Decision 1 — repo-owned content becomes plugins; third-party stays fetched

**Chosen.** The eleven skills and four agents this repository owns are five
Claude Code plugins, published by a marketplace manifest at
`.claude-plugin/marketplace.json`. Users install the ones they want.

Third-party packs are **not** republished. They stay installer-fetched, now
pinned to reviewed SHAs.

Why the split falls there:

| Criterion | Repo-owned | Third-party |
| --- | --- | --- |
| Ownership | ours | someone else's |
| Redistribution right | MIT, ours to grant | one pack (`andrej-karpathy-skills`) declares **no licence at all** |
| Update path | plugin auto-update | reviewed lock bump |
| Context cost | opt-in per plugin | opt-in per pack |

Republishing content we have not cleared for redistribution is not a technical
question. `karpathy` alone settles it, and drawing the line at "content we own"
rather than "content whose licence we happen to like today" is the version that
does not need re-litigating every time a source changes its terms.

**Rejected: list third-party packs as marketplace entries with pinned GitHub
sources.** Technically clean — `source: {source: "github", repo, sha}` copies
nothing, so it is a pointer, not redistribution — and four of the packs are
already valid plugins. It would also have moved their context cost behind an
explicit install. Rejected because it publishes other people's work under our
marketplace identity, makes our manifest's validity depend on repositories we do
not control, and creates a support surface where users install "our" plugin and
get someone else's content. Worth revisiting; not worth doing quietly.

## Decision 2 — plugins live at `skills/<name>/`

**Chosen.** Each plugin is a directory under `skills/` carrying
`.claude-plugin/plugin.json`, and the marketplace entries point at those same
directories with relative `./skills/<name>` sources.

This is not a workaround. Claude Code loads any directory under `~/.claude/skills/`
that carries `.claude-plugin/plugin.json` as a `<name>@skills-dir` plugin — it is
what `claude plugin init` scaffolds. Because this repository *is* `~/.claude`,
one layout serves both audiences with **no duplicated files**:

- clone-to-`~/.claude` users get the plugins automatically;
- marketplace users install them from the relative-path sources.

We learned this the hard way first: four upstream packs were being staged as
clones *inside* `skills/`, each shipping a root `plugin.json`, so every skill in
them loaded twice — once bare, once namespaced — competing for the same routing
decision. Staging moved to `.cache/skill-src/`, which Claude Code never scans.

**Rejected: a separate `marketplace/` tree.** Would have required either a second
copy of every skill or a symlink farm, and the clone-to-`~/.claude` install would
have stopped working.

## Decision 3 — `hooks/` stays out of the plugins

**Chosen.** Agents moved into `fk-eng-agents`; hooks did not.

Nothing references an agent file by path, so moving them costs a rename users see
as `fk-eng-agents:researcher`. Hooks are different: existing installs reference
`~/.claude/hooks/*.sh` by absolute path from their own `settings.json`, which is
gitignored and user-owned. We cannot migrate a file we do not track, so moving
the scripts would break every one of those configs with a hook error on the next
session.

This is the "capabilities plugins cannot distribute" bucket, and it is the reason
the bootstrap layer continues to exist at all.

## Decision 4 — `VERSION` is the only version

**Chosen.** One file at the repository root. The generator writes it into every
`plugin.json` and every marketplace entry; the release workflow tags `v$(cat VERSION)`.

This is enforced by the platform, not just by us:

```
plugins[0].version: Entry declares version "9.9.9" but
skills/fk-demo/.claude-plugin/plugin.json says "0.1.0". At install time,
plugin.json wins (calculatePluginVersion precedence) — the entry version is
silently ignored.
```

That is `claude plugin validate --strict` on a deliberately mismatched pair. A
disagreement here is *silently* wrong, which is exactly the class of bug a single
source of truth exists to prevent.

**Rejected: omit `version` and let Claude Code fall back to the commit SHA.**
Unambiguous, and genuinely tempting. Rejected because `claude plugin tag` needs a
version, and "which version am I on" is a question users ask.

**Rejected: keep inferring the tag from the catalog diff.** That is what the repo
did. It cannot work once plugins carry an in-tree version, because the inferred
tag and the committed manifests would disagree. Inference is still used — but
only to compute the *minimum* acceptable `VERSION`, and to fail the release when
the declared one is lower.

## Decision 5 — notification-first updates, refusal over repair

**Chosen.** `bin/fkt` checks, notifies, and applies updates only when asked.
Fast-forward only. It refuses — with the command to inspect the situation —
rather than resolving a dirty worktree or diverged history on the user's behalf.

The precedent studied was gstack's updater, which is the closest thing to a
reference implementation in this tree. What was taken from it: a cached check
with a TTL, an escalating snooze, migrations keyed to a `.done` marker, and
failing open so a broken check never blocks the tool.

What was deliberately **not** taken:

- **`git stash` + `git reset --hard origin/main`.** gstack stashes before
  resetting, which is better than nothing, but it still moves the user's
  checkout somewhere they did not choose and leaves them to find the stash. We
  refuse instead.
- **A telemetry ping.** gstack fires a best-effort analytics call on update
  check. There is none here, and there will not be.

`fkt` also does not check on a schedule of its own. The SessionStart hook reads
the cache — never the network — and detaches the refresh, so startup cannot wait
on DNS. A timing test against an unroutable remote asserts this.

## Decision 6 — the enforced listing budget is 2,048 characters

The budget is a property of the *user's session*, not of this repository. So it
is sized against the smallest window a user is realistically on:

```
2% × 204,800 tokens = 4,096 characters   (a 200k-token context)
```

and then halved, because the toolkit is a guest in a session that also holds the
user's own skills, project skills and other plugins. **2,048 characters.**

Enforced by `bun run catalog:budget` in CI, with a per-plugin and per-skill
breakdown when it fails. Current: **1,974 / 2,048 (96%)**, down from 54,529.

Raising Claude Code's own budget setting was never on the table. It would move
the problem onto the user's context window, which is the thing being conserved.

See [Skill context economy](skill-context-economy.md) for the full measurement.

## What this does not solve

- **Third-party pack context cost is still all-or-nothing per pack.** Installing
  the marketing pack still adds 63 skills and ~33,700 characters to your
  listing. The budget check does not police it, because we cannot fix someone
  else's description length. `CLAUDE_BOOTSTRAP_MINIMAL=1` skips the packs
  entirely; per-pack selection is not implemented.
- **`fkt` cannot repair a broken checkout.** By design. If `~/.claude` has
  diverged, that is a git problem and the user has better tools for it.
- **Nothing here verifies upstream content is safe.** The capability gate reasons
  about surface and provenance, not intent. See
  [Security model](security-model.md).

## Sources

Everything version-specific was verified against the local install rather than
taken from documentation alone.

| Claim | Verified how |
| --- | --- |
| Listing budget is 2% of context; per-description cap is 1,536 | Claude Code 2.1.220 changelog, corroborated against a live 1M-context session |
| `disable-model-invocation: true` hides a skill from the model but keeps `/` | changelog; already in use in this repo before this change |
| `skillOverrides` accepts `off` / `user-invocable-only` / `name-only` | changelog |
| Strict validation rejects a marketplace/plugin version mismatch | ran `claude plugin validate --strict` on a deliberately mismatched pair |
| Strict validation rejects unknown manifest fields | same, with an injected `bogusField` |
| `renames` is accepted in `marketplace.json` | same, with a populated `renames` map |
| A relative `./path` source validates from a marketplace root | same, on the real manifest |
| SessionStart stdout becomes Claude's context; the event cannot block a session | [Claude Code hooks reference](https://code.claude.com/docs/en/hooks) |
| Plugin manifest and marketplace schemas | [plugins reference](https://code.claude.com/docs/en/plugins-reference), [marketplaces](https://code.claude.com/docs/en/plugin-marketplaces) |
| Community Marketplace submission path | [discover plugins](https://code.claude.com/docs/en/discover-plugins) |