#!/usr/bin/env bash
# install.sh — bootstrap furkankoykiran/.claude into ~/.claude
#
# Usage:
#   curl -fsSL https://raw.githubusercontent.com/furkankoykiran/.claude/main/install.sh | bash
#   # or, after cloning manually:
#   cd ~/.claude && ./install.sh
#
# Platforms: Linux and macOS (and Windows via Git Bash / WSL). For native
# Windows PowerShell, use install.ps1 instead.
#
# Environment knobs:
#   CLAUDE_DIR=/path             Install target (default: ~/.claude)
#   CLAUDE_BOOTSTRAP_MINIMAL=1   Core install only (configs + gstack + rtk);
#                                skips the heavy upstream skill packs and manim.
#                                Useful for CI and lean setups.
#   CLAUDE_BOOTSTRAP_NO_SYNC=1   Use the working tree as-is; skip the git
#                                fetch/reset. For testing local changes, CI, and
#                                offline installs.
#
# Resilience: every step except the git/curl prerequisites is fail-soft. A
# failing optional step (e.g. the headless browser) is reported at the end and
# never aborts the whole bootstrap. Re-running is always safe (idempotent).

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
ANTHROPIC_SKILLS_REPO="https://github.com/anthropics/skills.git"

log()  { printf '\033[1;34m==>\033[0m %s\n' "$*"; }
warn() { printf '\033[1;33m!!\033[0m %s\n'  "$*" >&2; }
die()  { printf '\033[1;31mxx\033[0m %s\n'  "$*" >&2; exit 1; }

# ---------------------------------------------------------------------------
# Fail-soft step runner
# ---------------------------------------------------------------------------
# Only git + curl are hard requirements. Everything else is optional: a tool
# that won't install, a browser that won't launch, a skill pack that moved —
# none of these should sink the entire bootstrap. run_step runs an optional
# step, records (but swallows) its failure, and lets the script continue. The
# summary at the end lists what was skipped so nothing fails silently.
FAILED_STEPS=()
run_step() {
  local label="$1"; shift
  if "$@"; then
    return 0
  fi
  warn "step skipped/failed: $label (continuing — see summary at the end)"
  FAILED_STEPS+=("$label")
  return 0
}

# Echo the privilege-escalation prefix for package installs: empty when already
# root, "sudo" when sudo is available, non-zero exit when neither (caller skips).
_root_prefix() {
  if [ "$(id -u)" -eq 0 ]; then
    printf ''
  elif command -v sudo >/dev/null 2>&1; then
    printf 'sudo'
  else
    return 1
  fi
}

# Install apt packages best-effort. Rather than pre-checking with apt-cache
# (which misreports virtual packages — e.g. libasound2 on Ubuntu 24.04 looks
# present via `apt-cache show` but has no install candidate), we ask apt to
# install directly and let it be the source of truth. For each package we try
# the base name, then the t64 ABI-renamed variant (24.04+ renamed libasound2 ->
# libasound2t64, etc.). A package that won't install is skipped, never fatal.
apt_install_best_effort() {
  local as_root; as_root="$(_root_prefix)" || return 1
  local want=() p
  for p in "$@"; do
    dpkg -s "$p" >/dev/null 2>&1 && continue
    dpkg -s "${p}t64" >/dev/null 2>&1 && continue
    want+=("$p")
  done
  [ ${#want[@]} -eq 0 ] && return 0

  # Fast path: one shot with the base names. Succeeds on releases without the
  # t64 rename (Debian 12, Ubuntu 22.04).
  # shellcheck disable=SC2086  # $as_root is intentionally word-split (empty when root)
  $as_root apt-get install -y --no-install-recommends "${want[@]}" >/dev/null 2>&1 && return 0

  # Slow path (e.g. Ubuntu 24.04 t64 renames, or one bad package): per-package,
  # base name then t64 fallback, so one failure can't block the rest.
  warn "browser-deps batch install failed — retrying per package (with t64 fallback)"
  for p in "${want[@]}"; do
    dpkg -s "$p" >/dev/null 2>&1 && continue
    dpkg -s "${p}t64" >/dev/null 2>&1 && continue
    # shellcheck disable=SC2086
    $as_root apt-get install -y --no-install-recommends "$p" >/dev/null 2>&1 && continue
    # shellcheck disable=SC2086
    $as_root apt-get install -y --no-install-recommends "${p}t64" >/dev/null 2>&1 && continue
    warn "could not install $p (or ${p}t64) — skipping"
  done
  return 0
}

# ---------------------------------------------------------------------------
# Ensure Chromium's runtime system libraries are present (Linux only)
# ---------------------------------------------------------------------------
# THE FIX for the classic "gstack setup failed: Playwright Chromium could not be
# launched" error on clean Linux servers/containers. The bun/npm playwright
# package downloads the Chromium *binary* but NOT the OS-level .so libraries it
# dlopen()s at launch (libatk-1.0.so.0, libnss3, libcups, ...). Without them the
# browser is present but cannot start. macOS and Windows bundle these; only
# Linux needs the explicit install. We install them proactively, before gstack's
# setup runs, so the failure never happens. install_gstack also retries with
# Playwright's own version-aware `install-deps` if setup still fails.
ensure_browser_deps() {
  [ "$(uname -s)" = "Linux" ] || return 0
  if ! command -v apt-get >/dev/null 2>&1; then
    warn "Chromium needs GTK/graphics libraries but this Linux has no apt-get."
    warn "If /browse, /qa, or screenshots fail later, install them manually"
    warn "(see the Troubleshooting section in README.md)."
    return 0
  fi
  local as_root
  if ! as_root="$(_root_prefix)"; then
    warn "Not root and no sudo — skipping Chromium system-library install."
    warn "If the headless browser fails later, run as root:"
    warn "  cd $CLAUDE_DIR/skills/gstack && bunx playwright install-deps chromium"
    return 0
  fi

  # Runtime libraries Chromium dlopen()s at launch. Names track Debian 12 /
  # Ubuntu 22.04; apt_install_best_effort maps to the t64 variants on 24.04+.
  local libs=(
    libglib2.0-0 libnss3 libnspr4 libdbus-1-3 libatk1.0-0 libatk-bridge2.0-0
    libcups2 libdrm2 libatspi2.0-0 libx11-6 libxcomposite1 libxdamage1
    libxext6 libxfixes3 libxrandr2 libxcb1 libxkbcommon0 libpango-1.0-0
    libcairo2 libasound2 libgbm1
  )

  # If every lib is already present, skip the slow `apt-get update`.
  local need=0 p
  for p in "${libs[@]}"; do
    dpkg -s "$p" >/dev/null 2>&1 || dpkg -s "${p}t64" >/dev/null 2>&1 || { need=1; break; }
  done
  [ "$need" -eq 0 ] && return 0

  log "Installing Chromium system libraries (prevents 'libatk-1.0.so.0' launch failures)"
  # shellcheck disable=SC2086
  $as_root apt-get update -y >/dev/null 2>&1 || warn "apt-get update failed — attempting install anyway"
  apt_install_best_effort "${libs[@]}"
}

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
    warn "bun install failed. gstack/browser skills need it — install manually"
    warn "from https://bun.sh and re-run. Continuing with the rest of the setup."
    return 1
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

  # Make sure Chromium can actually launch BEFORE setup tries to use it. This is
  # the proactive half of the libatk fix; the retry below is the reactive half.
  ensure_browser_deps || warn "browser dependency pre-install hit an issue — continuing"

  log "Running gstack setup"
  if (cd "$gstack_dir" && ./setup --no-prefix); then
    return 0
  fi

  # Setup failed. On Linux the usual cause is Chromium present but unable to
  # launch because a system library is still missing (e.g. a newer Ubuntu our
  # curated list didn't cover). Repair with Playwright's own version-aware
  # installer — node_modules exists now, so it's available — then retry once.
  warn "gstack setup failed once — repairing Playwright deps and retrying"
  local as_root; as_root="$(_root_prefix || true)"
  # shellcheck disable=SC2086
  (cd "$gstack_dir" && $as_root env "PATH=$PATH" bunx playwright install-deps chromium) \
    || warn "playwright install-deps failed (need root/apt?) — see README troubleshooting"

  if (cd "$gstack_dir" && ./setup --no-prefix); then
    return 0
  fi
  warn "gstack setup still failing — browser skills (/browse, /qa, screenshots) may not work."
  warn "Fix later: cd $gstack_dir && sudo bunx playwright install-deps chromium && ./setup --no-prefix"
  return 1
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

  # Always pass --upgrade so re-running the bootstrap pulls the latest graphifyy,
  # mirroring the git skill packs (which reset to upstream HEAD on every run).
  # pip --upgrade is a fast no-op when already current.
  log "Installing/upgrading graphifyy (graphify CLI)"
  if ! python3 -m pip install --user --upgrade graphifyy; then
    warn "graphifyy install/upgrade failed. Run manually: python3 -m pip install --user --upgrade graphifyy"
    # A prior install can still be wired; if there's none, give up gracefully.
    command -v graphify >/dev/null 2>&1 || return 0
  fi

  log "Wiring graphify skill into Claude Code"
  graphify install \
    || warn "graphify install returned non-zero — check $CLAUDE_DIR/skills/graphify/"
}

# ---------------------------------------------------------------------------
# 8b. Anthropic official Agent Skills (anthropics/skills) — curated file-copy
#     Always-on subset: office-document + authoring + meta skills. The rest of
#     the repo (and the big third-party collections) stay on-demand via plugin
#     marketplaces below. Overlapping skills (frontend-design, webapp-testing,
#     canvas-design, algorithmic-art) and the name-colliding `claude-api` are
#     intentionally skipped to keep the always-loaded catalog clean.
# ---------------------------------------------------------------------------
install_anthropic_skills() {
  local stage="$CLAUDE_DIR/skills/.anthropic_upstream_src"
  if [ ! -d "$stage/.git" ]; then
    log "Cloning anthropics/skills into $stage"
    git clone --depth 1 "$ANTHROPIC_SKILLS_REPO" "$stage"
  else
    log "Updating anthropics/skills"
    git -C "$stage" fetch origin --depth 1 >/dev/null 2>&1 || true
    git -C "$stage" reset --hard origin/HEAD >/dev/null 2>&1 \
      || warn "anthropics/skills upstream pull failed — continuing"
  fi
  local curated="docx pdf pptx xlsx mcp-builder skill-creator web-artifacts-builder doc-coauthoring"
  local count=0 name src target
  for name in $curated; do
    src="$stage/skills/$name"
    target="$CLAUDE_DIR/skills/$name"
    [ -f "$src/SKILL.md" ] || { warn "anthropic skill missing upstream: $name"; continue; }
    if [ -d "$target" ] && [ ! -f "$target/.from_anthropic" ]; then
      warn "skipping collision (not from anthropics/skills): $name"
      continue
    fi
    mkdir -p "$target"
    cp -r "$src"/. "$target/"
    touch "$target/.from_anthropic"
    [ -f "$stage/LICENSE" ] && cp "$stage/LICENSE" "$target/UPSTREAM_LICENSE"
    count=$((count+1))
  done
  log "Synced $count anthropic skills (claude-api skipped: name collision)"
}

# ---------------------------------------------------------------------------
# 8c. Plugin marketplaces — breadth without catalog bloat
#     Registering a marketplace costs nothing per session; only INSTALLED
#     plugins load into the always-on catalog. So we register the big
#     collections (the full anthropics/skills set, wshobson's 80+ workflow
#     plugins, obra's methodology skills, and 700+ cybersecurity skills) for
#     on-demand use, and eagerly install only a curated set of domain plugins
#     that fill real gaps (backend, data, cloud, CI/CD, database) without
#     conflicting with gstack's own workflow skills.
#     Fail-soft: needs the `claude` CLI; skipped with a note if absent.
# ---------------------------------------------------------------------------
register_plugin_marketplaces() {
  if ! command -v claude >/dev/null 2>&1; then
    warn "claude CLI not found — skipping plugin marketplaces. Re-run after Claude Code is installed."
    return 0
  fi
  local existing repo p
  existing="$(claude plugin marketplace list 2>/dev/null || true)"
  # Third-party marketplaces: only add sources you trust — there is no built-in
  # security gate on marketplace contents.
  for repo in anthropics/skills wshobson/agents obra/superpowers \
              mukul975/Anthropic-Cybersecurity-Skills; do
    printf '%s\n' "$existing" | grep -q "$repo" && continue
    claude plugin marketplace add "$repo" >/dev/null 2>&1 \
      || warn "plugin marketplace add failed: $repo"
  done
  # Curated eager installs from wshobson's marketplace. Its marketplace name is
  # 'claude-code-workflows' (NOT the repo name); pin it explicitly. Installing
  # an already-installed plugin is a no-op.
  for p in backend-development data-engineering cloud-infrastructure \
           cicd-automation database-design; do
    claude plugin install "$p@claude-code-workflows" >/dev/null 2>&1 \
      || warn "plugin install failed: $p@claude-code-workflows"
  done
  log "Plugin marketplaces registered; curated workflow plugins installed"
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
  # The only hard requirements. Everything below is fail-soft via run_step.
  command -v git  >/dev/null || die "git is required"
  command -v curl >/dev/null || die "curl is required"

  # Core: the repo itself, personal configs, the runtime gstack needs.
  if [ "${CLAUDE_BOOTSTRAP_NO_SYNC:-0}" = "1" ]; then
    log "CLAUDE_BOOTSTRAP_NO_SYNC=1 — using the working tree as-is (skipping git sync)"
  else
    sync_repo
  fi
  run_step "config seeding"   seed_configs
  run_step "bun"              ensure_bun
  run_step "gstack + browser" install_gstack
  run_step "rtk"              install_rtk

  # Optional skill packs + heavy media deps. Skip in minimal mode (CI / lean).
  if [ "${CLAUDE_BOOTSTRAP_MINIMAL:-0}" = "1" ]; then
    log "CLAUDE_BOOTSTRAP_MINIMAL=1 — skipping manim + upstream skill packs"
  else
    run_step "manim deps"        ensure_manim_deps
    run_step "manim skills"      install_manim_upstream
    run_step "karpathy skill"    install_karpathy_skill
    run_step "marketing skills"  install_marketing_skills
    run_step "impeccable skill"  install_impeccable_skill
    run_step "taste skills"      install_taste_skills
    run_step "anthropic skills"  install_anthropic_skills
    run_step "graphify"          install_graphify
    run_step "plugin marketplaces" register_plugin_marketplaces
  fi

  maybe_setup_mcp

  cat <<EOF

Setup complete.

Next steps:
  1. Edit $CLAUDE_DIR/config.json with your username, blog dir, etc.
  2. Restart Claude Code to load skills, agents, and hooks.
  3. Re-run ./install.sh anytime to update — it's idempotent.
EOF

  if [ ${#FAILED_STEPS[@]} -gt 0 ]; then
    printf '\n'
    warn "${#FAILED_STEPS[@]} optional step(s) were skipped or failed:"
    local s
    for s in "${FAILED_STEPS[@]}"; do
      warn "  - $s"
    done
    warn "These are non-fatal. See the Troubleshooting section in README.md,"
    warn "fix the cause, and re-run ./install.sh (it's idempotent)."
  fi
}

main "$@"
