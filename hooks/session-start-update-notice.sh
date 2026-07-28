#!/usr/bin/env bash
# SessionStart hook: tell Claude when the toolkit's bootstrap layer is out of
# date, without ever making the user wait for it.
#
# Contract with Claude Code: whatever a SessionStart hook prints to stdout is
# added to Claude's context. So this prints at most three short lines, and only
# when there is genuinely something to say.
#
# The rules that make this safe to run on every session:
#   * NO network calls on this path. It reads the cache `fkt` already wrote.
#   * The cache refresh is detached and backgrounded, so a hung DNS lookup can
#     never delay startup. Its result is seen by the NEXT session.
#   * Every failure is swallowed. Exit is always 0: a broken updater must not
#     stop Claude Code from starting.
#   * It changes nothing. Notification only — applying an update is always an
#     explicit `fkt update`.
#
# Disable entirely with FKT_UPDATE_CHECK=0, or `fkt disable`.

# Deliberately no `set -e`: this hook fails open, always.
set -u

CLAUDE_DIR="${FKT_HOME:-$HOME/.claude}"
FKT="$CLAUDE_DIR/bin/fkt"
STATE_DIR="${FKT_STATE_DIR:-${XDG_STATE_HOME:-$HOME/.local/state}/fk-toolkit}"
CACHE="$STATE_DIR/update-check"
REFRESH_LOCK="$STATE_DIR/.refresh.lock"

[ -x "$FKT" ] || exit 0
[ "${FKT_UPDATE_CHECK:-1}" = "0" ] && exit 0

# --- report from the cache only -------------------------------------------
if [ -r "$CACHE" ]; then
  read -r status current latest _ts < "$CACHE" 2>/dev/null || status=""
  if [ "${status:-}" = "UPDATE_AVAILABLE" ]; then
    # Respect an active snooze without duplicating its logic: `fkt check`
    # returns 0 (not 10) while snoozed, and reads no network on a cache hit.
    if "$FKT" check --quiet >/dev/null 2>&1; then
      : # up to date, or snoozed — say nothing
    else
      # shellcheck disable=SC2016  # the backticks are markdown for Claude, not a subshell
      printf 'fk-toolkit update available: %s -> %s. Run `fkt update` (or tell the user).\n' \
        "${current:-?}" "${latest:-?}"
      # Reframe the notice as an explicit instruction so Claude proactively ASKS
      # the user (in their own language) whether to apply it, instead of only
      # mentioning it in passing. Applying is always an explicit `fkt update`.
      # shellcheck disable=SC2016  # the backticks are markdown for Claude, not a subshell
      printf 'ACTION REQUIRED: At the very start of your next reply, before addressing the user'\''s request, tell the user in their own language that this fk-toolkit update is available and ask whether to apply it now. If they confirm, run `fkt update` and report the outcome. Never run the update without explicit confirmation.\n'
    fi
  fi
fi

# --- surface security advisories even when checks are stale ---------------
if [ -r "$STATE_DIR/advisories.tsv" ] && [ "${FKT_SECURITY_NOTICES:-1}" != "0" ]; then
  advisories="$("$FKT" status 2>/dev/null | sed -n 's/^!! *\(\[.*\)$/\1/p' | head -3)"
  if [ -n "${advisories:-}" ]; then
    printf 'fk-toolkit security advisories apply to this install:\n%s\n' "$advisories"
  fi
fi

# --- refresh the cache in the background, for next time --------------------
# Skipped when a refresh is already in flight or the cache is fresh; `fkt check`
# re-checks the TTL itself, so this is only a stampede guard.
if [ "${FKT_OFFLINE:-0}" != "1" ]; then
  mkdir -p "$STATE_DIR" 2>/dev/null
  if command -v flock >/dev/null 2>&1; then
    ( flock -n 9 || exit 0
      "$FKT" check --quiet >/dev/null 2>&1
    ) 9>"$REFRESH_LOCK" </dev/null >/dev/null 2>&1 &
  else
    # No flock (macOS ships without it): fall back to a mkdir mutex.
    ( mkdir "$REFRESH_LOCK.d" 2>/dev/null || exit 0
      trap 'rmdir "$REFRESH_LOCK.d" 2>/dev/null' EXIT
      "$FKT" check --quiet >/dev/null 2>&1
    ) </dev/null >/dev/null 2>&1 &
  fi
  disown 2>/dev/null || true
fi

exit 0