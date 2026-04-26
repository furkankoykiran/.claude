#!/bin/bash
# Claude Code Hook: Scan staged files for secrets on `git commit`
# Runs as PreToolUse matcher=Bash. Exits 0 (allow) on no-match or warning printed.
# Does NOT block — prints warning to stderr so the user can abort.

INPUT=$(cat)
COMMAND=$(echo "$INPUT" | jq -r '.tool_input.command // empty' 2>/dev/null || echo "")

[[ -z "$COMMAND" ]] && exit 0
echo "$COMMAND" | grep -q "git commit" || exit 0

STAGED=$(git diff --cached --name-only 2>/dev/null)
[[ -z "$STAGED" ]] && exit 0

HITS=$(echo "$STAGED" | xargs -I{} grep -l -i -E "(password|secret|api_key|apikey|token|credential|private_key|wallet)" {} 2>/dev/null)

if [[ -n "$HITS" ]]; then
    cat >&2 << EOF
⚠️  POSSIBLE SECRETS in staged files:
$HITS

Review these files before committing. If intentional (e.g. an .env.example
with placeholder keys), proceed. Otherwise unstage and use a vault.
EOF
fi

exit 0
