#!/bin/bash
# Claude Code Hook: Auto-format files after Edit/MultiEdit/Write
# Runs as PostToolUse matcher=Edit|MultiEdit|Write.
# Detects language by extension and runs project-appropriate formatter.
# Silent on success; never blocks (exit 0 always).

INPUT=$(cat)
FILE=$(echo "$INPUT" | jq -r '.tool_input.file_path // empty' 2>/dev/null || echo "")

[[ -z "$FILE" ]] && exit 0
[[ ! -f "$FILE" ]] && exit 0

case "$FILE" in
    *.py)
        command -v ruff >/dev/null 2>&1 || exit 0
        ruff format "$FILE" 2>/dev/null
        ruff check --fix "$FILE" 2>/dev/null
        ;;
    *.ts|*.tsx|*.js|*.jsx)
        ROOT=$(git -C "$(dirname "$FILE")" rev-parse --show-toplevel 2>/dev/null || dirname "$FILE")
        cd "$ROOT" || exit 0
        if [[ -f "pnpm-lock.yaml" ]]; then
            pnpm exec eslint --fix "$FILE" 2>/dev/null || pnpm exec prettier --write "$FILE" 2>/dev/null
        elif [[ -f "package.json" ]]; then
            npx --no-install eslint --fix "$FILE" 2>/dev/null || npx --no-install prettier --write "$FILE" 2>/dev/null
        fi
        ;;
esac

exit 0
