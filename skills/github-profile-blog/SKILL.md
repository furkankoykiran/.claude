---
name: github-profile-blog
description: Write a blog post about GitHub profile activity with educational focus (generic, works for any user)
---

# GitHub Profile Activity Blog (Generic)

This skill generates an educational blog post about your GitHub activity from the last 2 months.

**Generic Design**: Works for any user with GitHub auth. Fetches both own repos AND external contributions.

## Configuration (Read from Global Memory & Config)

**CRITICAL**: Use global memory and config system, not project-specific memory.

Read `~/.claude/config.json` for:
- `USERNAME` - GitHub username (from `user.username`)
- `BLOG_DIR` - Blog directory path (from `paths.blog_dir`)
- `DEFAULT_LANGUAGE` - Default language setting (from `blog.default_language`)

Read `~/.claude/memory/blog-config.md` for:
- `BLOGGED_PROJECTS` - List of already blogged projects (to avoid duplicates)
- `IGNORED_REPOS` - Repos to exclude (empty repos, test repos, etc.)

### First-Time Setup
If config doesn't exist:
1. Copy `config.json.example` to `~/.claude/config.json`
2. Edit with your personal information
3. Run skill again

### Utility Scripts
The skill uses utility scripts in `~/.claude/utils/`:

- **`blog-scan.py`** - Scans existing blog posts for mentioned projects
  ```bash
  python3 ~/.claude/utils/blog-scan.py
  ```
  Output: `/tmp/blog-scan-results.json`

- **`github-scan.py`** - Template for GitHub activity scanning

## Variables Used

```python
# Read from config or auto-detect
from lib.config import get_config
config = get_config()
USERNAME = config["user"]["username"] or mcp__github__get_me()["login"]
BLOG_DIR = config["paths"]["blog_dir"]

# Calculate date dynamically (2 months ago from today)
from datetime import datetime, timedelta
since_date = (datetime.now() - timedelta(days=60)).strftime("%Y-%m-%d")
# Or use: from lib.config import get_since_date

# Derived paths
POSTS_DIR = f"{BLOG_DIR}/_posts/"
IMAGES_DIR = f"{BLOG_DIR}/assets/img/"
```

## Workflow

### Step 1: Ask Language Preference (FIRST)

Use AskUserQuestion to ask:
```
Blog gönderisi hangi dilde olsun?

1. Türkçe
2. İngilizce
3. Hem Türkçe hem İngilizce (iki ayrı post)
```

**Default**: Option 1 (Turkish) if not specified.

### Step 2: Fetch Last 2 Months of GitHub Activity

Use GitHub MCP tools to fetch ALL activity (both own repos and external contributions):

```python
# Get username dynamically
user_info = mcp__github__get_me()
username = user_info["login"]

# Calculate 2 months ago dynamically
since_date = (datetime.now() - timedelta(days=60)).strftime("%Y-%m-%d")

# Fetch ALL pull requests created by user (to any repo)
mcp__github__search_pull_requests(query="author:{username} is:pr")

# Fetch ALL issues created by user (in any repo)
mcp__github__search_issues(query="author:{username} is:issue")

# Fetch user's own repositories
mcp__github__search_repositories(query="user:{username}")

# Get recent commits from user's own repos
for repo in user_repos:
    mcp__github__list_commits(owner=username, repo=repo["name"], since=since_date)
```

**CRITICAL**: Skip any private repositories (check `visibility: private`).

### Step 3: Read All Existing Blog Posts

Read all files from `$POSTS_DIR` to check what has been mentioned.

Parse each blog post for:
- Repository names mentioned
- Project names mentioned
- Contribution types mentioned
- Dates to establish timeline

### Step 4: Categorize Activities

Organize the GitHub data into:

**Mentioned in Blog:**
- Items found in existing blog posts
- Include reference to which blog post mentioned it

**Unmentioned:**
- New repositories created
- Pull requests to other projects (external contributions)
- Issues opened in any repo
- Comments made
- Forks made

### Step 5: Display Selection List

Show the user a formatted list with **generic placeholders**:

```markdown
## GitHub Aktiviteleri (Son 2 Ay)

### ✅ Blog'da Bahsedilen:
- [x] [Project-Name] - [Brief Description] (Blog: [Date])
- [x] [Another-Project] - [Description] (Blog: [Date])

### 🆕 Blog'da Bahsedilmeyen:

#### 📁 Your Repositories:
- [ ] [Repo-Name] - [Brief Description]
- [ ] [Another-Repo] - [Description]

#### 🔧 Pull Requests (External Contributions):
- [ ] [Owner/Repo] - [PR Title] (#[PR-Number])
- [ ] [Owner/Repo] - [PR Title] (#[PR-Number])

#### 🐛 Issues (Opened in Any Repo):
- [ ] [Owner/Repo] - [Issue Title] (#[Issue-Number])
- [ ] [Owner/Repo] - [Issue Title] (#[Issue-Number])

---

**Lütfen blog yazmak istediğiniz konuları seçin:**
- Girin: `1,3,5` (sadece seçilenler)
- Girin: `hepsi` veya `all` (tümü)
- Girin: `yok` veya `none` (iptal)
```

### Step 6: Get User Selection

Use AskUserQuestion or wait for user input to get their selection.

### Step 7: Estimate Line Count

Calculate and show estimate:
```python
# Estimate: ~50 lines per item
estimated_lines = len(selected_items) * 50

print(f"Seçilen {len(selected_items)} item için tahmini blog uzunluğu: ~{estimated_lines} satır")
print("Onaylıyor musunuz? Veya tercih ettiğiniz aralığı belirtin (örn: 200-250 satır)")
```

Wait for user confirmation or preferred range.

### Step 8: Learn Writing Style

Read the last 2-3 blog posts from `$POSTS_DIR` to understand:
- Tone and voice
- Structure patterns
- Technical depth
- Educational approach

### Step 9: Generate Blog Content

For each selected item, create a section that includes:
- **Problem/Challenge**: What was being solved
- **Implementation**: How it was done
- **Technical Details**: Code snippets, architecture
- **Lessons Learned**: What others should learn
- **Warnings/Gotchas**: What to watch out for

**Adjust length** based on user's preferred range if specified.

**Example Structure**:
```markdown
---
title: "GitHub Aktivitelerim: [Month-Month] [Year]"
description: "Son iki ayda yaptığım açık kaynak katkıları ve projeler"
date: YYYY-MM-DD HH:MM:SS +0300
categories: [Open Source, Development]
tags: [mcp, typescript, contribution]
image:
  path: /assets/img/YYYY-MM-DD-github-activities/banner.png
  alt: "GitHub Activity Summary"
---

## Son İki Ayın Özeti

Son 60 gündür yoğun bir şekilde açık kaynak projelere katkıda bulundum...

## [Repo-Owner/Repo-Name] PR'ı

### Problemi Keşfetmek
[Describe the problem discovered]

### Çözüm Süreci
[Technical details with code examples]

### PR'ın Durumu
[#PR-Number numaralı PR](link) [durum]...

## [Repository-Name] Projesi

### Proje Hakkında
[Project details with challenges and solutions]

### Öğrendiklerim
[Lessons learned]
```

### Step 10: Find and Download Images

Use your configured image-search MCP (e.g. a Google / Bing image-search MCP server):
1. Search for banner image (GitHub/contribution themed)
2. Search for project-specific images
3. Search for technical diagram images
4. Download to `$BLOG_DIR/assets/img/YYYY-MM-DD-github-activities/`

Skip this step if no image-search MCP is configured.

### Step 11: Show Draft

Display the complete draft in the terminal.

### Step 12: Wait for User Approval

Ask: "Taslak onaylanıyor mu? Blog dosyası oluşturulsun mu?"

### Step 13: Write Blog File (On Approval)

If approved:
1. Create the file at `$POSTS_DIR/YYYY-MM-DD-github-activities.md`
2. If bilingual: Create two files (`-tr.md` and `-en.md`)

### Step 14: Create DEV.to Draft (Optional)

Skip this step entirely if no DEV.to publishing MCP is configured. Otherwise, use it to create the article draft:
- Set `published: false`
- Use appropriate tags (max 4)

### Step 15: Ask for DEV.to Publish Approval

Ask: "DEV.to'da publish edilsin mi?"

### Step 16: Publish to DEV.to (On Approval)

Update the draft to `published: true` via the same MCP used in Step 14.

## Critical Requirements

- **Config system**: Use `~/.claude/config.json` for user settings (username, blog_dir, language)
- **Global Memory**: Use `~/.claude/memory/blog-config.md` for state (blogged projects, ignored repos)
- **Config loader**: Use `from lib.config import get_config, get_blogged_projects` in utilities
- **Auto-detect username**: Use `config["user"]["username"]` or fallback to `mcp__github__get_me()["login"]`
- **Dynamic date calculation**: 2 months ago from today, not hardcoded
- **Skip empty repos**: Check repo has commits before including
- **Skip private repos**: Filter by `visibility: public`
- **Cross-reference blogs**: Don't duplicate blogged projects
- **Use utility scripts**: Leverage `~/.claude/utils/blog-scan.py`
- **Generic examples**: Use placeholders like `[Project-Name]`, not specific names
- **Estimated line count**: Show estimate before generating, allow user to specify range
- **List both mentioned and unmentioned** items
- **Let user select specific items** - don't auto-select
- **Educational focus** - teach lessons, show warnings
- **Read previous blog posts** for style matching
- **Show draft first** - never auto-write
- **Separate approvals** for file write and DEV.to publish

## Filtering Rules (IMPORTANT)

When scanning GitHub activity, **EXCLUDE**:

1. **Private repositories**: Check `visibility: private`
2. **Empty repositories**: Check for commits (some repos are created but never used)
3. **Ignored repos**: Read `IGNORED_REPOS` from memory
   - Example entry: `[OWNER]/[REPO]` with reason (e.g. empty repo, archived)

4. **Already blogged**: Check `BLOGGED_PROJECTS` from memory

```python
# Example filtering logic
def should_include_repo(repo):
    # Skip private
    if repo.get("visibility") == "private":
        return False

    # Skip ignored
    if repo["full_name"] in IGNORED_REPOS:
        return False

    # Skip already blogged
    if repo["full_name"] in BLOGGED_PROJECTS:
        return False

    # Skip empty (no commits)
    if repo.get("size", 0) == 0:
        return False

    return True
```

## Educational Content Guidelines

For each selected item:
1. **What was the challenge?** - Be specific
2. **How did you solve it?** - Step-by-step
3. **What did you learn?** - Teachable moments
4. **What should others watch out for?** - Warnings and gotchas
5. **Code examples** - When relevant

## GitHub MCP Query Patterns

```python
# All PRs created by user (to any repo)
mcp__github__search_pull_requests(query="author:USERNAME is:pr")

# All issues created by user (in any repo)
mcp__github__search_issues(query="author:USERNAME is:issue")

# User's own repositories
mcp__github__search_repositories(query="user:USERNAME")

# Filter by date
since_date = "2026-01-11"  # 2 months ago, calculated dynamically
```

## Memory Reference

**Config Path**: `~/.claude/config.json`
This file contains user settings (username, blog directory, language, profiles).

**Global Memory Path**: `~/.claude/memory/blog-config.md`
This file contains:
- Blogged projects tracker (YYYY-MM-DD | repo | blog-file)
- Ignored repositories list
- Writing style notes
- Common categories and tags

## Utility Scripts Reference

### `~/.claude/utils/blog-scan.py`
Scans blog posts for GitHub repo references.

**Usage**:
```python
result = subprocess.run(
    ["python3", "~/.claude/utils/blog-scan.py"],
    capture_output=True, text=True
)
```

**Returns**:
- `mentioned_projects`: List of repos found in blog posts
- `all_github_links`: All GitHub links found
- `posts`: Blog post metadata

### `~/.claude/utils/github-scan.py`
Template for scanning GitHub activity (uses MCP calls).

**Key Functions**:
- `scan_blog_posts()` - Find mentioned repos
- `calculate_since_date()` - Dynamic date calculation
- `main()` - Full scan workflow
