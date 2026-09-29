# Repository instructions

This is the live toolkit checkout. Preserve unrelated local work and test
installers in disposable HOME directories. Analysis and review do not authorize
edits. Keep changes scoped to the request; report checks that actually ran.

## Sources and generated files

- Read [docs/README.md](docs/README.md) for the relevant subsystem before changing it.
- Never hand-edit `catalog/generated/**`, `docs/skills/**`, or generated plugin
  manifests. Change their sources and run `bun run catalog:generate`.
- `skills-sources.toml` owns upstream provenance; `marketplace.toml` owns the
  repository plugin inventory; `VERSION` owns the release version. Keep installer
  source declarations in parity with `skills-sources.toml`.
- Keep generation deterministic. Preserve immutable pins, digests, component
  licenses, redistribution decisions, and capability classification.
- Keep `install.sh` and `install.ps1` at the root and preserve published release
  asset names. Installers remain idempotent; optional components fail softly.

## Security and compatibility

- Never commit or print credentials. Preserve safety denies and hooks when
  switching providers. Do not silently fall back to another inference provider.
- Keep capability expansions reviewable. Never bypass required checks, use
  `--admin`, weaken a ruleset, or direct-merge as a fallback. A new
  `SecurityProfile` capability also belongs in `ESCALATION_CAPABILITIES`.
- Preserve the updater's fast-forward-only behavior. Add no toolkit telemetry.
- Shared skill bodies stay canonical. Runtime adapters must not claim that
  Claude hooks, permissions, slash commands, or agents also work in Codex.
- Keep root instructions small. Task-specific guidance belongs in docs or skills.

## Verification and collaboration

Run from the repository root before claiming completion:

```bash
bun install --frozen-lockfile && bun run typecheck && bun test catalog/tests && bun run catalog:check && bun run docs:check
```

Also run `bun run instructions:check` and relevant installer, provider, marketplace, security, and context checks.
Use fixtures for auth tests; live credentials never belong in fixtures. Report
blocked or unrun checks explicitly. Run generation twice to check determinism
when changing generated output.

Read [CONTRIBUTING.md](CONTRIBUTING.md) before committing. Use scoped Conventional
Commits, Git CLI for local operations, and GitHub MCP for collaboration (`gh` is
the fallback). Never add AI attribution to commits or collaboration text. Apply
`skills/fk-writing-kit/skills/humanizer/SKILL.md` to substantial human-facing prose.
