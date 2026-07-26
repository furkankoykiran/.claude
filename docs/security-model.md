# Security and trust model

What this toolkit can touch, what it deliberately cannot, and what you are
trusting when you install it.

## What you are trusting

Installing runs a shell script from this repository and clones several
third-party skill repositories onto your machine. Skills are Markdown
instructions that Claude Code reads — they are not sandboxed, and a skill can
tell Claude to run commands. Treat adding a source the same way you would treat
adding a dependency.

This is **not an official Anthropic project**. It is a community toolkit that
packages Anthropic's published skills alongside third-party and repository-owned
ones.

## What the installer touches

Everything is confined to `~/.claude` (or `$CLAUDE_DIR`) plus the tool
installations it bootstraps. It never writes outside your home directory, never
requires `sudo`, and never uploads anything.

Existing files are preserved: `config.json` and `settings.json` are seeded from
`.example` templates **only when absent**, so re-running never overwrites your
values. See [Getting started](getting-started.md) for the full list.

## Credentials

API keys live in git-ignored files (`providers/*.json`, `config.json`,
`providers/nvidia-gateway.yaml`). Only `*.example` templates are tracked. A
`secret-scan-on-commit` hook checks staged content before it can be committed,
and CI scans the tree.

The catalog resolver flags credential-looking material in skill content and
**never prints a match** — only that one was found.

## The supply-chain gate

Upstream skill updates arrive through an automated pull request. Routine
changes can squash auto-merge after required checks pass; anything carrying
capability surface is labelled `manual-review-required` and left for a human.

A change requires review when it adds a skill with any capability (credential
reference, executable or binary, hooks, MCP/LSP, agents, dynamic shell,
Bash/PowerShell, network access, hidden files), when an existing skill *gains*
one, when the tool surface grows, when redistribution or licence changes, when
the source repository changes, when a skill is removed or renamed, or when the
batch exceeds a documented threshold.

Detection does not depend on the content digest: the same bytes re-pointed at a
different repository, relocated, or re-licensed is still a change. See
[Release automation](release-automation.md#what-forces-manual-review).

Auto-merge state is torn down and re-proven on every run, so a merge request
enabled by an earlier routine update cannot survive into a later
security-sensitive one.

## Third-party sources and licensing

Each source declares a licence in [`skills-sources.toml`](../skills-sources.toml)
and the resolver verifies it against the upstream `LICENSE`. When a source
grants no redistribution right, it is downgraded to **metadata-only**: the
catalog records the name, description, digest and an immutable upstream link,
and the body is not republished. See
[Catalog coverage](catalog-coverage.md).

Upstream projects retain their own licences. This repository's own code is MIT
(see [LICENSE](../LICENSE)); vendored and cataloged content is not.

## Reporting a vulnerability

See [SECURITY.md](../SECURITY.md). Please do not open a public issue for
security reports.

## What this does not claim

- Skills are not sandboxed or audited line by line.
- Secret detection is heuristic; it gates review, not merge.
- Metadata-only sources are still fetched at install time by `install.sh`;
  metadata-only governs republication in the catalog, not local installation.
