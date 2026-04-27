---
name: manim-narration
description: |
  Trigger when: (1) User asks for a "narrated Manim video", "anlatımlı manim",
  "manim with voice", "manim video with audio narration", or
  "PR walkthrough video"; (2) Code imports from manim_narration.lib.* or uses
  NarratedScene; (3) User wants Manim output that includes spoken narration
  synced to animations.

  Builds narrated Manim videos using Microsoft edge-tts (free, no API key) for
  voice synthesis and ffmpeg for proper audio re-encoding so MP4s play
  reliably in VSCode, Chromium, and Electron previews. Includes a NarratedScene
  base class that exposes a `narrate(text)` context manager paced to real
  audio duration. Optionally uses gstack /browse to pre-fetch live screenshots
  declared via `# ASSET:` manifest comments — so the video can showcase real
  websites, GitHub PRs, dashboards, IDE views, etc., without manual capture.

  Composes with manimce-best-practices for animation idioms.
  NOT for ManimGL — use manimgl-best-practices there (no narration support).

  Dependencies: installed automatically by ~/.claude/install.sh.
  - pip: manim, edge-tts
  - system: ffmpeg, ffprobe
  - optional: gstack (already installed by ~/.claude/install.sh)
---

# Manim Narration

A 30–120s narrated MP4 with synchronized voice, cinematic transitions, and
optional live-website screenshots — playable in any modern player including
VSCode's preview pane.

## When to invoke
- "make a narrated manim video about X"
- "explain Y in a 60s manim animation with voice"
- "PR walkthrough video for <github URL>"
- "anlatımlı manim videosu yap"

## Quick usage
1. Subclass `manim_narration.lib.voiceover_scene.NarratedScene`.
2. Wrap each beat: `with self.narrate("Sentence here.") as t: ...`
3. (Optional) Add `# ASSET: <slug> | <url> | viewport=WxH | clip=<css>`
   manifest comments. Run the visuals pre-fetch before rendering.
4. Render with `manim -qh`, then re-encode audio with ffmpeg per RENDER.md.

## Override voice per scene
```python
class MyScene(NarratedScene):
    VOICE = "tr-TR-EmelNeural"   # Turkish female
```
Tested voices: en-US-AriaNeural (default), en-US-JennyNeural, en-US-GuyNeural,
tr-TR-EmelNeural, tr-TR-AhmetNeural. Avoid en-US-AvaNeural (flaky).

## Visual asset pipeline (gstack /browse)
Pre-fetches screenshots from real URLs before render so scenes can
`ImageMobject(asset("slug"))` real web content. Falls back to a manual
capture instruction list if gstack is unavailable. See RENDER.md.
