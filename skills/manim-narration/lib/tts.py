"""edge-tts bridge — synthesize narration to mp3, cache by (text, voice) hash."""

from __future__ import annotations
import asyncio
import hashlib
import pathlib
import subprocess
import edge_tts

CACHE_DIR = pathlib.Path(__file__).resolve().parent.parent / ".cache" / "voiceovers"


def _ensure_cache_dir() -> None:
    CACHE_DIR.mkdir(parents=True, exist_ok=True)


def synthesize(
    text: str, voice: str = "en-US-AriaNeural"
) -> tuple[pathlib.Path, float]:
    _ensure_cache_dir()
    key = hashlib.sha256(f"{voice}|{text}".encode("utf-8")).hexdigest()[:16]
    path = CACHE_DIR / f"{key}.mp3"
    if not path.exists():

        async def _run() -> None:
            communicate = edge_tts.Communicate(text, voice)
            await communicate.save(str(path))

        asyncio.run(_run())
    return path, _probe_duration(path)


def _probe_duration(path: pathlib.Path) -> float:
    out = subprocess.check_output(
        [
            "ffprobe",
            "-v",
            "error",
            "-show_entries",
            "format=duration",
            "-of",
            "default=nw=1:nk=1",
            str(path),
        ]
    )
    return float(out.decode().strip())
