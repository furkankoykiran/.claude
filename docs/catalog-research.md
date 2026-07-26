<!-- Preserved primary-source research from the initial catalog audit (2026-07-25).
     Captures the official-docs rules that materially shaped the implementation;
     see docs/catalog-architecture.md for the realized design. -->

# Primary-Source Research Report: Skill Catalog Generator + CI Pipeline

## 1. Claude Code Skills Specification

### Source Documents
- [Agent Skills Overview](https://platform.claude.com/docs/en/agents-and-tools/agent-skills/overview)
- [Skill Authoring Best Practices](https://platform.claude.com/docs/en/agents-and-tools/agent-skills/best-practices)
- [Use Skills in Claude Code](https://code.claude.com/docs/en/skills)

### Where Skills Live

| Scope      | Path                                                | Precedence |
|------------|-----------------------------------------------------|------------|
| Enterprise | Managed settings directory                           | Highest    |
| Personal   | `~/.claude/skills/<name>/SKILL.md`                  | Middle     |
| Project    | `.claude/skills/<name>/SKILL.md`                    | Lower      |
| Plugin     | `<plugin>/skills/<name>/SKILL.md`                   | Lowest     |
| Nested     | `<subdir>/.claude/skills/<name>/SKILL.md`           | Qualified  |

Skills also load from `.claude/skills/` in parent directories up to the repository root, and from nested `.claude/skills/` below the working directory (monorepo support). A nested skill that shares a name with another skill gets a directory-qualified name like `apps/web:deploy`.

### Required Directory Structure

```
<skill-name>/
  SKILL.md              # Main instructions (required)
  supporting-file.md    # Reference docs (optional)
  examples/
    sample.md           # Examples (optional)
  scripts/
    helper.sh           # Executable scripts (optional)
```

Files in `.claude/commands/<name>.md` still work and are merged into the same namespace, but skills are recommended.

### Frontmatter Fields (YAML between `---` markers)

| Field                      | Type            | Required | Default     | Constraints                                         |
|----------------------------|-----------------|----------|-------------|-----------------------------------------------------|
| `name`                     | string          | No       | Directory name | Max 64 chars, lowercase/numbers/hyphens only, no XML tags, no "anthropic"/"claude" |
| `description`              | string          | Recommended | First paragraph of body | Max 1024 chars, no XML tags. Combined with `when_to_use` capped at 1536 chars in listing |
| `when_to_use`              | string          | No       | --          | Appended to description for trigger context          |
| `argument-hint`            | string          | No       | --          | Shown during autocomplete (e.g. `[issue-number]`)    |
| `arguments`                | string/list     | No       | --          | Named positional args for `$name` substitution       |
| `disable-model-invocation` | boolean         | No       | `false`     | Prevents Claude from auto-invoking                   |
| `user-invocable`           | boolean         | No       | `true`      | Set `false` to hide from `/` menu                    |
| `allowed-tools`            | string/list     | No       | --          | Pre-approved tools for the invoking turn             |
| `disallowed-tools`         | string/list     | No       | --          | Tools removed while skill is active                  |
| `model`                    | string          | No       | inherit     | Model alias or full model ID for the invoking turn   |
| `effort`                   | string          | No       | inherit     | `low`, `medium`, `high`, `xhigh`, `max`              |
| `context`                  | string          | No       | --          | `fork` to run in subagent                            |
| `agent`                    | string          | No       | --          | Subagent type when `context: fork`                   |
| `background`               | boolean         | No       | `true`      | Only with `context: fork`                            |
| `hooks`                    | object          | No       | --          | Hooks scoped to skill lifecycle                      |
| `paths`                    | string/list     | No       | --          | Glob patterns limiting auto-activation               |
| `shell`                    | string          | No       | `bash`      | `bash` or `powershell`                               |

Boolean fields accept `yes`/`no`/`on`/`off`/`1`/`0` (any case) as of v2.1.218, in addition to `true`/`false`.

### How Discovery Works

- Claude Code watches skill directories live: adding/editing/removing skills takes effect without restart (for directories that existed at session start).
- The `description` is pre-loaded into the system prompt (~100 tokens per skill); full SKILL.md loads only when triggered (progressive disclosure).
- `disable-model-invocation: true` removes the description from context and prevents auto-loading.
- The combined `description` + `when_to_use` text is capped at 1536 characters in listings.
- Skill listing budget scales at 1% of model context window; configurable via `skillListingBudgetFraction`.

### Naming and Plugin Prefix

- Plugin skills always use namespace `plugin-name:skill-name` (never unqualified).
- Frontmatter `name` in a plugin skill replaces the last segment of the command name.
- A plugin-root `SKILL.md` (no `skills/` subdirectory) uses `name` for the whole final segment; falls back to plugin directory name.

### String Substitutions

| Variable | Description |
|----------|-------------|
| `$ARGUMENTS` | All arguments passed to the skill |
| `$ARGUMENTS[N]` / `$N` | 0-based positional arguments |
| `$name` | Named argument from `arguments` frontmatter |
| `${CLAUDE_SESSION_ID}` | Current session ID |
| `${CLAUDE_EFFORT}` | Current effort level |
| `${CLAUDE_SKILL_DIR}` | Directory containing SKILL.md |
| `${CLAUDE_PROJECT_DIR}` | Project root directory |

### Dynamic Context Injection

- `` !`command` `` runs a shell command before the skill content reaches Claude; the output replaces the placeholder.
- Multi-line: use fenced code block `` ```! ``.
- Can be disabled with `disableSkillShellExecution: true` in settings.

---

## 2. Claude Code Plugins and Plugin Marketplaces

### Source Documents
- [Create Plugins](https://code.claude.com/docs/en/plugins)
- [Create and Distribute Plugin Marketplaces](https://code.claude.com/docs/en/plugin-marketplaces)

### Plugin Directory Structure

```
my-plugin/
  .claude-plugin/
    plugin.json           # Manifest (required if using manifest fields)
  skills/                 # Skills as <name>/SKILL.md directories
  commands/               # Skills as flat .md files (legacy)
  agents/                 # Custom subagent definitions
  hooks/
    hooks.json            # Event handlers
  .mcp.json               # MCP server configurations
  .lsp.json               # LSP server configurations
  monitors/
    monitors.json         # Background monitors
  bin/                    # Executables added to Bash tool PATH
  settings.json           # Default settings when plugin enabled
```

### Plugin Manifest (`plugin.json`) Required Fields

| Field | Required | Description |
|-------|----------|-------------|
| `name` | Yes | Unique identifier, kebab-case. Becomes skill namespace prefix |
| `description` | Yes | Shown in plugin manager |
| `version` | No | If set, users only receive updates when this changes. If omitted (git-hosted), commit SHA is used |
| `author` | No | Object with `name` (required), `email` (optional) |
| `homepage` | No | Documentation URL |
| `repository` | No | Source code URL |
| `license` | No | SPDX identifier |

### Skill Namespacing in Plugins

- Plugin skills are **always namespaced**: `plugin-name:skill-name`.
- This prevents conflicts between plugins.
- Bare `/skill-name` also invokes the plugin skill if no other command uses that name (v2.1.216+).

### Marketplace JSON Schema

Required fields: `name` (kebab-case identifier, public-facing), `owner` (object with `name`, optional `email`), `plugins` (array).

Reserved marketplace names (blocked for third parties): `claude-code-marketplace`, `claude-plugins-official`, `claude-plugins-community`, `claude-community`, and others.

### Plugin Source Types

| Source | Identifier | Fields |
|--------|------------|--------|
| Relative path | `"./plugins/my-plugin"` | Must start with `./` |
| GitHub | `{"source": "github", "repo": "owner/repo"}` | Optional `ref`, `sha` |
| Git URL | `{"source": "url", "url": "..."}` | Optional `ref`, `sha` |
| Git subdir | `{"source": "git-subdir", "url": "...", "path": "..."}` | For monorepo sparse checkout |
| npm | `{"source": "npm", "package": "@org/pkg"}` | Optional `version`, `registry` |

When both `ref` and `sha` are set, `sha` is the effective pin.

---

## 3. GitHub Actions Security Guidance

### Source Documents
- [Security Hardening for GitHub Actions](https://docs.github.com/en/actions/security-for-github-actions/security-guides/security-hardening-for-github-actions)
- [Workflow Syntax for GitHub Actions](https://docs.github.com/en/actions/writing-workflows/workflow-syntax-for-github-actions)
- [Triggering a Workflow](https://docs.github.com/en/actions/writing-workflows/choosing-when-your-workflow-runs/triggering-a-workflow)

### Most Restrictive Permissions

Set `permissions: read-all` or a minimal `permissions` block at the workflow top level, then override per job:

```yaml
permissions:
  contents: read
  # add specific permissions only where needed
```

### Default GITHUB_TOKEN Behavior

- By default, `GITHUB_TOKEN` has **read** access to `contents`.
- A push made with `GITHUB_TOKEN` does **not** trigger a new workflow run (prevents recursion).
- Using a Personal Access Token (PAT) or GitHub App token to push **does** trigger new runs -- this is how to intentionally cause downstream workflows.

### Preventing Recursive Workflow Runs

Two strategies:
1. Use `GITHUB_TOKEN` (default -- no recursion).
2. Add an `if` condition to skip bot-triggered runs:

```yaml
jobs:
  build:
    if: github.actor != 'github-actions[bot]'
```

### pull_request vs pull_request_target

| Trigger | Token scope from forks | Use case |
|---------|----------------------|----------|
| `pull_request` | Read-only GITHUB_TOKEN | Safe for untrusted code. Runs in context of merge commit |
| `pull_request_target` | Read/write GITHUB_TOKEN | Required when workflow needs write access (labels, comments). **Do not checkout/run untrusted code** |

Prefer `pull_request` unless you specifically need write access from fork PRs. If using `pull_request_target`, do not check out or execute the PR's code.

### Action Pinning

- Pin third-party actions to a **full-length commit SHA** (immutable).
- Validate the SHA comes from the original repository, not a fork.
- Tag pinning is only acceptable when the action creator is verified/trusted.

### Concurrency Groups

```yaml
concurrency:
  group: ${{ github.workflow }}-${{ github.ref }}
  cancel-in-progress: true
```

Prevents overlapping runs and cancels stale ones.

---

## 4. Generated Artifacts in CI

### Source Documents
- [Events That Trigger Workflows](https://docs.github.com/en/actions/writing-workflows/choosing-when-your-workflow-runs/events-that-trigger-workflows)
- [Triggering a Workflow](https://docs.github.com/en/actions/writing-workflows/choosing-when-your-workflow-runs/triggering-a-workflow)

### Committing Generated Files Back to the Repo

- Commits made with `GITHUB_TOKEN` do **not** trigger new workflow runs. This is the **built-in safeguard** against infinite loops.
- If you need the commit to trigger downstream workflows, use a PAT or GitHub App token instead.
- Best practice: use `GITHUB_TOKEN` for automated commits to keep CI pipelines isolated.

### Staleness Checks (Diff Pattern)

The recommended pattern for ensuring committed generated files are up to date:

1. Generate the artifact in CI.
2. Run `git diff --exit-code` on the generated file(s).
3. If the diff is non-empty, fail the build (the developer must regenerate and commit).

This prevents drift between committed and actual generated output.

### Avoiding Infinite Automation Loops

Key rules:
- A workflow triggered by `push` that uses `GITHUB_TOKEN` to push back will **not** re-trigger itself.
- A workflow triggered by `push` that uses a PAT/GitHub App token to push back **will** re-trigger -- use this deliberately for multi-workflow chains.
- The `workflow_run` trigger has a hard limit: chains cannot exceed **three levels** of nesting.
- Use `if: github.actor != 'github-actions[bot]'` as a safety check on any workflow that could generate commits.

---

## 5. Reproducible Dependency Resolution

### Source Documents
- [Bun Lockfile Documentation](https://bun.sh/docs/install/lockfile)

### Bun Lockfile Format (Current)

- As of Bun v1.2, the default format is **text-based `bun.lock`** (not binary `bun.lockb`).
- Commit `bun.lock` to version control.
- Use `bun install --frozen-lockfile` in CI for reproducible installs.
- To migrate a legacy binary `bun.lockb`: run `bun install --save-text-lockfile --frozen-lockfile --lockfile-only` and delete `bun.lockb`.
- The `--lockfile-only` flag generates a lockfile without installing to `node_modules`.

### Lockfile-Based Workspace Snapshot

For the skill catalog generator, the conventional approach to deterministic resolution is:
- Maintain a `package.json` (or `bun.lock`) pinned to specific dependency versions.
- In CI, run `bun install --frozen-lockfile` to install exactly the locked versions.
- For skill-source refs (which are filesystem-local), the catalog generator reads the `.claude/skills/` tree directly -- there is no network dependency for skill content itself.
- Any npm/Bun dependencies the generator code needs are captured in `bun.lock`.

---

## 6. Semantic Versioning for Solo-Maintained Developer Tooling

### Source Document
- [Semver.org Specification](https://semver.org/)

### Standard Format

```
MAJOR.MINOR.PATCH
```

| Segment | When to bump |
|---------|-------------|
| MAJOR | Incompatible API changes |
| MINOR | New backward-compatible functionality or deprecations |
| PATCH | Internal bug fixes, no API change |

### For 0.x (Initial Development)

- `0.y.z` signals the API is not stable.
- Any change (breaking or not) can increment the minor or patch.
- Many solo tools stay at 0.x until the interface stabilizes.

### Pre-release and Build Metadata

- Pre-release: `1.0.0-alpha.1`, `1.0.0-rc.1` (lower precedence than release)
- Build metadata: `1.0.0+build.199` (ignored for precedence)

### Git Tag Convention

- Standard practice: prefix with `v` -- e.g., `v1.0.0`, `v0.2.0`.
- The tag body is the exact semver string.
- README convention: a "Release" section or CHANGELOG tracking versions.
- For GitHub Releases, create a release from the git tag.

### Recommended for Solo Dev Tooling

- Start at `0.1.0`.
- Bump `MINOR` for new features, `PATCH` for fixes.
- Bump to `1.0.0` once the core interface stabilizes.
- Use pre-release tags (`0.5.0-alpha.1`) for experimental CI builds.
- Tag format: `v0.1.0`, `v1.0.0`, `v1.1.0`, etc.