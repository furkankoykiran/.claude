#!/usr/bin/env bash
# test-providers.sh — regression tests for the provider switcher (bin/cc-provider)
# and the committed providers/*.json.example templates.
#
# Runs against a throwaway CLAUDE_DIR so it never touches your real
# settings.json or provider files. Used by CI; safe to run locally:
#
#   scripts/test-providers.sh
set -euo pipefail

REPO_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
CC_PROVIDER="$REPO_DIR/bin/cc-provider"

PASS=0
FAIL=0
ok()   { printf '  \033[1;32mok\033[0m   %s\n' "$*"; PASS=$((PASS + 1)); }
bad()  { printf '  \033[1;31mFAIL\033[0m %s\n' "$*" >&2; FAIL=$((FAIL + 1)); }
head_() { printf '\n\033[1;34m==>\033[0m %s\n' "$*"; }

SANDBOX=$(mktemp -d)
trap 'rm -rf "$SANDBOX"' EXIT
mkdir -p "$SANDBOX/providers"
cp "$REPO_DIR"/providers/*.json.example "$SANDBOX/providers/"
cp "$REPO_DIR"/providers/*.yaml.example "$SANDBOX/providers/" 2>/dev/null || true
cp "$REPO_DIR/settings.base.json" "$SANDBOX/"

ccs() { CLAUDE_DIR="$SANDBOX" "$CC_PROVIDER" "$@"; }
# Merged stdout+stderr as a string. Captured rather than piped: under `set -o
# pipefail` a non-zero exit from cc-provider (which `ccs bogus` is supposed to
# return) would mask a successful grep and make the assertion lie.
say() { CLAUDE_DIR="$SANDBOX" "$CC_PROVIDER" "$@" 2>&1 || true; }
# Exit status only, with output discarded.
rc() { CLAUDE_DIR="$SANDBOX" "$CC_PROVIDER" "$@" >/dev/null 2>&1; }

# --- templates are well-formed and self-consistent -------------------------
head_ "Provider templates"
for ex in "$REPO_DIR"/providers/*.json.example; do
  name=${ex##*/}; name=${name%.json.example}
  if python3 -c "import json,sys; json.load(open(sys.argv[1]))" "$ex" 2>/dev/null; then
    ok "$name.json.example is valid JSON"
  else
    bad "$name.json.example is not valid JSON"
  fi
done

# Every template must keep the rtk PreToolUse hook: settings.json is a full
# replacement, so a template that drops it silently disables rtk on switch.
for ex in "$REPO_DIR"/providers/*.json.example; do
  name=${ex##*/}; name=${name%.json.example}
  if grep -q 'rtk hook claude' "$ex"; then
    ok "$name keeps the rtk PreToolUse hook"
  else
    bad "$name is missing the rtk PreToolUse hook"
  fi
done

# A remote provider that sets no credential falls back to the claude.ai
# subscription instead of the provider, which looks like it works but bills the
# wrong account. Local (loopback) providers are exempt only in that they still
# need a token, so require a credential key everywhere except plain anthropic.
for ex in "$REPO_DIR"/providers/*.json.example; do
  name=${ex##*/}; name=${name%.json.example}
  [ "$name" = "anthropic" ] && continue
  if grep -qE '"(ANTHROPIC_AUTH_TOKEN|ANTHROPIC_API_KEY)"' "$ex"; then
    ok "$name declares a credential variable"
  else
    bad "$name sets no ANTHROPIC_AUTH_TOKEN/ANTHROPIC_API_KEY (would fall back to claude.ai auth)"
  fi
done

# The gateway must strip Claude Code's non-OpenAI body fields. Without this NIM
# hard-fails every request from a real client with
# `Validation: Unsupported parameter(s): diagnostics` — and it cannot be caught
# by hand-rolled curl tests, only by an actual Claude Code session.
GW="$REPO_DIR/providers/nvidia-gateway.yaml.example"
if grep -q 'additional_drop_params' "$GW"; then
  ok "gateway template drops Claude Code's non-OpenAI body fields"
else
  bad "gateway template has no additional_drop_params (NIM will 400 on real requests)"
fi
if grep -q 'diagnostics' "$GW"; then
  ok "gateway template drops the diagnostics field specifically"
else
  bad "gateway template no longer drops 'diagnostics'"
fi
# Belt to that braces: keep the client from sending pre-release fields at all.
if grep -q 'CLAUDE_CODE_DISABLE_EXPERIMENTAL_BETAS' "$REPO_DIR/providers/nvidia.json.example"; then
  ok "nvidia provider suppresses pre-release capability fields"
else
  bad "nvidia provider does not set CLAUDE_CODE_DISABLE_EXPERIMENTAL_BETAS"
fi

# Claude Code sends a literal Anthropic model id whenever a model is pinned
# instead of left on an alias (/model opus, --model, a resumed session).
# ANTHROPIC_DEFAULT_*_MODEL does not rewrite those, so the gateway must resolve
# them or every request 404s with `Received Model Group=claude-opus-5`.
for alias in claude-opus-5 claude-sonnet-5 claude-haiku-4-5; do
  if grep -q "model_name: $alias" "$GW"; then
    ok "gateway resolves the pinned model id $alias"
  else
    bad "gateway has no mapping for $alias (a pinned model would 404)"
  fi
done
# The wildcard must stay LAST so the explicit aliases above win over it.
if [ "$(grep -n 'model_name:' "$GW" | tail -1 | grep -c '"\*"')" = "1" ]; then
  ok "the catch-all wildcard is the last model_name entry"
else
  bad "the wildcard is not last; it would shadow the pinned-id mappings"
fi
# NVIDIA's hosted tier caps concurrency and Claude Code's parallel subagents
# exceed it, which surfaced as ResourceExhausted mid-stream.
if grep -q 'max_parallel_requests' "$GW" && grep -q 'num_retries' "$GW"; then
  ok "gateway bounds concurrency and retries transient rate limits"
else
  bad "gateway does not bound concurrency / retry rate limits"
fi
# The key must be declarable once; four copies to edit is how a rotation gets
# half-applied and leaves a live gateway on a revoked key.
if [ "$(grep -c '<NVIDIA_NIM_API_KEY>' "$GW")" = "1" ]; then
  ok "the API key placeholder appears exactly once"
else
  bad "the API key placeholder appears $(grep -c '<NVIDIA_NIM_API_KEY>' "$GW") times; rotation should touch one line"
fi

# --- discovery -------------------------------------------------------------
head_ "Discovery (list)"
listed=$(ccs list)
for want in anthropic zai nvidia nvidia-nim deepseek kimi minimax openrouter; do
  if printf '%s\n' "$listed" | grep -qxF "$want"; then
    ok "list includes $want"
  else
    bad "list is missing $want"
  fi
done

# The whole point of the data-driven rewrite: a brand-new template becomes a
# valid provider with no code change.
printf '{"env":{"ANTHROPIC_BASE_URL":"https://example.test","ANTHROPIC_AUTH_TOKEN":"x"}}\n' \
  > "$SANDBOX/providers/madeup.json.example"
if ccs list | grep -qxF madeup; then
  ok "a dropped-in template is discovered without code changes"
else
  bad "dropped-in template was not discovered"
fi
rm -f "$SANDBOX/providers/madeup.json.example" "$SANDBOX/providers/madeup.json"

# --- activation ------------------------------------------------------------
head_ "Activation"
out=$(say anthropic)
case "$out" in
  *"Active provider: anthropic"*) ok "ccs anthropic reports activation" ;;
  *) bad "ccs anthropic did not report activation: $out" ;;
esac
if [ -f "$SANDBOX/settings.json" ] \
   && [ "$(jq -S -c '.env // {}' "$SANDBOX/settings.json")" = "$(jq -S -c '.env // {}' "$SANDBOX/providers/anthropic.json")" ]; then
  ok "settings.json carries the provider's env exactly"
else
  bad "settings.json env does not match providers/anthropic.json"
fi
if [ "$(cat "$SANDBOX/providers/.active")" = "anthropic" ]; then
  ok ".active records the choice"
else
  bad ".active was not written"
fi
if [ "$(ccs status)" = "anthropic" ]; then
  ok "status echoes the active provider on stdout"
else
  bad "status did not echo anthropic"
fi

# Switching must fully replace settings.json, not merge into it: a leftover
# ANTHROPIC_BASE_URL from the previous provider would silently keep routing
# traffic to it.
ccs zai >/dev/null 2>&1
if grep -q 'api.z.ai' "$SANDBOX/settings.json"; then
  ok "switching to zai rewrites settings.json"
else
  bad "settings.json was not rewritten on switch to zai"
fi
ccs anthropic >/dev/null 2>&1
if grep -q 'api.z.ai' "$SANDBOX/settings.json"; then
  bad "switching back to anthropic left z.ai config behind (merge, not replace)"
else
  ok "switching back leaves no trace of the previous provider"
fi

# --- the safety block survives every switch --------------------------------
# Regression for the failure that made this repo's docker-volume guard inert on
# every machine that had ever run `ccs`: settings.json was a straight copy of
# the provider file, no provider template carries the safety block, and
# seed_configs() only writes settings.json when it does not already exist. So
# the guard was in git, passed review, and was registered nowhere.
head_ "Repo-owned safety config survives provider switching"

BASE="$REPO_DIR/settings.base.json"
if jq -e . "$BASE" >/dev/null 2>&1; then
  ok "settings.base.json is valid JSON"
else
  bad "settings.base.json is not valid JSON"
fi

# The two files must not overlap. settings.base.json owns the safety config;
# settings.json.example owns the optional extras. A second copy of a deny rule
# or a safety hook is a copy that can silently fall behind, which is the whole
# failure this change exists to end.
EXAMPLE="$REPO_DIR/settings.json.example"
if [ "$(jq -r '(.permissions.deny // []) | length' "$EXAMPLE")" = "0" ] \
   && [ "$(jq -r '(.hooks // {}) | length' "$EXAMPLE")" = "0" ] \
   && [ "$(jq -r 'has("cleanupPeriodDays")' "$EXAMPLE")" = "false" ]; then
  ok "settings.json.example does not duplicate the safety config"
else
  bad "settings.json.example duplicates settings.base.json (deny, hooks or cleanupPeriodDays)"
fi

# An install that never picks a provider still has to end up guarded, so the
# seed is base + example rather than either one alone.
seeded=$(jq -s '.[0] * (.[1] // {}) | del(._comment) | del(.["$comment"])' "$BASE" "$EXAMPLE")
if [ "$(printf '%s' "$seeded" | jq '.permissions.deny | length')" = "$(jq '.permissions.deny | length' "$BASE")" ] \
   && [ "$(printf '%s' "$seeded" | jq -r '[.hooks[]?[]?.hooks[]?.command] | length')" = "4" ] \
   && [ "$(printf '%s' "$seeded" | jq -r 'has("statusLine")')" = "true" ]; then
  ok "the seeded settings.json carries both the safety config and the optional extras"
else
  bad "seeding settings.base.json + settings.json.example loses one of the two"
fi
if [ "$(printf '%s' "$seeded" | jq -r 'has("_comment") or has("$comment")')" = "false" ]; then
  ok "the seed strips the explanatory comment keys"
else
  bad "the seed leaves a _comment/\$comment key in settings.json"
fi

# A single leading slash in a path rule is relative to the working directory,
# so "Read(/var/lib/docker/volumes/**)" guards <cwd>/var/lib/... and protects
# nothing. Absolute paths need the double slash.
if [ "$(jq -r '[.permissions.deny[] | select(startswith("Read(/") or startswith("Write(/") or startswith("Edit(/")) | select(startswith("Read(//") or startswith("Write(//") or startswith("Edit(//") | not)] | length' "$BASE")" = "0" ]; then
  ok "every path deny rule is absolute (// prefix), not cwd-relative"
else
  bad "a path deny rule uses a single leading slash and resolves relative to cwd"
fi

for p in anthropic zai; do
  ccs "$p" >/dev/null 2>&1
  n=$(jq '[.permissions.deny[]] | length' "$SANDBOX/settings.json" 2>/dev/null || echo 0)
  if [ "$n" = "$(jq '.permissions.deny | length' "$BASE")" ]; then
    ok "$p: every deny rule from settings.base.json is registered"
  else
    bad "$p: settings.json has $n deny rule(s), expected $(jq '.permissions.deny | length' "$BASE")"
  fi

  cmds=$(jq -r '[.hooks[]?[]?.hooks[]?.command] | join(" ")' "$SANDBOX/settings.json")
  for h in protect-docker-volumes.sh secret-scan-on-commit.sh format-on-edit.sh; do
    case "$cmds" in
      *"$h"*) ok "$p: the $h hook is registered" ;;
      *)      bad "$p: the $h hook is missing after switching to $p" ;;
    esac
  done
  # The provider's own hook must survive the merge too, not be replaced by it.
  case "$cmds" in
    *"rtk hook claude"*) ok "$p: the provider's rtk hook survives the merge" ;;
    *)                   bad "$p: the provider's rtk hook was lost in the merge" ;;
  esac
done

# #55 lands cleanupPeriodDays in settings.base.json precisely so it is not a
# per-provider concern and cannot be wiped by the next switch.
ccs zai >/dev/null 2>&1
if [ "$(jq -r '.cleanupPeriodDays' "$SANDBOX/settings.json")" = "$(jq -r '.cleanupPeriodDays' "$BASE")" ]; then
  ok "cleanupPeriodDays survives a provider switch"
else
  bad "cleanupPeriodDays did not survive a provider switch"
fi

# Keys Claude Code and other tools write into settings.json are not the
# switcher's to delete. Before the merge, `ccs` silently dropped the gstack Stop
# hook, tui and agentPushNotifEnabled on every switch.
jq '. + {tui:"fullscreen", agentPushNotifEnabled:true}
    | .hooks.Stop = [{"hooks":[{"type":"command","command":"gstack/timeline-stop-hook"}]}]' \
  "$SANDBOX/settings.json" > "$SANDBOX/s.tmp" && mv "$SANDBOX/s.tmp" "$SANDBOX/settings.json"
ccs anthropic >/dev/null 2>&1
if [ "$(jq -r '.tui // "gone"' "$SANDBOX/settings.json")" = "fullscreen" ] \
   && [ "$(jq -r '[.hooks.Stop[]?.hooks[]?.command] | join(",")' "$SANDBOX/settings.json")" = "gstack/timeline-stop-hook" ]; then
  ok "unrelated settings and third-party hooks are carried across a switch"
else
  bad "a switch destroyed unrelated settings or a third-party hook"
fi

# Fail closed: writing a settings.json without the safety block is worse than
# refusing to switch at all.
mv "$SANDBOX/settings.base.json" "$SANDBOX/settings.base.json.away"
before=$(jq -S -c . "$SANDBOX/settings.json")
if rc anthropic; then
  bad "activation succeeded with settings.base.json missing (would ship an unguarded settings.json)"
else
  ok "activation fails closed when settings.base.json is missing"
fi
if [ "$(jq -S -c . "$SANDBOX/settings.json")" = "$before" ]; then
  ok "a failed activation leaves settings.json untouched"
else
  bad "a failed activation modified settings.json"
fi
mv "$SANDBOX/settings.base.json.away" "$SANDBOX/settings.base.json"

# --- guardrails ------------------------------------------------------------
head_ "Guardrails"
if rc no-such-provider; then
  bad "an unknown provider name exited 0"
else
  ok "an unknown provider name exits non-zero"
fi
case "$(say no-such-provider)" in
  *"available providers:"*) ok "unknown provider prints the available list" ;;
  *) bad "unknown provider did not print the available list" ;;
esac

# Placeholder tokens must be called out, or the first request 401s with no clue.
case "$(say zai)" in
  *placeholder*) ok "placeholder token triggers a warning on activate" ;;
  *) bad "placeholder token did not warn on activate" ;;
esac
case "$(say status)" in
  *placeholder*) ok "placeholder token triggers a warning on status" ;;
  *) bad "placeholder token did not warn on status" ;;
esac

# stdout must stay machine-readable: warnings go to stderr so `ccs status` can
# be used in a prompt or script.
if [ "$(ccs status 2>/dev/null)" = "zai" ]; then
  ok "warnings go to stderr, keeping status stdout clean"
else
  bad "status stdout was polluted by warnings"
fi

# settings.json drifting from the provider file is the silent-401 footgun.
printf '{"drifted":true}\n' > "$SANDBOX/settings.json"
case "$(say status)" in
  *"out of date with providers/zai.json"*) ok "drift between settings.json and the provider file is reported" ;;
  *) bad "drift went unreported" ;;
esac

# The same check now also catches an edited settings.base.json that has not been
# re-applied — the case where a safety rule exists in git but not on the box.
ccs zai >/dev/null 2>&1
jq '.permissions.deny += ["Bash(rm -rf /*)"]' "$SANDBOX/settings.base.json" > "$SANDBOX/b.tmp" \
  && mv "$SANDBOX/b.tmp" "$SANDBOX/settings.base.json"
case "$(say status)" in
  *"or settings.base.json"*) ok "an unapplied settings.base.json change is reported as drift" ;;
  *) bad "an unapplied safety-config change went unreported" ;;
esac
cp "$REPO_DIR/settings.base.json" "$SANDBOX/settings.base.json"
ccs zai >/dev/null 2>&1

# A loopback provider with nothing listening is the NVIDIA-gateway footgun.
head_ "Local gateway detection"

# The real template points at :4000, and on a machine that is actually using the
# nvidia provider that port IS listening — so asserting against it would pass or
# fail depending on the developer's running gateway. Repoint the sandbox copy at
# a port the kernel just told us is free to keep this hermetic.
FREE_PORT=$(python3 -c "
import socket
s = socket.socket(); s.bind(('127.0.0.1', 0)); print(s.getsockname()[1]); s.close()")
sed -i "s#http://127.0.0.1:4000#http://127.0.0.1:$FREE_PORT#" "$SANDBOX/providers/nvidia.json.example"
rm -f "$SANDBOX/providers/nvidia.json"

gw_out=$(say nvidia)
case "$gw_out" in
  *"nothing is listening"*) ok "nvidia warns when its gateway is not running" ;;
  *) bad "nvidia did not warn about the missing gateway: $gw_out" ;;
esac
case "$gw_out" in
  *"nim-gateway.sh start"*) ok "the warning names the command that fixes it" ;;
  *) bad "the warning does not say how to start the gateway" ;;
esac
# The check above only means anything while the shipped template really is
# loopback; if it ever moves to a remote host, these assertions go quiet.
if grep -qE '"ANTHROPIC_BASE_URL": "http://(127\.0\.0\.1|localhost):' \
     "$REPO_DIR/providers/nvidia.json.example"; then
  ok "shipped nvidia template is loopback, so the check applies to it"
else
  bad "shipped nvidia template is no longer loopback; the gateway check is dead code"
fi
# A remote provider must never trip the loopback check.
case "$(say deepseek)" in
  *"nothing is listening"*) bad "a remote provider was wrongly checked for a local listener" ;;
  *) ok "remote providers skip the local-listener check" ;;
esac

# --- summary ---------------------------------------------------------------
printf '\n%s passed, %s failed\n' "$PASS" "$FAIL"
[ "$FAIL" -eq 0 ]
