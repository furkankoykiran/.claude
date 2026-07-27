# Migrating to the plugin layout

The toolkit's own skills became Claude Code plugins. Skills that used to be
called by a bare name are now namespaced.

## What changed

| Before | After |
| --- | --- |
| `/humanizer` | `/fk-writing-kit:humanizer` |
| `/blog-from-chat` | `/fk-writing-kit:blog-from-chat` |
| `/github-profile-blog` | `/fk-writing-kit:github-profile-blog` |
| `/linkedin-post` | `/fk-writing-kit:linkedin-post` |
| `/find-issues` | `/fk-gh-flow:find-issues` |
| `/find-repos` | `/fk-gh-flow:find-repos` |
| `/github-comment` | `/fk-gh-flow:github-comment` |
| `/pr-followup` | `/fk-gh-flow:pr-followup` |
| `/solve-issue` | `/fk-gh-flow:solve-issue` |
| `/manim-narration` | `/fk-manim-video:manim-narration` |
| `/add-mcp` | `/fk-toolkit-ops:add-mcp` |
| `researcher` (agent) | `fk-eng-agents:researcher` |
| `planner`, `code-reviewer`, `debugger` | likewise under `fk-eng-agents:` |

Namespacing is not optional: Claude Code always namespaces plugin components by
plugin name. It is also what makes the plugins independently installable, and
what stops a name collision with someone else's `humanizer`.

**Nothing was removed and no behaviour changed.** Only the invocation names.

## If you install by cloning to `~/.claude`

Nothing to do beyond updating.

```bash
fkt update      # or: cd ~/.claude && ./install.sh
```

Migration `0001-plugin-layout` runs automatically and removes the superseded
bare directories. Without it every affected skill would load **twice** — once
bare, once namespaced — competing for the same routing decision.

The migration is deliberately conservative. It removes `skills/<name>/` only when
both are true:

- the replacement exists at `skills/<plugin>/skills/<name>/SKILL.md`;
- git is not tracking the old copy.

Anything else is reported and left alone. If you had edited one of those
directories, git is tracking it, and the migration will tell you it kept it —
your copy will shadow nothing, but you should move your changes into the plugin
directory and delete the old one yourself.

## If you install from the marketplace

```
/plugin marketplace add furkankoykiran/.claude
/plugin install fk-gh-flow@fk-toolkit
```

Install only the plugins you want. That is the point of the split — see
[Skill context economy](skill-context-economy.md) for why it matters.

| Plugin | Contents | Listing cost |
| --- | --- | --- |
| `fk-gh-flow` | 5 GitHub workflow skills | 746 chars |
| `fk-writing-kit` | 4 writing skills | 819 chars |
| `fk-manim-video` | narrated Manim video | 248 chars |
| `fk-toolkit-ops` | MCP setup, toolkit updates | 161 chars |
| `fk-eng-agents` | 4 subagents, no skills | **0** |

## Updating your own references

Anything of yours that names these skills needs the new form:

- `settings.json` permission rules — `Skill(humanizer)` becomes
  `Skill(fk-writing-kit:humanizer)`;
- `CLAUDE.md` / `CLAUDE.local.md` instructions that mention a skill by name;
- scripts, aliases, or hooks that invoke one.

`settings.json` and `CLAUDE.local.md` are yours and gitignored, so no automated
migration touches them. `settings.json.example` has been updated, but it only
seeds a *new* install.

## Future renames

If a plugin is ever renamed, the marketplace manifest carries a `renames` map and
Claude Code migrates existing installs automatically. That mechanism does not
cover this change — it maps plugin name to plugin name, and this was a move from
no plugin to a plugin, which is why migration `0001` exists instead.

## Reverting

There is no supported downgrade path for the layout itself; the plugins are how
the toolkit ships now. To pin to the last release before the change:

```bash
cd ~/.claude
git log --oneline --tags       # find the last v0.1.x tag
git checkout v0.1.1
```

That leaves you on a detached HEAD, and `fkt update` will refuse to move it
(exit `20`) until you check out a branch again — which is the intended behaviour,
not a bug.