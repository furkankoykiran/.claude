# Prompt Library

Upload this file to the ChatGPT project. It starts empty and earns its value over time.

Prompts that worked, and prompts that failed and why. This is the feedback loop: the
assistant reads this before forging, so every entry makes the next prompt better.

Append after each real Claude Code session. Keep entries short. The pattern matters more
than the exact wording, and a long file gets skimmed instead of read.

## Format

```
## [YYYY-MM-DD] <project> - <one-line task>
Mode: forge | audit
Prompt: <the prompt, or a one-line summary if long>
Result: worked | partially worked | failed
Why: <what made it work, or what the failure mode was>
Pattern: <the reusable lesson, one line>
```

## Entries

Nothing yet. Add the first one after your next session.

The example below shows the intended shape. Delete it once you have real entries.

```
## [2026-01-15] example-api - fix intermittent auth test
Mode: forge
Prompt: reproduce with a failing test first, then fix the root cause
Result: worked
Why: demanding a failing test before the fix stopped it from patching the symptom
Pattern: for intermittent bugs, require the reproduction before the fix
```

## Known failure modes

Prompt shapes that reliably underperform in your repositories. These carry forward into
every future prompt, so they are worth writing down carefully.

Add entries as you hit them.
