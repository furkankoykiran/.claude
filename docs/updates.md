# Updates

The toolkit ships in two layers and they update through different mechanisms.
Almost every update question is really a question about which layer you mean.

| Layer | What it holds | Updated by |
| --- | --- | --- |
| **Plugins** — `skills/fk-*` | skills, agents | Claude Code's plugin updater |
| **Bootstrap** — `~/.claude` | hooks, installer, provider scripts, global instructions, and the plugins' source of truth | `fkt` |

## Plugins

Native, and the preferred path for anything it can carry.

```
/plugin marketplace update fk-toolkit    # refresh the catalogue
/plugin update fk-gh-flow                # update one plugin
/plugin                                  # browse, enable, disable
```

Claude Code checks for marketplace and plugin updates in the background shortly
after startup, with a randomised delay. The running session keeps the versions
it launched with; new ones load on the next launch or after `/reload-plugins`.

Auto-update is **off by default for third-party marketplaces**, which includes
this one. Turn it on per marketplace in `/plugin` → Marketplaces → `fk-toolkit`.

To pin or roll back, point the marketplace entry's source at a specific `ref` or
`sha`, then `/plugin marketplace update fk-toolkit` and `/plugin update <name>`.

## Bootstrap: `fkt`

```bash
fkt status      # what is installed, which channel, cached check state, advisories
fkt check       # is there an update? (cached; exit 10 if yes)
fkt update      # fast-forward, then run migrations
```

`fkt` is installed as a shell function by `install.sh`. It is also
`~/.claude/bin/fkt` if you prefer the path.

### It refuses rather than repairs

An update stops, explains, and changes nothing when:

- **tracked files are modified** — `git -C ~/.claude status` shows what;
- **the checkout carries local commits** not on the target — the message prints
  the `git log` range to inspect;
- **HEAD is detached** — there is no branch to fast-forward.

All three are exit code `20`. None of them are resolved for you: this directory
holds your settings and your memory, and only you can decide what happens to
work you did in it. `fkt` never runs `reset --hard`, never runs `clean`, and
never stashes on your behalf.

`fkt update --dry-run` shows exactly which commits an update would bring in.

### Channels

```bash
fkt channel            # show
fkt channel stable     # default
fkt channel edge
```

| Channel | Toolkit follows | Third-party packs |
| --- | --- | --- |
| `stable` | the highest `v*` release tag | the SHAs reviewed in `skills-source.lock.json` |
| `edge` | `origin/main` | upstream `HEAD` |

`stable` is reproducible: two machines installing the same release get the same
skills, byte for byte. `edge` is not, and will occasionally be broken.

Switching clears the update cache and any snooze.

`install.sh` honours the same choice via `CLAUDE_BOOTSTRAP_CHANNEL=stable|edge`.

One interaction worth knowing: gstack ships its own `/gstack-upgrade`. If you run
it, gstack moves ahead of the pin and the next `install.sh` brings it back to the
reviewed revision. That is what the stable channel is for — use `edge` if you
want to track gstack's own HEAD.

### Update checks

Checks are cached for **12 hours** and are the only thing that touches the
network. A cached answer costs nothing and reaches nothing.

```bash
fkt check           # cached
fkt check --force   # ignore the cache
```

Exit codes, so a caller can branch without parsing prose:

| Code | Meaning |
| --- | --- |
| `0` | up to date, or an available update is snoozed |
| `2` | usage error |
| `10` | an update is available |
| `20` | refused — local changes or diverged history would be lost |
| `30` | offline, or the remote was unreachable |
| `40` | `~/.claude` is not a git checkout; reinstall rather than update |
| `50` | a migration failed |

### Turning it down

```bash
fkt snooze 168     # hide this update for a week (default 168h)
fkt disable        # stop update checks entirely
fkt enable         # resume
```

A **newer** release always breaks through a snooze.

`fkt disable` stops update checks. It does **not** stop security advisories —
see below. Those have their own switch.

### The session notice

`hooks/session-start-update-notice.sh` runs on SessionStart and prints two lines
when a cached check found an update: the version pair, and the convention for
handling it. Which convention depends on how the session started, which Claude
Code reports as `source` in the JSON payload it writes to the hook's stdin.

On a fresh **startup**, the convention asks Claude to open the reply with an
`AskUserQuestion` call — before any greeting or other prose — offering *Update
now*, *Skip for now* and *Show details*. Your answer is the only thing that
starts an update.

On **resume**, **clear**, **compact** and **fork**, and when no payload arrives,
you get the quieter line instead: Claude raises it with you in your own language
and runs `fkt update` only once you agree. Re-opening the question after every
compaction would be noise, and you already answered it.

A hook is a shell script, not an agent: it has no access to Claude Code's tools,
so it cannot call `AskUserQuestion` itself or wait for your answer. The text it
prints is its only lever. That also means the notice is a request, not a
guarantee — nothing here can force a tool call.

It is built not to be in your way:

- **no network on this path.** It reads the cache `fkt` already wrote. That
  includes discarding a cache written for a different version, which is a local
  `VERSION` comparison; the rebuild happens in the detached refresh.
- **the refresh is detached.** Startup never waits on DNS. A timing test in
  `scripts/test-fkt.sh` asserts this against an unroutable remote.
- **it does not wait on stdin.** The payload read is capped at one second, so a
  host that opens stdin and never writes cannot stall the session.
- **it always exits 0.** A broken or absent updater cannot stop Claude Code
  from starting.
- **it changes nothing.** Notification only; applying an update is always an
  explicit `fkt update`.

Remove the `SessionStart` block from `settings.json` to drop it entirely, or set
`FKT_UPDATE_CHECK=0`. To keep the notice but never be asked, set
`FKT_UPDATE_PROMPT=0`; non-interactive entrypoints are detected and skipped
already, because `claude -p` and the `dontAsk` permission mode both deny
`AskUserQuestion`.

### Why a cached check can be discarded

A cache line records the verdict *and* the version installed when it was
written. Nothing invalidates that line when the checkout moves — `fkt update`, a
plain `git pull`, or re-running `install.sh` all change `VERSION` behind its
back — so `fkt check` compares the two before trusting it, and drops the record
when they disagree or when the target is not actually ahead of what is
installed. `fkt status` marks such a record `stale` rather than reporting it.

Without that check a record could outlive its install and keep announcing an
update that had already landed; a `0.3.0 -> 0.3.1` notice once reached a 0.4.1
checkout, for a 0.3.1 that was never released.

### Migrations

Filesystem or configuration changes a plugin update cannot express. Each script
in `migrations/` runs at most once, in numeric order, and is idempotent anyway.

```bash
fkt migrate      # run pending migrations (also runs after a successful update)
```

A failure stops the run and **writes no completion marker**, so the migration is
retried once the cause is fixed. Later migrations do not run past a failure —
they may depend on it.

Applied markers live in the state directory, not in the repository, so cloning
the repo somewhere else does not mark them as done.

### Security advisories

`security-advisories.tsv` in the repository is a tab-separated feed:
`id`, `severity`, `introduced`, `fixed`, `summary`, `url`. `fkt` fetches it from
the default branch — so an advisory reaches installs pinned to an old release —
and prints any entry that applies to your installed version.

Deliberate properties:

- **It survives `fkt disable`.** Turning off "there is a new version" should not
  turn off "the version you are on has a known problem". Silence it separately
  with `fkt config security_notices false` or `FKT_SECURITY_NOTICES=0`.
- **It collects nothing.** One GET of one static file. No identifiers, no
  version reported upstream, no account, no endpoint of ours anywhere. The
  matching happens entirely on your machine.
- **A response that is not a feed is rejected.** A captive portal or an error
  page answering 200 will not be installed over a good cache — that would
  silently blind the check.

### Configuration

`~/.config/fk-toolkit/config` — a flat `key = value` file, safe to edit.

```bash
fkt config                              # show
fkt config channel edge
fkt config check_ttl_minutes 1440
fkt config security_notices false
```

| Key | Default | Meaning |
| --- | --- | --- |
| `channel` | `stable` | update channel |
| `update_check` | `true` | check for updates at all |
| `security_notices` | `true` | fetch and show advisories |
| `check_ttl_minutes` | `720` | how long a check result is reused |

Environment variables override the file for one run:

| Variable | Effect |
| --- | --- |
| `FKT_HOME` | toolkit checkout (default `~/.claude`) |
| `FKT_CONFIG_DIR` / `FKT_STATE_DIR` | config and state locations |
| `FKT_CHANNEL` | `stable` or `edge` |
| `FKT_UPDATE_CHECK=0` | disable update checks |
| `FKT_SECURITY_NOTICES=0` | disable advisories |
| `FKT_GSTACK_UPDATE=0` | skip the `skills/gstack` fast-forward |
| `FKT_OFFLINE=1` | forbid all network access |
| `FKT_ADVISORY_URL_BASE` | point the advisory feed elsewhere (testing, air-gapped) |

State lives in `~/.local/state/fk-toolkit/`: the check cache, the snooze marker,
applied-migration markers and the cached advisory feed. Deleting it is safe — the
worst case is that migrations already applied are re-run, and they are idempotent.

### gstack

`skills/gstack` is neither part of this repository's history nor a Claude Code
plugin. It is an independent checkout of `garrytan/gstack` with its own
upstream, its own `VERSION` and its own `./setup`, so for a long time `fkt
update` skipped it, the plugin updater skipped it, and nothing on the machine
kept it current — it only moved when someone remembered to run
`/gstack-upgrade` by hand.

That is not a theoretical gap. It left `AskUserQuestion` broken here for eleven
days: gstack's question-preference hook returned `permissionDecision: 'defer'`
on its pass-through path, which since Claude Code 2.1.89 means "pause for
external resumption" rather than "no opinion". Nothing resumed it, so every call
came back as `[Tool result missing due to internal error]`. The fix was two
commits upstream the whole time.

`fkt update` now fast-forwards gstack on both paths — after a bootstrap update
and after a no-op one, since most days there is nothing else to do — then runs
gstack's `./setup --no-prefix`, because a bare fast-forward leaves the checkout
ahead of what is actually wired into Claude Code.

It obeys the same rules as the rest of `fkt`:

| Situation | What happens |
| --- | --- |
| `skills/gstack/.git` missing | nothing, silently — a toolkit without gstack is a supported layout |
| `FKT_GSTACK_UPDATE=0` or `FKT_OFFLINE=1` | skipped |
| fetch fails | warn, carry on |
| already at `origin/main` | nothing |
| worktree dirty, or local commits | warn and point at `/gstack-upgrade`; never reset |
| otherwise | `merge --ff-only`, then `./setup --no-prefix`, reporting old → new |

Every branch returns success. A gstack problem must never fail `fkt update`.

The reason this is fast-forward-only rather than a call out to
`/gstack-upgrade` is that `/gstack-upgrade` runs `git stash && git fetch && git
reset --hard origin/main`. That is a fine thing for a user to ask for
explicitly, and the wrong thing for an updater whose first design rule is that
it never destroys local work. When gstack cannot be fast-forwarded, `fkt` says
so and leaves the decision to you.

### Disk

`fkt disk` reports what `~/.claude` costs and who is responsible for each part
of it. It is read-only and there is no `--clean`.

Claude Code already runs a retention sweep at startup, behind a 24-hour sentinel
(`~/.claude/.last-cleanup`) and gated on the `cleanupPeriodDays` setting. It
works, so this repo does not ship a second sweeper that would race it. What was
missing is that nothing said the setting exists, and nothing distinguished the
directories core handles from the ones it provably cannot reach.

The report has three sections:

- **Swept by Claude Code** — `projects/` and its sidecars, `file-history/`,
  `session-env/`, `shell-snapshots/`, `plans/`, `debug/`, `backups/`,
  `paste-cache/`. Nothing to do; lower `cleanupPeriodDays` if they are large.
- **Never touched** — `cache/nim-gateway/` (a live litellm venv whose pidfile
  can be stale, so "is it running" is not a safe heuristic),
  `projects/*/memory/` (holds `MEMORY.md`), and `catalog/cache/` (named cache,
  but git-tracked and needed for offline `catalog:generate`). Hard-coded, not
  configurable.
- **Outside every sweep** — `~/.cache/claude-cli-nodejs/<slug>/` for projects
  that no longer exist (core only sweeps the slug for the current working
  directory, so these are unreachable forever — upstream
  `anthropics/claude-code#87678`), `~/.claude.json.tmp.*` left by dead PIDs
  (`anthropics/claude-code#87677`), and `.cache/skill-src/`, which is ours and
  pinned by the lock — shrink it with `git gc --prune=now` per clone rather than
  by deleting it.

`cleanupPeriodDays` is set in `settings.base.json`, not in a provider file, so
it survives a provider switch. See [configuration.md](configuration.md).

## Local customisation that updates cannot touch

`CLAUDE.md` is **tracked**, and an update overwrites it. Put machine-specific or
private instructions in `CLAUDE.local.md`, which is gitignored and seeded on
install. `config.json`, `settings.json` and `providers/*.json` are likewise
gitignored and never overwritten — the installer seeds them from `.example`
templates only when they are absent.

If you want to change something the toolkit tracks, commit the change in your
checkout. `fkt` will then refuse to fast-forward past it and tell you, rather
than dropping it on the floor.