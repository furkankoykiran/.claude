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
# What a hook cannot do: a command hook is a shell script, not an agent. It has
# no access to Claude Code's tools, so it cannot call AskUserQuestion itself and
# cannot hold the session open waiting for an answer. The only lever it has is
# the text it prints. On an interactive startup this text therefore names
# AskUserQuestion as the reply's opening move; the tool call is Claude's to make.
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

# --- which kind of session is this? ---------------------------------------
# Claude Code hands SessionStart hooks a JSON payload on stdin whose `source` is
# "startup", "resume", "clear", "compact" or "fork". Only a fresh startup earns
# the interactive prompt; re-asking after every compaction would be noise.
#
# Read with bash's own `read` rather than jq, which this toolkit does not depend
# on, and bounded by -t so a caller that leaves stdin open cannot stall startup.
# Every failure here leaves hook_source empty, which selects the quieter notice.
hook_source=""
if [ ! -t 0 ]; then
  hook_payload=""
  IFS= read -r -t 1 -d '' hook_payload 2>/dev/null || true
  hook_source="$(printf '%s' "${hook_payload:-}" \
    | sed -n 's/.*"source"[[:space:]]*:[[:space:]]*"\([A-Za-z]*\)".*/\1/p' | head -1)"
fi

# AskUserQuestion is an interactive tool: `claude -p` has nobody to answer it and
# the `dontAsk` permission mode denies it outright, so asking there would spend
# the turn on a call that cannot succeed. Claude Code documents no way for a hook
# to detect print mode, so this only ever *suppresses* on a positive signal and
# never requires one — an unrecognised environment still gets the plain notice.
prompt_first=0
if [ "$hook_source" = "startup" ] && [ "${FKT_UPDATE_PROMPT:-1}" != "0" ]; then
  prompt_first=1
  case "${CLAUDE_CODE_ENTRYPOINT:-}" in
    sdk-*|*print*|*headless*) prompt_first=0 ;;
  esac
fi

# --- report from the cache only -------------------------------------------
if [ -r "$CACHE" ]; then
  read -r status current latest _ts < "$CACHE" 2>/dev/null || status=""
  if [ "${status:-}" = "UPDATE_AVAILABLE" ]; then
    # Respect an active snooze without duplicating its logic: `fkt check`
    # returns 0 (not 10) while snoozed, and reads no network on a cache hit.
    if "$FKT" check --quiet >/dev/null 2>&1; then
      : # up to date, or snoozed — say nothing
    else
      # Report the version that is installed right now, not the one the cache
      # happens to name. `fkt check` above already refuses to speak for a record
      # written against a different install, so these agree — but the number the
      # user reads should come from VERSION, not from a cache field.
      installed="$("$FKT" version 2>/dev/null | tr -d '[:space:]')"
      [ -n "$installed" ] || installed="${current:-?}"
      printf 'fk-toolkit update available: %s -> %s.\n' "$installed" "${latest:-?}"
      # Say how the notice is handled, so Claude raises it instead of mentioning
      # it in passing. Both variants stay phrased as this toolkit's convention
      # rather than as an out-of-band order: imperative "do this first" text
      # injected into context trips Claude's prompt-injection defences and gets
      # shown to the user verbatim instead of acted on, which would defeat the
      # point. Naming the required opening move inside that framing is what
      # survives; a bare command is not.
      if [ "$prompt_first" = "1" ]; then
        # shellcheck disable=SC2016  # the backticks are markdown for Claude, not a subshell
        printf 'fk-toolkit convention for this notice on an interactive startup: the reply opens with an AskUserQuestion call and nothing precedes it, no greeting and no other prose, offering "Update now" (run `fkt update`), "Skip for now" (say nothing further about it) and "Show details" (run `fkt status`, report it, then ask again). The user picking "Update now" is the only thing that starts an update; absent that answer nothing runs. Ask in the language they are writing in.\n'
      else
        # shellcheck disable=SC2016  # the backticks are markdown for Claude, not a subshell
        printf 'fk-toolkit convention for this notice: it is raised with the user early in the reply, in the language they are writing in, and `fkt update` runs only once they agree to it.\n'
      fi
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