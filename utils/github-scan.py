#!/usr/bin/env python3
"""
GitHub Activity Scanner Utility
Scans GitHub activity and identifies unblogged projects/contributions.

Usage:
    python3 /root/.claude/utils/github-scan.py

Output:
    - JSON file with categorized activity
    - Human-readable summary
"""

import json
import os
import sys
from datetime import datetime

# Add parent directory to path for lib imports
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from lib.config import get_config, get_blogged_projects

# Configuration (loaded from config.json)
config = get_config()
USERNAME = config["user"]["username"]
BLOG_DIR = config["paths"]["blog_dir"]
OUTPUT_FILE = "/tmp/github-activity-scan.json"

# Blogged projects and ignored repos (loaded from memory)
BLOGGED_PROJECTS, IGNORED_REPOS = get_blogged_projects()


def scan_blog_posts():
    """Scan blog posts for mentioned projects."""
    import os
    import re

    mentioned = set()
    posts_dir = f"{BLOG_DIR}/_posts/"

    if not os.path.exists(posts_dir):
        return mentioned

    for filename in os.listdir(posts_dir):
        if not filename.endswith(".md"):
            continue

        filepath = os.path.join(posts_dir, filename)
        with open(filepath, "r") as f:
            content = f.read()

        # Find GitHub repo references
        # Pattern: github.com/owner/repo
        repos = re.findall(r"github\.com/([\w-]+)/([\w-]+)", content)
        for owner, repo in repos:
            mentioned.add(f"{owner}/{repo}")

    return mentioned


def calculate_since_date():
    """Calculate the 'since' date for activity scanning."""
    from lib.config import get_since_date

    return get_since_date()


def main():
    """Main scanning function."""
    since_date = calculate_since_date()
    scan_days_ago = config.get("blog", {}).get("scan_days_ago", 60)

    print("🔍 GitHub Activity Scanner")
    print(f"📅 Scanning since: {since_date} ({scan_days_ago} days ago)")
    print(f"👤 Username: {USERNAME}")
    print()

    # This is a template - actual implementation would use GitHub MCP
    # For now, output the structure

    result = {
        "scan_date": datetime.now().isoformat(),
        "since_date": since_date,
        "username": USERNAME,
        "blogged_projects": list(BLOGGED_PROJECTS.values()),
        "ignored_repos": list(IGNORED_REPOS),
        "categories": {
            "mentioned_in_blog": [],
            "new_repos": [],
            "external_prs": [],
            "external_issues": [],
        },
    }

    # TODO: Implement actual GitHub MCP calls here
    # The skill will use this as a template and make real API calls

    with open(OUTPUT_FILE, "w") as f:
        json.dump(result, f, indent=2)

    print(f"✅ Scan complete: {OUTPUT_FILE}")
    print()
    print("Summary:")
    print(f"  - Blogged projects: {len(BLOGGED_PROJECTS)}")
    print(f"  - Ignored repos: {len(IGNORED_REPOS)}")

    return result


if __name__ == "__main__":
    main()
