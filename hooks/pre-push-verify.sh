#!/bin/bash
# Claude Code Hook: Pre-push CI gate
# OPT-IN: reference this script from settings.json PreToolUse when ready.
#
# Runs as PreToolUse matcher=Bash. Detects `git push`, runs project-detected
# verification (make check | pnpm typecheck+lint | ruff+mypy) and BLOCKS push
# on failure via exit 2. Addresses insights friction: "buggy_code (40)" — lint
# failures surfacing post-PR, builds never verified locally.

INPUT=$(cat)
COMMAND=$(echo "$INPUT" | jq -r '.tool_input.command // empty' 2>/dev/null || echo "")

[[ -z "$COMMAND" ]] && exit 0
echo "$COMMAND" | grep -qE "^\s*git\s+push(\s|$)" || exit 0

ROOT=$(git rev-parse --show-toplevel 2>/dev/null) || exit 0
cd "$ROOT" || exit 0

echo "🔍 Pre-push verification..." >&2
FAILED=0

run() {
    local label="$1"; shift
    echo "  → $label" >&2
    if ! "$@" >/tmp/pre-push-verify.log 2>&1; then
        echo "  ✗ $label FAILED (log: /tmp/pre-push-verify.log)" >&2
        FAILED=1
    else
        echo "  ✓ $label" >&2
    fi
}

if [[ -f "Makefile" ]] && grep -qE "^check:" Makefile; then
    run "make check" make check
elif [[ -f "pnpm-lock.yaml" ]]; then
    run "pnpm typecheck" pnpm -s typecheck
    run "pnpm lint" pnpm -s lint
elif [[ -f "package.json" ]]; then
    run "npm test" npm test --silent
elif [[ -f "pyproject.toml" ]] || [[ -f "setup.py" ]]; then
    command -v ruff >/dev/null && run "ruff check" ruff check .
    command -v mypy >/dev/null && run "mypy" mypy .
else
    echo "  (no recognized project — skipping)" >&2
fi

if [[ $FAILED -eq 1 ]]; then
    cat >&2 << 'EOF'

🛑 BLOCKED: Pre-push verification failed.
Fix the failing check(s) and retry push. To bypass this hook for a single push,
use `git push --no-verify` (discouraged).
EOF
    exit 2
fi

exit 0
