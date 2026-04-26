#!/usr/bin/env bash
# setup-mcp.sh — interactive wizard for portable MCP servers.
#
# Adds two servers at user scope:
#   - github   (https://api.githubcopilot.com/mcp)
#   - context7 (https://mcp.context7.com/mcp)
#
# Tokens are stored in ~/.claude.json by `claude mcp add`. They are never
# committed to this repo. Already-configured servers are skipped.
#
# Personal MCPs (devto, coderlegion, google-image-search, etc.) are NOT in
# scope here. Configure them locally with `claude mcp add` directly.

set -euo pipefail

CLAUDE_JSON="${CLAUDE_JSON:-$HOME/.claude.json}"

log()  { printf '\033[1;34m==>\033[0m %s\n' "$*"; }
warn() { printf '\033[1;33m!!\033[0m %s\n'  "$*" >&2; }
die()  { printf '\033[1;31mxx\033[0m %s\n'  "$*" >&2; exit 1; }

command -v claude >/dev/null || die "claude CLI not found on PATH"

already_configured() {
  local name="$1"
  [ -f "$CLAUDE_JSON" ] || return 1
  python3 - "$CLAUDE_JSON" "$name" <<'PY' 2>/dev/null
import json, sys
path, name = sys.argv[1], sys.argv[2]
with open(path) as f:
    data = json.load(f)
sys.exit(0 if name in data.get("mcpServers", {}) else 1)
PY
}

prompt_secret() {
  local label="$1" var
  printf '  %s: ' "$label" >&2
  IFS= read -rs var
  printf '\n' >&2
  printf '%s' "$var"
}

setup_github() {
  if already_configured github; then
    log "github MCP already configured — skipping"
    return 0
  fi
  printf '\n[github MCP] Needs a GitHub PAT with repo + read:user.\n'
  printf '   Create one at https://github.com/settings/tokens\n'
  printf '   Press Enter to skip.\n'
  local token
  token=$(prompt_secret "GitHub token")
  if [ -z "$token" ]; then
    log "Skipped github MCP"
    return 0
  fi
  claude mcp add -s user --transport http github \
    "https://api.githubcopilot.com/mcp" \
    --header "Authorization: Bearer $token"
  log "Added github MCP"
}

setup_context7() {
  if already_configured context7; then
    log "context7 MCP already configured — skipping"
    return 0
  fi
  printf '\n[context7 MCP] Needs a Context7 API key.\n'
  printf '   Get one at https://context7.com/dashboard\n'
  printf '   Press Enter to skip.\n'
  local key
  key=$(prompt_secret "Context7 API key")
  if [ -z "$key" ]; then
    log "Skipped context7 MCP"
    return 0
  fi
  claude mcp add -s user --transport http context7 \
    "https://mcp.context7.com/mcp" \
    --header "CONTEXT7_API_KEY: $key"
  log "Added context7 MCP"
}

main() {
  setup_github
  setup_context7
  printf '\nDone. Restart Claude Code so the new MCP tools register.\n'
}

main "$@"
