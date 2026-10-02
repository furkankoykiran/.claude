# Configuration

How to personalize the toolkit, switch API providers, wire MCP servers and
manage plugin marketplaces.

## Personalization

After install, edit:

- `~/.claude/config.json` — your username, blog dir, default language. Read by
  `utils/lib/config.py` and the personal skills.
- `~/.claude/settings.json` — Claude Code permissions, hooks, env vars.

Both are git-ignored, so your edits never conflict with `git pull`.

## API provider switching

The installer seeds a provider-switching system so Claude Code can run against
the official Anthropic API, a cheaper third-party model host, or a model you run
yourself — and you flip between them with one command.

```bash
ccs list                         # list available providers
ccs status                       # print the active provider
ccs use zai                      # route Claude Code through z.ai (GLM)
ccs anthropic                    # compatibility shorthand for: ccs use anthropic
ccs api zai                      # fill the local provider API key without echoing it
ccs logout zai                   # clear a local provider API key
ccs login codex                  # delegate to official codex login
ccs codex-model gpt-5.5 medium   # choose the Codex model and reasoning effort
ccs codex-status                 # print Codex gateway state and selected model
ccs account                      # print supported Codex account/auth fields
ccs usage                        # print supported Codex usage/rate-limit fields
ccs permissions                  # print Claude/Codex permission and Auto ownership
ccs doctor                       # check provider setup, safety merge and gateway state
```

`ccs` is installed as a real command. On Unix, WSL, and Git Bash the
installer writes `~/.local/bin/ccs` and adds that directory to normal shell
startup files. On native Windows it writes `ccs.ps1` under `$HOME\.local\bin`
and adds that directory to the user PATH.

### Available providers

| `ccs <name>` | Endpoint | You need | Notes |
| --- | --- | --- | --- |
| `anthropic` | `api.anthropic.com` | `claude login` | No token in the file; uses your normal claude.ai auth |
| `codex` | `127.0.0.1:4545` | `ccs login codex` + experimental local gateway | Routes Claude Code to the isolated Codex adapter. The 2026-09-30 live proof covered a GPT-5.5 Medium text and shell-tool round trip with Anthropic inference unavailable/observed, but it does not make the gateway non-experimental. |
| `zai` | `api.z.ai/api/anthropic` | z.ai API key | GLM models. [Subscription link](https://z.ai/subscribe?ic=SNPFQIQ7BD) (my referral) |
| `nvidia` | `127.0.0.1:4000` -> `build.nvidia.com` | NVIDIA API key + local gateway | Hosted NVIDIA catalog. [See below](#nvidia-nim) |
| `nvidia-nim` | your NIM container | a NIM deployment | Self-hosted NIM, no gateway. [See below](#nvidia-nim) |
| `deepseek` | `api.deepseek.com/anthropic` | DeepSeek API key | `deepseek-v4-pro` / `-flash` |
| `kimi` | `api.moonshot.ai/anthropic` | Moonshot API key | `kimi-k3[1m]` |
| `minimax` | `api.minimax.io/anthropic` | MiniMax API key | `MiniMax-M3[1m]`. Use `api.minimaxi.com` in China |
| `openrouter` | `openrouter.ai/api` | OpenRouter API key | Anthropic-format "skin"; any OpenRouter model slug |

Most remote providers in the table speak the Anthropic Messages API directly.
`nvidia` and `codex` are different: they route Claude Code to a local loopback
adapter, so a local gateway must be running before Claude Code can complete a
request.

Third-party endpoints implement the Anthropic schema to varying depth. Claude
Code sends its full capability set to any `ANTHROPIC_BASE_URL`, so if a provider
starts returning `400 Unsupported parameter(s): <field>`, that's the cause —
`CLAUDE_CODE_DISABLE_EXPERIMENTAL_BETAS=1` in the provider file is the first
thing to try.

Claude Code only speaks the Anthropic Messages API. Endpoints and variables in
the table follow each vendor's own Claude Code documentation. The `anthropic`,
`zai`, and `nvidia` rows are verified end-to-end here; the rest are configured
from vendor docs but not key-tested, so double-check the model id against your
plan if a request comes back 404.


### Codex gateway

Codex authentication stays with the official CLI. Run `ccs login codex` to call `codex login`; the toolkit never copies ChatGPT cookies, Codex tokens, or Claude subscription credentials into provider files. `ccs logout codex` delegates to `codex logout`.

Choose the Codex model independently from Claude aliases:

```bash
ccs codex-model gpt-5.5 medium
ccs codex
ccs codex-status
```

`ccs codex-model <model> <effort>` accepts a Codex model id and one of `none`, `low`, `medium`, `high`, or `xhigh`. The example above sets `CODEX_GATEWAY_MODEL=gpt-5.5` and `CODEX_GATEWAY_REASONING_EFFORT=medium`. `ccs codex` switches Claude Code to the loopback provider and starts or reuses `scripts/codex-anthropic-gateway.ts`, which supervises `codex app-server --stdio` behind `127.0.0.1:4545`. `ccs codex-start`, `ccs codex-stop`, and `ccs codex-status` expose the same lifecycle without switching providers.

`ccs models` reads the live Codex App Server catalog through the local gateway. Claude Code's raw gateway discovery only keeps `/v1/models` ids containing `claude` or `anthropic`, so Codex ids such as `gpt-5.5` are intentionally filtered by the client. When `ccs codex` activates the provider, it refreshes Claude Code's supported `modelPicker` rows from the live Codex catalog instead, using `behavesAs` for provider-specific model ids. `ccs codex-model` sets the default Codex model for Claude aliases and resumed sessions; if Claude Code sends an explicit Codex model id from the generated picker, the gateway honors that request for the turn.

`ccs account` and `ccs usage` read only supported Codex App Server RPCs through the local gateway: `account/read`, `account/rateLimits/read`, and `account/usage/read`. The output redacts email addresses, labels unavailable fields as unavailable, and points users back to ChatGPT Settings -> Usage for the authoritative UI. The toolkit does not scrape ChatGPT pages, read browser cookies, copy OAuth tokens, or infer quota recovery from reset timestamps. Local pricing estimates stay disabled because ChatGPT/Codex entitlement is not Anthropic API billing. Session usage surfaces have the same boundary: see [Codex session usage](codex-session-usage.md) before treating Claude Code usage data as billing or quota evidence. Model switching has its own boundary: see [Codex model switching](codex-model-switching.md) for what is live-proven and what remains unclaimed.

The current mode boundary is deliberately conservative. Manual mode and Plan mode are Claude Code client behavior and work through the Codex bridge. Auto mode is model-dependent in Claude Code; with the verified `gpt-5.5` setup, Claude Code reports Auto as unavailable for that model. Fast mode is an Opus 5 usage-credit feature and is not treated as a Codex capability.

Use `ccs permissions` to inspect the layered authority model for the active provider. Under `ccs codex`, Claude Code remains the authority for Bash, file tools, hooks, Claude-side MCP, tool results, and the permission UI. The Codex bridge starts Codex turns with a read-only sandbox, `approvalPolicy=never`, and no authoritative Codex auto-review path. Native Codex sandbox and approval-reviewer settings, including Codex Auto Review, apply when you use the official Codex CLI directly; they do not silently approve operations that Claude Code is expected to review.

The live zero-Anthropic acceptance test proves a narrow boundary: with Anthropic inference unavailable/observed, Claude Code sent a text prompt and a shell-tool turn through the Codex gateway and received the expected result. It does not prove every Claude Code feature, every MCP server, every model, or production-grade availability. Treat the Codex app-server bridge as experimental until upstream stabilizes it.

### How it works

`settings.json` is **generated by merging three layers**, lowest precedence
first (a real file, not a symlink, so the same flow works on Windows):

| Layer | Source | What it contributes |
| --- | --- | --- |
| 1 | the existing `settings.json` | everything not owned by a provider — keys Claude Code writes itself (`tui`, `agentPushNotifEnabled`), your own tweaks, hooks other tools installed |
| 2 | `settings.base.json` | repo-owned safety config: `permissions.deny`, the three safety hooks, `cleanupPeriodDays` |
| 3 | `providers/<active>.json` | provider routing keys: `env`, `model`, `apiKeyHelper` |

`permissions.deny` and `hooks` are **unioned** across all three, so a rule a
later layer happens not to mention is never dropped. The provider-owned routing keys in layer 3 are taken **wholesale** — a key the
new provider does not set is removed, not inherited, so no credential or base
URL can outlive a switch. `enabledPlugins` and `effortLevel` are user policy, so
provider files no longer reset them.

Use `ccs api <provider>` or `ccs auth <provider>` to fill API-key provider
files; the prompt is masked where the shell supports it, the local provider file
is kept mode `600`, and command output only shows a redacted suffix. For
ChatGPT/Codex entitlement, use the official `codex login`, `codex status`, and
`codex logout` flow; `ccs login chatgpt` delegates there and never copies those
tokens into provider JSON.

Edit the provider file for routing and models, or `settings.base.json` for safety config,
then re-switch; don't hand-edit `settings.json`. `ccs status` recomputes the
merge and warns when the live file is out of date, which catches both the mystery
`401` (an edited provider file that was never re-applied) and a safety rule that
exists in git but not on this machine.

`ccs` refuses to write `settings.json` at all if `jq` is missing or
`settings.base.json` is absent. Shipping a settings file that silently lacks its
safety block is worse than refusing to switch.

- `~/.claude/settings.base.json` — committed, repo-owned, and the only home for
  the safety config. The switcher reads it and never writes to it.
- `~/.claude/settings.json.example` — committed, and deliberately carries *only*
  the optional extras (`statusLine`, `permissions.allow`, `additionalDirectories`).
  It does not repeat the deny rules or the hooks, because a second copy is a
  copy that can fall behind. `install.sh` seeds `settings.json` as
  `settings.base.json` merged with this file, so an install that never picks a
  provider is still guarded.
- `~/.claude/providers/<name>.json` — the live config, mode `600` and
  git-ignored, because auth tokens live here.
- `~/.claude/providers/<name>.json.example` — committed templates carrying a
  `<ZAI_TOKEN>`-style placeholder. `ccs` warns while a placeholder is still in
  place, so a half-configured provider fails loudly instead of at request time.

> This used to be a straight copy of the provider file. Because no provider
> template carries the safety block, and the installer only seeds
> `settings.json` when it does not already exist, the first switch after install
> silently deleted this repo's 12 docker-volume deny rules and all three safety
> hooks — and nothing ever put them back. The guard was in git, passed review,
> and was registered on no machine that had ever run `ccs`. Re-running
> `install.sh` now re-applies the active provider, which repairs affected
> installs.

### Disk retention

`cleanupPeriodDays` controls Claude Code's own startup retention sweep — how
many days of transcripts, file history, shell snapshots, plans and other session
state it keeps. The default is 30; `settings.base.json` sets **14**, which
roughly halves the steady-state footprint of `~/.claude` with no code at all.

It lives in `settings.base.json` rather than in each provider file precisely so
a provider switch cannot wipe it. Run `fkt disk` to see what the sweep covers,
what is deliberately protected from it, and what sits outside it entirely —
see [updates.md](updates.md#disk).

Restart Claude Code after switching; it reads provider env at startup.

**Adding a provider** means dropping `providers/<name>.json.example` into the
repo. The provider list is discovered from whichever templates exist, so no code
in `cc-provider`, `install.sh`, or `install.ps1` needs to change.

### NVIDIA NIM

NVIDIA has two paths, and they need different providers:

**Self-hosted NIM container** (`ccs nvidia-nim`) — NIM serves `/v1/messages`
natively, so Claude Code talks to it directly with no gateway. Fill in your host
and deployed model in `providers/nvidia-nim.json`, then switch. This is
[NVIDIA's documented integration](https://docs.nvidia.com/nim/large-language-models/latest/ai-assistant-integrations/claude-code.html).

**Hosted catalog at [build.nvidia.com](https://build.nvidia.com)** (`ccs nvidia`)
— the hosted API is OpenAI-shaped and returns `404` on `/v1/messages`, so a small
local gateway translates between the two:

```bash
# 1. put your nvapi- key in the gateway config
#    ~/.claude/providers/nvidia-gateway.yaml   (git-ignored)
# 2. start the gateway (installs LiteLLM into its own venv on first run)
~/.claude/scripts/nim-gateway.sh start
# 3. switch
ccs nvidia
```

`nim-gateway.sh` also takes `stop`, `restart`, `status`, and `logs`; on Windows
use `pwsh ~\.claude\scripts\nim-gateway.ps1`. It binds loopback only and is
installed **on demand**, not by `install.sh`, so you don't carry a Python
dependency you never use. `ccs` warns if you switch to `nvidia` while the gateway
is down, which otherwise surfaces as an opaque connection error inside Claude
Code.

#### Which models the slots map to

Claude Code asks for three tiers, so the defaults mirror what each tier is for —
`opus` = most capable, `sonnet` = the balanced workhorse, `haiku` = cheapest and
fastest. Scores are the
[Artificial Analysis Intelligence Index v4.1](https://artificialanalysis.ai/);
latency is measured through this gateway, not vendor-published:

| Slot | Model | Index | $/1M in | $/1M out | Latency | Verified context |
| --- | --- | --- | --- | --- | --- | --- |
| `opus` | `minimaxai/minimax-m3` | 44 | $0.30 | $1.20 | ~11s | 355k |
| `sonnet` | `deepseek-ai/deepseek-v4-flash` | 40 | $0.14 | $0.28 | ~3s | 666k |
| `haiku` | `openai/gpt-oss-20b` | — | cheapest | — | ~0.6s | 89k |

Intelligence and price both descend across the three, which is the same shape as
Anthropic's own ladder. Two notes on what got left out: the catalog's strongest
models on paper — `z-ai/glm-5.2` (51) and `deepseek-ai/deepseek-v4-pro` (44) —
time out through the hosted API, and `nvidia/nemotron-3-ultra-550b-a55b` (38) is
dominated by the `sonnet` pick on intelligence, price, and context at once.

"Verified context" is measured, not advertised, and it is worth measuring:
`nvidia/nemotron-3-nano-omni-30b-a3b-reasoning` advertises 256k but **silently
truncated** a 400KB prompt down to 1,869 counted tokens — it answers normally
while having discarded the context, which is worse than an error. If you switch
models, send one oversized prompt and check the reported `input_tokens` scales
with what you sent.

To change any model, edit `providers/nvidia.json` and re-run `ccs nvidia` — the
wildcard in the gateway config forwards whatever id you name. One catch: if you
**pin** a model with `/model opus` or `--model`, Claude Code sends the literal
Anthropic id (`claude-opus-5`) rather than your mapping, so the gateway config
also maps those ids onto the same three tiers. Change a tier and you want both
files, which is why each says so.

Browse ids at [build.nvidia.com/models](https://build.nvidia.com/models), and
note that **Claude Code requires tool calling** while much of the catalog lacks
it, and availability varies by key — a model that `404`s is usually just not
enabled on your account.

## MCP servers

The repo-owned portable plugin marketplace includes MCP configuration generated from one registry: `mcp-registry.toml`. The portable `skills/fk-toolkit-ops/mcp.json` emits only no-auth, default-enabled servers, currently OpenAI Developer Docs at `https://developers.openai.com/mcp`. Auth-required entries stay in the registry and in `fkt mcp` output, but are not enabled in portable defaults because the plugin MCP schema has no disabled/auth-state field.

The current starter registry is:

| id | Auth | Default | Endpoint |
| --- | --- | --- | --- |
| `openaiDeveloperDocs` | none | enabled | `https://developers.openai.com/mcp` |
| `github` | API key | login-required | `https://api.githubcopilot.com/mcp/` |
| `linear` | OAuth | login-required | `https://mcp.linear.app/mcp` |
| `notion` | OAuth | login-required | `https://mcp.notion.com/mcp` |
| `sentry` | OAuth | login-required | `https://mcp.sentry.dev/mcp` |

Use `fkt mcp status`, `fkt mcp auth <id>`, `fkt mcp enable <id>`, `fkt mcp disable <id>`, and `fkt mcp doctor` to inspect and record those preferences. `fkt mcp doctor` validates the generated plugin MCP manifest against `mcp-registry.toml`, rejects manifest drift or auth-required endpoint leakage, and checks live `claude mcp list` / `codex mcp list` output when those CLIs are available. It then reports cross-host and enabled-endpoint duplicates by URL. Complete login in the host that will use the server: Claude Code users add the server with `claude mcp add --transport http ...` and run `/mcp`; Codex users use `codex mcp add ... --url ...` and `codex mcp login <id>` when the server supports OAuth. Tokens stay in native host storage, never in this repository.

`scripts/setup-mcp.sh` still configures the two older Claude-local examples, `github` and `context7`, for users who want that path. Those tokens are stored in `~/.claude.json` (mode `600`).

### MCP servers across a provider switch

There are two kinds of MCP server, and only one kind survives a switch away from
`anthropic`:

- **Local MCP servers** — the ones in `~/.claude.json` (`github`, `context7`,
  anything you add with `claude mcp add`). These carry their own URL and auth, so
  they work under **either** provider. Verified: `github` and `context7` respond
  under both z.ai and Anthropic.
- **claude.ai connectors** — servers you added at
  [claude.ai/customize/connectors](https://claude.ai/customize/connectors)
  (e.g. Fintables, Google Drive). Claude Code loads these **only while your active
  auth is your claude.ai subscription**. The moment a provider sets a credential
  of its own — which every provider except `anthropic` does — Claude Code stops
  fetching claude.ai connectors — [by design, per Anthropic's MCP docs](https://code.claude.com/docs/en/mcp#use-mcp-servers-from-claude-ai),
  not a bug. So `ccs anthropic` shows Fintables; every other provider hides it.

**To keep a connector like Fintables under a non-Anthropic provider, register it
as a local MCP server** (they publish a remote HTTP endpoint), so it no longer
depends on the claude.ai session:

```bash
claude mcp add --transport http fintables https://evo.fintables.com/mcp
/mcp                     # then complete the OAuth sign-in once, in an interactive session
```

Now `fintables` lives in `~/.claude.json` and loads under both providers. Add
only the connectors you actually use this way — each one is an extra startup
handshake. (Fintables MCP is free on their PRO/EVO tiers.)

## Plugin marketplaces

Beyond the file-copied skills, the installer registers four Claude Code **plugin
marketplaces** so a large catalog is one `/plugin install` away without loading
every skill into each session. Registering a marketplace is free; only
*installed* plugins cost per-session context — so the big collections stay
on-demand:

- [anthropics/skills](https://github.com/anthropics/skills) — the rest of
  Anthropic's official Agent Skills (marketplace `anthropic-agent-skills`).
- [wshobson/agents](https://github.com/wshobson/agents) — 80+ domain workflow
  plugins (marketplace `claude-code-workflows`).
- [obra/superpowers](https://github.com/obra/superpowers) — a TDD / debugging /
  planning methodology (`superpowers-dev`). Left install-on-demand because it
  overlaps gstack's own plan / review / investigate skills.
- [mukul975/Anthropic-Cybersecurity-Skills](https://github.com/mukul975/Anthropic-Cybersecurity-Skills)
  — 700+ MITRE/NIST-mapped security skills (`anthropic-cybersecurity-skills`).
  Marketplace-only so it never floods the catalog.

From `claude-code-workflows` it eagerly installs a few high-value domain plugins
that fill real gaps without conflicting with gstack: `backend-development`,
`data-engineering`, `cloud-infrastructure`, `cicd-automation`, `database-design`.

Browse and install more with `/plugin` (or
`claude plugin install <name>@<marketplace>`). **Trust note:** Claude Code does
not vet marketplace contents — only add sources you trust. Remove one with
`claude plugin marketplace remove <name>`.
