#!/usr/bin/env bash
# nim-gateway.sh — run the Anthropic-to-NVIDIA translating gateway that the
# `nvidia` provider (hosted build.nvidia.com catalog) needs.
#
#   scripts/nim-gateway.sh start    # install on first run, then serve on 127.0.0.1:4000
#   scripts/nim-gateway.sh stop
#   scripts/nim-gateway.sh status
#   scripts/nim-gateway.sh logs
#
# Why a gateway: Claude Code only speaks the Anthropic Messages API
# (`/v1/messages`). The hosted NVIDIA catalog is OpenAI-shaped and 404s on that
# path, so LiteLLM translates between the two. Self-hosted NIM containers serve
# `/v1/messages` natively — use `ccs nvidia-nim` for those and skip this script.
#
# LiteLLM is installed on demand into its own venv under cache/, NOT by
# install.sh, so nobody pays for a dependency they don't use.
#
# Config lives in providers/nvidia-gateway.yaml (gitignored, holds your
# `nvapi-` key), seeded from the committed .yaml.example template.
set -euo pipefail

CLAUDE_DIR="${CLAUDE_DIR:-$HOME/.claude}"
PDIR="$CLAUDE_DIR/providers"
CONFIG="$PDIR/nvidia-gateway.yaml"
EXAMPLE="$PDIR/nvidia-gateway.yaml.example"
RUNDIR="$CLAUDE_DIR/cache/nim-gateway"
VENV="$RUNDIR/venv"
PIDFILE="$RUNDIR/gateway.pid"
LOGFILE="$RUNDIR/gateway.log"
HOST="${NIM_GATEWAY_HOST:-127.0.0.1}"
PORT="${NIM_GATEWAY_PORT:-4000}"

log()  { printf '\033[1;34m==>\033[0m %s\n' "$*"; }
warn() { printf '\033[1;33m!!\033[0m %s\n'  "$*" >&2; }
die()  { printf '\033[1;31mxx\033[0m %s\n'  "$*" >&2; exit 1; }

# PID of a live gateway process, or empty. Checks the recorded PID is still
# ours rather than a recycled one, so a stale pidfile never masquerades as up.
running_pid() {
  [ -f "$PIDFILE" ] || return 0
  local pid
  pid=$(cat "$PIDFILE" 2>/dev/null) || return 0
  [ -n "$pid" ] || return 0
  if kill -0 "$pid" 2>/dev/null && grep -qa litellm "/proc/$pid/cmdline" 2>/dev/null; then
    printf '%s' "$pid"
  fi
}

ensure_config() {
  if [ ! -f "$CONFIG" ]; then
    [ -f "$EXAMPLE" ] || die "missing $EXAMPLE"
    cp "$EXAMPLE" "$CONFIG"
    chmod 600 "$CONFIG"
    log "Seeded providers/nvidia-gateway.yaml from template"
  fi
  if grep -qE '<[A-Z_]+>' "$CONFIG"; then
    die "providers/nvidia-gateway.yaml still has a placeholder (<...>).
    Put your build.nvidia.com key (nvapi-...) in $CONFIG, then re-run."
  fi
}

ensure_litellm() {
  if [ -x "$VENV/bin/litellm" ]; then return 0; fi
  command -v python3 >/dev/null 2>&1 || die "python3 is required to install the gateway"
  log "Installing LiteLLM gateway into $VENV (one-time, a few minutes)"
  mkdir -p "$RUNDIR"
  python3 -m venv "$VENV" || die "could not create venv at $VENV (install python3-venv)"
  "$VENV/bin/pip" install --quiet --upgrade pip
  "$VENV/bin/pip" install --quiet 'litellm[proxy]' \
    || die "pip install 'litellm[proxy]' failed"
  [ -x "$VENV/bin/litellm" ] || die "litellm did not install correctly"
  log "LiteLLM installed"
}

start() {
  local pid
  pid=$(running_pid)
  if [ -n "$pid" ]; then
    log "Gateway already running (pid $pid) on $HOST:$PORT"
    return 0
  fi
  ensure_config
  ensure_litellm
  mkdir -p "$RUNDIR"
  log "Starting gateway on $HOST:$PORT"
  # setsid detaches from this shell's process group so the gateway outlives the
  # terminal that started it.
  setsid nohup "$VENV/bin/litellm" --config "$CONFIG" --host "$HOST" --port "$PORT" \
    >"$LOGFILE" 2>&1 </dev/null &
  printf '%s\n' "$!" > "$PIDFILE"
  local i
  for i in $(seq 1 60); do
    if curl -fsS -m 2 -o /dev/null "http://$HOST:$PORT/health/liveliness" 2>/dev/null; then
      log "Gateway up after ${i}s. Now run: ccs nvidia"
      return 0
    fi
    [ -n "$(running_pid)" ] || break
    sleep 1
  done
  warn "Gateway did not answer on http://$HOST:$PORT within 60s. Last log lines:"
  tail -n 20 "$LOGFILE" >&2 2>/dev/null || true
  return 1
}

stop() {
  local pid
  pid=$(running_pid)
  if [ -z "$pid" ]; then
    log "Gateway not running"
    rm -f "$PIDFILE"
    return 0
  fi
  kill "$pid" 2>/dev/null || true
  local i
  for i in $(seq 1 10); do
    [ -n "$(running_pid)" ] || break
    sleep 1
  done
  [ -z "$(running_pid)" ] || kill -9 "$pid" 2>/dev/null || true
  rm -f "$PIDFILE"
  log "Gateway stopped"
}

status() {
  local pid
  pid=$(running_pid)
  if [ -z "$pid" ]; then
    printf 'nim-gateway: stopped\n'
    return 1
  fi
  if curl -fsS -m 3 -o /dev/null "http://$HOST:$PORT/health/liveliness" 2>/dev/null; then
    printf 'nim-gateway: running (pid %s) http://%s:%s\n' "$pid" "$HOST" "$PORT"
  else
    printf 'nim-gateway: process alive (pid %s) but not answering on %s:%s\n' "$pid" "$HOST" "$PORT"
    return 1
  fi
}

usage() {
  cat >&2 <<'EOF'
usage: nim-gateway.sh [start|stop|restart|status|logs]
  start     install on first run, then serve the Anthropic->NVIDIA gateway
  stop      stop the gateway
  restart   stop then start
  status    report whether the gateway is up (default)
  logs      follow the gateway log

env: NIM_GATEWAY_HOST (default 127.0.0.1), NIM_GATEWAY_PORT (default 4000)
EOF
}

case "${1:-status}" in
  start)   start ;;
  stop)    stop ;;
  restart) stop; start ;;
  status)  status ;;
  logs)    [ -f "$LOGFILE" ] || die "no log at $LOGFILE"; tail -f "$LOGFILE" ;;
  -h|--help) usage; exit 0 ;;
  *)       usage; exit 1 ;;
esac
