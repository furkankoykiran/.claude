#!/usr/bin/env bash
# Behavioural tests for install.sh's repository and staging logic.
#
# install.sh is sourced with CLAUDE_BOOTSTRAP_LIB_ONLY=1, which loads the
# functions without running the bootstrap, so the parts that can lose a user's
# work are testable without a twenty-minute end-to-end install. The full
# end-to-end path is covered separately by the install-smoke CI job.
#
# Every fixture is a throwaway local repository. Nothing here touches the real
# ~/.claude and nothing reaches the network.
#
# Run: ./scripts/test-install.sh

set -uo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

PASS=0
FAIL=0
WORK=""

cleanup() { [ -n "$WORK" ] && rm -rf "$WORK"; }
trap cleanup EXIT

pass() { PASS=$((PASS + 1)); printf '  \033[0;32mok\033[0m   %s\n' "$1"; }
fail() { FAIL=$((FAIL + 1)); printf '  \033[0;31mFAIL\033[0m %s\n' "$1"; [ -n "${2-}" ] && printf '        %s\n' "$2"; }

check() {
  local label="$1" expected="$2" actual="$3"
  if [ "$expected" = "$actual" ]; then
    pass "$label"
  else
    fail "$label" "expected '$expected', got '$actual'"
  fi
}

git_q() { git -C "$1" "${@:2}" >/dev/null 2>&1; }
file_status() { if [ -f "$1" ]; then printf '0\n'; else printf '1\n'; fi; }
dir_status() { if [ -d "$1" ]; then printf '0\n'; else printf '1\n'; fi; }

# Build a git repository with two commits; the first is tagged v1.0.0.
# Prints the SHA of the FIRST commit, which is what the lock will pin.
make_upstream() {
  local dir="$1"
  mkdir -p "$dir"
  git_q "$dir" init -b main
  git_q "$dir" config user.email t@example.invalid
  git_q "$dir" config user.name Test
  mkdir -p "$dir/skills/demo"
  printf -- '---\nname: demo\ndescription: pinned\n---\nold\n' > "$dir/skills/demo/SKILL.md"
  git_q "$dir" add -A
  git_q "$dir" commit -m first
  git_q "$dir" tag v1.0.0
  local first
  first="$(git -C "$dir" rev-parse HEAD)"
  printf -- '---\nname: demo\ndescription: head\n---\nnew\n' > "$dir/skills/demo/SKILL.md"
  git_q "$dir" add -A
  git_q "$dir" commit -m second
  printf '%s\n' "$first"
}

echo "install.sh: repository and staging"

WORK="$(mktemp -d)"

# ---------------------------------------------------------------------------
# stage_source: pins to the reviewed SHA on stable, follows HEAD on edge
# ---------------------------------------------------------------------------
UPSTREAM="$WORK/upstream"
PINNED_SHA="$(make_upstream "$UPSTREAM")"
HEAD_SHA="$(git -C "$UPSTREAM" rev-parse HEAD)"

CLAUDE_DIR="$WORK/claude"
mkdir -p "$CLAUDE_DIR"
cat > "$CLAUDE_DIR/skills-source.lock.json" <<EOF
{
  "schemaVersion": 1,
  "resolverVersion": "1",
  "sources": [
    {
      "id": "other",
      "type": "runtime",
      "selectedPaths": [],
      "canonicalSkills": []
    },
    {
      "id": "demo",
      "type": "git",
      "repo": "$UPSTREAM",
      "configuredRef": "origin/HEAD",
      "resolvedRevision": "$PINNED_SHA",
      "selectedPaths": [],
      "canonicalSkills": []
    }
  ],
  "skills": []
}
EOF

# shellcheck source=/dev/null
CLAUDE_BOOTSTRAP_LIB_ONLY=1 CLAUDE_DIR="$CLAUDE_DIR" source "$REPO_ROOT/install.sh"

# install.sh sets `-e` at the top, and sourcing applies that to THIS shell. Half
# these tests deliberately exercise functions that return non-zero, so leaving it
# on would abort the run at the first refusal and report a pass.
set +e

check "locked_revision reads the pinned SHA" "$PINNED_SHA" "$(locked_revision demo)"
check "locked_revision is empty for a source with no revision" "" "$(locked_revision other)"
check "locked_revision is empty for an unknown source" "" "$(locked_revision nope)"

STAGE="$WORK/stage-stable"
CLAUDE_BOOTSTRAP_CHANNEL=stable stage_source demo "$UPSTREAM" "$STAGE" >/dev/null 2>&1
check "stable checks out the reviewed SHA, not upstream HEAD" \
  "$PINNED_SHA" "$(git -C "$STAGE" rev-parse HEAD 2>/dev/null)"
if grep -q "description: pinned" "$STAGE/skills/demo/SKILL.md" 2>/dev/null; then
  pass "the staged content is the pinned revision's content"
else
  fail "the staged content is the pinned revision's content"
fi

# Re-staging an existing clone must land on the pin too, not drift to HEAD.
git_q "$STAGE" checkout --detach main
CLAUDE_BOOTSTRAP_CHANNEL=stable stage_source demo "$UPSTREAM" "$STAGE" >/dev/null 2>&1
check "re-staging an existing clone returns it to the pin" \
  "$PINNED_SHA" "$(git -C "$STAGE" rev-parse HEAD 2>/dev/null)"

STAGE_EDGE="$WORK/stage-edge"
CLAUDE_BOOTSTRAP_CHANNEL=edge stage_source demo "$UPSTREAM" "$STAGE_EDGE" >/dev/null 2>&1
check "edge follows upstream HEAD" "$HEAD_SHA" "$(git -C "$STAGE_EDGE" rev-parse HEAD 2>/dev/null)"

# A non-empty, non-git directory is somebody's files. Refuse; never delete.
STAGE_OCCUPIED="$WORK/stage-occupied"
mkdir -p "$STAGE_OCCUPIED"
printf 'my own work\n' > "$STAGE_OCCUPIED/NOTES.md"
OCC_OUT="$(CLAUDE_BOOTSTRAP_CHANNEL=stable stage_source demo "$UPSTREAM" "$STAGE_OCCUPIED" 2>&1)"
check "staging refuses a non-empty directory that is not a checkout" \
  "my own work" "$(cat "$STAGE_OCCUPIED/NOTES.md" 2>/dev/null)"
if printf '%s' "$OCC_OUT" | grep -q "refusing to replace it"; then
  pass "and says why"
else
  fail "and says why" "$(printf '%s' "$OCC_OUT" | tail -2 | tr '\n' ' ')"
fi

# An EMPTY directory is fine to clone into — a half-made mkdir must not block.
STAGE_EMPTY="$WORK/stage-empty"
mkdir -p "$STAGE_EMPTY"
CLAUDE_BOOTSTRAP_CHANNEL=stable stage_source demo "$UPSTREAM" "$STAGE_EMPTY" >/dev/null 2>&1
check "staging still works into an empty directory" \
  "$PINNED_SHA" "$(git -C "$STAGE_EMPTY" rev-parse HEAD 2>/dev/null)"

# An unreachable pin must warn and fall back, not fail silently or hang.
cat > "$CLAUDE_DIR/skills-source.lock.json" <<EOF
{
  "schemaVersion": 1,
  "resolverVersion": "1",
  "sources": [
    {
      "id": "demo",
      "type": "git",
      "repo": "$UPSTREAM",
      "configuredRef": "origin/HEAD",
      "resolvedRevision": "$(printf 'd%.0s' {1..40})",
      "selectedPaths": [],
      "canonicalSkills": []
    }
  ],
  "skills": []
}
EOF
STAGE_BAD="$WORK/stage-bad"
BAD_OUT="$(CLAUDE_BOOTSTRAP_CHANNEL=stable stage_source demo "$UPSTREAM" "$STAGE_BAD" 2>&1)"
if printf '%s' "$BAD_OUT" | grep -q "not reachable upstream"; then
  pass "an unreachable pin is reported, not silently ignored"
else
  fail "an unreachable pin is reported, not silently ignored" "$(printf '%s' "$BAD_OUT" | tail -2 | tr '\n' ' ')"
fi
check "an unreachable pin falls back to upstream HEAD" \
  "$HEAD_SHA" "$(git -C "$STAGE_BAD" rev-parse HEAD 2>/dev/null)"

# No lock at all: warn, and still install something usable.
rm -f "$CLAUDE_DIR/skills-source.lock.json"
STAGE_NOLOCK="$WORK/stage-nolock"
NOLOCK_OUT="$(CLAUDE_BOOTSTRAP_CHANNEL=stable stage_source demo "$UPSTREAM" "$STAGE_NOLOCK" 2>&1)"
if printf '%s' "$NOLOCK_OUT" | grep -q "no locked revision"; then
  pass "a missing lock warns that the install is not deterministic"
else
  fail "a missing lock warns that the install is not deterministic"
fi

# ---------------------------------------------------------------------------
# sync_repo / checkout_channel: never destroy the user's work
# ---------------------------------------------------------------------------
TOOLKIT_UP="$WORK/toolkit-upstream"
make_upstream "$TOOLKIT_UP" >/dev/null   # the tag is what matters here, not the SHA
git clone --quiet --bare "$TOOLKIT_UP" "$WORK/toolkit.git"

fresh_checkout() {
  local dir="$1"
  rm -rf "$dir"
  git clone --quiet "$WORK/toolkit.git" "$dir"
  git_q "$dir" config user.email t@example.invalid
  git_q "$dir" config user.name Test
  git_q "$dir" reset --hard v1.0.0
}

CLAUDE_DIR="$WORK/toolkit"
fresh_checkout "$CLAUDE_DIR"

# Dirty worktree: refuse, change nothing.
printf 'mine\n' >> "$CLAUDE_DIR/skills/demo/SKILL.md"
BEFORE="$(git -C "$CLAUDE_DIR" rev-parse HEAD)"
SYNC_OUT="$(CLAUDE_BOOTSTRAP_CHANNEL=edge sync_repo 2>&1)"
check "a dirty worktree is not moved" "$BEFORE" "$(git -C "$CLAUDE_DIR" rev-parse HEAD)"
if printf '%s' "$SYNC_OUT" | grep -q "NOT updating"; then
  pass "the refusal is reported"
else
  fail "the refusal is reported" "$(printf '%s' "$SYNC_OUT" | tail -2 | tr '\n' ' ')"
fi
if grep -q '^mine$' "$CLAUDE_DIR/skills/demo/SKILL.md"; then
  pass "the local edit survived"
else
  fail "the local edit survived"
fi

# Local commits that are not on the target: refuse, keep them.
fresh_checkout "$CLAUDE_DIR"
printf 'local\n' > "$CLAUDE_DIR/LOCAL.md"
git_q "$CLAUDE_DIR" add -A
git_q "$CLAUDE_DIR" commit -m "local work"
LOCAL_SHA="$(git -C "$CLAUDE_DIR" rev-parse HEAD)"
DIVERGED_OUT="$(CLAUDE_BOOTSTRAP_CHANNEL=edge sync_repo 2>&1)"
check "a diverged checkout is not moved" "$LOCAL_SHA" "$(git -C "$CLAUDE_DIR" rev-parse HEAD)"
if printf '%s' "$DIVERGED_OUT" | grep -q "local commits"; then
  pass "the divergence is named in the refusal"
else
  fail "the divergence is named in the refusal"
fi

# Clean checkout: fast-forward to the right ref for each channel.
fresh_checkout "$CLAUDE_DIR"
CLAUDE_BOOTSTRAP_CHANNEL=stable sync_repo >/dev/null 2>&1
check "stable stays on the newest release tag" \
  "$(git -C "$CLAUDE_DIR" rev-parse v1.0.0)" "$(git -C "$CLAUDE_DIR" rev-parse HEAD)"

CLAUDE_BOOTSTRAP_CHANNEL=edge sync_repo >/dev/null 2>&1
check "edge fast-forwards to origin/main" \
  "$(git -C "$CLAUDE_DIR" rev-parse origin/main)" "$(git -C "$CLAUDE_DIR" rev-parse HEAD)"

# Still on a branch afterwards — a detached HEAD would strand the user.
if [ -n "$(git -C "$CLAUDE_DIR" symbolic-ref --quiet --short HEAD 2>/dev/null)" ]; then
  pass "the checkout is left on a branch, not detached"
else
  fail "the checkout is left on a branch, not detached"
fi

# Idempotency: a second sync changes nothing and still succeeds.
AFTER="$(git -C "$CLAUDE_DIR" rev-parse HEAD)"
CLAUDE_BOOTSTRAP_CHANNEL=edge sync_repo >/dev/null 2>&1
check "a second sync is a no-op" "$AFTER" "$(git -C "$CLAUDE_DIR" rev-parse HEAD)"

# ---------------------------------------------------------------------------
# seeding: never overwrite what the user already has
# ---------------------------------------------------------------------------
CLAUDE_DIR="$WORK/seed"
mkdir -p "$CLAUDE_DIR"
printf '{"mine":true}\n' > "$CLAUDE_DIR/config.json.example"
printf '{"mine":true}\n' > "$CLAUDE_DIR/settings.json.example"
seed_configs >/dev/null 2>&1
check "config.json is seeded when absent" "0" "$(file_status "$CLAUDE_DIR/config.json")"

printf '{"edited":true}\n' > "$CLAUDE_DIR/config.json"
seed_configs >/dev/null 2>&1
check "an existing config.json is never overwritten" \
  '{"edited":true}' "$(cat "$CLAUDE_DIR/config.json")"

seed_local_overrides >/dev/null 2>&1
check "CLAUDE.local.md is seeded" "0" "$(file_status "$CLAUDE_DIR/CLAUDE.local.md")"
printf 'my notes\n' > "$CLAUDE_DIR/CLAUDE.local.md"
seed_local_overrides >/dev/null 2>&1
check "an existing CLAUDE.local.md is never overwritten" "my notes" "$(cat "$CLAUDE_DIR/CLAUDE.local.md")"

# ---------------------------------------------------------------------------
# staging migration: legacy clones move out of skills/
# ---------------------------------------------------------------------------
CLAUDE_DIR="$WORK/migrate"
SKILL_SRC_DIR="$CLAUDE_DIR/.cache/skill-src"
mkdir -p "$CLAUDE_DIR/skills/.marketing_upstream_src/.claude-plugin"
printf '{}\n' > "$CLAUDE_DIR/skills/.marketing_upstream_src/.claude-plugin/plugin.json"
migrate_skill_staging >/dev/null 2>&1
check "a legacy staging clone is moved out of skills/" "1" \
  "$(dir_status "$CLAUDE_DIR/skills/.marketing_upstream_src")"
check "and lands under .cache/skill-src" "0" "$(dir_status "$SKILL_SRC_DIR/marketing")"
migrate_skill_staging >/dev/null 2>&1
check "the migration is idempotent" "0" "$(dir_status "$SKILL_SRC_DIR/marketing")"

# ---------------------------------------------------------------------------
# migration 0001: retires superseded directories without destroying them
# ---------------------------------------------------------------------------
CLAUDE_DIR="$WORK/mig"
mkdir -p "$CLAUDE_DIR/skills/humanizer" "$CLAUDE_DIR/skills/fk-writing-kit/skills/humanizer"
git_q "$CLAUDE_DIR" init -b main
git_q "$CLAUDE_DIR" config user.email t@example.invalid
git_q "$CLAUDE_DIR" config user.name Test
printf 'new\n' > "$CLAUDE_DIR/skills/fk-writing-kit/skills/humanizer/SKILL.md"
printf 'MINE — not the shipped one\n' > "$CLAUDE_DIR/skills/humanizer/SKILL.md"

FKT_HOME="$CLAUDE_DIR" bash "$REPO_ROOT/migrations/0001-plugin-layout.sh" >/dev/null 2>&1
check "the superseded directory is gone from skills/" "1" \
  "$(dir_status "$CLAUDE_DIR/skills/humanizer")"
check "but its content was moved, not deleted" "MINE — not the shipped one" \
  "$(cat "$CLAUDE_DIR/.cache/superseded-skills/humanizer/SKILL.md" 2>/dev/null)"

# Re-created afterwards, a second run must not clobber the first rescue.
mkdir -p "$CLAUDE_DIR/skills/humanizer"
printf 'second\n' > "$CLAUDE_DIR/skills/humanizer/SKILL.md"
FKT_HOME="$CLAUDE_DIR" bash "$REPO_ROOT/migrations/0001-plugin-layout.sh" >/dev/null 2>&1
check "a second rescue does not overwrite the first" "MINE — not the shipped one" \
  "$(cat "$CLAUDE_DIR/.cache/superseded-skills/humanizer/SKILL.md" 2>/dev/null)"
check "and lands beside it" "second" \
  "$(cat "$CLAUDE_DIR/.cache/superseded-skills/humanizer.1/SKILL.md" 2>/dev/null)"

# A git-TRACKED legacy copy is left strictly alone.
mkdir -p "$CLAUDE_DIR/skills/add-mcp" "$CLAUDE_DIR/skills/fk-toolkit-ops/skills/add-mcp"
printf 'tracked\n' > "$CLAUDE_DIR/skills/add-mcp/SKILL.md"
printf 'new\n' > "$CLAUDE_DIR/skills/fk-toolkit-ops/skills/add-mcp/SKILL.md"
git_q "$CLAUDE_DIR" add -f skills/add-mcp/SKILL.md
git_q "$CLAUDE_DIR" commit -m tracked
FKT_HOME="$CLAUDE_DIR" bash "$REPO_ROOT/migrations/0001-plugin-layout.sh" >/dev/null 2>&1
check "a git-tracked legacy copy is left in place" "tracked" \
  "$(cat "$CLAUDE_DIR/skills/add-mcp/SKILL.md" 2>/dev/null)"

# ---------------------------------------------------------------------------
# full-bootstrap upstream packs: Agent-Reach, UI/UX Pro Max, BRAG slim
# ---------------------------------------------------------------------------
make_skill_repo() {
  local dir="$1" first
  shift
  mkdir -p "$dir"
  git_q "$dir" init -b main
  git_q "$dir" config user.email t@example.invalid
  git_q "$dir" config user.name Test
  printf 'MIT\n' > "$dir/LICENSE"
  while [ "$#" -gt 0 ]; do
    local rel="$1" body="$2"
    shift 2
    mkdir -p "$dir/$(dirname "$rel")"
    printf -- '%s\n' "$body" > "$dir/$rel"
  done
  git_q "$dir" add -A
  git_q "$dir" commit -m first
  first="$(git -C "$dir" rev-parse HEAD)"
  printf 'head-only\n' > "$dir/HEAD_ONLY.txt"
  git_q "$dir" add -A
  git_q "$dir" commit -m second
  printf '%s\n' "$first"
}

AGENT_UP="$WORK/agent-reach-upstream"
AGENT_SHA="$(make_skill_repo "$AGENT_UP" \
  agent_reach/skill/SKILL.md $'---\nname: agent-reach\ndescription: pinned agent reach\n---\npinned\n' \
  agent_reach/install.sh 'runtime installer must not be copied')"

UIUX_UP="$WORK/uiux-upstream"
UIUX_SHA="$(make_skill_repo "$UIUX_UP" \
  .claude/skills/banner-design/SKILL.md $'---\nname: banner-design\ndescription: pinned banner\n---\npinned\n' \
  .claude/skills/brand/SKILL.md $'---\nname: brand\ndescription: pinned brand\n---\npinned\n' \
  .claude/skills/design/SKILL.md $'---\nname: design\ndescription: pinned design\n---\npinned\n' \
  .claude/skills/design-system/SKILL.md $'---\nname: design-system\ndescription: pinned design system\n---\npinned\n' \
  .claude/skills/slides/SKILL.md $'---\nname: slides\ndescription: pinned slides\n---\npinned\n' \
  .claude/skills/ui-styling/SKILL.md $'---\nname: ui-styling\ndescription: pinned styling\n---\npinned\n' \
  .claude/skills/ui-ux-pro-max/SKILL.md $'---\nname: ui-ux-pro-max\ndescription: pinned pro max\n---\npinned\n')"

BRAG_UP="$WORK/brag-upstream"
BRAG_SHA="$(make_skill_repo "$BRAG_UP" \
  skills/brag-slim/SKILL.md $'---\nname: brag-slim\ndescription: pinned slim\n---\npinned\n' \
  skills/brag/SKILL.md $'---\nname: brag\ndescription: full runtime\n---\nfull\n')"

CLAUDE_DIR="$WORK/full-bootstrap-packs"
SKILL_SRC_DIR="$CLAUDE_DIR/.cache/skill-src"
LOCK_FILE="$CLAUDE_DIR/skills-source.lock.json"
mkdir -p "$CLAUDE_DIR"
cat > "$LOCK_FILE" <<EOF
{
  "schemaVersion": 1,
  "resolverVersion": "1",
  "sources": [
    {"id":"agent_reach","type":"git","repo":"$AGENT_UP","resolvedRevision":"$AGENT_SHA","selectedPaths":[],"canonicalSkills":[]},
    {"id":"ui_ux_pro_max","type":"git","repo":"$UIUX_UP","resolvedRevision":"$UIUX_SHA","selectedPaths":[],"canonicalSkills":[]},
    {"id":"brag_slim","type":"git","repo":"$BRAG_UP","resolvedRevision":"$BRAG_SHA","selectedPaths":[],"canonicalSkills":[]}
  ],
  "skills": []
}
EOF
AGENT_REACH_REPO="$AGENT_UP" CLAUDE_BOOTSTRAP_CHANNEL=stable install_agent_reach_skill >/dev/null 2>&1
UI_UX_PRO_MAX_REPO="$UIUX_UP" CLAUDE_BOOTSTRAP_CHANNEL=stable install_ui_ux_pro_max_skills >/dev/null 2>&1
BRAG_REPO="$BRAG_UP" CLAUDE_BOOTSTRAP_CHANNEL=stable install_brag_slim_skill >/dev/null 2>&1

check "Agent-Reach safe skill installs from the locked revision" "0" \
  "$(grep -q '^pinned$' "$CLAUDE_DIR/skills/agent-reach/SKILL.md" 2>/dev/null; echo $?)"
check "Agent-Reach runtime installer is not copied" "1" \
  "$(file_status "$CLAUDE_DIR/skills/agent-reach/install.sh")"
check "UI/UX Pro Max approved skill set installs" "7" \
  "$(find "$CLAUDE_DIR/skills" -maxdepth 2 -name .from_ui_ux_pro_max | wc -l | tr -d ' ')"
check "BRAG slim installs by default" "0" \
  "$(grep -q '^pinned$' "$CLAUDE_DIR/skills/brag-slim/SKILL.md" 2>/dev/null; echo $?)"
check "BRAG full runtime stays out of full bootstrap" "1" \
  "$(file_status "$CLAUDE_DIR/skills/brag/SKILL.md")"
check "PowerShell installer has Agent-Reach parity" "0" \
  "$(grep -q 'Install-AgentReachSkill' "$REPO_ROOT/install.ps1"; echo $?)"
check "PowerShell installer has UI/UX Pro Max parity" "0" \
  "$(grep -q 'Install-UiUxProMaxSkillSet' "$REPO_ROOT/install.ps1"; echo $?)"
check "PowerShell installer has BRAG slim parity" "0" \
  "$(grep -q 'Install-BragSlimSkill' "$REPO_ROOT/install.ps1"; echo $?)"
check "PowerShell installer has no-sync CI mode" "0" \
  "$(grep -q 'CLAUDE_BOOTSTRAP_NO_SYNC' "$REPO_ROOT/install.ps1"; echo $?)"

# ---------------------------------------------------------------------------
# user commands: ccs/fkt must be real commands in a clean shell
# ---------------------------------------------------------------------------
install_commands_for() {
  local home="$1" dir="$2"
  mkdir -p "$dir/bin" "$dir/migrations"
  cp "$REPO_ROOT/bin/fkt" "$dir/bin/fkt"
  cat > "$dir/bin/cc-provider" <<'EOF'
#!/usr/bin/env bash
exit 0
EOF
  chmod 755 "$dir/bin/cc-provider"
  ( HOME="$home" CLAUDE_DIR="$dir" install_fkt >/dev/null 2>&1
    HOME="$home" CLAUDE_DIR="$dir" install_ccs_command >/dev/null 2>&1
    HOME="$home" bash -lc 'command -v ccs; command -v fkt' )
}

COMMAND_HOME="$WORK/commands-default"
mkdir -p "$COMMAND_HOME"
check "a clean login shell can discover ccs and fkt after install" \
  "$COMMAND_HOME/.local/bin/ccs
$COMMAND_HOME/.local/bin/fkt" \
  "$(install_commands_for "$COMMAND_HOME" "$COMMAND_HOME/.claude")"

check "the default ccs command resolves the default toolkit lazily" \
  "toolkit_dir=\${CLAUDE_DIR:-\$HOME/.claude}" \
  "$(grep '^toolkit_dir=' "$COMMAND_HOME/.local/bin/ccs")"
check "the default fkt command honors FKT_HOME first" \
  "toolkit_dir=\${FKT_HOME:-\${CLAUDE_DIR:-\$HOME/.claude}}" \
  "$(grep '^toolkit_dir=' "$COMMAND_HOME/.local/bin/fkt")"

COMMAND_HOME2="$WORK/commands-custom"
mkdir -p "$COMMAND_HOME2"
install_commands_for "$COMMAND_HOME2" "$COMMAND_HOME2/elsewhere" >/dev/null
check "a custom CLAUDE_DIR is embedded in the ccs command" \
  "toolkit_dir=\${CLAUDE_DIR:-'$COMMAND_HOME2/elsewhere'}" \
  "$(grep '^toolkit_dir=' "$COMMAND_HOME2/.local/bin/ccs")"
check "a custom CLAUDE_DIR is embedded in the fkt command" \
  "toolkit_dir=\${FKT_HOME:-\${CLAUDE_DIR:-'$COMMAND_HOME2/elsewhere'}}" \
  "$(grep '^toolkit_dir=' "$COMMAND_HOME2/.local/bin/fkt")"

# Re-running must not append duplicate PATH blocks.
install_commands_for "$COMMAND_HOME" "$COMMAND_HOME/.claude" >/dev/null
check "command PATH setup does not append a duplicate on re-run" "1" \
  "$(grep -c 'FK Claude Toolkit commands (managed by' "$COMMAND_HOME/.profile")"

LEGACY_HOME="$WORK/legacy-functions"
mkdir -p "$LEGACY_HOME" "$LEGACY_HOME/.claude/bin"
cp "$REPO_ROOT/bin/fkt" "$LEGACY_HOME/.claude/bin/fkt"
cat > "$LEGACY_HOME/.claude/bin/cc-provider" <<'EOF'
#!/usr/bin/env bash
exit 0
EOF
chmod 755 "$LEGACY_HOME/.claude/bin/cc-provider"
cat > "$LEGACY_HOME/.bashrc" <<'EOF'
keep_before=1
# Claude Code provider switcher (managed by ~/.claude/install.sh)
ccs() { "$HOME/.claude/bin/cc-provider" "$@"; }
# FK Claude Toolkit updater (managed by /tmp/old/.claude/install.sh)
fkt() { "$HOME/.claude/bin/fkt" "$@"; }
keep_after=1
EOF
HOME="$LEGACY_HOME" CLAUDE_DIR="$LEGACY_HOME/.claude" install_fkt >/dev/null 2>&1
HOME="$LEGACY_HOME" CLAUDE_DIR="$LEGACY_HOME/.claude" install_ccs_command >/dev/null 2>&1
check "obsolete managed ccs/fkt shell functions are removed" "0" \
  "$(grep -Ec '^(ccs|fkt)\(\)' "$LEGACY_HOME/.bashrc")"
check "legacy function migration preserves unrelated shell content" \
  $'keep_before=1
keep_after=1' \
  "$(grep '^keep_' "$LEGACY_HOME/.bashrc")"

printf '\n%s passed, %s failed\n' "$PASS" "$FAIL"
[ "$FAIL" -eq 0 ]