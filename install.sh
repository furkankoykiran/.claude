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
#                                fetch/update. For testing local changes, CI, and
#                                offline installs.
#   CLAUDE_BOOTSTRAP_LIB_ONLY=1  Source the functions without running anything.
#                                Used by scripts/test-install.sh.
#   CLAUDE_BOOTSTRAP_CHANNEL=    stable (default) tracks the highest v* release
#     stable|edge                tag and installs third-party packs at the SHAs
#                                reviewed in skills-source.lock.json. edge tracks
#                                origin/main and upstream HEAD.
#
# This installer never discards your work. It fast-forwards, and refuses (with
# an explanation) when the checkout has uncommitted changes or local commits.
# Day-to-day updates should use `fkt update`, which is the same policy without
# the heavyweight dependency bootstrap.
#
# Resilience: every step except the git/curl prerequisites is fail-soft. A
# failing optional step (e.g. the headless browser) is reported at the end and
# never aborts the whole bootstrap. Re-running is always safe (idempotent).

set -euo pipefail

REPO_URL="https://github.com/furkankoykiran/.claude.git"
CLAUDE_DIR="${CLAUDE_DIR:-$HOME/.claude}"
# Upstream packs are cloned here and their skills copied into skills/. This dir
# MUST stay outside skills/ — see migrate_skill_staging for why.
SKILL_SRC_DIR="$CLAUDE_DIR/.cache/skill-src"
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
#
# Update strategy: fast-forward only, never `reset --hard`.
#
# This directory is the user's ~/.claude. It holds their settings, their memory,
# their provider tokens and whatever they have edited. The previous
# `git reset --hard origin/main` discarded every tracked local change without
# asking — a single re-run of the installer silently destroyed customisations.
# Refusing is the correct behaviour: only the user can decide what happens to
# their work.
#
# Channel selection matches `fkt`:
#   stable (default)  the highest v* release tag
#   edge              origin/main
sync_repo() {
  local channel="${CLAUDE_BOOTSTRAP_CHANNEL:-stable}"

  if [ ! -d "$CLAUDE_DIR" ]; then
    log "Cloning $REPO_URL into $CLAUDE_DIR"
    git clone "$REPO_URL" "$CLAUDE_DIR"
    checkout_channel "$channel"
    return 0
  fi

  if [ ! -d "$CLAUDE_DIR/.git" ]; then
    log "Initializing git in existing $CLAUDE_DIR"
    git -C "$CLAUDE_DIR" init -b main >/dev/null
    git -C "$CLAUDE_DIR" remote add origin "$REPO_URL" 2>/dev/null \
      || git -C "$CLAUDE_DIR" remote set-url origin "$REPO_URL"
    git -C "$CLAUDE_DIR" fetch origin
    # A pre-existing, untracked ~/.claude may hold files that collide with the
    # repository. Checking out reports those instead of overwriting them.
    if ! git -C "$CLAUDE_DIR" checkout -B main origin/main; then
      die "Existing files in $CLAUDE_DIR conflict with the repository (listed above).
    Move or delete them, or install into a different CLAUDE_DIR, then re-run.
    Nothing was overwritten."
    fi
    git -C "$CLAUDE_DIR" branch --set-upstream-to=origin/main main 2>/dev/null || true
    checkout_channel "$channel"
    return 0
  fi

  log "Updating existing repo at $CLAUDE_DIR (channel: $channel)"

  if [ -n "$(git -C "$CLAUDE_DIR" status --porcelain --untracked-files=no)" ]; then
    warn "$CLAUDE_DIR has uncommitted changes to tracked files — NOT updating the repo."
    warn "Nothing was discarded. Review with: git -C $CLAUDE_DIR status"
    warn "Commit or stash them, then re-run. The rest of the bootstrap continues."
    return 0
  fi

  git -C "$CLAUDE_DIR" fetch --tags --prune origin
  checkout_channel "$channel"
}

# Fast-forward the checkout to the tip of the requested channel. Refuses, and
# says why, rather than moving a checkout that carries local commits.
checkout_channel() {
  local channel="$1" target
  case "$channel" in
    stable)
      target="$(git -C "$CLAUDE_DIR" tag --list 'v*' --sort=-v:refname | head -1)"
      if [ -z "$target" ]; then
        warn "no v* release tag found; staying on the current revision."
        warn "Use CLAUDE_BOOTSTRAP_CHANNEL=edge to track origin/main."
        return 0
      fi
      ;;
    edge) target="origin/main" ;;
    *) die "CLAUDE_BOOTSTRAP_CHANNEL must be 'stable' or 'edge' (got '$channel')" ;;
  esac

  local target_sha
  target_sha="$(git -C "$CLAUDE_DIR" rev-parse --verify "$target^{commit}" 2>/dev/null)" || {
    warn "could not resolve $target; leaving the checkout alone"
    return 0
  }
  [ "$target_sha" = "$(git -C "$CLAUDE_DIR" rev-parse HEAD)" ] && { log "Already at $target"; return 0; }

  if ! git -C "$CLAUDE_DIR" merge-base --is-ancestor HEAD "$target_sha" 2>/dev/null; then
    warn "$CLAUDE_DIR has local commits that are not on $target — NOT updating."
    warn "They would be lost. Inspect with: git -C $CLAUDE_DIR log --oneline $target_sha..HEAD"
    return 0
  fi

  # Detached at a tag on the stable channel would leave the user unable to pull;
  # merge into the current branch instead so `git status` stays meaningful.
  if git -C "$CLAUDE_DIR" merge --ff-only --quiet "$target_sha"; then
    log "Fast-forwarded to $target"
  else
    warn "fast-forward to $target failed; the checkout was left unchanged"
  fi
}

# ---------------------------------------------------------------------------
# 1b. Keep upstream staging clones out of skills/
# ---------------------------------------------------------------------------
# Upstream packs used to be cloned into ~/.claude/skills/.<pack>_upstream_src.
# Four of those repos ship a .claude-plugin/plugin.json at their root, and
# Claude Code loads ANY directory under ~/.claude/skills/ carrying one as a
# skills-dir plugin — including dot-prefixed ones. So each pack was loaded
# twice: once as the copied top-level skills (/cro), once namespaced by the
# accidental plugin (/marketing-skills:cro), and the clone's bin/ was injected
# into the Bash tool's PATH. Staging now lives under .cache/ (gitignored), which
# Claude Code never scans. This moves any pre-existing clone across so upgrading
# installs stop double-loading without a manual cleanup.
migrate_skill_staging() {
  mkdir -p "$SKILL_SRC_DIR"
  local legacy pack moved=0
  for legacy in "$CLAUDE_DIR"/skills/.*_upstream_src; do
    [ -d "$legacy" ] || continue
    pack=${legacy##*/}; pack=${pack#.}; pack=${pack%_upstream_src}
    if [ -d "$SKILL_SRC_DIR/$pack" ]; then
      rm -rf "$legacy"          # already migrated; drop the stale copy
    else
      mv "$legacy" "$SKILL_SRC_DIR/$pack"
    fi
    moved=$((moved+1))
  done
  [ "$moved" -gt 0 ] \
    && log "Moved $moved upstream staging clone(s) out of skills/ (they were loading as duplicate plugins)"
  return 0
}

# ---------------------------------------------------------------------------
# 1c. Deterministic third-party staging
# ---------------------------------------------------------------------------
# Every upstream pack used to be cloned at whatever HEAD happened to be, so two
# machines bootstrapped an hour apart could get different skills, and the
# reviewed content in skills-source.lock.json described neither of them.
#
# The lock records an immutable SHA per source, produced by `catalog:resolve`
# and reviewed through the update PR. On the stable channel we check out exactly
# that SHA. On edge we follow upstream HEAD, which is what edge is for.
#
# The lock is read with awk rather than a JSON parser because this runs before
# bun is guaranteed to exist. That is only safe because the lock is generated
# deterministically by JSON.stringify(_, null, 2); catalog/tests/lock-parse.test.ts
# asserts this extraction agrees with a real JSON parse for every source.
LOCK_FILE="$CLAUDE_DIR/skills-source.lock.json"

locked_revision() {
  local id="$1"
  [ -f "$LOCK_FILE" ] || return 1
  awk -v want="$id" '
    $0 ~ "\"id\": \"" want "\"" { found = 1; next }
    found && /"resolvedRevision":/ {
      # ..."resolvedRevision": "<sha>",
      line = $0
      sub(/^.*"resolvedRevision"[[:space:]]*:[[:space:]]*"/, "", line)
      sub(/".*$/, "", line)
      print line
      exit
    }
    # A new object started before any revision: this source has none.
    found && /^    \}/ { exit }
  ' "$LOCK_FILE"
}

# stage_source <lock-id> <repo-url> <stage-dir>
# Leaves <stage-dir> checked out at the pinned revision (stable) or upstream
# HEAD (edge). Never destroys anything outside the staging directory.
stage_source() {
  local id="$1" repo="$2" stage="$3"
  local channel="${CLAUDE_BOOTSTRAP_CHANNEL:-stable}"
  local sha=""

  if [ "$channel" = "stable" ]; then
    sha="$(locked_revision "$id" || true)"
    if [ -z "$sha" ]; then
      warn "no locked revision for '$id' in skills-source.lock.json — falling back to upstream HEAD."
      warn "Run 'bun run catalog:resolve' and commit the lock to make this deterministic."
    fi
  fi

  if [ ! -d "$stage/.git" ]; then
    rm -rf "$stage"
    mkdir -p "$(dirname "$stage")"
    if [ -n "$sha" ]; then
      log "Cloning $repo at $sha"
      # No --depth: a shallow clone cannot check out an arbitrary older SHA.
      git clone --quiet "$repo" "$stage" || return 1
    else
      log "Cloning $repo (HEAD)"
      git clone --quiet --depth 1 "$repo" "$stage" || return 1
    fi
  else
    log "Updating $repo"
    git -C "$stage" fetch --quiet --tags origin || warn "fetch failed for $id — using the existing clone"
  fi

  if [ -n "$sha" ]; then
    if ! git -C "$stage" cat-file -e "$sha^{commit}" 2>/dev/null; then
      # The clone predates the pin (or was shallow). Deepen and retry once.
      git -C "$stage" fetch --quiet --unshallow origin 2>/dev/null \
        || git -C "$stage" fetch --quiet origin 2>/dev/null || true
    fi
    if git -C "$stage" checkout --quiet --detach "$sha" 2>/dev/null; then
      log "  pinned $id at ${sha:0:12}"
    else
      warn "locked revision ${sha:0:12} for '$id' is not reachable upstream — it may have been"
      warn "force-pushed away. Using upstream HEAD instead; re-resolve the lock to fix."
      git -C "$stage" checkout --quiet --detach origin/HEAD 2>/dev/null || true
    fi
  else
    git -C "$stage" checkout --quiet --detach origin/HEAD 2>/dev/null \
      || warn "could not check out origin/HEAD for $id — using the clone as-is"
  fi
  return 0
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
  # Pinned to the lock like every other upstream source. gstack also ships its
  # own `/gstack-upgrade`; if a user runs that, gstack moves ahead of the pin and
  # the next install.sh brings it back to the reviewed revision. That is the
  # intended behaviour of the stable channel — use CLAUDE_BOOTSTRAP_CHANNEL=edge
  # to track gstack's own HEAD instead.
  stage_source "gstack" "$GSTACK_REPO" "$gstack_dir" || warn "gstack staging failed — continuing"

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
# 6. Provider switcher (Anthropic, z.ai, NVIDIA, ...) — settings.json copy system
# ---------------------------------------------------------------------------
# settings.json is a COPY of providers/<active>.json (copy, not symlink, so it
# also works on Windows where symlinks need admin/Developer Mode). Provider
# files are local (gitignored, hold auth tokens); *.json.example templates are
# tracked with a <ZAI_TOKEN>-style placeholder. `ccs` (-> bin/cc-provider on
# Unix, bin/cc-provider.ps1 on Windows) copies the chosen provider to
# settings.json and records it in providers/.active. Fresh installs opt in by
# running `ccs <provider>` once after filling the token.
#
# Seeding is driven by whichever templates exist, so a new provider is added by
# committing providers/<name>.json.example and nothing else.
setup_providers() {
  local pdir="$CLAUDE_DIR/providers"
  mkdir -p "$pdir"
  local ex p
  for ex in "$pdir"/*.json.example; do
    [ -e "$ex" ] || continue
    p=${ex##*/}; p=${p%.json.example}
    if [ ! -f "$pdir/$p.json" ]; then
      cp "$ex" "$pdir/$p.json"
      chmod 600 "$pdir/$p.json"
      log "Seeded providers/$p.json from template (fill your token before switching to it)"
    fi
  done
  install_ccs_alias
}

install_ccs_alias() {
  local rc="$HOME/.bashrc"
  touch "$rc"
  if grep -q 'cc-provider' "$rc" 2>/dev/null; then return 0; fi
  # Quoted heredoc: $HOME and $@ must stay literal so the generated function
  # resolves them at call time (not at install time).
  cat >> "$rc" <<'EOF'

# Claude Code provider switcher (managed by ~/.claude/install.sh)
ccs() { "$HOME/.claude/bin/cc-provider" "$@"; }
EOF
  log "Added 'ccs' shell function to ~/.bashrc (run: source ~/.bashrc)"
}

# ---------------------------------------------------------------------------
# 5b. Updater (fkt) + versioned migrations
# ---------------------------------------------------------------------------
# `fkt` is how the bootstrap layer updates after this first install: a
# fast-forward-only path that refuses rather than discards. Exposing it as a
# shell function (not a PATH edit) keeps the change to ~/.bashrc to one line and
# reversible, and matches how `ccs` is already wired.
install_fkt() {
  [ -x "$CLAUDE_DIR/bin/fkt" ] || { warn "bin/fkt missing — skipping updater setup"; return 1; }

  local rc="$HOME/.bashrc"
  touch "$rc"
  if ! grep -q 'claude/bin/fkt' "$rc" 2>/dev/null; then
    cat >> "$rc" <<'EOF'

# FK Claude Toolkit updater (managed by ~/.claude/install.sh)
fkt() { "$HOME/.claude/bin/fkt" "$@"; }
EOF
    log "Added 'fkt' shell function to ~/.bashrc (run: source ~/.bashrc)"
  fi

  # Run pending migrations now. On a first install every migration is a no-op,
  # but recording them as applied means an upgrading user never replays a
  # migration that was already true of their tree.
  "$CLAUDE_DIR/bin/fkt" migrate || warn "some migrations did not apply — run 'fkt migrate' to retry"
  return 0
}

# ---------------------------------------------------------------------------
# 5c. Local override file
# ---------------------------------------------------------------------------
# CLAUDE.md is tracked and IS overwritten by updates. CLAUDE.local.md is
# gitignored and is where machine-specific instructions belong, so an update can
# never clobber them. Seeded once, never overwritten.
seed_local_overrides() {
  local target="$CLAUDE_DIR/CLAUDE.local.md"
  [ -f "$target" ] && return 0
  cat > "$target" <<'EOF'
# Local instructions

This file is yours. It is gitignored, so toolkit updates never touch it, and it
is loaded alongside the tracked CLAUDE.md.

Put machine-specific or private instructions here — paths that only exist on
this box, an employer's conventions, personal preferences. Anything you put in
the tracked CLAUDE.md instead will be overwritten by the next update.
EOF
  log "Seeded CLAUDE.local.md (gitignored — your instructions live here, not in CLAUDE.md)"
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
  # manim may live in a pipx-managed venv (the pip-blocked fallback above), where
  # system python3 can't `import manim` even though the `manim` CLI works fine.
  # Only warn when NEITHER path is usable — otherwise it's a false alarm.
  if ! python3 -c "import manim" >/dev/null 2>&1 && ! command -v manim >/dev/null 2>&1; then
    warn "manim not importable and the 'manim' CLI is not on PATH. Likely cause:"
    warn "missing system headers. On Debian/Ubuntu, run:"
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
  local stage="$SKILL_SRC_DIR/manim"
  stage_source "manim" "$MANIM_UPSTREAM_REPO" "$stage" || warn "adithya-s-k/manim_skill staging failed — using whatever is on disk"
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
  local stage="$SKILL_SRC_DIR/karpathy"
  stage_source "karpathy" "$KARPATHY_REPO" "$stage" || warn "multica-ai/andrej-karpathy-skills staging failed — using whatever is on disk"
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
  local stage="$SKILL_SRC_DIR/marketing"
  stage_source "marketing" "$MARKETING_REPO" "$stage" || warn "coreyhaines31/marketingskills staging failed — using whatever is on disk"
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
  local stage="$SKILL_SRC_DIR/impeccable"
  stage_source "impeccable" "$IMPECCABLE_REPO" "$stage" || warn "pbakaus/impeccable staging failed — using whatever is on disk"
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
  local stage="$SKILL_SRC_DIR/taste"
  stage_source "taste" "$TASTE_REPO" "$stage" || warn "Leonxlnx/taste-skill staging failed — using whatever is on disk"
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

  # Always upgrade so a re-run pulls the latest graphifyy, mirroring the git
  # skill packs. graphifyy ships the `graphify` CLI, so when system pip is
  # missing ("No module named pip") or PEP 668 blocks --user, pipx (isolated
  # venv) is the right tool — the same fallback ensure_manim_deps uses.
  log "Installing/upgrading graphifyy (graphify CLI)"
  if python3 -m pip install --user --upgrade graphifyy 2>/dev/null; then
    :
  elif command -v pipx >/dev/null 2>&1; then
    warn "python3 -m pip unavailable (no pip module / PEP 668) — using pipx for graphifyy"
    pipx install graphifyy >/dev/null 2>&1 \
      || pipx upgrade graphifyy >/dev/null 2>&1 \
      || warn "pipx install/upgrade graphifyy failed"
  else
    warn "graphifyy install failed: no usable pip and no pipx. Install one, then run:"
    warn "  python3 -m pip install --user --upgrade graphifyy   (or: pipx install graphifyy)"
  fi

  # Wire the skill only if the CLI is actually on PATH now (or from a prior run).
  if ! command -v graphify >/dev/null 2>&1; then
    warn "graphify CLI not on PATH — skipping skill wiring. Add ~/.local/bin to PATH and re-run."
    return 0
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
  local stage="$SKILL_SRC_DIR/anthropic"
  stage_source "anthropic" "$ANTHROPIC_SKILLS_REPO" "$stage" || warn "anthropics/skills staging failed — using whatever is on disk"
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
    log "claude CLI not present — skipping plugin marketplaces (expected on servers without Claude Code; re-run here once it's installed to register them)."
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
  run_step "local overrides"  seed_local_overrides
  run_step "updater (fkt)"    install_fkt
  # Runs in minimal mode too: an install that once had the packs still carries
  # the misplaced clones, and leaving them behind keeps the duplicate plugins.
  run_step "staging migration" migrate_skill_staging
  run_step "bun"              ensure_bun
  run_step "gstack + browser" install_gstack
  run_step "rtk"              install_rtk
  run_step "providers"        setup_providers

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
  4. Switch API provider: run 'ccs list' to see them all, fill the token in
     $CLAUDE_DIR/providers/<name>.json, then run: ccs <name>
     For the hosted NVIDIA catalog, start its gateway first:
     $CLAUDE_DIR/scripts/nim-gateway.sh start && ccs nvidia
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

# Sourcing with CLAUDE_BOOTSTRAP_LIB_ONLY=1 loads the functions without running
# the bootstrap, so scripts/test-install.sh can exercise sync_repo,
# checkout_channel and stage_source directly against throwaway repositories.
# Without this the only way to test them is a full 20-minute install.
if [ "${CLAUDE_BOOTSTRAP_LIB_ONLY:-0}" != "1" ]; then
  main "$@"
fi
