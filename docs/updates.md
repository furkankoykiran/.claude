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

`hooks/session-start-update-notice.sh` runs on SessionStart and prints one line
when a cached check found an update, so Claude can tell you and offer to run it.

It is built not to be in your way:

- **no network on this path.** It reads the cache `fkt` already wrote.
- **the refresh is detached.** Startup never waits on DNS. A timing test in
  `scripts/test-fkt.sh` asserts this against an unroutable remote.
- **it always exits 0.** A broken or absent updater cannot stop Claude Code
  from starting.
- **it changes nothing.** Notification only; applying an update is always an
  explicit `fkt update`.

Remove the `SessionStart` block from `settings.json` to drop it entirely, or set
`FKT_UPDATE_CHECK=0`.

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
| `FKT_OFFLINE=1` | forbid all network access |
| `FKT_ADVISORY_URL_BASE` | point the advisory feed elsewhere (testing, air-gapped) |

State lives in `~/.local/state/fk-toolkit/`: the check cache, the snooze marker,
applied-migration markers and the cached advisory feed. Deleting it is safe — the
worst case is that migrations already applied are re-run, and they are idempotent.

## Local customisation that updates cannot touch

`CLAUDE.md` is **tracked**, and an update overwrites it. Put machine-specific or
private instructions in `CLAUDE.local.md`, which is gitignored and seeded on
install. `config.json`, `settings.json` and `providers/*.json` are likewise
gitignored and never overwritten — the installer seeds them from `.example`
templates only when they are absent.

If you want to change something the toolkit tracks, commit the change in your
checkout. `fkt` will then refuse to fast-forward past it and tell you, rather
than dropping it on the floor.