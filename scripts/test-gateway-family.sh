#!/usr/bin/env bash
# Real loopback lifecycle checks with fixture credentials and disposable state.
# No Google inference or production authentication is used.
set -euo pipefail
REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
TASK_DIR=$(mktemp -d)
UNRELATED_PID=""
API_PID=""
cleanup() {
  CLAUDE_DIR="$TASK_DIR" "$REPO_ROOT/bin/cc-provider" gemini-stop >/dev/null 2>&1 || true
  [ -z "$API_PID" ] || kill "$API_PID" 2>/dev/null || true
  [ -z "$UNRELATED_PID" ] || kill "$UNRELATED_PID" 2>/dev/null || true
  rm -rf "$TASK_DIR"
}
trap cleanup EXIT
mkdir -p "$TASK_DIR/providers" "$TASK_DIR/gateways/claude-gemini-gateway"
cp "$REPO_ROOT/gateways/claude-gemini-gateway/package.json" "$TASK_DIR/gateways/claude-gemini-gateway/"
cp -R "$REPO_ROOT/gateways/claude-gemini-gateway/src" "$TASK_DIR/gateways/claude-gemini-gateway/"
PORT=$(python3 -c 'import socket; s=socket.socket(); s.bind(("127.0.0.1",0)); print(s.getsockname()[1]); s.close()')
jq --arg port "$PORT" '.env.ANTHROPIC_BASE_URL=("http://127.0.0.1:"+$port) | .env.GEMINI_GATEWAY_PORT=$port | .env.GEMINI_API_KEY="fixture-key" | .env.GEMINI_GATEWAY_MODEL="fixture-model"' \
  "$REPO_ROOT/providers/gemini.json.example" > "$TASK_DIR/providers/gemini.json"
cp "$TASK_DIR/providers/gemini.json" "$TASK_DIR/providers/gemini.json.example"
cp "$REPO_ROOT/settings.base.json" "$TASK_DIR/"
cp "$REPO_ROOT/providers/anthropic.json.example" "$TASK_DIR/providers/"
cat > "$TASK_DIR/api.ts" <<'EOF_API'
const server=Bun.serve({port:0,hostname:'127.0.0.1',async fetch(req){
  if(req.headers.get('x-goog-api-key')!=='fixture-key')return new Response('denied',{status:401});
  const body=await req.json();const text=body.contents[0].parts[0].text.replace('Reply exactly ','');
  return Response.json({candidates:[{finishReason:'STOP',content:{parts:[{text}]}}]});
}});
await Bun.write(process.argv[2],String(server.port));
EOF_API
bun run "$TASK_DIR/api.ts" "$TASK_DIR/api-port" &
API_PID=$!
for _wait in {1..50}; do [ ! -f "$TASK_DIR/api-port" ] || break; sleep .1; done
API_PORT=$(cat "$TASK_DIR/api-port")
export GEMINI_GATEWAY_API_BASE_URL="http://127.0.0.1:$API_PORT"
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
jq '.env.GEMINI_GATEWAY_MODEL="changed-fixture-model"' "$TASK_DIR/providers/gemini.json" > "$TASK_DIR/providers/gemini.next.json"
mv "$TASK_DIR/providers/gemini.next.json" "$TASK_DIR/providers/gemini.json"
run_provider gemini-start
[ "$(cat "$TASK_DIR/state/gemini-gateway.pid")" != "$SECOND" ]
curl -fsS "http://127.0.0.1:$PORT/health" | jq -e '.model=="changed-fixture-model"' >/dev/null
run_provider gemini-stop
# Full provider activation, credential failure atomicity and canonical native routing.
run_provider anthropic >/dev/null
BEFORE=$(shasum -a 256 "$TASK_DIR/settings.json")
if GEMINI_API_KEY=invalid run_provider gemini >/dev/null 2>&1; then echo 'invalid Gemini credentials activated' >&2; exit 1; fi
[ "$(cat "$TASK_DIR/providers/.active")" = "anthropic" ]
[ "$BEFORE" = "$(shasum -a 256 "$TASK_DIR/settings.json")" ]
jq '.env.GEMINI_API_KEY=""' "$TASK_DIR/providers/gemini.json" > "$TASK_DIR/providers/gemini.next.json"
mv "$TASK_DIR/providers/gemini.next.json" "$TASK_DIR/providers/gemini.json"
if GEMINI_API_KEY='' run_provider gemini >/dev/null 2>&1; then echo 'credentialless Gemini activated' >&2; exit 1; fi
[ "$BEFORE" = "$(shasum -a 256 "$TASK_DIR/settings.json")" ]
run_provider gemini >/dev/null
[ "$(cat "$TASK_DIR/providers/.active")" = "gemini" ]
API_GATEWAY_PID=$(cat "$TASK_DIR/state/gemini-gateway.pid")
# Retired local files are preserved, but cannot silently revive old switching aliases.
cp "$TASK_DIR/providers/gemini.json" "$TASK_DIR/providers/google.json"
for alias in google antigravity; do
  if run_provider "$alias" >/dev/null 2>&1; then echo 'legacy alias switched' >&2; exit 1; fi
  if run_provider use "$alias" >/dev/null 2>&1; then echo 'legacy use alias switched' >&2; exit 1; fi
  [ "$(cat "$TASK_DIR/providers/.active")" = "gemini" ]
done
cp "$REPO_ROOT/catalog/tests/fixtures/agy-cli.ts" "$TASK_DIR/agy"
chmod +x "$TASK_DIR/agy"
jq --arg port "$PORT" --arg binary "$TASK_DIR/agy" '.env.GEMINI_GATEWAY_PORT=$port | .env.ANTHROPIC_BASE_URL=("http://127.0.0.1:"+$port) | .env.AGY_GATEWAY_BIN=$binary | .env.AGY_GATEWAY_MODEL="fixture-model"' "$REPO_ROOT/providers/agy.json.example" > "$TASK_DIR/providers/agy.json"
NATIVE_BEFORE=$(shasum -a 256 "$TASK_DIR/settings.json")
if FIXTURE_AGY_AUTH=missing GEMINI_API_KEY='' run_provider agy >/dev/null 2>&1; then echo 'unauthenticated AGY activated' >&2; exit 1; fi
if AGY_GATEWAY_BIN="$TASK_DIR/missing" GEMINI_API_KEY='' run_provider agy >/dev/null 2>&1; then echo 'missing AGY activated' >&2; exit 1; fi
[ "$NATIVE_BEFORE" = "$(shasum -a 256 "$TASK_DIR/settings.json")" ]
[ "$(cat "$TASK_DIR/providers/.active")" = "gemini" ]
kill -0 "$API_GATEWAY_PID"
if GEMINI_GATEWAY_PORT=0 GEMINI_API_KEY='' run_provider agy >/dev/null 2>&1; then echo 'invalid port activated' >&2; exit 1; fi
[ "$NATIVE_BEFORE" = "$(shasum -a 256 "$TASK_DIR/settings.json")" ]
kill -0 "$API_GATEWAY_PID"
jq --arg port "$API_PORT" '.env.GEMINI_GATEWAY_PORT=$port' "$TASK_DIR/providers/agy.json" > "$TASK_DIR/providers/agy.next.json"
mv "$TASK_DIR/providers/agy.next.json" "$TASK_DIR/providers/agy.json"
if GEMINI_API_KEY='' run_provider agy >/dev/null 2>&1; then echo 'occupied target activated' >&2; exit 1; fi
[ "$NATIVE_BEFORE" = "$(shasum -a 256 "$TASK_DIR/settings.json")" ]
[ "$(cat "$TASK_DIR/providers/.active")" = "gemini" ]
kill -0 "$API_GATEWAY_PID"
jq --arg port "$PORT" '.env.GEMINI_GATEWAY_PORT=$port' "$TASK_DIR/providers/agy.json" > "$TASK_DIR/providers/agy.next.json"
mv "$TASK_DIR/providers/agy.next.json" "$TASK_DIR/providers/agy.json"
GEMINI_API_KEY='' run_provider agy >/dev/null
[ "$(cat "$TASK_DIR/providers/.active")" = "agy" ]
[ "$(cat "$TASK_DIR/state/gemini-gateway.pid")" != "$API_GATEWAY_PID" ]
if kill -0 "$API_GATEWAY_PID" 2>/dev/null; then echo 'API runtime survived adapter switch' >&2; exit 1; fi
curl -fsS "http://127.0.0.1:$PORT/health" | jq -e '.adapter=="agy-cli"' >/dev/null
AGY_BEFORE=$(shasum -a 256 "$TASK_DIR/settings.json")
if GEMINI_API_KEY='' run_provider gemini >/dev/null 2>&1; then echo 'Gemini silently fell back to AGY' >&2; exit 1; fi
[ "$(run_provider status 2>/dev/null)" = "agy" ]
[ "$AGY_BEFORE" = "$(shasum -a 256 "$TASK_DIR/settings.json")" ]
run_provider gemini-stop
sleep 120 &
UNRELATED_PID=$!
printf '%s\n' "$UNRELATED_PID" > "$TASK_DIR/state/gemini-gateway.pid"
if run_provider gemini-start >/dev/null 2>&1; then echo 'unrelated PID reused' >&2; exit 1; fi
run_provider gemini-stop
kill -0 "$UNRELATED_PID"
printf 'Gateway family lifecycle: configuration, source restart, ownership and cleanup passed.\n'
