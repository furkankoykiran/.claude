---
name: blog-from-chat
description: Write a blog post from chat summary with multi-language support (generic, works for any user)
---

# Blog from Chat Summary (Generic)

This skill generates a blog post from a chat summary. It supports Turkish, English, or both languages.

**Generic Design**: Works for any user with GitHub auth. Reads configuration from memory.

## Input

Chat summary provided as `$ARGUMENTS`.

## Configuration (Read from Config & Memory)

Before starting, read `~/.claude/config.json` for:
- `BLOG_DIR` - Blog directory path (from `paths.blog_dir`)
- `USERNAME` - GitHub username (from `user.username`)
- `DEFAULT_LANGUAGE` - Default language setting (from `blog.default_language`)

Fallback detection:
- If config doesn't exist: Use `mcp__github__get_me()["login"]` and ask user for blog_dir

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

### Step 2: Learn Writing Style

Read the last 2-3 blog posts from `$BLOG_DIR/_posts/` to understand:
- Tone and voice (friendly, professional, first-person)
- Structure (Problem → Solution → Implementation → Results)
- Formatting patterns
- Image placement (~1 image per 50 lines)

### Step 3: Generate Frontmatter

Based on the chat summary, create appropriate frontmatter:

```yaml
---
title: "Generated Title"
description: "Brief 1-2 sentence description"
date: YYYY-MM-DD HH:MM:SS +0300
categories: [Category1, Category2]
tags: [tag1, tag2, tag3, tag4]
image:
  path: /assets/img/YYYY-MM-DD-slug/banner.png
  alt: "Banner image description"
---
```

### Step 4: Estimate Line Count

Calculate and show estimate:
```python
# Estimate based on chat summary length
estimated_lines = len(chat_summary.split()) / 3  # Rough estimate

print(f"Tahmini blog uzunluğu: ~{estimated_lines} satır")
print("Onaylıyor musunuz? Veya tercih ettiğiniz aralığı belirtin (örn: 200-250 satır)")
```

Wait for user confirmation or preferred range.

### Step 5: Write Blog Content

Generate blog content in the selected language following the learned style.

**Adjust length** based on user's preferred range if specified.

### Step 6: Find and Download Images

Use your configured image-search MCP (e.g. a Google / Bing image-search MCP server):
1. Search for banner image (main topic related)
2. Search for inline images (~1 per 50 lines of content)
3. Download all images to `$BLOG_DIR/assets/img/YYYY-MM-DD-slug/`
4. Use format: `banner.png`, `image1.png`, `image2.png`, etc.

Skip this step if no image-search MCP is configured.

### Step 7: Show Draft

Display the complete draft in the terminal using fenced code blocks.

### Step 8: Wait for User Approval

Ask user: "Taslak onaylanıyor mu? Blog dosyası oluşturulsun mu?"

### Step 9: Write Blog File (On Approval)

If approved:
1. Create the file at `$BLOG_DIR/_posts/YYYY-MM-DD-slug.md`
2. If bilingual: Create two files (`-tr.md` and `-en.md`)

### Step 10: Create DEV.to Draft (Optional)

Skip this step entirely if no DEV.to publishing MCP is configured. Otherwise, use it to create the article draft:
- Set `published: false`
- Use appropriate tags (max 4)
- Include frontmatter as description

### Step 11: Ask for DEV.to Publish Approval

Ask user: "DEV.to'da publish edilsin mi?"

### Step 12: Publish to DEV.to (On Approval)

Update the draft to `published: true` via the same MCP used in Step 10.

## Critical Requirements

- **Generic Design**: No hardcoded usernames or paths
- **Read config from config.json**: User settings in `~/.claude/config.json`
- **Auto-detect username**: Use `config["user"]["username"]` or fallback to `mcp__github__get_me()["login"]`
- **Language selection is FIRST question** - always ask before generating content
- **Read previous blog posts** to match writing style
- **Show draft first** - never auto-write files
- **Separate approvals** for file write and DEV.to publish
- **Default to Turkish** unless user specifies otherwise
- **Download images** to correct directory structure if an image-search MCP is configured

## Image Guidelines

- Banner: 1200x630px PNG
- Inline images: Every ~50 lines
- Save to: `$BLOG_DIR/assets/img/YYYY-MM-DD-slug/`
- Always include alt text

## Memory Reference

**Config Path**: `~/.claude/config.json`
This file contains user settings (username, blog directory, language).

## Variables Used

```python
# Read from config or auto-detect
from lib.config import get_config
config = get_config()
USERNAME = config["user"]["username"] or mcp__github__get_me()["login"]
BLOG_DIR = config["paths"]["blog_dir"]

# Derived paths
POSTS_DIR = f"{BLOG_DIR}/_posts/"
IMAGES_DIR = f"{BLOG_DIR}/assets/img/"
```
