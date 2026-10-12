#!/usr/bin/env bash
# Real loopback lifecycle checks with fixture credentials and disposable state.
# No Google inference or production authentication is used.
set -euo pipefail
REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
TASK_DIR=$(mktemp -d)
UNRELATED_PID=""
cleanup() {
  CLAUDE_DIR="$TASK_DIR" "$REPO_ROOT/bin/cc-provider" gemini-stop >/dev/null 2>&1 || true
  [ -z "$UNRELATED_PID" ] || kill "$UNRELATED_PID" 2>/dev/null || true
  rm -rf "$TASK_DIR"
}
trap cleanup EXIT
mkdir -p "$TASK_DIR/providers" "$TASK_DIR/gateways/claude-gemini-gateway"
cp "$REPO_ROOT/gateways/claude-gemini-gateway/package.json" "$TASK_DIR/gateways/claude-gemini-gateway/"
cp -R "$REPO_ROOT/gateways/claude-gemini-gateway/src" "$TASK_DIR/gateways/claude-gemini-gateway/"
PORT=$(python3 -c 'import socket; s=socket.socket(); s.bind(("127.0.0.1",0)); print(s.getsockname()[1]); s.close()')
jq --arg port "$PORT" '.env.GEMINI_GATEWAY_PORT=$port | .env.GEMINI_API_KEY="fixture-key" | .env.GEMINI_GATEWAY_MODEL="fixture-model"' \
  "$REPO_ROOT/providers/google.json.example" > "$TASK_DIR/providers/google.json"
cp "$TASK_DIR/providers/google.json" "$TASK_DIR/providers/google.json.example"
# Explicit fixture credentials prevent ambient auth from participating.
export GEMINI_API_KEY=fixture-key
unset GEMINI_MODEL GEMINI_GATEWAY_MODEL GEMINI_GATEWAY_PORT GEMINI_GATEWAY_HOST GEMINI_GATEWAY_TIMEOUT_MS
run_provider() { CLAUDE_DIR="$TASK_DIR" "$REPO_ROOT/bin/cc-provider" "$@"; }
run_provider gemini-start
FIRST=$(cat "$TASK_DIR/state/gemini-gateway.pid")
curl -fsS "http://127.0.0.1:$PORT/health" | jq -e '.model=="fixture-model" and .execution_owner=="claude-code"' >/dev/null
run_provider gemini-start
[ "$(cat "$TASK_DIR/state/gemini-gateway.pid")" = "$FIRST" ]
printf 'export const sourceIdentityFixture = true;\n' > "$TASK_DIR/gateways/claude-gemini-gateway/src/identity-fixture.ts"
run_provider gemini-start
SECOND=$(cat "$TASK_DIR/state/gemini-gateway.pid")
[ "$SECOND" != "$FIRST" ]
if kill -0 "$FIRST" 2>/dev/null; then echo 'obsolete gateway survived restart' >&2; exit 1; fi
jq '.env.GEMINI_GATEWAY_MODEL="changed-fixture-model"' "$TASK_DIR/providers/google.json" > "$TASK_DIR/providers/google.next.json"
mv "$TASK_DIR/providers/google.next.json" "$TASK_DIR/providers/google.json"
run_provider gemini-start
[ "$(cat "$TASK_DIR/state/gemini-gateway.pid")" != "$SECOND" ]
curl -fsS "http://127.0.0.1:$PORT/health" | jq -e '.model=="changed-fixture-model"' >/dev/null
run_provider gemini-stop
sleep 120 &
UNRELATED_PID=$!
printf '%s\n' "$UNRELATED_PID" > "$TASK_DIR/state/gemini-gateway.pid"
if run_provider gemini-start >/dev/null 2>&1; then echo 'unrelated PID reused' >&2; exit 1; fi
run_provider gemini-stop
kill -0 "$UNRELATED_PID"
printf 'Gateway family lifecycle: configuration, source restart, ownership and cleanup passed.\n'
