#!/usr/bin/env bash
# Run Claude Code's own strict validator over the marketplace and every plugin.
#
# `claude plugin validate --strict` is the authority on what is publishable: it
# rejects unknown fields, type errors, and — critically — a marketplace entry
# whose version disagrees with the plugin.json it points at, which would
# otherwise be silently wrong at install time.
#
# CI treats a missing `claude` CLI as a skip, not a pass: the exit status says
# so, and the message names what was not checked.

set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$REPO_ROOT"

if ! command -v claude >/dev/null 2>&1; then
  echo "SKIP: the 'claude' CLI is not installed; marketplace manifests were NOT validated." >&2
  exit "${MARKETPLACE_VALIDATE_SKIP_CODE:-0}"
fi

failures=0

validate() {
  local target="$1"
  echo "--- $target"
  if ! claude plugin validate "$target" --strict; then
    failures=$((failures + 1))
  fi
}

validate "$REPO_ROOT"

# Every directory the marketplace publishes, read from the generated manifest so
# this can never drift from what is actually shipped.
while IFS= read -r src; do
  validate "$REPO_ROOT/${src#./}"
done < <(bun -e '
  const m = JSON.parse(await Bun.file(".claude-plugin/marketplace.json").text());
  for (const p of m.plugins) console.log(p.source);
')

if [ "$failures" -gt 0 ]; then
  echo "xx $failures manifest(s) failed strict validation" >&2
  exit 1
fi
echo "==> marketplace + plugins: strict validation passed"
