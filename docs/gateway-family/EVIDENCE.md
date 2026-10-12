# Evidence

Initial parent HEAD: 44c7c729f7063c9ef86eba4d861cc2370c39078d, clean, one local commit ahead of origin/main. Codex HEAD: 548fa01 (local Penpot continuation fix), clean detached submodule. Gemini HEAD: ee4ff44, clean detached submodule. Paths resolved from .gitmodules.

Neither child had AGENTS.md or CONTRIBUTING.md. Parent AGENTS.md, CONTRIBUTING.md and docs/README.md read before changes. All three repositories now use feat/gateway-family-standardization; sandbox Git metadata is read-only so branch creation used authorized escalation.

Installed JCode: v0.95.0 (6487bbd7e), executable /root/.jcode/builds/versions/0.95.0/jcode. Upstream 1jehuang/jcode reports MIT licensing; inspect pinned source before using architectural ideas. No source copied.

Existing sanitized Penpot evidence is gateways/claude-codex-gateway/docs/penpot-baseline.json, with real Claude-owned execution and a fresh next thread/turn. This is prior evidence, not a fresh acceptance run for this change.

Child PR delivery completed through normal PR merge endpoints after exact-head Gateway CI success:

- Codex PR https://github.com/furkankoykiran/claude-codex-gateway/pull/2; merged SHA 19b64c389fd3ac372b1d54a605c02606430fcd7f.
- Gemini PR https://github.com/furkankoykiran/claude-gemini-gateway/pull/2; merged SHA 228636a3ee77261de99b7ea67a2a147c0b2eb9cf.

The merged child trees were verified identical to the reviewed feature trees before soft-updating local feature-branch refs to the merged commits. No files or index entries were discarded. The parent gitlinks and provider registry now pin these exact merged SHAs. Child default branches had no existing protection; their newly added Gateway CI was checked green before PR merge. No bypass or direct main push was used.

Fresh Codex Penpot acceptance passed with GPT-6.1 Sol/Medium and Claude Code 2.1.296. Real Claude-owned execute_code output contained PENPOT_ALIVE; each of two distinct model-requested tool calls answered its original RPC once on the original thread/turn. The independent MCP_NEXT_TURN_91E4 prompt used a fresh thread/turn with no tools. See the child docs/penpot-acceptance.json. The configured Luna model was initially rejected by an MCP-alias guard introduced during this work; fixing the original/alias map and adding a regression resolved it. Luna was not subsequently revalidated; the successful model-specific claim is Sol only.

Codex final suite: 71 passed, 0 failed, 199 assertions. Gemini final suite: 28 passed, 0 failed, 105 assertions. Frozen installation, documented shell syntax lint, typecheck and ShellCheck passed. No official Gemini/Vertex credentials were available; live Google inference is unproven. Its fixture suite and auth rejection are separate evidence.

Parent canonical suite before final integration changes: 329 passed, 1 skipped, 0 failed. Provider regressions: 139 passed, 0 failed. Hermetic toolkit checks: 161 passed, 0 failed. Installer repository/staging tests: 51 passed, 0 failed. Parent tests will be rerun after pin/configuration/lifecycle updates.

Disposable real Gemini lifecycle acceptance passed: fixture API key/model loaded from provider environment config, repeated activation reused the same process, source/configuration changes restarted only the owned process, and an unrelated PID was rejected/preserved. No Google inference was requested. Standalone child lifecycle tests also preserved unrelated processes on start/status/stop.

Canonical test-command discrepancy resolved in README and catalog CI/release/update validation steps: bun test catalog/tests. Protocol narrative/baseline belongs to the child; toolkit docs retain integration links. No generated artifact was edited directly. No npm or update-distribution behavior was changed.

Final parent verification against the merged child pins passed: frozen Bun installation; typecheck; 329 tests passed, 1 skipped, 0 failed; catalog consistency/determinism; docs check (32 documents); instruction and listing budgets; marketplace check; static skills compatibility (14 passed, 6 explicitly pending live proof, 0 failed). ShellCheck passed across installers, hooks, scripts, migrations and CLI wrappers. Provider tests and the real fixture-only family lifecycle acceptance passed again after integration changes. PowerShell lint and Windows smoke are delegated to the existing required CI jobs because pwsh is unavailable locally. Full installer bootstrap smoke is delegated to CI; local installer repository/staging regressions passed.
