# Gateway parity

| Boundary | Codex | Gemini |
| --- | --- | --- |
| Harness authority | Claude Code tools, MCP, hooks, permissions | Claude Code tools, MCP, hooks, permissions |
| Current-turn authority | Fresh text creates ephemeral thread/turn; reminders rejected | Fresh text takes priority; reminders rejected |
| Continuation origin | Actual server RPC ID + thread + turn + Claude session | Local issued-tool cycle + original arguments + session + model |
| Tool results | Actual success/failure answers original callback once | Actual success/failure maps to issued Google function call; claim is atomic |
| Cleanup | Configured RPC/origin deadline, interruption, terminal/resolved events, provider shutdown | Configured HTTP/cycle deadline, abort, shutdown, terminal/late stream rejection |
| Runtime schemas/models | Request-declared schema; request model or configured alias target; live model/list | Request-declared schema; explicit/configured model; live Developer API list; configured-only Vertex |
| Health | Loopback health/healthz, version/configuration; no entitlement claim | Loopback health/healthz, version/configuration/auth state; no entitlement claim |
| Structure | index entrypoint, protocol, client transport, HTTP server | index entrypoint, translation, auth, cycle contract, HTTP server |
| Checks | Frozen Bun, shell syntax, TypeScript, 71 tests, Gateway CI | Frozen Bun, shell syntax, TypeScript, 28 tests, Gateway CI |
| Live evidence | GPT-6.1 Sol/Medium real Penpot result and fresh next turn | Official credentials unavailable; no live inference claim |
| Auth | Official Codex CLI state | Official API key or explicit Vertex project/access token; ADC refresh unimplemented |
| Open-source hygiene | README, AGENTS, CONTRIBUTING, SECURITY, CODE_OF_CONDUCT, MIT file, About/topics | Same documents, existing MIT file, About/topics, new lockfile |

Both gateways buffer complete provider responses before publishing Anthropic SSE; incremental token latency is unproven. JCode was inspected read-only for provider separation and cancellation ideas; no code or credentials were copied. Provider transports intentionally differ.
