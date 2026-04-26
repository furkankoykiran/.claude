#!/usr/bin/env bash
# install.sh — bootstrap furkankoykiran/.claude into ~/.claude
#
# Usage:
#   curl -fsSL https://raw.githubusercontent.com/furkankoykiran/.claude/main/install.sh | bash
#   # or, after cloning manually:
#   cd ~/.claude && ./install.sh
#
# Idempotent: safe to re-run. Each step checks "already done?" before acting.

set -euo pipefail

REPO_URL="https://github.com/furkankoykiran/.claude.git"
CLAUDE_DIR="${CLAUDE_DIR:-$HOME/.claude}"
GSTACK_REPO="https://github.com/garrytan/gstack.git"
RTK_INSTALLER="https://raw.githubusercontent.com/rtk-ai/rtk/master/install.sh"

log()  { printf '\033[1;34m==>\033[0m %s\n' "$*"; }
warn() { printf '\033[1;33m!!\033[0m %s\n'  "$*" >&2; }
die()  { printf '\033[1;31mxx\033[0m %s\n'  "$*" >&2; exit 1; }

# ---------------------------------------------------------------------------
# 1. Sync ~/.claude with the remote repo
# ---------------------------------------------------------------------------
sync_repo() {
  if [ -d "$CLAUDE_DIR/.git" ]; then
    log "Updating existing repo at $CLAUDE_DIR"
    git -C "$CLAUDE_DIR" fetch origin
    git -C "$CLAUDE_DIR" reset --hard origin/main
  elif [ -d "$CLAUDE_DIR" ]; then
    log "Initializing git in existing $CLAUDE_DIR"
    git -C "$CLAUDE_DIR" init -b main >/dev/null
    git -C "$CLAUDE_DIR" remote add origin "$REPO_URL" 2>/dev/null \
      || git -C "$CLAUDE_DIR" remote set-url origin "$REPO_URL"
    git -C "$CLAUDE_DIR" fetch origin
    git -C "$CLAUDE_DIR" reset --hard origin/main
    git -C "$CLAUDE_DIR" branch --set-upstream-to=origin/main main 2>/dev/null || true
  else
    log "Cloning $REPO_URL into $CLAUDE_DIR"
    git clone "$REPO_URL" "$CLAUDE_DIR"
  fi
}

# ---------------------------------------------------------------------------
# 2. Personal config bootstrap (never overwrite)
# ---------------------------------------------------------------------------
seed_configs() {
  for f in config.json settings.json; do
    local target="$CLAUDE_DIR/$f"
    local example="$CLAUDE_DIR/$f.example"
    if [ ! -f "$target" ] && [ -f "$example" ]; then
      cp "$example" "$target"
      chmod 600 "$target"
      log "Seeded $f from $f.example (edit it with your values)"
    fi
  done
}

# ---------------------------------------------------------------------------
# 3. Install bun (gstack dependency)
# ---------------------------------------------------------------------------
ensure_bun() {
  if command -v bun >/dev/null 2>&1; then
    return 0
  fi
  if [ -x "$HOME/.bun/bin/bun" ]; then
    export PATH="$HOME/.bun/bin:$PATH"
    return 0
  fi
  log "Installing bun (required by gstack)"
  if ! curl -fsSL https://bun.sh/install | bash; then
    die "bun install failed. Install manually from https://bun.sh and re-run."
  fi
  export PATH="$HOME/.bun/bin:$PATH"
}

# ---------------------------------------------------------------------------
# 4. Install gstack
# ---------------------------------------------------------------------------
install_gstack() {
  local gstack_dir="$CLAUDE_DIR/skills/gstack"
  if [ ! -d "$gstack_dir/.git" ]; then
    log "Cloning gstack into $gstack_dir"
    git clone --depth 1 "$GSTACK_REPO" "$gstack_dir"
  else
    log "Updating gstack"
    git -C "$gstack_dir" pull --ff-only origin main || warn "gstack pull failed — continuing"
  fi
  log "Running gstack setup"
  (cd "$gstack_dir" && ./setup --no-prefix)
}

# ---------------------------------------------------------------------------
# 5. Install rtk and wire its hooks
# ---------------------------------------------------------------------------
install_rtk() {
  if ! command -v rtk >/dev/null 2>&1; then
    log "Installing rtk"
    if ! curl -fsSL "$RTK_INSTALLER" | sh; then
      die "rtk install failed. Install manually from https://github.com/rtk-ai/rtk and re-run."
    fi
    # rtk lands in ~/.local/bin; make sure it's on PATH for the rest of this script
    export PATH="$HOME/.local/bin:$PATH"
  fi
  log "Initializing rtk hook (--hook-only --auto-patch: skips RTK.md/CLAUDE.md, this repo owns both)"
  rtk init -g --hook-only --auto-patch \
    || warn "rtk init returned non-zero — inspect ~/.claude/settings.json"
}

# ---------------------------------------------------------------------------
# 6. Optional: configure portable MCP servers (github, context7)
# ---------------------------------------------------------------------------
maybe_setup_mcp() {
  local script="$CLAUDE_DIR/scripts/setup-mcp.sh"
  [ -x "$script" ] || return 0

  if [ ! -t 0 ]; then
    log "Skipping MCP setup (non-interactive shell). Run it later: $script"
    return 0
  fi

  printf '\nConfigure portable MCP servers (github, context7) now? [y/N] '
  read -r answer
  case "$answer" in
    y|Y|yes|YES) "$script" ;;
    *) log "Skipped — run later with: $script" ;;
  esac
}

# ---------------------------------------------------------------------------

main() {
  command -v git  >/dev/null || die "git is required"
  command -v curl >/dev/null || die "curl is required"

  sync_repo
  seed_configs
  ensure_bun
  install_gstack
  install_rtk
  maybe_setup_mcp

  cat <<EOF

Setup complete.

Next steps:
  1. Edit $CLAUDE_DIR/config.json with your username, blog dir, etc.
  2. Restart Claude Code to load skills, agents, and hooks.
  3. Re-run ./install.sh anytime to update — it's idempotent.
EOF
}

main "$@"
