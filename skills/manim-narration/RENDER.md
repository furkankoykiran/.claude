# Render workflow

## 1. Pre-render: fetch visual assets (optional)
If your scene uses `# ASSET:` manifest comments:

```bash
python -m skills.manim-narration.lib.visuals prefetch path/to/scene.py
# or, if running from the skill dir:
python -m lib.visuals prefetch path/to/scene.py
```

PNG cache: `~/.claude/skills/manim-narration/.cache/visuals/<sha256>.png`.
If gstack is not installed or fails, the step prints exact URLs + filenames
the user must capture manually, then exits non-zero.

## 2. Render with Manim
```bash
manim -qh --format=mp4 path/to/scene.py SceneName
# Output: media/videos/<basename>/1080p60/SceneName.mp4
```
Fast iteration: `-ql` (480p15, ~15–25s).

## 3. Re-encode audio (CRITICAL — do not skip)
Manim's PyAV muxer leaves audio packets non-interleaved with video, so
VSCode/Chromium/Electron play the file silently even though ffprobe sees
both streams. A plain `-c copy` remux does NOT fix this.

```bash
TARGET=output.mp4
SRC="media/videos/<basename>/1080p60/SceneName.mp4"
ffmpeg -y -i "$SRC" \
    -c:v copy \
    -c:a aac -b:a 192k -ar 48000 -ac 2 \
    -avoid_negative_ts make_zero \
    -movflags +faststart \
    "$TARGET"
```

## 4. Verify playability
```bash
ffprobe -v error -show_entries stream=codec_type,codec_name,duration \
    -of default=nw=1 "$TARGET"
ffmpeg -i "$TARGET" -af "volumedetect" -f null /dev/null 2>&1 \
    | grep -E "mean_volume|max_volume"
```
Pass: one h264, one aac, mean_volume ≥ −40 dB, audio/video duration ≥ 0.75.

## 5. (Optional) Preview via /browse
```bash
gstack browse open "file://$(pwd)/$TARGET"
```

## TTS cache
`~/.claude/skills/manim-narration/.cache/voiceovers/`, keyed by
sha256(voice|text). Nuke to regenerate.
