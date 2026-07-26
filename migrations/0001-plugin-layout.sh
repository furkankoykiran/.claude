#!/usr/bin/env bash
# 0001 — repo-owned skills became plugins.
#
# Before: skills/<name>/SKILL.md, loaded bare as /<name>.
# After:  skills/fk-<plugin>/skills/<name>/SKILL.md, loaded as /fk-<plugin>:<name>.
#
# Git moved the tracked copies, but an existing checkout can still be carrying
# the OLD directories as untracked leftovers (they were removed from the
# .gitignore allowlist in the same change, so git will not clean them up and
# will not warn). Left in place, every one of these skills loads twice — once
# bare, once namespaced — competing for the same routing decision.
#
# This removes a legacy directory only when the identically-named skill exists
# in its new plugin home AND the legacy copy is not tracked by git. Anything
# unexpected is reported and left alone.

set -euo pipefail

CLAUDE_DIR="${FKT_HOME:-$HOME/.claude}"
SKILLS="$CLAUDE_DIR/skills"

# legacy directory name -> plugin that now owns it
MOVED="
find-issues:fk-gh-flow
find-repos:fk-gh-flow
github-comment:fk-gh-flow
pr-followup:fk-gh-flow
solve-issue:fk-gh-flow
blog-from-chat:fk-writing-kit
github-profile-blog:fk-writing-kit
humanizer:fk-writing-kit
linkedin-post:fk-writing-kit
manim-narration:fk-manim-video
add-mcp:fk-toolkit-ops
"

removed=0
kept=0

for entry in $MOVED; do
  name="${entry%%:*}"
  plugin="${entry##*:}"
  legacy="$SKILLS/$name"
  new="$SKILLS/$plugin/skills/$name/SKILL.md"

  [ -d "$legacy" ] || continue

  if [ ! -f "$new" ]; then
    echo "  keeping $legacy — $plugin does not provide $name in this checkout" >&2
    kept=$((kept + 1))
    continue
  fi

  # Never delete something git is tracking: that would be a real content loss,
  # and it means this checkout is not in the state this migration assumes.
  if git -C "$CLAUDE_DIR" ls-files --error-unmatch "skills/$name" >/dev/null 2>&1; then
    echo "  keeping $legacy — still tracked by git" >&2
    kept=$((kept + 1))
    continue
  fi

  rm -rf "$legacy"
  removed=$((removed + 1))
done

# The old top-level agents/ dir moved into the fk-eng-agents plugin the same way.
if [ -d "$CLAUDE_DIR/agents" ] && [ -d "$SKILLS/fk-eng-agents/agents" ]; then
  for f in "$CLAUDE_DIR"/agents/*.md; do
    [ -f "$f" ] || continue
    base="$(basename "$f")"
    if [ -f "$SKILLS/fk-eng-agents/agents/$base" ] \
       && ! git -C "$CLAUDE_DIR" ls-files --error-unmatch "agents/$base" >/dev/null 2>&1; then
      rm -f "$f"
      removed=$((removed + 1))
    fi
  done
  rmdir "$CLAUDE_DIR/agents" 2>/dev/null || true
fi

echo "  removed $removed superseded director(ies), kept $kept"
if [ "$removed" -gt 0 ]; then
  echo "  skills are now namespaced: /humanizer is /fk-writing-kit:humanizer, etc."
  echo "  see docs/migration-plugins.md"
fi