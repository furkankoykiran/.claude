# Claude Code Utilities

This directory contains utility scripts for common tasks in blog generation and GitHub activity scanning.

## Available Utilities

### `blog-scan.py`
Scans existing blog posts to find mentioned GitHub repositories.

**Usage**:
```bash
python3 /root/.claude/utils/blog-scan.py
```

**Output**: `/tmp/blog-scan-results.json`

**Features**:
- Extracts frontmatter (title, date, categories, tags)
- Finds GitHub repo references in content
- Filters by date (configurable)
- Returns mentioned projects list

**Use Case**: When generating GitHub activity blog posts, this script helps identify which projects have already been blogged about.

---

### `github-scan.py`
Template/placeholder for GitHub activity scanning.

**Usage**: Integrated into `github-profile-blog` skill

**Features**:
- Calculates dynamic date range (2 months ago)
- Defines blogged projects tracker
- Defines ignored repos list
- Provides structure for activity categorization

**Use Case**: Used by the skill to organize GitHub activity into categories (mentioned vs unmentioned).

---

## Configuration

Most utilities read configuration from two sources:

### 1. User Settings (`~/.claude/config.json`)
Contains personal information:
- GitHub username
- Blog directory path
- Default language
- Profile URLs

**First-time setup:**
1. Copy `/root/.claude/config.json.example` to `~/.claude/config.json`
2. Edit with your personal information

### 2. Blog State (`/root/.claude/memory/blog-config.md`)
Contains runtime state:
- Blogged projects tracker
- Ignored repositories list
- Writing style notes

### Config Loader

Utilities use `lib/config.py` to load configuration:
```python
from lib.config import get_config, get_blogged_projects

# Load user settings
config = get_config()
username = config["user"]["username"]
blog_dir = config["paths"]["blog_dir"]

# Load blogged projects from memory
blogged, ignored = get_blogged_projects()
```

## Output Location

Utility scripts save results to `/tmp/` by default:
- `/tmp/blog-scan-results.json`
- `/tmp/github-activity-scan.json`

## Adding New Utilities

When creating new utility scripts:

1. **Follow the naming pattern**: `{task}-scan.py` or `{task}-util.py`
2. **Use global memory**: Read from `/root/.claude/memory/`
3. **Output JSON**: Save results as JSON for easy parsing
4. **Document usage**: Add header comment with usage instructions
5. **Handle errors gracefully**: Return meaningful error messages

## Example Utility Template

```python
#!/usr/bin/env python3
"""
Utility Name - Brief description

Usage:
    python3 /root/.claude/utils/utility-name.py

Output:
    - JSON file with results
    - Human-readable summary
"""

import json
from datetime import datetime

# Configuration (loaded from config.json via lib/config.py)
from lib.config import get_config, get_since_date

config = get_config()
USERNAME = config["user"]["username"]
SINCE_DATE = get_since_date()

def main():
    """Main function."""
    # Implementation here
    pass

if __name__ == "__main__":
    main()
```

## Related Skills

- `github-profile-blog` - Uses these utilities for activity scanning
- `blog-from-chat` - May use blog scanning utilities

## Troubleshooting

**Problem**: `ModuleNotFoundError` for `lib.config`
- **Solution**: Ensure you're running utilities from `/root/.claude/utils/` directory

**Problem**: `FileNotFoundError` for `config.json`
- **Solution**: Copy `config.json.example` to `~/.claude/config.json` and edit it

**Problem**: `FileNotFoundError` for blog directory
- **Solution**: Update `paths.blog_dir` in `~/.claude/config.json`

**Problem**: Wrong username detected
- **Solution**: Update `user.username` in `~/.claude/config.json`

**Problem**: Empty results
- **Solution**: Check date filters and ensure posts exist in the directory
