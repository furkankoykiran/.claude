# Skills Catalog Architecture

This document describes how the Skills Catalog discovers, resolves, validates,
and publishes every Claude Code skill represented by `furkankoykiran/.claude`.
It is the reference for the resolver's discovery rules, source model, lock
behavior, canonical naming, security policy, licensing policy, deterministic
generation, and failure modes.

The implementation lives in [`catalog/src/`](../catalog/src/). Commands are
defined in [`package.json`](../package.json); the source-of-truth manifest is
[`skills-sources.toml`](../skills-sources.toml).

## Overview

The catalog is a **pure function of committed inputs**:

```
skills-sources.toml  ─┐
skills-source.lock.json ─┼─► resolver ─► generator ─► catalog/generated/{SKILLS_CATALOG.md,
catalog/cache/        ─┤                  claude_code_skills.md, skills-catalog.json, SHA256SUMS}, docs/skills/*
skills/ (repo-owned)  ─┘
```

Two consecutive `bun run catalog:generate` runs produce **byte-identical**
output: stable ordering, recursively-sorted JSON keys, LF line endings, and no
wall-clock timestamps anywhere. Generation runs **offline** (no network) from
the committed lock + cache; only `catalog:resolve` (and `--update`) touch the
network.

## Discovery model

Sources are declared in `skills-sources.toml` as pure data (no executable
logic). Three source types:

| type | meaning | resolvable? |
| --- | --- | --- |
| `git` | Cloned upstream skill pack | yes — to an immutable SHA |
| `repo-owned` | Skills committed in this repo under `skills/` | yes — from the working tree |
| `runtime` | PyPI package / plugin marketplace / curl installer | **no** — recorded honestly as metadata-only |

`install.sh` is **not** refactored to read the manifest (a disproportionate,
risky rewrite of a carefully-tuned fail-soft script). Instead
[`catalog/src/parity.ts`](../catalog/src/parity.ts) parses `install.sh`'s own
source declarations and asserts they match the manifest, so the two can never
silently drift. This parity test runs in `catalog:check` and in CI.

### Git selection rules

A git source selects which skill directories to copy out of the clone, mirroring
`install.sh` exactly:

- `all-skills` (root) — every `<root>/<dir>/SKILL.md` (`root=""` = the repo
  itself, e.g. gstack's flat layout).
- `named` (root, names) — an explicit list (e.g. manim's three skills).
- `subpath` (path, dest) — one skill at a custom path (e.g. impeccable's
  `.claude/skills/impeccable`).
- `whole-repo` — scan the whole clone for `<dir>/SKILL.md`.

## Claude Code canonical naming

Derived from current official docs:

- **Personal** `~/.claude/skills/<dir>/SKILL.md` → `/<name>`.
- The frontmatter `name` field overrides the directory-derived final segment.
- `name` must be ≤64 chars, lowercase/digits/hyphens, and must not contain the
  reserved words `anthropic`/`claude`.
- **Plugin** skills are always namespaced `/<plugin>:<skill>`. The file-copied
  upstream packs in this repo become personal-scope (bare `/<name>`); the
  runtime plugin-marketplace source records its expected `/<marketplace>:<plugin>`
  namespace pattern.
- Duplicate canonical invocations and case collisions (`/Foo` vs `/foo`) are
  detected and reported as warnings.

## Lock snapshot

[`skills-source.lock.json`](../skills-source.lock.json) records, for every
source and skill: configured ref, resolved immutable SHA, repository URL,
selected paths, canonical skill names, per-skill SHA-256 digests, license
metadata, and resolver version. It contains **no timestamps** and **no skill
bodies** — it is a reviewable summary.

The committed content snapshot lives under
[`catalog/cache/<sourceId>/<sha>/`](../catalog/cache/): a `.snapshot.json` with
parsed frontmatter (always) and the skill body (only when redistribution is
`full`), plus the upstream `LICENSE`/`NOTICE` verbatim for attribution.

- Release installs use **locked immutable revisions**.
- The scheduled updater ([`skills-catalog-update.yml`](../.github/workflows/skills-catalog-update.yml)) is the only process that advances tracked refs.

## Parser

[`catalog/src/parser.ts`](../catalog/src/parser.ts):

- Strict UTF-8 decode (rejects invalid bytes → actionable error).
- CRLF/CR normalized to LF.
- Explicit frontmatter boundary detection (no regex guessing); unterminated
  frontmatter fails with a diagnostic.
- YAML parsed via the `yaml` library with a `LineCounter`, so malformed YAML
  reports `file:line`. Unknown frontmatter fields are **preserved**, not dropped.
- Never executes anything: `` `!cmd` `` dynamic context is detected as data,
  not run.

### Digest (documented canonicalization)

1. Decode bytes as strict UTF-8.
2. Normalize line endings to LF.
3. Strip one trailing newline.
4. `digest = sha256(canonical UTF-8 bytes)` (lowercase hex).

## Licensing & redistribution

Supply-chain rule: we only republish a skill **body** when the upstream license
is permissive (MIT, Apache-2.0, ISC, BSD, MPL-2.0, …) **and** the manifest
declares `redistribution = "full"`. License is detected from the upstream
`LICENSE` and **per-skill** `LICENSE.txt` (e.g. `anthropics/skills`). When a
license is absent, unclear, copyleft, or does not permit redistribution, the
entry is downgraded to **metadata-only** (digest + immutable link + provenance),
and the reason is recorded. This is fail-safe: when in doubt, omit the body.

| source | detected license | redistribution |
| --- | --- | --- |
| repository (this repo) | MIT | full |
| gstack | MIT | full |
| manim | MIT | full |
| marketing | MIT | full |
| taste | MIT | full |
| impeccable | Apache-2.0 | full |
| anthropic (curated) | per-skill Apache-2.0 / unknown | full where LICENSE.txt present, else metadata-only |
| karpathy | **none** | metadata-only |
| graphify, plugin-marketplaces, rtk | n/a (runtime) | metadata-only |

## Security analysis

Skill updates are treated as software supply-chain changes.
[`catalog/src/security.ts`](../catalog/src/security.ts) builds a profile per
skill covering: bash/PowerShell tools, dynamic `!` shell context, hooks,
MCP/LSP, agents, network access, credential references, hidden files, and
executables/binaries. Secret detection runs but **never prints the secret** —
only that one was found.

A change is classified **manual-review-required** (no auto-merge) when it
introduces: a new upstream source, a source URL change, a license downgrade, an
unexpected executable/binary, a secret, a symlink escape, a malformed manifest,
a hook/MCP/agent introduction, or a significant permission expansion. Routine
content updates may auto-merge after required checks pass. See
[`docs/release-automation.md`](release-automation.md).

## Resolver safety invariants

- Isolated temp dir + temp `HOME`; no system/global git config
  (`GIT_CONFIG_NOSYSTEM=1`, `GIT_CONFIG_GLOBAL=/dev/null`).
- Hooks disabled (`core.hooksPath=/dev/null`), LFS skipped, submodules off.
- Only immutable SHAs are checked out in normal (locked) mode; moving refs are
  resolved with `git ls-remote` (no clone) in update mode.
- All network calls are bounded by a timeout.
- Symlink cycles and path traversal outside an approved root are detected and
  rejected.
- **Network** failures are fail-soft (repo moved, fetch timeout); **content**
  failures (malformed YAML, security policy) fail loud.

## Deterministic generation & atomicity

[`catalog/src/generate.ts`](../catalog/src/generate.ts) builds every output into
a **staging dir first**; only after the full build succeeds does it swap the
result into place (replacing `docs/skills/` wholesale to drop stale pages). A
failure leaves committed outputs untouched. Output ordering, JSON key order,
whitespace, and line endings are stable.

## Failure modes

| condition | behavior |
| --- | --- |
| missing cache snapshot for a locked SHA | `catalog:generate` errors: run `catalog:resolve` |
| malformed YAML / unsafe path / duplicate command | hard fail with `file:line` |
| secret in repo-owned content | hard fail (policy) |
| upstream network failure | warn + skip that source (resolve mode); never a partial catalog write |
| stale committed generated files | CI `catalog` job fails; release workflow refuses to release |