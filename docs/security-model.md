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
values. `CLAUDE.local.md` is seeded once and never touched again — it is where
machine-specific instructions belong, because the tracked `CLAUDE.md` *is*
overwritten by updates. See [Getting started](getting-started.md) for the full
list.

## Updates cannot destroy your work

The installer used to run `git reset --hard origin/main` against `~/.claude` on
every invocation, discarding every tracked local edit without asking. It no
longer does, and a test asserts no code path in `install.sh` runs `reset --hard`
or `clean` against the checkout.

Both the installer and `fkt` fast-forward only. When the worktree is dirty, when
the checkout carries local commits that are not on the target, or when HEAD is
detached, the update **refuses**, explains which, and prints the command to
inspect it. Nothing is stashed, reset or resolved on your behalf.

Applying an update is always explicit. The SessionStart hook only *notifies*;
`fkt update` is what changes anything, and it prompts unless you pass `-y`.

Full behaviour, including channels and migrations, in [Updates](updates.md).

## Capability surface of the plugins

The five marketplace plugins ship **skills and agents only**. None of them
carries a hook, an MCP server, an LSP server, or a `bin/` directory that would
land on the Bash tool's `PATH`.

Everything with capability surface — the hooks, the provider switcher, the
updater, the installer — is in the bootstrap layer, in this repository, where you
can read it before it runs. That split is deliberate: installing a plugin from a
marketplace should not be able to give a third party a shell on your machine.

## Determinism as a security property

On the `stable` channel every third-party source is checked out at the exact
commit SHA recorded in `skills-source.lock.json` — a revision that went through
the review gate. Two machines installing the same release get the same bytes.

This is what makes the content digests meaningful. Previously each pack was
cloned at whatever upstream `HEAD` happened to be, so the lock described a
revision nobody was actually running, and an upstream force-push or a
compromised account would have reached every new install immediately.

If a pinned revision is no longer reachable upstream — the usual cause is a
force-push — the installer says so explicitly and falls back to `HEAD` rather
than failing silently. That is a signal worth investigating before you keep
going.

## Credentials

API keys live in git-ignored files (`providers/*.json`, `config.json`,
`providers/nvidia-gateway.yaml`). Only `*.example` templates are tracked. A
`secret-scan-on-commit` hook checks staged content before it can be committed,
and CI scans the tree.

The catalog resolver flags credential-looking material in skill content and
**never prints a match** — only that one was found.

The updater reads and writes nothing sensitive. Its config
(`~/.config/fk-toolkit/config`) is created mode 600 and holds four non-secret
keys; its state (`~/.local/state/fk-toolkit/`) holds a check timestamp, a snooze
marker, migration markers and a cached copy of the public advisory feed.

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

It also fires when a skill that already carries a severe capability
(credential reference, executable, hooks, MCP/LSP, agents) has its **content
rewritten** — no capability goes false-to-true in that case, so escalation alone
would call it routine — and when files appear or disappear beside `SKILL.md`,
which the content digest does not cover.

Detection does not depend on the content digest: the same bytes re-pointed at a
different repository, relocated, or re-licensed is still a change. See
[Release automation](release-automation.md#what-forces-manual-review).

**What this gate is not.** It reasons about capability surface and provenance,
not intent. A rewritten body in a skill carrying no severe capability merges as
routine, and heuristic secret detection can miss things. It raises the cost of a
supply-chain attack and makes provenance auditable; it is not a guarantee that
merged content is safe.

Auto-merge state is torn down and re-proven on every run, so a merge request
enabled by an earlier routine update cannot survive into a later
security-sensitive one.

## Third-party sources and licensing

Each source declares a licence in [`skills-sources.toml`](../skills-sources.toml)
and the resolver verifies it against the upstream `LICENSE`. When a source
grants no redistribution right, it is downgraded to **metadata-only**: the
catalog records the name, description, digest and an immutable upstream link,
and the body is not republished. See
[Catalog coverage](catalog-coverage.md) and [Provenance](provenance.md) for the
full inventory.

The marketplace publishes **only** repository-owned plugins. No third-party pack
is republished under this repository's name — one of them declares no licence at
all, and drawing the line at "content we own" is the version that does not need
re-deciding every time a source changes its terms.

Upstream projects retain their own licences. This repository's own code is MIT
(see [LICENSE](../LICENSE)); vendored and cataloged content is not.

## Security advisories

`security-advisories.tsv` in this repository is a tab-separated feed matched
against your installed `VERSION` by `fkt`. It is fetched from the default branch,
so an advisory reaches installs pinned to an old release.

Two properties matter:

- **It survives `fkt disable`.** Turning off update notifications should not turn
  off "the version you are running has a known problem". Silence it separately
  with `fkt config security_notices false`.
- **It collects nothing.** One GET of one static file. No identifiers, no version
  reported upstream, no endpoint of ours. The matching happens on your machine.

A response that is not a well-formed feed — a captive portal, an error page — is
rejected rather than installed over a good cache, so a hostile or broken network
cannot silently blind the check.

## Reporting a vulnerability

See [SECURITY.md](../SECURITY.md). Please do not open a public issue for
security reports.

## What this does not claim

- Skills are not sandboxed or audited line by line.
- Secret detection is heuristic; it gates review, not merge.
- Metadata-only sources are still fetched at install time by `install.sh`;
  metadata-only governs republication in the catalog, not local installation.
- Pinning proves you got the revision that was reviewed. It does not prove the
  revision was safe — the gate reasons about capability surface and provenance,
  not intent.
- `fkt` refusing to destroy your work is a property of `fkt`. Any other tool you
  point at `~/.claude`, including plain `git`, has its own rules.
