# FAQ

<details><summary><b>Is this an official Anthropic project?</b></summary>

No. It is a community toolkit. It packages Anthropic's published skills
alongside third-party and repository-owned ones. Anthropic's skills keep their
own Apache-2.0 licensing.
</details>

<details><summary><b>Who is it for?</b></summary>

Anyone who wants a reproducible Claude Code setup — skills, agents, hooks and
provider switching — without assembling it by hand. It works as a personal
setup and as a starting point for a team's shared configuration.
</details>

<details><summary><b>Will installing overwrite my existing config?</b></summary>

No. `config.json` and `settings.json` are seeded from `.example` templates only
when they do not already exist. Re-running is safe.
</details>

<details><summary><b>How do I install only part of it?</b></summary>

Use the installer flags — see [Getting started](getting-started.md#installer-flags).
`CLAUDE_BOOTSTRAP_MINIMAL=1` skips the optional heavy components.
</details>

<details><summary><b>Where do skills get installed?</b></summary>

Under `~/.claude/skills/`. Repository-owned skills are committed here; upstream
packs are cloned in by the installer.
</details>

<details><summary><b>Why is a skill missing from the catalog?</b></summary>

Most likely its source uses a **curated** selection and the skill was never
opted into, or it has no `SKILL.md`. Run `bun run catalog:coverage` — curated
sources list exactly which upstream skills exist but are not selected. See
[Catalog coverage](catalog-coverage.md).
</details>

<details><summary><b>Why does a skill show no body in the catalog?</b></summary>

Its source is **metadata-only**: upstream grants no redistribution right, or the
component is not resolvable from files (a PyPI package, a marketplace plugin, a
`curl | sh` installer). The catalog records name, description, digest and an
immutable link instead.
</details>

<details><summary><b>How are upstream changes detected?</b></summary>

A scheduled workflow resolves every source's moving ref to a current SHA, fetches
the pinned SHAs, regenerates, and opens or updates a single automation pull
request. See [Release automation](release-automation.md).
</details>

<details><summary><b>Which changes merge automatically?</b></summary>

Only routine ones, and only after every required check passes. Anything with
capability surface, a removal, a rename, a licence or source-identity change, or
an unusually large batch is left open for review. See
[Security model](security-model.md#the-supply-chain-gate).
</details>

<details><summary><b>How are releases versioned and verified?</b></summary>

The `VERSION` file is the single source of truth — it feeds every plugin
manifest, every marketplace entry and the release tag. CI refuses a release
whose `VERSION` understates what landed, deriving the minimum bump from the
commits plus the catalog diff, and prints the exact value to write. Release
notes are generated from the commits; there is no CHANGELOG. Every release ships
`SHA256SUMS` covering all content assets — see
[Release process](release-process.md) and
[Getting started](getting-started.md#verifying-a-release).
</details>

<details><summary><b>What happens if an upstream repository is unavailable?</b></summary>

Resolution is fail-soft for network errors: the source is skipped with a warning
and the previous pinned revision stays in the lock. Content errors (malformed
skill, path escape, policy violation) fail loudly instead.
</details>

<details><summary><b>Does Windows behave differently from WSL or Git Bash?</b></summary>

Yes. Native PowerShell uses `install.ps1` and needs Git for Windows. WSL and Git
Bash use `install.sh` and behave like Linux. See
[Getting started](getting-started.md#platform-support).
</details>

<details><summary><b>How do I request a new skill or source?</b></summary>

Open an issue describing the upstream repository and its licence. Adding a
source is a deliberate edit to `skills-sources.toml` plus `install.sh`; the two
are kept in lockstep by a parity check.
</details>
