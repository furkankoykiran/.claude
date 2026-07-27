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
check "config.json is seeded when absent" "0" "$([ -f "$CLAUDE_DIR/config.json" ]; echo $?)"

printf '{"edited":true}\n' > "$CLAUDE_DIR/config.json"
seed_configs >/dev/null 2>&1
check "an existing config.json is never overwritten" \
  '{"edited":true}' "$(cat "$CLAUDE_DIR/config.json")"

seed_local_overrides >/dev/null 2>&1
check "CLAUDE.local.md is seeded" "0" "$([ -f "$CLAUDE_DIR/CLAUDE.local.md" ]; echo $?)"
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
  "$([ -d "$CLAUDE_DIR/skills/.marketing_upstream_src" ]; echo $?)"
check "and lands under .cache/skill-src" "0" "$([ -d "$SKILL_SRC_DIR/marketing" ]; echo $?)"
migrate_skill_staging >/dev/null 2>&1
check "the migration is idempotent" "0" "$([ -d "$SKILL_SRC_DIR/marketing" ]; echo $?)"

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
  "$([ -d "$CLAUDE_DIR/skills/humanizer" ]; echo $?)"
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

printf '\n%s passed, %s failed\n' "$PASS" "$FAIL"
[ "$FAIL" -eq 0 ]