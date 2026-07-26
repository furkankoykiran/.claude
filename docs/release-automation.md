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
4. If nothing changed → exit 0 (no PR, no branch, no comment, no release).
5. Otherwise commit to the dedicated bot branch
   `automation/skills-catalog` (rebuilt from `main` each run; `--force-with-lease`
   is safe on that branch) and open or update **one** PR titled
   `chore(skills): update upstream catalog`.

## Auto-merge policy

- **Routine** policy-compliant changes: squash auto-merge after required checks
  pass.
- **`manual-review-required`** changes (new source, source-URL change, license
  downgrade, executable/binary/secret/hook/MCP introduction, significant
  permission expansion): the PR is labeled `manual-review-required` and left
  open; **never** auto-merged.

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

The App needs **Contents: read/write** and **Pull requests: read/write** on this
repo (fine-grained, scoped to `furkankoykiran/.claude`).

**Without** these, the update workflow still opens a PR using `GITHUB_TOKEN`,
but will **not** auto-merge, and merging that PR will **not** trigger a release.
Auto-merge has therefore not been verified until this is configured.

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