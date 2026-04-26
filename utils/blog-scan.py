#!/usr/bin/env python3
"""
Blog Post Scanner Utility
Scans existing blog posts to find mentioned projects/repos.

Usage:
    python3 /root/.claude/utils/blog-scan.py

Output:
    - JSON file with mentioned projects
    - Human-readable summary
"""

import json
import os
import re
import sys
from datetime import datetime

# Add parent directory to path for lib imports
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from lib.config import get_config, get_since_date

# Configuration (loaded from config.json)
config = get_config()
BLOG_DIR = config["paths"]["blog_dir"]
USERNAME = config["user"]["username"]
OUTPUT_FILE = "/tmp/blog-scan-results.json"
SINCE_DATE = get_since_date()  # Dynamic: calculated from config


def extract_frontmatter(content):
    """Extract frontmatter from markdown file."""
    match = re.match(r"^---\n(.*?)\n---\n", content, re.DOTALL)
    if match:
        return match.group(1)
    return None


def parse_frontmatter(frontmatter):
    """Parse YAML frontmatter into dict."""
    result = {}
    for line in frontmatter.split("\n"):
        if ":" in line:
            key, value = line.split(":", 1)
            result[key.strip()] = value.strip().strip('"').strip("'")
    return result


def extract_github_links(content):
    """Extract GitHub repository links from content."""
    full_pattern = r"github\.com/([\w-]+)/([\w-]+)"
    implicit_pattern = rf"\b{re.escape(USERNAME)}/([\w-]+)"

    repos = set()
    for owner, repo in re.findall(full_pattern, content):
        repos.add(f"{owner}/{repo}")
    for repo in re.findall(implicit_pattern, content):
        repos.add(f"{USERNAME}/{repo}")

    return repos


def scan_blog_post(filepath):
    """Scan a single blog post for information."""
    with open(filepath, "r", encoding="utf-8") as f:
        content = f.read()

    frontmatter_text = extract_frontmatter(content)
    frontmatter = parse_frontmatter(frontmatter_text) if frontmatter_text else {}

    # Extract GitHub links
    github_links = extract_github_links(content)

    # Get file date from filename
    filename = os.path.basename(filepath)
    date_match = re.match(r"(\d{4}-\d{2}-\d{2})", filename)
    file_date = date_match.group(1) if date_match else None

    return {
        "file": filename,
        "date": file_date or frontmatter.get("date", "")[:10],
        "title": frontmatter.get("title", ""),
        "categories": frontmatter.get("categories", "").strip("[]").split(","),
        "tags": frontmatter.get("tags", "").strip("[]").split(","),
        "github_links": list(github_links),
        "line_count": len(content.split("\n")),
    }


def main():
    """Main scanning function."""
    posts_dir = f"{BLOG_DIR}/_posts/"

    if not os.path.exists(posts_dir):
        print(f"❌ Posts directory not found: {posts_dir}")
        return

    print("📚 Blog Post Scanner")
    print(f"📂 Directory: {posts_dir}")
    print(f"📅 Since: {SINCE_DATE}")
    print()

    results = []
    mentioned_projects = set()
    all_github_links = set()

    for filename in sorted(os.listdir(posts_dir), reverse=True):
        if not filename.endswith(".md"):
            continue

        filepath = os.path.join(posts_dir, filename)
        post_info = scan_blog_post(filepath)

        # Filter by date
        if post_info["date"] >= SINCE_DATE:
            results.append(post_info)
            mentioned_projects.update(post_info["github_links"])
            all_github_links.update(post_info["github_links"])

    # Output results
    output = {
        "scan_date": datetime.now().isoformat(),
        "since_date": SINCE_DATE,
        "total_posts_scanned": len(results),
        "posts": results,
        "mentioned_projects": sorted(list(mentioned_projects)),
        "all_github_links": sorted(list(all_github_links)),
    }

    with open(OUTPUT_FILE, "w") as f:
        json.dump(output, f, indent=2)

    print(f"✅ Scan complete: {OUTPUT_FILE}")
    print()
    print("Summary:")
    print(f"  - Posts since {SINCE_DATE}: {len(results)}")
    print(f"  - Mentioned projects: {len(mentioned_projects)}")
    print()
    print("Recent posts:")
    for post in results[:5]:
        print(f"  {post['date']} | {post['title'][:50]}")
        print(f"    Repos: {', '.join(post['github_links'][:3])}")
    print()

    return output


if __name__ == "__main__":
    main()
