# Provenance and redistribution

Every component the toolkit installs, where it comes from, what licence it
carries, and whether this repository redistributes its content or only points at
it.

Generated facts in this page come from `skills-source.lock.json` and
`catalog/generated/skills-catalog.json`. Regenerate them with:

```bash
bun run catalog:resolve    # re-pin sources (touches the network)
bun run catalog:coverage   # what each source contributes
bun run catalog:check      # parity, digests, licences, determinism
```

## Source inventory

| Source | Type | Licence declared / detected | Redistribution | Skills | Pinned revision |
| --- | --- | --- | --- | --- | --- |
| **repository** (this repo) | repo-owned | MIT | full | 11 | *the commit you have* |
| [gstack](https://github.com/garrytan/gstack) | git | MIT / MIT | full | 53 | `a3259400a366` |
| [manim_skill](https://github.com/adithya-s-k/manim_skill) | git | MIT / MIT | metadata-only | 3 | `cef045011722` |
| [andrej-karpathy-skills](https://github.com/multica-ai/andrej-karpathy-skills) | git | **unknown** / unknown | metadata-only | 1 | `2c606141936f` |
| [marketingskills](https://github.com/coreyhaines31/marketingskills) | git | MIT / MIT | full | 48 | `c21a984a56da` |
| [impeccable](https://github.com/pbakaus/impeccable) | git | Apache-2.0 / Apache-2.0 | full | 1 | `d272b9bd5dcf` |
| [taste-skill](https://github.com/Leonxlnx/taste-skill) | git | MIT / MIT | full | 13 | `e988add20dab` |
| [anthropics/skills](https://github.com/anthropics/skills) | git | Apache-2.0 / unknown | metadata-only | 8 | `b29e7cf65e5c` |
| [graphifyy](https://pypi.org/project/graphifyy/) | runtime | Apache-2.0 | metadata-only | — | *PyPI version* |
| [rtk](https://github.com/rtk-ai/rtk) | runtime | — | metadata-only | — | *installer script* |
| plugin marketplaces | runtime | per-plugin | metadata-only | — | *resolved by the `claude` CLI* |

Revisions are what the **stable** channel installs. `edge` follows upstream
`HEAD` and is not reproducible.

## What the two redistribution levels mean

**full** — the catalog and release assets may carry the skill's body. Upstream
grants that right, the resolver verified the licence text, and the required
licence and notice files travel with the copy.

**metadata-only** — the catalog publishes name, description, digest, source
repository and immutable revision, but **never the body**. You still get the
skill when you install; the toolkit fetches it from upstream on your machine.
What it does not do is republish someone else's text under this repository's
release artefacts.

A source lands in metadata-only for one of three reasons:

- **No licence upstream.** `andrej-karpathy-skills` declares none. No licence
  means no grant, so nothing is republished.
- **Detection disagreed with the declaration.** `anthropics/skills` licenses
  per-skill via `LICENSE.txt` files rather than at the repository root, so the
  resolver cannot confirm Apache-2.0 for the tree and downgrades rather than
  assuming. The skills themselves are Apache-2.0; the conservatism is about what
  *we* republish.
- **It is not resolvable from files.** `graphify`, `rtk` and the plugin
  marketplaces are installed by a package manager, an installer script, or the
  `claude` CLI. There is no tree to digest, so they are recorded honestly as
  runtime components with the reason attached.

The resolver **downgrades automatically**. A source declared `full` whose licence
cannot be verified becomes metadata-only without anyone deciding to be careful
that day.

## What is in the marketplace

`.claude-plugin/marketplace.json` publishes **only** the five repository-owned
plugins. No third-party pack is republished there under this repository's name.

This is a deliberate line, and `andrej-karpathy-skills` is why it is drawn at
"content we own" rather than "content whose licence we like". A pointer-only
marketplace entry (`source: {source: "github", repo, sha}`) copies nothing and
would be defensible, but it publishes someone else's work under our marketplace
identity and makes our manifest depend on repositories we do not control. See
[the architecture record](architecture-distribution.md) for the full reasoning.

Third-party packs therefore stay installer-fetched, pinned to the reviewed SHAs
above.

## Licence and notice files

Where upstream requires attribution, the installer copies it alongside the
skill:

| Source | Files carried |
| --- | --- |
| gstack | `LICENSE` |
| manim_skill | `LICENSE` → `UPSTREAM_LICENSE` beside each skill |
| marketingskills | `LICENSE` |
| impeccable | `LICENSE`, `NOTICE.md` |
| taste-skill | `LICENSE` |

`catalog/tests/license.test.ts` asserts the declared notice files exist in the
committed cache for every source that declares them, so a source cannot quietly
lose its attribution.

This repository's own code is [MIT](../LICENSE). That covers the installer, the
catalog toolchain, the updater, the hooks and the eleven repository-owned skills
— not the upstream content, which stays under its own terms.

## Verifying what you have

Every skill in the catalog carries a content digest computed from the exact bytes
at the pinned revision.

```bash
bun run catalog:check
```

runs parity (the manifest and `install.sh` agree), consistency (every digest
matches the committed cache), coverage (what each source contributes and what is
curated out), policy, and determinism (two generations are byte-identical).

Releases attach `SHA256SUMS` over every asset:

```bash
gh release download <tag> --dir /tmp/check
cd /tmp/check && sha256sum -c SHA256SUMS
```

## Adding a source

1. Declare it in `skills-sources.toml` with its licence, redistribution level and
   the `install.sh` function that installs it.
2. `bun run catalog:resolve` to pin it and detect its licence.
3. Mirror it in `install.sh`. `catalog/src/parity.ts` fails the build if the two
   drift.
4. `bun run catalog:generate` and commit the generated output with the source
   change.

A new source is a supply-chain decision. The capability gate holds it for human
review — see [Security model](security-model.md).