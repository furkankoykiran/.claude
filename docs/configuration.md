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
ccs list         # every available provider
ccs zai          # route Claude Code through z.ai (GLM)
ccs anthropic    # route through the official Anthropic API
ccs status       # print the active provider
```

`ccs` is a shell function the installer adds to your shell profile (`~/.bashrc`
on Unix, `$PROFILE` on Windows). It works identically on both.

### Available providers

| `ccs <name>` | Endpoint | You need | Notes |
| --- | --- | --- | --- |
| `anthropic` | `api.anthropic.com` | `claude login` | No token in the file; uses your normal claude.ai auth |
| `zai` | `api.z.ai/api/anthropic` | z.ai API key | GLM models. [Subscription link](https://z.ai/subscribe?ic=SNPFQIQ7BD) (my referral) |
| `nvidia` | `127.0.0.1:4000` -> `build.nvidia.com` | NVIDIA API key + local gateway | Hosted NVIDIA catalog. [See below](#nvidia-nim) |
| `nvidia-nim` | your NIM container | a NIM deployment | Self-hosted NIM, no gateway. [See below](#nvidia-nim) |
| `deepseek` | `api.deepseek.com/anthropic` | DeepSeek API key | `deepseek-v4-pro` / `-flash` |
| `kimi` | `api.moonshot.ai/anthropic` | Moonshot API key | `kimi-k3[1m]` |
| `minimax` | `api.minimax.io/anthropic` | MiniMax API key | `MiniMax-M3[1m]`. Use `api.minimaxi.com` in China |
| `openrouter` | `openrouter.ai/api` | OpenRouter API key | Anthropic-format "skin"; any OpenRouter model slug |

Every provider except `nvidia` talks to an endpoint that speaks the Anthropic
Messages API directly, so there is nothing to run and nothing to translate.

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

### How it works

`settings.json` is a **generated copy** of the active provider file (copied, not
symlinked, so the same flow works on Windows). Edit the provider file, then
re-switch; don't hand-edit `settings.json` — `ccs status` warns when the two
drift apart, which is the usual cause of a mystery `401`.

- `~/.claude/providers/<name>.json` — the live config, mode `600` and
  git-ignored, because auth tokens live here.
- `~/.claude/providers/<name>.json.example` — committed templates carrying a
  `<ZAI_TOKEN>`-style placeholder. `ccs` warns while a placeholder is still in
  place, so a half-configured provider fails loudly instead of at request time.

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

`scripts/setup-mcp.sh` configures the two portable ones:

- **github** (HTTP) — needs a personal access token
- **context7** (HTTP) — needs a Context7 API key

Tokens are stored in `~/.claude.json` (mode `600`), never in this repo. For
other MCP servers, use `claude mcp add` directly (or the `/add-mcp` skill).

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
