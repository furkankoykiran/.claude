#!/usr/bin/env python3
"""Configuration loader for Claude Code utilities.

Usage:
    from lib.config import get_config
    config = get_config()
    print(config["user"]["username"])
"""

import json
import os
from pathlib import Path
from datetime import datetime, timedelta

# Default config paths
CONFIG_PATHS = [
    Path.home() / ".claude" / "config.json",
    Path("/root/.claude/config.json"),  # Fallback for development
]


def get_config():
    """Load configuration from config.json."""
    for config_path in CONFIG_PATHS:
        if config_path.exists():
            with open(config_path) as f:
                return json.load(f)

    # Fallback: return minimal config
    return {
        "user": {"username": os.getenv("USER", "user")},
        "paths": {
            "blog_dir": os.getcwd(),
            "memory_dir": Path.home() / ".claude" / "memory",
        },
        "blog": {
            "default_language": "en",
            "scan_days_ago": 60,
        },
    }


def get_since_date():
    """Calculate the 'since' date for activity scanning."""
    config = get_config()
    days_ago = config.get("blog", {}).get("scan_days_ago", 60)
    return (datetime.now() - timedelta(days=days_ago)).strftime("%Y-%m-%d")


def get_blogged_projects():
    """Load blogged projects from memory (for github-scan.py)."""
    blogged = {}
    ignored = set()

    config = get_config()
    memory_file = Path(config["paths"]["memory_dir"]) / "blog-config.md"

    if memory_file.exists():
        with open(memory_file) as f:
            in_blogged = False
            in_ignored = False

            for line in f:
                if "## Blogged Projects Tracker" in line:
                    in_blogged = True
                elif (
                    "### Current Ignore List" in line
                    or "## Ignored Repositories" in line
                ):
                    in_blogged = False
                    in_ignored = True
                elif "---" in line:
                    # Section separator, reset flags
                    in_blogged = False
                    in_ignored = False
                elif in_blogged and line.strip().startswith("- "):
                    # Parse blogged projects: - `date` | `repo` | `file`
                    # Remove the leading "- " and backticks
                    content = line.strip()[2:]  # Remove "- "
                    content = content.replace("`", "")  # Remove backticks
                    parts = content.split("|")
                    if len(parts) >= 2:
                        date = parts[0].strip()
                        repo = parts[1].strip()
                        # Filter out header lines
                        if (
                            repo
                            and date
                            and date != "Date"
                            and not date.startswith("###")
                        ):
                            blogged[date] = repo
                elif in_ignored and line.strip().startswith("- "):
                    # Parse ignored repos: - `repo` - reason
                    # Remove the leading "- "
                    content = line.strip()[2:]
                    # Extract repo from backticks
                    if "`" in content:
                        repo = content.split("`")[1]
                        if repo:
                            ignored.add(repo)

    return blogged, ignored
