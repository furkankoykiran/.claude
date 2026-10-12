# Gateway family goals

Make the Codex and Gemini inference gateways consistent at the Claude Code boundary while preserving provider transports. Claude Code owns MCP, hooks, permissions, and execution. Preserve the Codex Penpot continuation baseline. No npm or update-distribution changes.

Success requires scoped tests for current-turn authority, exact tool correlation, cancellation, timeout, and late events; documented checks in each repository; live Codex Penpot next-turn acceptance and safe Gemini acceptance where official credentials permit; child PR merges before the parent pins merged SHAs. All pushes use feat/gateway-family-standardization and normal merge gates.
