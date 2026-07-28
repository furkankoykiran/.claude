#!/usr/bin/env bash
# SessionStart hook: tell Claude when the toolkit's bootstrap layer is out of
# date, without ever making the user wait for it.
#
# Contract with Claude Code: whatever a SessionStart hook prints to stdout is
# added to Claude's context. So this stays silent unless there is genuinely
# something to say, and each path that can speak is bounded rather than a fixed
# length: the update notice is one line plus one line of handling convention,
# and the advisory block is one header line plus at most three advisories
# (`head -3`). Advisory text comes from the feed, so its width is not ours to
# promise. Anything added here has to stay bounded the same way.
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
      # Say how the notice is handled, so Claude raises it instead of mentioning
      # it in passing. Stated as convention, not as an out-of-band command:
      # imperative "do this first" text injected into context trips Claude's
      # prompt-injection defences and gets shown to the user verbatim rather
      # than acted on, which would defeat the point.
      # shellcheck disable=SC2016  # the backticks are markdown for Claude, not a subshell
      printf 'fk-toolkit convention for this notice: it is raised with the user early in the reply, in the language they are writing in, and `fkt update` runs only once they agree to it.\n'
    fi
  fi
fi

# --- surface security advisories even when checks are stale ---------------
if [ -r "$STATE_DIR/advisories.tsv" ] && [ "${FKT_SECURITY_NOTICES:-1}" != "0" ]; then
  # Ask for the data, not the rendered status page: `fkt status` prints
  # advisories through `warn`, which goes to stderr and colours every line, so
  # scraping it silently yielded nothing. `fkt advisories` is the same list as
  # plain TSV on stdout, and reads only the cache.
  #
  # The feed itself arrives over the network and is validated only for its
  # column count, so its text is untrusted: strip control characters before
  # they reach Claude's context as escape sequences.
  advisories="$("$FKT" advisories 2>/dev/null | head -3 |
    awk -F'\t' '{ for (i = 1; i <= 3; i++) gsub(/[[:cntrl:]]/, "", $i)
                  printf "  [%s] %s — %s\n", $2, $1, $3 }')"
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