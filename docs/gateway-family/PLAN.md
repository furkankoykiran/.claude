# Plan

1. Inspect repository guidance, history, installed JCode and upstream architecture read-only; record evidence and contract differences.
2. Harden each provider adapter without moving execution into the gateway. Add bounded cleanup and contract regressions.
3. Align contributor/security/community docs, health/configuration conventions and CI checks. Preserve provider-specific structure where useful.
4. Move gateway protocol detail out of the toolkit; correct stale capability claims and canonical test commands.
5. Run documented checks and isolated live acceptance; commit, push and merge child PRs through required checks.
6. Pin merged child commits, run parent gates, and merge its PR through required checks. Record exact SHAs and unproven boundaries.
