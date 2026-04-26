# Memory Directory

This directory contains state and tracking files for SKILLs and utilities.

## Purpose

Memory files are **automatically populated by AI** during SKILL execution. They track:
- Blogged projects (to avoid duplication)
- Ignored repositories (to exclude from scans)
- Writing style notes (learned from previous posts)
- SKILL-specific state

## Files

### `blog-config.md`
- **Purpose**: Blog state tracking for `github-profile-blog` SKILL
- **Populated by**: AI when first running the SKILL
- **Contains**: Blogged projects tracker, ignored repos, style notes

See `blog-config.template.md` for the expected structure.

## Usage

When a SKILL needs memory:
1. SKILL checks if memory file exists
2. If not, AI creates it from the template
3. AI populates it with learned/extracted information
4. Future reads use this memory

## Privacy Note

Memory files contain **your personal data**:
- Projects you've blogged about
- Repositories you've ignored
- Your writing style preferences

These files should **not be committed to git** if they contain personal data.
Only templates and examples should be tracked.

## First-Time Setup

No manual setup needed. SKILLs will create and populate memory files automatically.
