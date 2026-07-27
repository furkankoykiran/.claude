# Community Marketplace submission

Preparation and checklist for submitting `fk-toolkit` to Anthropic's Claude Code
plugin community marketplace.

**Nothing here has been submitted.** This is the prepared material and the
verification that must pass first. Submission is an outward-facing, hard-to-undo
action and needs an explicit decision by the repository owner.

## What the submission is

Approved plugins are listed in
[`anthropics/claude-plugins-community`](https://github.com/anthropics/claude-plugins-community),
pinned to a specific commit SHA of the submitted repository, with the pin
advanced automatically as new commits land. Users add it with:

```
/plugin marketplace add anthropics/claude-plugins-community
/plugin install <name>@claude-community
```

Submission runs the same validation we run locally, plus automated safety
screening. There are two forms and both lead to the same catalogue:

| You are | Form |
| --- | --- |
| an individual author | <https://platform.claude.com/plugins/submit> |
| a Team/Enterprise org owner | <https://claude.ai/admin-settings/directory/submissions/plugins/new> |

This is separate from `claude-plugins-official`, which is curated by Anthropic at
their discretion and has no application process.

## Pre-submission checklist

Run this in order. Everything must pass.

### Identity

- [x] Marketplace name `fk-toolkit` is not on Claude Code's reserved list — the
      generator [enforces this](../catalog/src/marketplace.ts) and fails the
      build if a rename ever lands on one.
- [x] No plugin name, description or manifest field implies an Anthropic
      affiliation.
- [x] README states plainly that this is not an official Anthropic project.
- [x] Owner name and URL are real and resolve.

### Validation

- [ ] `bun install --frozen-lockfile`
- [ ] `bun run typecheck`
- [ ] `bun test catalog`
- [ ] `bun run catalog:check`
- [ ] `bun run marketplace:check`
- [ ] `bun run catalog:budget`
- [ ] `bun run docs:check`
- [ ] `bun run marketplace:validate` — `claude plugin validate --strict` over the
      marketplace and every plugin
- [ ] `./scripts/test-fkt.sh`
- [ ] `./scripts/test-providers.sh`
- [ ] `shellcheck install.sh hooks/*.sh scripts/*.sh migrations/*.sh bin/cc-provider bin/fkt`

### Content

- [ ] Every plugin's `description` says what it does without marketing language.
- [ ] Every skill's `description` carries real routing signal and is inside the
      1,536-character per-skill cap.
- [ ] `bun run catalog:budget` is within budget, so no user's listing is silently
      truncated by installing this.
- [ ] No plugin ships a credential, token, or absolute developer-machine path.
- [ ] Licence and attribution files travel with anything redistributed — see
      [Provenance](provenance.md).

### Security posture

- [ ] [Security model](security-model.md) and [SECURITY.md](../SECURITY.md) are
      current.
- [ ] Capability surface is declared: which plugins ship hooks, executables, or
      network access. Currently: **none of the five plugins ships a hook, an MCP
      server, or a `bin/`**. The hooks and the updater are bootstrap components
      and are not part of any plugin.
- [ ] No telemetry. Confirm with:
      `grep -rn "analytics\|telemetry\|posthog\|segment\|mixpanel" bin/ hooks/ skills/fk-*/`

### Release state

- [ ] `VERSION` matches the release you want pinned.
- [ ] That version is tagged and has a published GitHub Release with
      `SHA256SUMS`.
- [ ] CI is green on `main`.

## Submission text

Prepared copy, so the submission matches the repository rather than being
improvised into a form field.

**Marketplace name:** `fk-toolkit`

**Display name:** FK Claude Toolkit

**Repository:** <https://github.com/furkankoykiran/.claude>

**Short description**

> Deterministic, provenance-audited Claude Code plugins: GitHub workflow
> automation, writing tools, narrated Manim video, and engineering subagents.
> Every skill is pinned to a reviewed commit, licence-checked, content-digested,
> and measured against the model's skill-listing context budget.

**Longer description**

> Five focused plugins, split so you install only what you want and pay context
> for only what you installed.
>
> - **fk-gh-flow** — find issues worth working on, solve one into a pull request,
>   follow up on review feedback, and write comments that read like a human wrote
>   them.
> - **fk-writing-kit** — strip AI tells from drafts, and build blog posts or
>   LinkedIn copy from a chat, a URL, or a GitHub profile.
> - **fk-manim-video** — Manim animations with spoken narration synced to the
>   animation, via edge-tts and ffmpeg.
> - **fk-eng-agents** — researcher, planner, code-reviewer and debugger
>   subagents. No skills, so no skill-listing context cost at all.
> - **fk-toolkit-ops** — wire an MCP server from a pasted config block; manage
>   toolkit updates.
>
> What is unusual about it: the whole toolkit's model-visible skill listing is
> measured and CI-enforced at 2,048 characters — half of what a 200k-token
> context allows — because Claude Code silently drops descriptions past its
> budget and unroutable skills are worse than absent ones. Every third-party
> source is pinned to a reviewed commit SHA with its licence verified and its
> content digested. Nothing collects telemetry.

**Categories:** `productivity`, `content`, `media`, `development`

**Keywords:** `github`, `issues`, `pull-requests`, `code-review`, `writing`,
`editing`, `manim`, `video`, `subagents`, `mcp`, `provenance`

## After approval

The community catalogue pins a commit SHA and advances it as commits land, so:

- `main` must stay releasable — a broken `main` becomes a broken listing;
- a breaking change reaches listed users without an explicit action from them,
  so it must go through `VERSION`, the release notes and a migration where the
  change is not backward-compatible;
- the [security advisory feed](updates.md#security-advisories) is the channel for
  anything users need to know about a version they are already on.

## What will not be submitted

Third-party packs. They are not ours to publish, one declares no licence at all,
and the toolkit installs them from upstream rather than republishing them. See
[Provenance](provenance.md).