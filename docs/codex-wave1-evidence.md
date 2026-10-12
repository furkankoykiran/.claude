# Codex gateway Wave 1 evidence

Recorded 2026-10-12. Claude Code 2.1.296, Bun 1.3.8, Codex App Server,
`gpt-6.1-sol`, Medium reasoning. The root checkout and gateway submodule were
clean before work. No publishing, push, release, npm, or updater changes were made.

## Root causes and changes

Claude Code's streaming input merges a previous tool result and the next user
instruction into one user message. The gateway treated the old result as a
continuation, sent empty input, and lost the current instruction. Both the tool
and timeout live probes reproduced this failure before the fix.

Current actionable text now takes priority. Only text blocks from the current
user request become inference input. A result-only request must match a pending
tool ID and its session. Consumed, abandoned, and completed routes cannot be
reused. Request metadata cannot select an old App Server thread. Fresh threads
receive system context and current user text without replaying completed turns.

A separate Auto classifier request shares the Claude session while the main
tool is pending. A session-wide route cleanup introduced during this work
failed the final Auto canary. A new deterministic test reproduced it before
the correction: 50 passed, 1 failed. Cleanup now retires only structured tool
results present in the current request, preserving independent classifier
requests and their pending main tools. The final Auto run passed.

The event router also assigned unknown or completed turn events to the newest
pending request. Deterministic tests reproduced contamination after completion,
failure, and interruption. Routing now requires the originating thread and turn;
unidentified and late events cannot complete a newer request.

The historical `Unsupported Anthropic message role at index 3` error reproduces
from submodule commit `c6d93a8` with a mid-conversation system message. The pinned
submodule already contains `4450ce7`, which accepts that role and folds it into
system context. The fixture now covers index 3 with a current user request.

## Auto

The toolkit generated `behavesAs: claude-sonnet-4-5` for every picker row.
Claude Code excludes Sonnet 4.5 from Auto, so even `--permission-mode auto`
started the GPT-6.1 Sol probe in Manual (`permissionMode: default`).

The supported `modelPicker.options[].behavesAs` setting applies a known model's
capabilities without changing the label or transmitted model ID. Mapping only
GPT-6.1 Sol to Sonnet 4.6 enabled upstream `permissionMode: auto`. The toolkit
refresh function now generates that mapping for this verified model. The
installation's existing GPT-6.1 Sol rows in `settings.json` and
`providers/codex.json` were updated; other local settings and model defaults were
preserved. These files are ignored local configuration.

The stronger Auto probe used no Bash allow rule or permission bypass. It retained
the base permission denies, ran a Claude-owned PreToolUse hook, and requested a
Python command that wrote `auto-proof.txt` in the scratch working directory.
Claude Code emitted `permission_check_status`, returned a successful tool result,
and replied `AUTO_DONE_5A11`. The file contains `AUTO_TOOL_5A11`; the hook artifact
contains `PRE_TOOL_5A11`.

Claude Code remains the permission and execution owner. App Server turns retain
`approvalPolicy: never`, `approvalsReviewer: user`, and a read-only sandbox with
network access disabled. There is no Auto-to-`bypassPermissions` translation.

Official references:

- [Custom picker capabilities](https://code.claude.com/docs/en/settings-reference#modelpicker)
- [Auto eligibility and classifier](https://code.claude.com/docs/en/permission-modes#eliminate-prompts-with-auto-mode)
- [Auto configuration scopes](https://code.claude.com/docs/en/auto-mode-config)

## Live canaries

An isolated gateway listened at `127.0.0.1:46451`; existing gateway processes and
provider defaults were preserved. Claude Code received explicit loopback settings
and used stream-json input/output. Auth stayed with the official Codex CLI.

| Canary | Before | After |
| --- | --- | --- |
| `TURN_ONE_7F3A` then `TURN_TWO_9C21` | Both exact replies passed | Both exact replies passed |
| Bash `pwd` -> result -> assistant -> `AFTER_TOOL_81BC` | Replied with repository-instruction acknowledgement, losing the new prompt | Exact `AFTER_TOOL_81BC` |
| Bash `sleep 2`, timeout 1 ms -> error -> assistant -> `AFTER_TIMEOUT_42DD` | Replied with repository-instruction acknowledgement, losing the new prompt | Exact `AFTER_TIMEOUT_42DD` |
| Upstream Auto, real Claude-owned Bash | Started in Manual | Started in Auto; real tool and hook completed |
| Mid-conversation system role at index 3 | Historical commit reproduced the rejection | HTTP 200; exact `AFTER_SYSTEM_73AB` |
| Reminder-only request with `stream: true` | Gateway guard covered by existing tests | One structured HTTP 400; no App Server thread/turn |

Gateway traces show the merged `[tool_result, text]` shape. After the fix,
`hasToolResult` is false on fresh canary requests and their actionable text is
exactly the new instruction. Tool-result continuations retain the originating
thread; fresh turns receive a different thread. Logs contain only scratch canary
activity and are retained under `/tmp/codex-wave1/` for local review.

## Verification

Tests were added before source changes. The corrected regression fixtures failed
against the original source: 38 passed, 10 failed. This includes the eight new
regression cases and two existing expectations revised to enforce current-only
input. After fixes, 51 gateway tests passed, with 141 assertions. A provider
fixture reproduced the Auto mapping defect before the configuration change:
136 passed, 1 failed.

| Command | Outcome |
| --- | --- |
| `cd gateways/claude-codex-gateway && bun test` | 51 passed, 0 failed; 141 assertions |
| `bun install --frozen-lockfile` | Passed; no dependency changes |
| `bun run typecheck` | Passed |
| `bun test catalog` | Failed: 908 passed, 1 skipped, 26 failed, 6 errors; includes ignored installed-plugin cache tests |
| `bun test catalog/tests` | 329 passed, 1 skipped, 0 failed |
| `bun test ./catalog` | 329 passed, 1 skipped, 0 failed |
| `bun run catalog:check` | Passed; deterministic output |
| `bun run docs:check` | Passed |
| `bun run instructions:check` | Passed |
| `bun run marketplace:check` | Passed |
| `bash scripts/test-providers.sh` | 137 passed, 0 failed |
| `./scripts/test-fkt.sh` | 161 passed, 0 failed |
| `shellcheck bin/cc-provider scripts/test-providers.sh` | Passed |
| `git diff --check` in root and gateway | Passed |

The literal `bun test catalog` treats `catalog` as a path filter and also
finds tests inside ignored `plugins/cache/claude-plugins-official/hyperframes/`.
Those installed-plugin tests lack React and generated runtime files, and
use `node:test` mock APIs that this Bun version does not implement. No cache code or dependencies were changed. The exact
directory command `bun test ./catalog` and the repository-prescribed
`bun test catalog/tests` isolate the repository suite and pass. The requested
literal command remains failed; it is not reported as green.

The live gateway command was:

```bash
CODEX_GATEWAY_PORT=46451 CODEX_GATEWAY_MODEL=gpt-6.1-sol \
CODEX_GATEWAY_REASONING_EFFORT=medium CODEX_GATEWAY_TRACE_REQUESTS=1 \
bun gateways/claude-codex-gateway/src/index.ts serve
```

Scratch acceptance drivers used explicit loopback settings, stream-json input
and output, and bounded deadlines. Their exact commands were:

```bash
python3 /tmp/codex-wave1/live-turns.py tool accepted-turns
python3 /tmp/codex-wave1/live.py tool accepted
python3 /tmp/codex-wave1/live.py timeout accepted
python3 /tmp/codex-wave1/live.py text accepted
python3 /tmp/codex-wave1/liveauto.py auto accepted
python3 /tmp/codex-wave1/http-canary.py
```

The Auto driver uses upstream `--permission-mode auto`, a supported picker
mapping, base denies, and a PreToolUse hook. The manual tool/timeout drivers
allow only Bash for their harmless canaries. No driver passes
`--dangerously-skip-permissions`. Sanitized outcomes and routing assertions
are retained in `/tmp/codex-wave1/acceptance.json`.


## Limits

This validates the named GPT-6.1 Sol paths on the installed Claude Code version.
Other models, MCP execution, subagents, context-dependent resume, long sessions,
interactive UI mode cycling, and classifier quality remain unproven. Fresh
threads intentionally do not replay completed conversation turns. There was no
process-scoped egress audit, so these canaries do not establish that every
non-inference Claude Code network destination was blocked.

The canonical runtime lives in the gateway submodule. A scoped local gateway
commit and root gitlink commit record the Wave 1 changes. No commits are pushed
and no release is published. The local submodule commit must be published
before a different checkout can fetch that gitlink.

## Penpot continuation verification

The continuation work ran from `/root/signalyze-v3` through the installed
`ccs codex`, with Claude Code 2.1.296 and GPT-6.1 Sol at Medium reasoning.
The previous gateway process reproduced the defect: Claude ran Penpot
`execute_code`, its MCP result contained `PENPOT_ALIVE`, and the independent
next prompt did not produce `MCP_NEXT_TURN_91E4`.

Two protocol/lifecycle problems remained. The gateway immediately answered a
server-initiated `item/tool/call` with an empty success, then injected Claude's
real result through `turn/start.toolOutput`. Those are different App Server
operations: a dynamic callback must receive its actual content under its
original JSON-RPC request ID. Completed/failed/interrupted notifications also
went unprocessed while there was no pending HTTP response, leaving stale tool
routes alive. `ccs codex` reused the old process because its source identity
hashed only the thin launcher, omitting the canonical submodule runtime.

The bridge now holds each server request until Claude executes the tool. It
answers that exact request with the real result and `success` flag, resumes the
same originating thread and turn, and processes terminal and
`serverRequest/resolved` cleanup even between HTTP requests. Multiple callbacks
are retained and matched independently. Duplicate callbacks do not execute or
complete another response; incomplete result batches fail closed without
consuming pending callbacks. HTTP aborts interrupt only their origin. The
source identity includes both launcher and canonical runtime, so activation
restarts an obsolete toolkit-owned gateway.

Fresh text still takes priority over old results and history. Routing uses
runtime thread/turn IDs, callback IDs, model selection, and tool definitions.
The fixed tool-name fallback whitelist and fabricated thread/message/request
IDs were removed from this path. Each HTTP response has its own Anthropic
message ID and reports the selected model. Claude remains the MCP, hook,
permission, and execution owner; Codex execution stays read-only.

The [official App Server documentation](https://learn.chatgpt.com/docs/app-server#dynamic-tool-calls-experimental)
and the schema generated by installed Codex 0.159.2 were the protocol references.

The strict live canary exposed only Penpot `execute_code` to the test session.
Its input was exactly `return "PENPOT_ALIVE";`; the actual MCP result was
`{"result":"PENPOT_ALIVE","log":""}`. The first completed assistant reply
was exactly `PENPOT_ALIVE`. Only after Claude's result event did the driver send
`Reply exactly MCP_NEXT_TURN_91E4. Do not use tools.` The completed reply was
exactly `MCP_NEXT_TURN_91E4`, with no tool call. That message had a new prompt ID,
new thread, new turn, and `hasToolResult: false`.

[Sanitized live evidence](codex-penpot-evidence.json) contains the exact session,
thread, turn, RPC, and tool-use IDs. The callback and actual result have identical
origin IDs. Raw endpoint credentials and arbitrary project text are excluded.
Sanitized request shapes and route traces remain in `/tmp/codex-penpot/`.
The driver used `ccs codex` from the project, then `claude -p` with stream-json
input/output and allowed only the named MCP operation for the canary. The
explicit model/effort flags did not alter the installation's model defaults.
A structural fingerprint confirmed every user settings key/value was preserved.
Existing project files and MCP configuration were untouched.

An initial MCP startup race did not execute a tool and was not counted as proof.
Later runs encountered Penpot's suspended-browser/no-heartbeat error; assistant
marker replies after that error were also rejected as proof. After the user
focused the existing Penpot tab, the real tool-result and new-turn assertions
passed. Penpot's browser/plugin connection must remain awake for execution.

The new `tests/routing.test.ts` adds 13 cases for actual callback success/failure,
multiple pending tools, incomplete result batches, duplicate callbacks before
and after response, terminal cleanup, pre-cancellation, HTTP cancellation,
reminder-only input, and server-request cleanup. Existing late-event,
classifier interleaving, mixed-result/current-text, and fresh-turn tests were
retained and updated to model real server requests instead of notification-only
or injected-output fixtures. The provider suite adds a runtime-source identity
regression. The gateway tsconfig includes DOM types for its AbortSignal API.

Final checks:

| Command | Outcome |
| --- | --- |
| `cd gateways/claude-codex-gateway && bun test` | 64 passed, 0 failed; 176 assertions |
| `bun node_modules/typescript/bin/tsc --noEmit --project gateways/claude-codex-gateway/tsconfig.json` | Passed, including gateway tests |
| `bun install --frozen-lockfile` | Passed |
| `bun run typecheck` | Passed |
| `bun test catalog/tests` | 329 passed, 1 skipped, 0 failed |
| `bun test catalog` in disposable tracked checkout | 329 passed, 1 skipped, 0 failed |
| `bun run catalog:check` | Passed; deterministic output |
| `bun run docs:check` | Passed |
| `bun run instructions:check` | Passed |
| `bun run marketplace:check` and `bun run catalog:budget` | Passed |
| `bash scripts/test-providers.sh` | 138 passed, 0 failed |
| `./scripts/test-fkt.sh` | 161 passed, 0 failed |
| `shellcheck bin/cc-provider scripts/test-providers.sh` | Passed |
| Existing Wave 1 live text/tool/timeout/Auto canaries | Passed |
| Strict live Penpot canary, with real MCP-result assertions | Passed |

The disposable catalog checkout contains tracked test/source files and scoped
local changes, with the frozen lockfile installed. It excludes the unrelated
installed plugin cache rather than editing it or changing test exclusions.
The live checkout's literal path-filter command still discovers those caches.
Cancellation and multiple pending calls have deterministic fixture evidence;
this is not a live Penpot concurrency stress test or broad MCP parity claim.
