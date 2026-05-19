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
MANIM_UPSTREAM_REPO="https://github.com/adithya-s-k/manim_skill.git"
KARPATHY_REPO="https://github.com/multica-ai/andrej-karpathy-skills.git"
MARKETING_REPO="https://github.com/coreyhaines31/marketingskills.git"
IMPECCABLE_REPO="https://github.com/pbakaus/impeccable.git"
TASTE_REPO="https://github.com/Leonxlnx/taste-skill.git"

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
  log "Initializing rtk hook (--hook-only --auto-patch: writes the PreToolUse hook to settings.json only; CLAUDE.md is owned by this repo)"
  rtk init -g --hook-only --auto-patch \
    || warn "rtk init returned non-zero — inspect ~/.claude/settings.json"
}

# ---------------------------------------------------------------------------
# 6. Install Manim runtime deps (pip + system) for skills/manim-narration
# ---------------------------------------------------------------------------
ensure_manim_deps() {
  # ---- 1. System build prerequisites ----
  # manim pulls pycairo + manimpango, both build from source on Linux.
  # Without cairo/pango dev headers + pkg-config + a C toolchain, pip will
  # fail with "pangocairo >= 1.30.0 is required" or "cairo.h: not found".
  if command -v apt-get >/dev/null 2>&1; then
    local apt_pkgs=(
      ffmpeg
      pkg-config
      build-essential
      python3-dev
      libcairo2-dev
      libpango1.0-dev
    )
    local missing_apt=()
    local p
    for p in "${apt_pkgs[@]}"; do
      dpkg -s "$p" >/dev/null 2>&1 || missing_apt+=("$p")
    done
    if [ ${#missing_apt[@]} -gt 0 ]; then
      log "Installing system deps for manim-narration: ${missing_apt[*]}"
      sudo apt-get update -y >/dev/null 2>&1 || true
      sudo apt-get install -y "${missing_apt[@]}" \
        || warn "apt-get install failed for: ${missing_apt[*]}"
    fi
  elif command -v brew >/dev/null 2>&1; then
    local brew_pkgs=(ffmpeg cairo pango pkg-config)
    local p
    for p in "${brew_pkgs[@]}"; do
      brew list --formula "$p" >/dev/null 2>&1 \
        || brew install "$p" \
        || warn "brew install $p failed"
    done
  else
    command -v ffmpeg >/dev/null 2>&1 \
      || warn "ffmpeg missing and no apt-get/brew detected — install manually."
    warn "Also install: pkg-config, cairo + pango dev headers, a C compiler."
  fi

  # ---- 2. Python deps (manim + edge-tts) ----
  if ! command -v python3 >/dev/null 2>&1; then
    warn "python3 not found — skipping manim/edge-tts install."
    return 0
  fi

  local need_manim=0 need_edge=0
  python3 -c "import manim"    >/dev/null 2>&1 || need_manim=1
  python3 -c "import edge_tts" >/dev/null 2>&1 || need_edge=1
  if [ "$need_manim" -eq 0 ] && [ "$need_edge" -eq 0 ]; then
    return 0
  fi

  local pkgs=()
  [ "$need_manim" -eq 1 ] && pkgs+=("manim")
  [ "$need_edge"  -eq 1 ] && pkgs+=("edge-tts")
  log "Installing Python deps for manim-narration: ${pkgs[*]}"

  # Prefer pip --user (works for pyenv and non-PEP-668 Pythons; both packages
  # land in the same site-packages so the scene can import both).
  if python3 -m pip install --user --upgrade "${pkgs[@]}" 2>/dev/null; then
    log "Installed manim-narration deps via pip --user"
  elif command -v pipx >/dev/null 2>&1; then
    # PEP 668 fallback. Put manim + edge-tts in ONE venv via pipx inject —
    # the scene imports both, and they must share a Python.
    log "pip --user blocked (PEP 668?) — using pipx with shared venv"
    if [ "$need_manim" -eq 1 ]; then
      pipx install manim || warn "pipx install manim failed"
    fi
    if [ "$need_edge" -eq 1 ]; then
      if pipx list 2>/dev/null | grep -q 'package manim '; then
        pipx inject manim edge-tts || warn "pipx inject edge-tts failed"
      else
        pipx install edge-tts || warn "pipx install edge-tts failed"
      fi
    fi
  else
    warn "Neither pip --user nor pipx worked. Install manually:"
    warn "  python3 -m pip install --user ${pkgs[*]}"
  fi

  # ---- 3. Final sanity check + actionable hint ----
  if ! python3 -c "import manim" >/dev/null 2>&1; then
    warn "manim still not importable after install. Likely cause: missing"
    warn "system headers. On Debian/Ubuntu, run:"
    warn "  sudo apt install pkg-config build-essential python3-dev \\"
    warn "                   libcairo2-dev libpango1.0-dev"
    warn "Then re-run ./install.sh."
  fi
}

# ---------------------------------------------------------------------------
# 7. Install upstream Manim skills (manimce, manimgl, composer) — same
#    pattern as gstack: cloned into skills/, ignored by parent .gitignore.
# ---------------------------------------------------------------------------
install_manim_upstream() {
  local stage="$CLAUDE_DIR/skills/.manim_upstream_src"
  if [ ! -d "$stage/.git" ]; then
    log "Cloning adithya-s-k/manim_skill into $stage"
    git clone --depth 1 "$MANIM_UPSTREAM_REPO" "$stage"
  else
    log "Updating adithya-s-k/manim_skill"
    git -C "$stage" fetch origin --depth 1 >/dev/null 2>&1 || true
    git -C "$stage" reset --hard origin/HEAD >/dev/null 2>&1 \
      || warn "manim_skill upstream pull failed — continuing"
  fi
  for s in manimce-best-practices manimgl-best-practices manim-composer; do
    local target="$CLAUDE_DIR/skills/$s"
    if [ -d "$stage/skills/$s" ]; then
      mkdir -p "$target"
      cp -r "$stage/skills/$s/." "$target/"
      [ -f "$stage/LICENSE" ] && cp "$stage/LICENSE" "$target/UPSTREAM_LICENSE"
      log "Synced upstream skill: $s"
    else
      warn "Upstream skill not found in clone: $s"
    fi
  done
}

# ---------------------------------------------------------------------------
# 7b. Karpathy coding-discipline skill (multica-ai/andrej-karpathy-skills)
#     CLAUDE.md inlines the four principles for always-on guidance; this
#     skill ships the full upstream text so it can be invoked on demand and
#     stay in sync with upstream edits.
# ---------------------------------------------------------------------------
install_karpathy_skill() {
  local stage="$CLAUDE_DIR/skills/.karpathy_upstream_src"
  if [ ! -d "$stage/.git" ]; then
    log "Cloning multica-ai/andrej-karpathy-skills into $stage"
    git clone --depth 1 "$KARPATHY_REPO" "$stage"
  else
    log "Updating andrej-karpathy-skills"
    git -C "$stage" fetch origin --depth 1 >/dev/null 2>&1 || true
    git -C "$stage" reset --hard origin/HEAD >/dev/null 2>&1 \
      || warn "karpathy upstream pull failed — continuing"
  fi
  local target="$CLAUDE_DIR/skills/karpathy-guidelines"
  if [ -d "$stage/skills/karpathy-guidelines" ]; then
    mkdir -p "$target"
    cp -r "$stage/skills/karpathy-guidelines/." "$target/"
    cp "$stage/README.md" "$target/UPSTREAM_README.md" 2>/dev/null || true
    log "Synced upstream skill: karpathy-guidelines"
  else
    warn "Upstream skill not found in clone: karpathy-guidelines"
  fi
}

# ---------------------------------------------------------------------------
# 7c. Marketing skills collection (coreyhaines31/marketingskills)
#     Installs the entire skills/ tree (~40 skills: cro, copywriting, ads,
#     seo-audit, analytics, …). Touches a marker file so re-runs cleanly
#     overwrite their own dirs but never clobber unrelated user skills.
# ---------------------------------------------------------------------------
install_marketing_skills() {
  local stage="$CLAUDE_DIR/skills/.marketing_upstream_src"
  if [ ! -d "$stage/.git" ]; then
    log "Cloning coreyhaines31/marketingskills into $stage"
    git clone --depth 1 "$MARKETING_REPO" "$stage"
  else
    log "Updating coreyhaines31/marketingskills"
    git -C "$stage" fetch origin --depth 1 >/dev/null 2>&1 || true
    git -C "$stage" reset --hard origin/HEAD >/dev/null 2>&1 \
      || warn "marketingskills upstream pull failed — continuing"
  fi
  local count=0
  local sd name target
  for sd in "$stage"/skills/*/; do
    name=$(basename "$sd")
    target="$CLAUDE_DIR/skills/$name"
    if [ -d "$target" ] && [ ! -f "$target/.from_marketing" ]; then
      warn "skipping collision (not from marketingskills): $name"
      continue
    fi
    mkdir -p "$target"
    cp -r "$sd"/. "$target/"
    touch "$target/.from_marketing"
    [ -f "$stage/LICENSE" ] && cp "$stage/LICENSE" "$target/UPSTREAM_LICENSE"
    count=$((count+1))
  done
  log "Synced $count marketingskills"
}

# ---------------------------------------------------------------------------
# 7d. Impeccable frontend-design skill (pbakaus/impeccable)
#     Repo bundles a ready Claude-Code distribution at .claude/skills/impeccable
# ---------------------------------------------------------------------------
install_impeccable_skill() {
  local stage="$CLAUDE_DIR/skills/.impeccable_upstream_src"
  if [ ! -d "$stage/.git" ]; then
    log "Cloning pbakaus/impeccable into $stage"
    git clone --depth 1 "$IMPECCABLE_REPO" "$stage"
  else
    log "Updating pbakaus/impeccable"
    git -C "$stage" fetch origin --depth 1 >/dev/null 2>&1 || true
    git -C "$stage" reset --hard origin/HEAD >/dev/null 2>&1 \
      || warn "impeccable upstream pull failed — continuing"
  fi
  local src="$stage/.claude/skills/impeccable"
  local target="$CLAUDE_DIR/skills/impeccable"
  if [ -d "$src" ]; then
    mkdir -p "$target"
    cp -r "$src"/. "$target/"
    [ -f "$stage/LICENSE" ]   && cp "$stage/LICENSE"   "$target/UPSTREAM_LICENSE"
    [ -f "$stage/NOTICE.md" ] && cp "$stage/NOTICE.md" "$target/UPSTREAM_NOTICE.md"
    log "Synced upstream skill: impeccable"
  else
    warn "impeccable upstream layout changed — $src missing"
  fi
}

# ---------------------------------------------------------------------------
# 7e. Taste-skill collection (Leonxlnx/taste-skill)
#     Anti-slop frontend skills: taste-skill, gpt-tasteskill, brutalist-skill,
#     minimalist-skill, soft-skill, redesign-skill, image-to-code-skill,
#     output-skill, brandkit, stitch-skill, imagegen-frontend-{web,mobile}.
# ---------------------------------------------------------------------------
install_taste_skills() {
  local stage="$CLAUDE_DIR/skills/.taste_upstream_src"
  if [ ! -d "$stage/.git" ]; then
    log "Cloning Leonxlnx/taste-skill into $stage"
    git clone --depth 1 "$TASTE_REPO" "$stage"
  else
    log "Updating Leonxlnx/taste-skill"
    git -C "$stage" fetch origin --depth 1 >/dev/null 2>&1 || true
    git -C "$stage" reset --hard origin/HEAD >/dev/null 2>&1 \
      || warn "taste-skill upstream pull failed — continuing"
  fi
  local count=0
  local sd name target
  for sd in "$stage"/skills/*/; do
    name=$(basename "$sd")
    [ -f "$sd/SKILL.md" ] || continue
    target="$CLAUDE_DIR/skills/$name"
    if [ -d "$target" ] && [ ! -f "$target/.from_taste" ]; then
      warn "skipping collision (not from taste-skill): $name"
      continue
    fi
    mkdir -p "$target"
    cp -r "$sd"/. "$target/"
    touch "$target/.from_taste"
    [ -f "$stage/LICENSE" ] && cp "$stage/LICENSE" "$target/UPSTREAM_LICENSE"
    count=$((count+1))
  done
  log "Synced $count taste skills"
}

# ---------------------------------------------------------------------------
# 8. Install graphify (safishamsi/graphify) — knowledge-graph skill
# ---------------------------------------------------------------------------
install_graphify() {
  # Ensure ~/.local/bin is on PATH (where pip --user lands the binary)
  export PATH="$HOME/.local/bin:$PATH"

  if ! command -v graphify >/dev/null 2>&1; then
    log "Installing graphifyy (graphify CLI)"
    if ! python3 -m pip install --user graphifyy; then
      warn "graphifyy install failed. Install manually: python3 -m pip install --user graphifyy"
      return 0
    fi
  fi

  log "Wiring graphify skill into Claude Code"
  graphify install \
    || warn "graphify install returned non-zero — check $CLAUDE_DIR/skills/graphify/"
}

# ---------------------------------------------------------------------------
# 9. Optional: configure portable MCP servers (github, context7)
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
  ensure_manim_deps
  install_manim_upstream
  install_karpathy_skill
  install_marketing_skills
  install_impeccable_skill
  install_taste_skills
  install_graphify
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
