#!/usr/bin/env bash
# Behavioural tests for bin/fkt.
#
# Everything runs against throwaway git repositories and throwaway config/state
# directories, so no test can touch the developer's real ~/.claude, real
# ~/.config or real remote.
#
# Nothing here reaches the network. The "remote" is a local bare repository, and
# FKT_ADVISORY_URL_BASE points the advisory feed at a file:// path that does not
# exist, so the fetch fails instantly and fail-soft instead of calling out to
# githubusercontent.com. That keeps the suite hermetic and fast.
#
# Run: ./scripts/test-fkt.sh

set -uo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
FKT="$REPO_ROOT/bin/fkt"

PASS=0
FAIL=0
WORK=""

cleanup() { [ -n "$WORK" ] && rm -rf "$WORK"; }
trap cleanup EXIT

pass() { PASS=$((PASS + 1)); printf '  \033[0;32mok\033[0m   %s\n' "$1"; }
fail() { FAIL=$((FAIL + 1)); printf '  \033[0;31mFAIL\033[0m %s\n' "$1"; [ -n "${2-}" ] && printf '        %s\n' "$2"; }

# assert_exit <expected> <label> -- <fkt args...>
assert_exit() {
  local expected="$1" label="$2"; shift 3
  local out status
  out="$(run_fkt "$@" 2>&1)"; status=$?
  if [ "$status" -eq "$expected" ]; then
    pass "$label"
  else
    fail "$label" "expected exit $expected, got $status: $(printf '%s' "$out" | head -3 | tr '\n' ' ')"
  fi
}

assert_contains() {
  local needle="$1" label="$2"; shift 3
  local out
  out="$(run_fkt "$@" 2>&1)"
  if grep -qF -- "$needle" <<<"$out"; then
    pass "$label"
  else
    fail "$label" "output did not contain '$needle': $(printf '%s' "$out" | head -3 | tr '\n' ' ')"
  fi
}

assert_not_contains() {
  local needle="$1" label="$2"; shift 3
  local out
  out="$(run_fkt "$@" 2>&1)"
  if grep -qF -- "$needle" <<<"$out"; then
    fail "$label" "output unexpectedly contained '$needle'"
  else
    pass "$label"
  fi
}

run_fkt() {
  FKT_HOME="$HOME_DIR" \
  FKT_CONFIG_DIR="$CFG_DIR" \
  FKT_STATE_DIR="$STATE_DIR" \
  FKT_ADVISORY_URL_BASE="file://$WORK/feed" \
  "$FKT" "$@"
}

# run_fkt_env VAR=VALUE... -- <fkt args...>
#
# Never write `VAR=x run_fkt ...`: bash keeps assignments made in front of a
# FUNCTION call, so the override would silently apply to every later test. The
# subshell here contains it.
run_fkt_env() {
  (
    while [ "$1" != "--" ]; do export "${1?}"; shift; done
    shift
    run_fkt "$@"
  )
}

git_q() { git -C "$1" "${@:2}" >/dev/null 2>&1; }

# Write a migration that appends a marker to the state dir when fkt runs it.
# The quoted heredoc keeps $FKT_STATE_DIR unexpanded until then — that variable
# is set by fkt for the migration, and is not this script's to resolve.
write_migration() {
  local path="$1" marker="$2"
  cat > "$path" <<EOF
#!/usr/bin/env bash
echo $marker >> "\$FKT_STATE_DIR/log"
EOF
  chmod +x "$path"
}

# ---------------------------------------------------------------------------
# Fixture: a bare "remote" with two tagged releases, and a clone of it.
# ---------------------------------------------------------------------------
setup_fixture() {
  WORK="$(mktemp -d)"
  REMOTE="$WORK/remote.git"
  HOME_DIR="$WORK/claude"
  CFG_DIR="$WORK/config"
  STATE_DIR="$WORK/state"

  local seed="$WORK/seed"
  mkdir -p "$seed"
  git_q "$seed" init -b main
  git_q "$seed" config user.email t@example.invalid
  git_q "$seed" config user.name Test
  printf '0.1.0\n' > "$seed/VERSION"
  mkdir -p "$seed/migrations" "$seed/bin" "$seed/hooks"
  # A realistic checkout ships the updater and the hook; the SessionStart tests
  # below resolve them relative to FKT_HOME, exactly as a real install does.
  cp "$FKT" "$seed/bin/fkt"
  cp "$REPO_ROOT/hooks/session-start-update-notice.sh" "$seed/hooks/"
  git_q "$seed" add -A
  git_q "$seed" commit -m v0.1.0
  git_q "$seed" tag v0.1.0

  printf '0.2.0\n' > "$seed/VERSION"
  git_q "$seed" add -A
  git_q "$seed" commit -m v0.2.0
  git_q "$seed" tag v0.2.0

  # An untagged commit after the last release: stable must ignore it, edge must not.
  printf 'edge\n' > "$seed/EDGE"
  git_q "$seed" add -A
  git_q "$seed" commit -m edge-only

  git clone --quiet --bare "$seed" "$REMOTE"

  git clone --quiet "$REMOTE" "$HOME_DIR"
  git_q "$HOME_DIR" config user.email t@example.invalid
  git_q "$HOME_DIR" config user.name Test
  # Start at the older release so there is something to update to.
  git_q "$HOME_DIR" reset --hard v0.1.0
}

reset_state() { rm -rf "$STATE_DIR" "$CFG_DIR"; }

# ---------------------------------------------------------------------------
echo "fkt behaviour"
setup_fixture

# --- basics ---------------------------------------------------------------
assert_contains "0.1.0" "version reports the checked-out VERSION" -- version
assert_contains "channel        stable" "status defaults to the stable channel" -- status
assert_exit 2 "unknown command is a usage error" -- frobnicate

# --- channels -------------------------------------------------------------
run_fkt channel edge >/dev/null
assert_contains "edge" "channel persists to config" -- channel
run_fkt channel stable >/dev/null
assert_contains "stable" "channel switches back" -- channel
assert_exit 2 "an invalid channel is rejected" -- channel nightly

# FKT_CHANNEL overrides the config file.
if [ "$(run_fkt_env FKT_CHANNEL=edge -- channel)" = "edge" ]; then
  pass "FKT_CHANNEL overrides the configured channel"
else
  fail "FKT_CHANNEL overrides the configured channel"
fi

# --- check ----------------------------------------------------------------
reset_state
assert_exit 10 "stable check finds the newer release tag" -- check
assert_contains "0.1.0 -> 0.2.0" "check names both versions" -- check

# The cache must now answer without consulting the remote at all: break the
# remote and confirm the answer is unchanged.
mv "$REMOTE" "$REMOTE.hidden"
assert_exit 10 "a cached result needs no network" -- check
mv "$REMOTE.hidden" "$REMOTE"

reset_state
OFFLINE_OUT="$(run_fkt_env FKT_OFFLINE=1 -- check --force 2>&1)"; OFFLINE_STATUS=$?
if [ "$OFFLINE_STATUS" = "30" ]; then
  pass "an offline check reports offline, not a bogus success"
else
  fail "an offline check reports offline, not a bogus success" "exit $OFFLINE_STATUS"
fi
# Grep the captured text, not a pipeline: `set -o pipefail` would surface fkt's
# own exit 30 as the pipeline status and make the assertion meaningless.
if grep -qi offline <<<"$OFFLINE_OUT"; then
  pass "offline mode says so"
else
  fail "offline mode says so" "$(printf '%s' "$OFFLINE_OUT" | head -2 | tr '\n' ' ')"
fi
# An unreachable remote must also be exit 30, not a silent "up to date".
mv "$REMOTE" "$REMOTE.hidden"
assert_exit 30 "an unreachable remote reports offline" -- check --force
mv "$REMOTE.hidden" "$REMOTE"

# --- snooze ---------------------------------------------------------------
reset_state
run_fkt check >/dev/null 2>&1
run_fkt snooze 24 >/dev/null
assert_exit 0 "a snoozed update no longer reports as available" -- check
assert_contains "snoozed" "check says it is snoozed" -- check

# A NEWER version must break through an existing snooze.
printf '%s %s\n' "0.2.0" "$(( $(date +%s) + 86400 ))" > "$STATE_DIR/snooze"
printf 'UPDATE_AVAILABLE 0.1.0 0.3.0 %s\n' "$(date +%s)" > "$STATE_DIR/update-check"
assert_exit 10 "a newer release breaks through a snooze" -- check

# --- opt-out --------------------------------------------------------------
reset_state
run_fkt disable >/dev/null
assert_exit 0 "checks are silent once disabled" -- check
assert_contains "disabled" "status shows checks disabled" -- status
assert_exit 10 "--force still checks when disabled" -- check --force
run_fkt enable >/dev/null
assert_exit 10 "enable restores checking" -- check

if [ "$(run_fkt_env FKT_UPDATE_CHECK=0 -- check >/dev/null 2>&1; echo $?)" = "0" ]; then
  pass "FKT_UPDATE_CHECK=0 disables checks"
else
  fail "FKT_UPDATE_CHECK=0 disables checks"
fi

# --- update: refuses to destroy ------------------------------------------
reset_state
printf 'local edit\n' >> "$HOME_DIR/VERSION"
assert_exit 20 "update refuses against a dirty worktree" -- update -y
assert_contains "uncommitted changes" "the refusal explains why" -- update -y
if [ "$(tail -1 "$HOME_DIR/VERSION")" = "local edit" ]; then
  pass "the dirty file was left untouched"
else
  fail "the dirty file was left untouched"
fi
git_q "$HOME_DIR" checkout -- VERSION

# A local commit that is not on the target must also block.
printf 'mine\n' > "$HOME_DIR/LOCAL.md"
git_q "$HOME_DIR" add -A
git_q "$HOME_DIR" commit -m "local work"
LOCAL_SHA="$(git -C "$HOME_DIR" rev-parse HEAD)"
assert_exit 20 "update refuses when local commits would be lost" -- update -y
assert_contains "local commits" "the refusal names the problem" -- update -y
if [ "$(git -C "$HOME_DIR" rev-parse HEAD)" = "$LOCAL_SHA" ]; then
  pass "the local commit survived the refusal"
else
  fail "the local commit survived the refusal"
fi
git_q "$HOME_DIR" reset --hard v0.1.0

# Detached HEAD must block too: there is no branch to fast-forward.
git_q "$HOME_DIR" checkout --detach v0.1.0
assert_exit 20 "update refuses on a detached HEAD" -- update -y
git_q "$HOME_DIR" checkout main
git_q "$HOME_DIR" reset --hard v0.1.0

# --- update: the happy path ----------------------------------------------
reset_state
assert_contains "would fast-forward" "--dry-run explains without changing anything" -- update --dry-run
if [ "$(tr -d '[:space:]' < "$HOME_DIR/VERSION")" = "0.1.0" ]; then
  pass "--dry-run really changed nothing"
else
  fail "--dry-run really changed nothing"
fi

run_fkt update -y >/dev/null 2>&1
if [ "$(tr -d '[:space:]' < "$HOME_DIR/VERSION")" = "0.2.0" ]; then
  pass "stable update lands on the newest release tag"
else
  fail "stable update lands on the newest release tag" "VERSION=$(cat "$HOME_DIR/VERSION")"
fi
if [ ! -f "$HOME_DIR/EDGE" ]; then
  pass "stable stopped at the tag and did not take the untagged commit"
else
  fail "stable stopped at the tag and did not take the untagged commit"
fi
assert_exit 0 "a second update is a no-op" -- update -y
assert_exit 0 "check is clean after updating" -- check

# --- edge channel ---------------------------------------------------------
reset_state
run_fkt channel edge >/dev/null
run_fkt update -y >/dev/null 2>&1
if [ -f "$HOME_DIR/EDGE" ]; then
  pass "edge takes the untagged tip of main"
else
  fail "edge takes the untagged tip of main"
fi
run_fkt channel stable >/dev/null

# --- migrations -----------------------------------------------------------
reset_state
MIG="$HOME_DIR/migrations"
mkdir -p "$MIG"
write_migration "$MIG/0001-first.sh" ran-0001
write_migration "$MIG/0002-second.sh" ran-0002
chmod +x "$MIG"/*.sh

run_fkt migrate >/dev/null 2>&1
if [ "$(tr '\n' ' ' < "$STATE_DIR/log")" = "ran-0001 ran-0002 " ]; then
  pass "migrations run once, in order"
else
  fail "migrations run once, in order" "log=$(tr '\n' ' ' < "$STATE_DIR/log" 2>/dev/null)"
fi

run_fkt migrate >/dev/null 2>&1
if [ "$(wc -l < "$STATE_DIR/log")" -eq 2 ]; then
  pass "an applied migration is never replayed"
else
  fail "an applied migration is never replayed" "log has $(wc -l < "$STATE_DIR/log") lines"
fi

# A failing migration must stop the run, leave no marker, and be retried.
printf '#!/usr/bin/env bash\nexit 3\n' > "$MIG/0003-broken.sh"
write_migration "$MIG/0004-after.sh" ran-0004
chmod +x "$MIG"/*.sh
assert_exit 50 "a failing migration exits 50" -- migrate
if [ ! -f "$STATE_DIR/migrations/0003-broken.done" ]; then
  pass "a failed migration records no completion marker"
else
  fail "a failed migration records no completion marker"
fi
if ! grep -q ran-0004 "$STATE_DIR/log" 2>/dev/null; then
  pass "later migrations do not run after a failure"
else
  fail "later migrations do not run after a failure"
fi

printf '#!/usr/bin/env bash\nexit 0\n' > "$MIG/0003-broken.sh"
chmod +x "$MIG/0003-broken.sh"
run_fkt migrate >/dev/null 2>&1
if grep -q ran-0004 "$STATE_DIR/log"; then
  pass "a fixed migration is retried and the run continues"
else
  fail "a fixed migration is retried and the run continues"
fi
rm -rf "$MIG"

# --- security advisories --------------------------------------------------
# Pinned offline: what is under test is how an advisory is MATCHED against the
# installed version, not how it is downloaded. Leaving the network in scope let
# a real fetch race the fixture and replace it.
reset_state
mkdir -p "$STATE_DIR"
printf '#id\tseverity\tintroduced\tfixed\tsummary\turl\n' > "$STATE_DIR/advisories.tsv"
printf 'FKT-2026-001\tcritical\t0.1.0\t0.9.0\tExample unfixed-for-you issue\thttps://example.invalid/a\n' >> "$STATE_DIR/advisories.tsv"
printf 'FKT-2026-002\thigh\t0.0.1\t0.2.0\tAlready fixed in your version\t-\n' >> "$STATE_DIR/advisories.tsv"
# Match with a herestring, never a pipe. `cmd | grep -q` under `set -o pipefail`
# reports the PIPELINE as failed when grep exits on its first match and the
# writer takes SIGPIPE — which inverts a positive assertion at random, depending
# on which side wins the race. `<<<` has no writer to kill, so it cannot.
adv_status() { run_fkt_env FKT_OFFLINE=1 -- status 2>&1; }
adv_has() { grep -qF "$1" <<<"$(adv_status)"; }
if adv_has "FKT-2026-001"; then
  pass "an applicable advisory is surfaced"
else
  fail "an applicable advisory is surfaced"
fi
if adv_has "FKT-2026-002"; then
  fail "an advisory already fixed for you is not surfaced"
else
  pass "an advisory already fixed for you is not surfaced"
fi

# Advisories must survive turning update checks off — that is the whole point.
run_fkt disable >/dev/null
if adv_has "FKT-2026-001"; then
  pass "advisories survive 'fkt disable'"
else
  fail "advisories survive 'fkt disable'"
fi
run_fkt config security_notices false >/dev/null
if adv_has "FKT-2026-001"; then
  fail "security_notices=false silences the cached feed too"
else
  pass "security_notices=false silences the cached feed too"
fi
run_fkt config security_notices true >/dev/null
if adv_has "FKT-2026-001"; then
  pass "and turning them back on restores them"
else
  fail "and turning them back on restores them"
fi

# A fetched feed that is not a feed (captive portal, error page) must be
# rejected rather than installed over a good cache.
BAD="$WORK/bad-feed"
printf '<html><body>404</body></html>\n' > "$BAD"
if bash -c 'source "$1" 2>/dev/null; looks_like_advisory_feed "$2"' _ "$FKT" "$BAD" 2>/dev/null; then
  fail "an HTML error page is rejected as an advisory feed"
else
  pass "an HTML error page is rejected as an advisory feed"
fi
if grep -qF "FKT-2026-001" <<<"$(run_fkt_env FKT_SECURITY_NOTICES=0 -- status 2>&1)"; then
  fail "FKT_SECURITY_NOTICES=0 silences them for one run"
else
  pass "FKT_SECURITY_NOTICES=0 silences them for one run"
fi

# --- not a git checkout ---------------------------------------------------
reset_state
NOGIT="$WORK/nogit"
mkdir -p "$NOGIT"
if [ "$(FKT_HOME="$NOGIT" FKT_CONFIG_DIR="$CFG_DIR" FKT_STATE_DIR="$STATE_DIR" "$FKT" check >/dev/null 2>&1; echo $?)" = "40" ]; then
  pass "a non-git install reports exit 40, not a bogus success"
else
  fail "a non-git install reports exit 40, not a bogus success"
fi

# --- large tag lists ------------------------------------------------------
# `git tag --list ... | head -1` under `set -o pipefail` dies silently once the
# tag list is big enough that head closes the pipe before git finishes writing:
# git takes SIGPIPE, the pipeline reports 141, `set -e` aborts with no message.
# This repository adds a tag on every release, so the list only grows.
reset_state
# The checkout must be CLEAN and on a branch, or update refuses (exit 20) before
# it ever resolves a target — which would make this assertion prove nothing.
git_q "$HOME_DIR" checkout main
git_q "$HOME_DIR" reset --hard v0.1.0
git_q "$HOME_DIR" clean -fd
# Named v0.0.* so they sort BELOW the real releases: the update must still
# resolve v0.2.0 and report a genuine fast-forward, not "already at" the bulk
# tag, or the assertion would pass without ever exercising the long list.
for i in $(seq 1 1200); do git -C "$HOME_DIR" tag "v0.0.$i" >/dev/null 2>&1; done

BIG_FAILS=0
BIG_LAST=""
for _try in 1 2 3 4 5 6 7 8; do
  BIG_LAST="$(run_fkt update --dry-run 2>&1)"
  BIG_STATUS=$?
  # Exit 0 AND a real answer. A silent death shows up as 141 and empty output.
  if [ "$BIG_STATUS" -ne 0 ] || ! grep -q "would fast-forward" <<<"$BIG_LAST"; then
    BIG_FAILS=$((BIG_FAILS + 1))
  fi
done
if [ "$BIG_FAILS" -eq 0 ]; then
  pass "resolving a target survives a 1,200-tag repository"
else
  fail "resolving a target survives a 1,200-tag repository" \
    "$BIG_FAILS/8 runs failed; last: exit $BIG_STATUS, output '$(printf '%s' "$BIG_LAST" | head -c 120)'"
fi
for i in $(seq 1 1200); do git -C "$HOME_DIR" tag -d "v0.0.$i" >/dev/null 2>&1; done
git_q "$HOME_DIR" reset --hard v0.1.0

# --- SessionStart hook ----------------------------------------------------
# The hook runs on every session. It must be fast, silent when there is nothing
# to say, and incapable of failing the session.
HOOK="$REPO_ROOT/hooks/session-start-update-notice.sh"
reset_state

# Closed stdin, the way a host that sends no payload behaves. The hook has to
# treat that as "source unknown", so this is also the default every pre-existing
# test runs under.
run_hook() {
  (
    export FKT_HOME="$HOME_DIR" FKT_STATE_DIR="$STATE_DIR" FKT_CONFIG_DIR="$CFG_DIR"
    local kv
    for kv in "$@"; do export "${kv?}"; done
    "$HOOK" 2>/dev/null </dev/null
  )
}

# The real thing: Claude Code writes a SessionStart JSON payload to the hook's
# stdin. `source` is what decides whether this is a fresh startup.
# Usage: run_hook_src <source> [VAR=VAL...]
run_hook_src() {
  local src="$1"; shift
  printf '{"session_id":"t","hook_event_name":"SessionStart","source":"%s"}' "$src" \
    | env FKT_HOME="$HOME_DIR" FKT_STATE_DIR="$STATE_DIR" FKT_CONFIG_DIR="$CFG_DIR" \
          "$@" "$HOOK" 2>/dev/null
}

HOOK_OUT="$(run_hook FKT_OFFLINE=1)"
if [ -z "$HOOK_OUT" ]; then
  pass "the hook says nothing when there is no cached update"
else
  fail "the hook says nothing when there is no cached update" "printed: $HOOK_OUT"
fi

# Capture, then match with a herestring — see the note above the advisory
# helpers for why piping into `grep -q` flakes under `set -o pipefail`.
mkdir -p "$STATE_DIR"
printf 'UPDATE_AVAILABLE 0.1.0 0.9.9 %s\n' "$(date +%s)" > "$STATE_DIR/update-check"
HOOK_OUT="$(run_hook FKT_OFFLINE=1)"
if grep -qF "0.1.0 -> 0.9.9" <<<"$HOOK_OUT"; then
  pass "the hook reports a cached update"
else
  fail "the hook reports a cached update" "printed: $HOOK_OUT"
fi

# The notice has to carry the ask-before-applying convention, or Claude has no
# reason to raise it rather than mention it in passing.
if grep -qF "runs only once they agree" <<<"$HOOK_OUT"; then
  pass "the hook states the ask-before-applying convention"
else
  fail "the hook states the ask-before-applying convention" "printed: $HOOK_OUT"
fi

if [ -z "$(run_hook FKT_OFFLINE=1 FKT_UPDATE_CHECK=0)" ]; then
  pass "FKT_UPDATE_CHECK=0 silences the hook"
else
  fail "FKT_UPDATE_CHECK=0 silences the hook"
fi

# The hard requirement: startup must not wait on the network. Point the checkout
# at an unroutable host and confirm the hook still returns effectively instantly,
# because the refresh it triggers is detached.
git -C "$HOME_DIR" remote set-url origin "https://10.255.255.1/unreachable.git" >/dev/null 2>&1
# This is the one hook call that is deliberately not offline, so it is the one
# that leaves a detached `fkt check` hanging on the unroutable address. That
# child outlives the test and writes its own verdict whenever the connection
# finally gives up, so it gets a state directory of its own: pointed at the
# shared one it would overwrite the cache out from under a later test.
NET_STATE="$WORK/net-state"
mkdir -p "$NET_STATE"
printf 'UPDATE_AVAILABLE 0.1.0 0.9.9 %s\n' "$(date +%s)" > "$NET_STATE/update-check"
HOOK_START="$(date +%s)"
run_hook FKT_STATE_DIR="$NET_STATE" >/dev/null 2>&1
HOOK_ELAPSED=$(( $(date +%s) - HOOK_START ))
if [ "$HOOK_ELAPSED" -le 2 ]; then
  pass "the hook does not block on the network (${HOOK_ELAPSED}s)"
else
  fail "the hook does not block on the network" "took ${HOOK_ELAPSED}s"
fi
git -C "$HOME_DIR" remote set-url origin "$REMOTE" >/dev/null 2>&1

if [ "$(run_hook FKT_OFFLINE=1 >/dev/null 2>&1; echo $?)" = "0" ]; then
  pass "the hook always exits 0"
else
  fail "the hook always exits 0"
fi

# --- advisories have to reach the hook's stdout ---------------------------
# `fkt status` prints advisories through warn(), which writes to stderr and
# wraps every line in ANSI colour. Only stdout reaches Claude's context, so the
# hook has to capture that stream and hand over clean text: escapes would land
# in the context window verbatim, and an unbounded feed would flood it. Four
# applicable advisories, so the three-entry cap is actually exercised.
reset_state
mkdir -p "$STATE_DIR"
printf '#id\tseverity\tintroduced\tfixed\tsummary\turl\n' > "$STATE_DIR/advisories.tsv"
for n in 1 2 3 4; do
  printf 'FKT-2026-10%s\tcritical\t0.1.0\t0.9.0\tAdvisory number %s\thttps://example.invalid/%s\n' \
    "$n" "$n" "$n" >> "$STATE_DIR/advisories.tsv"
done
ADV_OUT="$(run_hook FKT_OFFLINE=1)"

if grep -qF "FKT-2026-101" <<<"$ADV_OUT"; then
  pass "an applicable advisory reaches the hook's stdout"
else
  fail "an applicable advisory reaches the hook's stdout" "printed: $ADV_OUT"
fi

if grep -qF "security advisories apply to this install" <<<"$ADV_OUT"; then
  pass "the advisory block is introduced by its header"
else
  fail "the advisory block is introduced by its header" "printed: $ADV_OUT"
fi

# A colour escape here would be pasted into Claude's context as noise.
if grep -q "$(printf '\033')" <<<"$ADV_OUT"; then
  fail "the hook's advisory output carries no terminal escapes" "printed: $ADV_OUT"
else
  pass "the hook's advisory output carries no terminal escapes"
fi


# One header plus at most three entries, however long the feed grows.
ADV_COUNT="$(printf '%s\n' "$ADV_OUT" | grep -c 'FKT-2026-10')"
if [ "$ADV_COUNT" = "3" ]; then
  pass "the hook caps the advisory list at three entries"
else
  fail "the hook caps the advisory list at three entries" "counted $ADV_COUNT"
fi

# `fkt disable` promises in its own output that "Security advisories still
# apply", so the hook has to keep printing them with update checks turned off.
# (FKT_UPDATE_CHECK=0 is the separate kill-everything switch and is asserted
# further up; it silences the whole hook by design.)
run_fkt disable >/dev/null
if grep -qF "FKT-2026-101" <<<"$(run_hook FKT_OFFLINE=1)"; then
  pass "advisories survive 'fkt disable' on the hook path"
else
  fail "advisories survive 'fkt disable' on the hook path"
fi
run_fkt enable >/dev/null

if [ -z "$(run_hook FKT_OFFLINE=1 FKT_SECURITY_NOTICES=0)" ]; then
  pass "FKT_SECURITY_NOTICES=0 silences the advisory block"
else
  fail "FKT_SECURITY_NOTICES=0 silences the advisory block"
fi

# The feed arrives over the network and `looks_like_advisory_feed` only counts
# columns, so its text is untrusted. A summary carrying escape sequences must
# not reach Claude's context intact. Sole entry in the feed, so `head -3` cannot
# drop it and let this pass vacuously.
printf '#id\tseverity\tintroduced\tfixed\tsummary\turl\n' > "$STATE_DIR/advisories.tsv"
printf 'FKT-2026-666\tcritical\t0.1.0\t0.9.0\tRed \033[31malert\033[0m here\t-\n' \
  >> "$STATE_DIR/advisories.tsv"
HOSTILE_OUT="$(run_hook FKT_OFFLINE=1)"
if ! grep -qF "FKT-2026-666" <<<"$HOSTILE_OUT"; then
  fail "escape sequences in the feed are stripped" "advisory never rendered: $HOSTILE_OUT"
elif grep -q "$(printf '\033')" <<<"$HOSTILE_OUT"; then
  fail "escape sequences in the feed are stripped" "printed: $HOSTILE_OUT"
else
  pass "escape sequences in the feed are stripped"
fi
reset_state

# A missing updater must be survivable: the hook is wired into settings.json and
# a half-installed toolkit must not break every session.
if [ "$(FKT_HOME="$WORK/nowhere" FKT_STATE_DIR="$STATE_DIR" "$HOOK" >/dev/null 2>&1; echo $?)" = "0" ]; then
  pass "the hook exits 0 when fkt is missing entirely"
else
  fail "the hook exits 0 when fkt is missing entirely"
fi

# --- a cached verdict is only valid for the install it was written for -----
# The bug this covers: a record written while 0.3.0 was installed kept asserting
# "0.3.0 -> 0.3.1" after the checkout moved to a newer version, because nothing
# ever compared the record's own version field against VERSION. The fixture is
# at 0.1.0, so a record claiming 0.0.9 is one written for a different install.
reset_state
mkdir -p "$STATE_DIR"

printf 'UPDATE_AVAILABLE 0.0.9 0.1.0 %s\n' "$(date +%s)" > "$STATE_DIR/update-check"
assert_exit 0 "a check written for another version is not replayed" -- check
if [ ! -f "$STATE_DIR/update-check" ]; then
  pass "the outdated record is discarded rather than kept"
else
  fail "the outdated record is discarded rather than kept" "still: $(cat "$STATE_DIR/update-check")"
fi

# The impossible notice in its purest form: a target that is not ahead of what
# is installed. Self-contradictory even though the version field matches.
printf 'UPDATE_AVAILABLE 0.1.0 0.0.5 %s\n' "$(date +%s)" > "$STATE_DIR/update-check"
assert_exit 0 "an update to an older version is rejected" -- check

# A truncated line must read as "no usable cache", not as a usable one.
printf 'UPDATE_AVAILABLE\n' > "$STATE_DIR/update-check"
assert_exit 0 "a truncated cache line is not trusted" -- check

# Validation must not cost a network round trip: VERSION is a local file read.
# With the remote gone, an invalid record still resolves, and it resolves quietly.
printf 'UPDATE_AVAILABLE 0.0.9 0.1.0 %s\n' "$(date +%s)" > "$STATE_DIR/update-check"
mv "$REMOTE" "$REMOTE.hidden"
assert_exit 0 "invalidation needs no network" -- check
mv "$REMOTE.hidden" "$REMOTE"

# And the hook stays silent on it, rather than printing the impossible pair.
printf 'UPDATE_AVAILABLE 0.0.9 0.0.99 %s\n' "$(date +%s)" > "$STATE_DIR/update-check"
HOOK_OUT="$(run_hook_src startup FKT_OFFLINE=1)"
if [ -z "$HOOK_OUT" ]; then
  pass "the hook prints nothing for a stale cached record"
else
  fail "the hook prints nothing for a stale cached record" "printed: $HOOK_OUT"
fi

# A record that matches the install is still honoured — the fix must not have
# simply switched the notice off.
reset_state
mkdir -p "$STATE_DIR"
printf 'UPDATE_AVAILABLE 0.1.0 0.9.9 %s\n' "$(date +%s)" > "$STATE_DIR/update-check"
assert_exit 10 "a record matching the install still reports an update" -- check

# `status` must not present a stale record as current truth.
printf 'UPDATE_AVAILABLE 0.0.9 0.0.99 %s\n' "$(date +%s)" > "$STATE_DIR/update-check"
assert_contains "stale" "status marks a stale record as stale" -- status
reset_state

# On edge the recorded-version test cannot carry this on its own: most edge
# commits leave VERSION alone, so a record written before the checkout caught up
# still has a matching version field. Whether the target is already contained is
# the real question, and `merge-base --is-ancestor` answers it without a remote.
run_fkt channel edge >/dev/null
mkdir -p "$STATE_DIR"
EDGE_HEAD="$(git -C "$HOME_DIR" rev-parse HEAD)"
EDGE_VER="$(tr -d '[:space:]' < "$HOME_DIR/VERSION")"

printf 'UPDATE_AVAILABLE %s edge-%s %s\n' "$EDGE_VER" "${EDGE_HEAD:0:12}" "$(date +%s)" \
  > "$STATE_DIR/update-check"
assert_exit 0 "edge rejects a target the checkout already contains" -- check

# The same shape, but for a commit this checkout genuinely does not have: the
# record is real and must survive. An unknown sha is not evidence of staleness.
printf 'UPDATE_AVAILABLE %s edge-%s %s\n' "$EDGE_VER" "0123456789ab" "$(date +%s)" \
  > "$STATE_DIR/update-check"
assert_exit 10 "edge keeps a target the checkout does not have" -- check
run_fkt channel stable >/dev/null
reset_state

# --- the interactive startup prompt ----------------------------------------
# A real update on a fresh startup: the notice has to name AskUserQuestion as
# the reply's opening move, and name the choices the user gets.
mkdir -p "$STATE_DIR"
printf 'UPDATE_AVAILABLE 0.1.0 0.9.9 %s\n' "$(date +%s)" > "$STATE_DIR/update-check"
STARTUP_OUT="$(run_hook_src startup FKT_OFFLINE=1)"

if grep -qF "0.1.0 -> 0.9.9" <<<"$STARTUP_OUT"; then
  pass "a validated update is reported on startup"
else
  fail "a validated update is reported on startup" "printed: $STARTUP_OUT"
fi

if grep -qF "AskUserQuestion" <<<"$STARTUP_OUT"; then
  pass "the startup notice calls for AskUserQuestion"
else
  fail "the startup notice calls for AskUserQuestion" "printed: $STARTUP_OUT"
fi

# "before any greeting" is the whole point: without it Claude answers first and
# mentions the update afterwards, which is the behaviour this replaced.
if grep -qF "nothing precedes it" <<<"$STARTUP_OUT"; then
  pass "the startup notice puts the question before any prose"
else
  fail "the startup notice puts the question before any prose" "printed: $STARTUP_OUT"
fi

for choice in "Update now" "Skip for now" "Show details"; do
  if grep -qF "$choice" <<<"$STARTUP_OUT"; then
    pass "the startup notice offers \"$choice\""
  else
    fail "the startup notice offers \"$choice\"" "printed: $STARTUP_OUT"
  fi
done

# Accepting and declining are both the user's call. The hook cannot apply an
# update either way, so what it must guarantee is that nothing runs unasked.
if grep -qF "absent that answer nothing runs" <<<"$STARTUP_OUT"; then
  pass "the startup notice forbids updating without an answer"
else
  fail "the startup notice forbids updating without an answer" "printed: $STARTUP_OUT"
fi

# Notification only: whatever the user answers, the hook itself never mutates
# the checkout. The fixture must still be on the version it started at.
if [ "$(tr -d '[:space:]' < "$HOME_DIR/VERSION")" = "0.1.0" ]; then
  pass "the hook applies no update of its own"
else
  fail "the hook applies no update of its own" "VERSION: $(cat "$HOME_DIR/VERSION")"
fi

# --- non-startup and non-interactive sources -------------------------------
# Resuming or compacting still reports the update, but must not re-open the
# question: the user already answered it once this session.
for src in resume compact clear fork; do
  SRC_OUT="$(run_hook_src "$src" FKT_OFFLINE=1)"
  if grep -qF "0.1.0 -> 0.9.9" <<<"$SRC_OUT" &&
     ! grep -qF "AskUserQuestion" <<<"$SRC_OUT"; then
    pass "source=$src reports the update without re-asking"
  else
    fail "source=$src reports the update without re-asking" "printed: $SRC_OUT"
  fi
done

# No payload at all (a host that sends nothing) falls back to the plain notice
# rather than demanding a tool call it cannot know is available.
NOSTDIN_OUT="$(run_hook FKT_OFFLINE=1)"
if grep -qF "runs only once they agree" <<<"$NOSTDIN_OUT" &&
   ! grep -qF "AskUserQuestion" <<<"$NOSTDIN_OUT"; then
  pass "an absent payload falls back to the plain notice"
else
  fail "an absent payload falls back to the plain notice" "printed: $NOSTDIN_OUT"
fi

# AskUserQuestion is denied in print mode, so a non-interactive entrypoint gets
# the plain notice even on a genuine startup.
SDK_OUT="$(run_hook_src startup FKT_OFFLINE=1 CLAUDE_CODE_ENTRYPOINT=sdk-py)"
if grep -qF "0.1.0 -> 0.9.9" <<<"$SDK_OUT" &&
   ! grep -qF "AskUserQuestion" <<<"$SDK_OUT"; then
  pass "a non-interactive entrypoint gets no question"
else
  fail "a non-interactive entrypoint gets no question" "printed: $SDK_OUT"
fi

# An explicit opt-out, matching FKT_SECURITY_NOTICES on the advisory path.
OPTOUT_OUT="$(run_hook_src startup FKT_OFFLINE=1 FKT_UPDATE_PROMPT=0)"
if grep -qF "0.1.0 -> 0.9.9" <<<"$OPTOUT_OUT" &&
   ! grep -qF "AskUserQuestion" <<<"$OPTOUT_OUT"; then
  pass "FKT_UPDATE_PROMPT=0 keeps the notice but drops the question"
else
  fail "FKT_UPDATE_PROMPT=0 keeps the notice but drops the question" "printed: $OPTOUT_OUT"
fi

# No update, on the same startup path: silence, not an empty question.
reset_state
if [ -z "$(run_hook_src startup FKT_OFFLINE=1)" ]; then
  pass "no cached update means no question on startup"
else
  fail "no cached update means no question on startup"
fi

# Reading the payload must not become a way to stall startup: an open stdin that
# never delivers has to time out, not hang until the hook's 5s budget expires.
mkdir -p "$STATE_DIR"
printf 'UPDATE_AVAILABLE 0.1.0 0.9.9 %s\n' "$(date +%s)" > "$STATE_DIR/update-check"
STDIN_START="$(date +%s)"
# Deliberately not run_hook: this needs the un-redirected stdin it closes off.
# Process substitution rather than a pipeline, so the wait being measured is the
# hook's own and not the writer's — bash does not block on a process
# substitution once the reader has exited.
env FKT_HOME="$HOME_DIR" FKT_STATE_DIR="$STATE_DIR" FKT_CONFIG_DIR="$CFG_DIR" \
    FKT_OFFLINE=1 "$HOOK" < <(sleep 6) >/dev/null 2>&1
STDIN_ELAPSED=$(( $(date +%s) - STDIN_START ))
# The read is capped at 1s; the extra second is whole-second clock rounding.
# What matters is that it is nowhere near the writer's 6s or the hook's 5s budget.
if [ "$STDIN_ELAPSED" -le 3 ]; then
  pass "a stalled stdin does not hold up the hook (${STDIN_ELAPSED}s)"
else
  fail "a stalled stdin does not hold up the hook" "took ${STDIN_ELAPSED}s"
fi
reset_state

# ---------------------------------------------------------------------------
printf '\n%s passed, %s failed\n' "$PASS" "$FAIL"
[ "$FAIL" -eq 0 ]