# Catalog coverage contract

What "all skills" means for each configured source, and what the automation
will and will not ingest on its own.

Generate the live report:

```bash
bun run catalog:coverage          # markdown
bun run catalog:coverage --json   # machine-readable
```

It is also embedded in every automation PR body and enforced by
`bun run catalog:check`.

## Selection modes

| mode | meaning | new upstream skills |
| --- | --- | --- |
| `all-skills` | every `<dir>/SKILL.md` under the selection root | **ingested automatically** |
| `named` | only the listed directory names | **never ingested** — reported as available-but-unselected |
| `subpath` | exactly one skill at a fixed path | **never ingested** — siblings reported |
| `whole-repo` | the clone is scanned for `<dir>/SKILL.md` | ingested automatically |
| `repo-owned` | skills committed in this repository under `skills/` | n/a |
| `runtime` | resolved by the `claude` CLI / PyPI / an installer script | n/a — metadata only |

## Per source

| source | mode | policy |
| --- | --- | --- |
| `repository` | repo-owned | this repo's own `skills/` tree |
| `gstack` | all-skills (repo root) | tracks upstream automatically |
| `marketing` | all-skills (`skills/`) | tracks upstream automatically |
| `taste` | all-skills (`skills/`) | tracks upstream automatically |
| `manim` | named (3) | curated; new upstream skills are reported, not added |
| `karpathy` | named (1) | curated; no upstream license → metadata-only |
| `anthropic` | named (8) | curated; `claude-api` deliberately skipped (invocation collision) |
| `impeccable` | subpath | one bundled skill |
| `graphify` | runtime (PyPI) | metadata-only; body not reproducible from committed inputs |
| `plugin-marketplaces` | runtime | metadata-only; resolved by the `claude` CLI at runtime |
| `rtk` | runtime (installer script) | metadata-only; a CLI proxy, not a skill body |

## Guarantees

**A selected skill can never silently disappear.** If a name in a `named` or
`subpath` selection resolves to nothing upstream, `catalog:check` fails with the
missing names. Previously the resolver simply produced fewer skills and the
resulting removal auto-merged.

**Curated sources never auto-ingest.** Upstream skills outside a `named` or
`subpath` selection are *reported* under "Observations", never added. Ingesting
them is a deliberate edit to `skills-sources.toml` (and `install.sh`, which
`catalog/src/parity.ts` keeps in lockstep).

**Invocation collisions are fatal.** Two sources claiming the same canonical
invocation fails `catalog:check`.

## Bodies that are not reproducible

`metadata-only` sources publish digest + immutable link only, never the body:
either upstream grants no redistribution licence (`karpathy`, and the
Anthropic skills lacking a per-skill `LICENSE.txt`) or the component is not
file-resolvable at all (`graphify`, `plugin-marketplaces`, `rtk`). These are
listed in the report so the gap is explicit rather than looking like coverage.

## Upstream availability data

`availableSkillDirs` is recorded per source by `catalog:resolve` and is what
makes "available but not selected" answerable offline. A lock written before
this field existed reports `not recorded` rather than falsely reporting zero;
the next scheduled `catalog:resolve --update` populates it.
