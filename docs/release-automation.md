# Release Automation

How the Skills Catalog is updated, merged, versioned, and released. The
implementation reference for the three workflows under
[`.github/workflows/`](.github/workflows/).

## Workflows

| workflow | trigger | purpose |
| --- | --- | --- |
| [`ci.yml`](.github/workflows/ci.yml) (`catalog` job) | `push: main`, `pull_request`, `workflow_dispatch` | offline validation: typecheck, tests, parity, consistency, determinism, staleness guard |
| [`skills-catalog-update.yml`](.github/workflows/skills-catalog-update.yml) | daily cron `17 6 * * *` + `workflow_dispatch` | network: advance upstream refs, regenerate, validate, open/update one automation PR, (auto-)merge |
| [`skills-catalog-release.yml`](.github/workflows/skills-catalog-release.yml) | `push: main` (never tags) | re-validate, compute next SemVer, tag the commit, publish the GitHub Release with assets |

## Update policy (the automation PR)

1. `catalog:resolve --update` resolves every moving ref (`origin/HEAD`) to its
   current SHA via `git ls-remote` (no clone), then fetches only the pinned
   SHAs into isolated worktrees.
2. `catalog:generate` regenerates the catalog, lock, cache, and diff.
3. Full validation runs (typecheck, tests, `catalog:check`).
4. A single change-detection step records `changed=true|false`; every mutating
   step is gated on it, so a run with nothing to ship ends as a successful
   no-op (no branch, no PR, no token, no release).
5. Otherwise commit to the dedicated bot branch
   `automation/skills-catalog` (rebuilt from `main` each run; `--force-with-lease`
   is safe on that branch) and open or update **one** PR titled
   `chore(skills): update upstream catalog`.

`workflow_dispatch` with `dry_run=true` stops after step 4: it resolves,
validates, classifies, and reports, and never reaches a step that mints an App
token, commits, pushes, opens a PR, or merges.

## Auto-merge policy

- **Routine** policy-compliant changes: squash auto-merge after required checks
  pass (`gh pr merge --squash --auto`). Never `--admin`, never a ruleset bypass,
  and no direct-merge fallback — if auto-merge cannot be enabled the step fails
  and the PR stays open.
- **`manual-review-required`** changes: the PR is labeled and left open;
  **never** auto-merged.

### What forces manual review

Classification runs against `HEAD:skills-catalog.json` — the catalog as it
stands on `main` — not against the committed `skills-catalog-diff.json`, which
is generated against an empty base and would mark everything as new. The
verdict, the PR body, and the merge decision all read that one diff.

| change | requires review when |
| --- | --- |
| **added** skill | it carries *any* capability: credential reference, executable/binary, hooks, MCP/LSP, agents, dynamic shell, Bash/PowerShell, network access, hidden files |
| **updated** skill | a capability was **absent before and present now**, the allowed-tools surface grew, redistribution was downgraded, the detected license changed, or the source repository changed (including appearing/disappearing) |
| **removed** skill | always |
| **renamed** skill | always — the public invocation changed |
| any batch | more than `MASS_CHANGE_THRESHOLD` (25) changed entries |

Escalation compares against the **persisted** previous `security` profile. It
used to rebuild that profile from frontmatter with an empty body and empty file
list, which made every body-derived capability (network, dynamic shell,
executables) look newly introduced on every edit — so every PR was
manual-review and the signal was worthless. A capability that was already
present is not an escalation; only `false -> true` counts.

For catalogs written before `security` was persisted there is a documented
fallback that reconstructs a partial profile from frontmatter. It under-reports,
so it over-escalates — it fails safe.

The gate is covered by `catalog/tests/review-policy.test.ts`, which asserts both
directions: every capability escalates when newly introduced, and no capability
re-escalates when it was already there.

Auto-merge only *waits* for checks that `main` actually requires. With no
required status checks configured, GitHub reports the PR as immediately
mergeable and `--auto` merges it straight away. Configure required checks (see
below) if the CI gate is meant to be binding.

## Authentication — one-time setup (requires the repository owner)

Full automation needs a **GitHub App** so that automation PRs trigger required
checks and the resulting merge triggers the release workflow. `GITHUB_TOKEN`
cannot do this: pushes/merges made with `GITHUB_TOKEN` do **not** trigger
downstream workflows.

Configure (repo Settings → Secrets and variables → Actions):

| item | kind | value |
| --- | --- | --- |
| `ENABLE_SKILLS_AUTOMATION` | repository **variable** | `true` |
| `AUTOMATION_APP_ID` | repository **secret** | the GitHub App ID |
| `AUTOMATION_APP_PRIVATE_KEY` | repository **secret** | the App's private key |

The App needs **Contents: read/write** and **Pull requests: read/write** on
this repo (fine-grained, scoped to `furkankoykiran/.claude`).

**Issues: write is not automatically required for labels.** Label endpoints are
issue endpoints, but run `30195036275` created this repo's
`manual-review-required` label using `GITHUB_TOKEN` whose `permissions:` block
was `contents` + `pull-requests` only, with no `issues` scope. The update
workflow therefore *probes* the label-write path in its preflight step and
reports the result in the job summary rather than assuming. Grant
**Issues: read/write** only if that preflight reports `denied`.

Also enable, in repo Settings → General → Pull Requests:

- **Allow squash merging**
- **Allow auto-merge** — required for `gh pr merge --auto`; without it the
  auto-merge step fails.

**Without** the App credentials the update workflow still resolves, validates,
and reports, but makes **no** changes: it does not commit, push, open a PR, or
merge, and it logs a warning instead. `GITHUB_TOKEN` is deliberately not a
fallback — Actions is not permitted to create pull requests in this repo, and
pushes or merges made with `GITHUB_TOKEN` do not trigger the required checks or
the release workflow.

### Recommended branch protection (owner action)

To gate auto-merge on required checks (so a routine PR only merges once CI is
green), enable on `main`:

- Require status checks to pass: `Skills catalog (generate + check)`,
  `Lint shell scripts`, and any others you rely on.
- Require pull request reviews (≥1) for non-bot branches; exempt
  `automation/skills-catalog` if you trust the policy gate.
- Allow squash merges; do **not** weaken existing protection to make automation
  pass.

These are **recommendations**, not requirements the workflows enforce — the
workflows never weaken branch protection.

## Semantic versioning

Source of truth is **git tags** (there is no tracked version file). Rules:

- No prior tags → **`v0.1.0`** (initial release).
- `release:major` / `release:minor` / `release:patch` PR label overrides
  inference (exactly one allowed; conflicting labels error).
- Removed/renamed public invocation or schema break → **major** (collapses to
  **minor** while below `1.0.0`).
- Added public skill / new backward-compatible capability → **minor**.
- Updated body/metadata/sha/doc/resolver fix → **patch**.
- No catalog change → no release.

The release workflow reads the previous tag's `skills-catalog.json` as the diff
base, infers the bump, computes the next tag, and tags the **exact** main commit.

## Release assets

Every release attaches: `claude_code_skills.md`, `SKILLS_CATALOG.md`,
`skills-catalog.json`, `skills-source.lock.json`, `skills-catalog-diff.json`,
`catalog-change-report.md`, `SHA256SUMS`, and a `docs-skills.tar.gz` bundle of
the full per-skill pages. `claude_code_skills.md` is directly downloadable from
every release. Verify locally:

```bash
gh release download <tag> --pattern 'claude_code_skills.md' --dir /tmp/check
sha256sum -c SHA256SUMS   # after downloading all assets
```

## Recursion safety

- The release workflow triggers on `push: main`, **never** on tags.
- It tags + releases only — it never commits to `main`, so it cannot retrigger
  itself.
- `GITHUB_TOKEN` pushes don't trigger workflows (built-in safeguard); the
  App-merged update PR **does** trigger the release workflow (intended chain:
  update PR → merge → push main → release).

## Idempotency

If the exact `main` commit already has the intended tag, the release workflow
verifies the required assets exist and exits successfully. Tag creation
re-fetches tags immediately before writing and refuses collisions.

## Rollback / recovery

- A bad release: delete the tag + release (`gh release delete <tag>`; `git push
  origin :refs/tags/<tag>`) and cut a corrective release from an earlier commit.
- Stale generated files reaching `main`: the release workflow refuses to
  release and the CI `catalog` job fails. Open a recovery PR running
  `bun run catalog:generate`. **Never** mutate protected `main` directly.

## Troubleshooting

| symptom | fix |
| --- | --- |
| `missing cache snapshot for X @ <sha>` | run `bun run catalog:resolve` and commit the updated cache + lock |
| `installer/manifest parity FAILED` | align `skills-sources.toml` with (or) `install.sh` |
| `generation is not deterministic` | a new nondeterministic input reached the generator; check for timestamps / unordered maps |
| release workflow did not fire after merging the update PR | App credentials not configured; merges via `GITHUB_TOKEN` don't trigger workflows |
| auto-merge did not fire | `ENABLE_SKILLS_AUTOMATION`/App not configured, or the change was `manual-review-required` |
| `Auto-merge is not allowed for this repository` | enable **Allow auto-merge** in repo settings |
| the PR merged before CI finished | `main` has no required status checks, so GitHub considered the PR immediately mergeable |
| upstream changed but nothing was pushed | `ENABLE_SKILLS_AUTOMATION` is not `true`; the run logs a warning and exits successfully |