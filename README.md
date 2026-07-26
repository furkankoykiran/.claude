# `.claude` — Furkan Köykıran's Claude Code setup

[![CI](https://github.com/furkankoykiran/.claude/actions/workflows/ci.yml/badge.svg)](https://github.com/furkankoykiran/.claude/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)
![Platform](https://img.shields.io/badge/platform-Linux%20%7C%20macOS%20%7C%20Windows-lightgrey)

My personal [Claude Code](https://claude.com/claude-code) configuration —
`CLAUDE.md`, custom skills, agents, hooks, and utility scripts, plus a
self-contained bootstrap that wires in a handful of upstream tools (gstack, rtk,
manim, graphify, several skill packs, Anthropic's official skills, and curated
plugin marketplaces).

It's public so others can fork it, borrow pieces, and leave the rest. The
installer is **idempotent** (safe to re-run) and **fail-soft** (one broken
optional tool never sinks the whole setup).

## Quickstart

### Linux / macOS (and Windows via WSL or Git Bash)

```bash
curl -fsSL https://raw.githubusercontent.com/furkankoykiran/.claude/main/install.sh | bash
```

### Windows (native PowerShell, no WSL)

```powershell
irm https://raw.githubusercontent.com/furkankoykiran/.claude/main/install.ps1 | iex
```

> On native Windows you need **Git for Windows** (it bundles Git Bash, which runs
> gstack's setup) and **Node.js** (Chromium is driven by Node there). The
> installer checks for both and guides you if either is missing.

### Manual

```bash
git clone https://github.com/furkankoykiran/.claude ~/.claude
cd ~/.claude && ./install.sh          # or:  .\install.ps1  on Windows
```

If `~/.claude` already has files, the installer turns it into a git repo
tracking this remote (`git reset --hard origin/main`). Your local `cache/`,
`sessions/`, `.credentials.json`, `config.json`, etc. stay put — they're already
git-ignored.

## Platform support

| Component | Linux | macOS | Windows (native) | Windows (WSL) |
| --- | :---: | :---: | :---: | :---: |
| Core (`CLAUDE.md`, agents, hooks, skills) | ✅ | ✅ | ✅ | ✅ |
| gstack + headless browser | ✅ | ✅ | ✅ (Git Bash + Node) | ✅ |
| rtk token proxy | ✅ | ✅ | ⚠️ filters only¹ | ✅ |
| manim-narration | ✅ | ✅ | ✅ | ✅ |
| graphify | ✅ | ✅ | ✅ | ✅ |

¹ On native Windows, rtk's token *filters* work but its PreToolUse *hook*
auto-install is WSL-only ([rtk#671](https://github.com/rtk-ai/rtk/discussions/671)).

## Installer flags

Both installers honour the same knobs:

| Knob | Effect |
| --- | --- |
| `CLAUDE_DIR=/path` | Install target (default `~/.claude`) |
| `CLAUDE_BOOTSTRAP_MINIMAL=1` / `-Minimal` | Core only (configs + gstack + rtk); skip heavy skill packs |
| `CLAUDE_BOOTSTRAP_NO_SYNC=1` | Use the working tree as-is; skip the git fetch/reset (local testing, offline) |

## What the installer does

1. Syncs the repo at `~/.claude` (unless `CLAUDE_BOOTSTRAP_NO_SYNC=1`).
2. Seeds `config.json` and `settings.json` from the `.example` files — only if
   missing, never overwriting yours.
3. Installs [`bun`](https://bun.sh) (gstack's runtime).
4. Clones [gstack](https://github.com/garrytan/gstack) and runs its setup,
   linking its slash commands (`/qa`, `/review`, `/ship`, `/browse`, `/retro`, …).
   On Linux it first installs Chromium's system libraries so the headless
   browser actually launches (see [Troubleshooting](#troubleshooting)).
5. Installs [rtk](https://github.com/rtk-ai/rtk) and wires its PreToolUse hook.
6. Seeds `providers/*.json` from every committed template and adds the `ccs`
   shell function, so [switching API providers](#api-provider-switching) works
   out of the box. Nothing is activated until you run `ccs <name>` yourself.
7. Installs Python deps (`manim`, `edge-tts`) and `ffmpeg` for `manim-narration`.
8. Clones five upstream skill packs into `~/.claude/skills/` (each git-ignored,
   auto-discovered by Claude Code):
   [adithya-s-k/manim_skill](https://github.com/adithya-s-k/manim_skill),
   [multica-ai/andrej-karpathy-skills](https://github.com/multica-ai/andrej-karpathy-skills),
   [coreyhaines31/marketingskills](https://github.com/coreyhaines31/marketingskills),
   [pbakaus/impeccable](https://github.com/pbakaus/impeccable), and
   [Leonxlnx/taste-skill](https://github.com/Leonxlnx/taste-skill).
9. File-copies a curated, always-on subset of Anthropic's official
   [anthropics/skills](https://github.com/anthropics/skills) — the
   office-document and authoring skills (`docx`, `pdf`, `pptx`, `xlsx`,
   `doc-coauthoring`) plus `mcp-builder`, `skill-creator`, and
   `web-artifacts-builder`. Overlapping skills and the name-colliding
   `claude-api` are skipped.
10. Installs (or upgrades) [graphify](https://pypi.org/project/graphifyy/) and
    wires its skill — re-running the bootstrap pulls the latest `graphifyy`, just
    like the git skill packs above.
11. Registers four [plugin marketplaces](#plugin-marketplaces) and installs a
    curated set of workflow plugins (see below). Skipped if the `claude` CLI
    isn't on `PATH` yet.
12. Optionally configures portable MCP servers (`github`, `context7`).

Every step except cloning the repo is **fail-soft**: a failure is recorded and
printed in an end-of-run summary instead of aborting the bootstrap. Re-run
`./install.sh` after fixing the cause — it picks up where it left off.

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

## Skills Catalog

Every skill this setup represents — repository-owned **and** the resolvable
upstream packs (gstack, marketing, taste, manim, impeccable, anthropic, …) — is
indexed in a **deterministic Skills Catalog**. The catalog is generated from a
declarative source manifest ([`skills-sources.toml`](skills-sources.toml)) and
an immutable lock ([`skills-source.lock.json`](skills-source.lock.json)); it is
byte-for-byte reproducible and needs no LLM to build. See
[`docs/catalog-architecture.md`](docs/catalog-architecture.md).

```bash
bun install                         # one-time
bun run catalog:resolve             # fetch/verify pinned upstream revisions (network)
bun run catalog:resolve --update    # advance tracked upstream refs (network)
bun run catalog:generate            # regenerate all catalog outputs (offline)
bun run catalog:check               # parity + consistency + policy + determinism
bun run catalog:diff                # diff against a base catalog
bun run typecheck && bun test catalog
```

Outputs include [`SKILLS_CATALOG.md`](SKILLS_CATALOG.md) (index),
[`claude_code_skills.md`](claude_code_skills.md) (portable single-file export),
[`skills-catalog.json`](skills-catalog.json) (machine-readable),
[`docs/skills/`](docs/skills/) (per-skill pages), and
[`SHA256SUMS`](SHA256SUMS). `claude_code_skills.md` is published as a
downloadable asset on every [GitHub Release](https://github.com/furkankoykiran/.claude/releases);
release/update automation is documented in
[`docs/release-automation.md`](docs/release-automation.md).

## Updating

```bash
cd ~/.claude && git pull && ./install.sh      # macOS/Linux
```
```powershell
cd ~/.claude; git pull; .\install.ps1          # Windows
```

## Troubleshooting

<details>
<summary><strong>Linux: "gstack setup failed: Playwright Chromium could not be launched" / <code>libatk-1.0.so.0: cannot open shared object file</code></strong></summary>

The Chromium *binary* downloads fine, but on a clean server/container its
OS-level shared libraries (GTK/graphics: `libatk`, `libnss3`, `libcups`, …) are
missing, so it can't *launch*. The installer now fixes this automatically
(`ensure_browser_deps` + a Playwright `install-deps` retry). To repair an
existing install by hand, as root:

```bash
cd ~/.claude/skills/gstack && bunx playwright install-deps chromium && ./setup --no-prefix
```

On Ubuntu 24.04+ some packages were renamed (`libasound2` → `libasound2t64`,
etc.); Playwright's `install-deps` knows the current names, which is why it's
preferred over a hand-written `apt` list.
</details>

<details>
<summary><strong>Windows: "Git Bash (bash.exe) not found"</strong></summary>

gstack's setup is a bash script. Install [Git for Windows](https://git-scm.com/download/win)
(it bundles Git Bash) and re-run `install.ps1`.
</details>

<details>
<summary><strong>Windows: gstack browser/screenshots don't work</strong></summary>

On Windows, Chromium is driven by **Node.js** (Bun can't launch it there —
[oven-sh/bun#4253](https://github.com/oven-sh/bun/issues/4253)). Install
[Node.js LTS](https://nodejs.org/) (or `winget install OpenJS.NodeJS.LTS`) and
re-run.
</details>

<details>
<summary><strong>A tool didn't install / the run ended with a "skipped or failed" summary</strong></summary>

That's the fail-soft design working — the rest of the setup still completed.
Read the listed step name, fix its cause (often a missing system dependency),
and re-run the installer; it's idempotent.
</details>

## Uninstall

```bash
rm -rf ~/.claude ~/.claude.json ~/.gstack    # macOS/Linux; rtk binary: ~/.local/bin/rtk
```
```powershell
Remove-Item -Recurse -Force $HOME\.claude, $HOME\.claude.json, $HOME\.gstack   # Windows
```

## Layout

```
.
├── CLAUDE.md                 # global instructions (loaded at session start)
├── agents/                   # custom subagents (researcher, code-reviewer, …)
├── hooks/                    # PreToolUse / PostToolUse / pre-push hooks
├── skills/                   # personal + upstream slash commands
├── scripts/                  # helpers (setup-mcp.sh, …)
├── utils/                    # Python utilities (blog-scan, github-scan, …)
├── memory/                   # per-user memory templates
├── .github/                  # CI, issue/PR templates, Dependabot
├── config.json.example       # template for ~/.claude/config.json
├── settings.json.example     # template for ~/.claude/settings.json
├── install.sh                # bootstrap (Linux/macOS/WSL/Git Bash)
└── install.ps1               # bootstrap (native Windows PowerShell)
```

`CLAUDE.md` is kept tight (under Anthropic's ~200-line target); domain knowledge
lives in skills, loaded on demand.

## Contributing & security

- Contributions are welcome — see [CONTRIBUTING.md](CONTRIBUTING.md).
- Found a security issue? See [SECURITY.md](SECURITY.md) (report privately).
- Be kind — see the [Code of Conduct](CODE_OF_CONDUCT.md).
- Notable changes are tracked in [CHANGELOG.md](CHANGELOG.md).

## License

[MIT](LICENSE) — take what you want. Bundled upstream skill packs keep their own
licenses (cloned at install time, not redistributed here).