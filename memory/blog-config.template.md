# Blog Configuration (Global Memory)

This file stores user-specific blog settings for the `github-profile-blog` skill.
**Path**: `~/.claude/memory/blog-config.md`

---

## User Settings (Auto-detected or Configured)

### GitHub Username
**Source**: `mcp__github__get_me()` or `config.json`
- The username is automatically detected from GitHub authentication
- Fallback: Read from `config.json` under `user.username`
- Usage: `mcp__github__search_pull_requests(query="author:$USERNAME")`
- **Current**: `[DETECTED BY AI]`

### Blog Directory
**Source**: `config.json`
- Path to the blog repository
- Should contain `_posts/` and `assets/img/` subdirectories
- **Current**: `[FROM config.json paths.blog_dir]`
- Usage: `$BLOG_DIR/_posts/` for posts, `$BLOG_DIR/assets/img/` for images

### Default Language
**Source**: `config.json`
- Options: `tr` (Turkish), `en` (English), `both`
- **Current**: `[FROM config.json blog.default_language]`

---

## Paths (Derived from BLOG_DIR)

```bash
BLOG_DIR="[FROM config.json paths.blog_dir]"
POSTS_DIR="${BLOG_DIR}/_posts/"
IMAGES_DIR="${BLOG_DIR}/assets/img/"
```

---

## Blogged Projects Tracker

This section tracks which projects have been blogged about to avoid duplication.
Format: `YYYY-MM-DD | Project/Repo | Blog File`

**Populated by AI during blog generation. Leave empty initially.**

### 2026
- `[DATE]` | `[OWNER/REPO]` | `[BLOG-FILE]`

---

## Ignored Repositories

Repositories to exclude from activity scanning:
- Empty repos (no commits)
- Test repos
- Private repos (unless specified)

**Populated by AI during activity scanning. Leave empty initially.**

### Current Ignore List
- `[OWNER/REPO]` - `[REASON]`

---

## Frontmatter Template

```yaml
---
title: "Post Title"
description: "Brief description (1-2 sentences)"
date: YYYY-MM-DD HH:MM:SS +0300
categories: [Category1, Category2]
tags: [tag1, tag2, tag3, tag4]
image:
  path: /assets/img/YYYY-MM-DD-slug/banner.png
  alt: "Banner image description"
---
```

---

## Writing Style (Learned from Previous Posts)

When generating blog content:
1. Read last 2-3 blog posts from `$POSTS_DIR`
2. Analyze: tone, structure, technical depth, formatting
3. Match the style in new posts

### Style Notes (AI will learn from your posts)
- **Tone**: `[LEARNED FROM YOUR POSTS]`
- **Structure**: `[LEARNED FROM YOUR POSTS]`
- **Technical Depth**: `[LEARNED FROM YOUR POSTS]`
- **Formatting**: `[LEARNED FROM YOUR POSTS]`
- **Length**: `[LEARNED FROM YOUR POSTS]`

---

## File Naming Convention

- Single language: `YYYY-MM-DD-slugified-title.md`
- Bilingual: `YYYY-MM-DD-slugified-title-tr.md` and `YYYY-MM-DD-slugified-title-en.md`

---

## Image Guidelines

- **Banner**: 1200x630px PNG (required)
- **Inline**: Every ~50 lines
- **Folder**: `/assets/img/YYYY-MM-DD-slug/`
- **Format**: PNG (preferred), JPG, WebP
- **Alt text**: Required

---

## Common Categories

- AI / Machine Learning
- Blockchain / Web3
- Software Development
- Open Source
- DevOps / Infrastructure
- Tutorial / Guide

---

## Common Tags

#python #typescript #ai #ml #blockchain #ethereum #solana
#fastapi #mcp #opensource #tutorial #devops
