# Release process

One version, one source of release notes, no file to hand-edit.

## The short version for contributors

1. Write a [Conventional Commit](https://www.conventionalcommits.org/) subject:
   `<type>(<scope>): <description>`.
2. If the change breaks something, say so — `feat(x)!: …` or a `BREAKING CHANGE:`
   footer.
3. If your change is user-facing, bump `VERSION`.

That is the whole contract. There is no `CHANGELOG.md` to update, and no
`Unreleased` section to append to.

If you bump `VERSION` too little, CI tells you the exact value to write:

```
xx this range needs a minor bump: VERSION must be at least 0.3.0, but says 0.2.1
   Edit VERSION to 0.3.0 (or higher) and regenerate:
     printf '0.3.0\n' > VERSION && bun run marketplace:generate
```

## Why it works this way

The repository previously kept `CHANGELOG.md` with a permanent `## [Unreleased]`
heading. Every change was supposed to be hand-written into it. Two problems:

- **Nothing consumed it.** The release workflow built its notes from the catalog
  diff and never read the file. There were two release-note sources and only one
  of them shipped.
- **It never ended.** `Unreleased` was never cut, so it grew without bound and
  drifted from what had actually been released.

The commits already carry the information, in a format CI can check. So the
commits are the source, and the GitHub Release is where notes are published.

The historical file is preserved verbatim at
[docs/changelog-archive.md](changelog-archive.md).

## VERSION is the only version

`VERSION` at the repository root feeds three things:

| Consumer | How |
| --- | --- |
| every `plugin.json` | written by `bun run marketplace:generate` |
| every marketplace entry | same generator, same value |
| the release tag | the workflow tags `v$(cat VERSION)` |

They cannot disagree: `bun run marketplace:check` fails when the generated
manifests are stale, and `claude plugin validate --strict` independently fails a
marketplace whose entry version disagrees with the `plugin.json` it points at.

## How notes are built

`catalog/src/release-notes.ts` reads the commits between the previous release tag
and the release commit, and groups them:

| Section | What lands there |
| --- | --- |
| **Breaking changes** | `!` after the type/scope, or a `BREAKING CHANGE:` / `BREAKING-CHANGE:` / `BREAKING:` footer |
| **Security** | type `security`, or a scope containing `security` |
| **Features** | `feat` |
| **Fixes** | `fix` |
| **Dependencies and upstream sources** | scope `deps`/`skills`/`sources`, or type `build` |
| **Other changes** | everything else |

Breaking beats every other rule. A breaking fix is a breaking change first —
filing it under "Fixes" is how upgrade surprises happen.

Two things are reported as properties of the release rather than of a commit:

- **Migrations** — any `migrations/NNNN-*.sh` added in the range, so users know
  what `fkt update` will run.
- **Skill catalog** — added/updated/removed/renamed counts from the catalog diff,
  plus the pinned upstream revisions this release was built against.

Preview the notes for the current branch:

```bash
bun run release:notes -- --previous "$(git describe --tags --abbrev=0)"
```

## The minimum-bump rule

`check-version` computes the lowest version that honestly describes the range:

| Signal | Required bump |
| --- | --- |
| a breaking commit | major |
| a skill invocation removed or renamed | major |
| a `feat` commit, or a skill added | minor |
| anything else that landed | patch |
| nothing | none — no release is cut |

Below `1.0.0`, a "major" bump moves the minor instead, per SemVer §4.

The catalog signals matter because a commit subject cannot be trusted to notice
that an invocation somebody depended on disappeared. The diff can.

## What the workflow does

On every push to `main`, in order:

1. Re-run typecheck, tests, `catalog:check`, `marketplace:check`.
2. Regenerate the catalog and refuse to release if the committed output is stale
   or non-reproducible.
3. Rebuild the catalog diff against the previous **release**, not an empty base.
4. Verify `VERSION` clears the minimum bump for the range.
5. If `v$(cat VERSION)` is already tagged, verify that release is complete and
   uncorrupted, and stop. Otherwise tag it and publish the release with the
   generated notes, the catalog assets, and `SHA256SUMS`.

The workflow never pushes to `main` and never commits generated files, so it
cannot recurse.

## Release assets

Asset names are a compatibility contract and do not change even when files move
in the tree. Every release carries `SHA256SUMS`, and a re-run over an
already-released commit downloads every asset and verifies it byte-for-byte
rather than assuming a filename listing means the upload succeeded.
