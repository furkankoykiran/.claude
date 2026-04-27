"""NarratedScene — MovingCameraScene with edge-tts-backed narrate() context."""

from __future__ import annotations
from contextlib import contextmanager
from typing import Generator
from manim import MovingCameraScene, ManimColor
from .tts import synthesize

DEFAULT_BG = ManimColor("#0b0d12")


class _NarrationTracker:
    __slots__ = ("_scene", "duration", "_start_time")

    def __init__(self, scene, duration: float) -> None:
        self._scene = scene
        self.duration = duration
        self._start_time = float(scene.renderer.time)

    def get_remaining_duration(self) -> float:
        elapsed = float(self._scene.renderer.time) - self._start_time
        return max(0.0, self.duration - elapsed)


class NarratedScene(MovingCameraScene):
    VOICE = "en-US-AriaNeural"
    BG_COLOR = DEFAULT_BG

    def setup(self) -> None:
        super().setup()
        self.camera.background_color = self.BG_COLOR

    @contextmanager
    def narrate(self, text: str) -> Generator[_NarrationTracker, None, None]:
        audio_path, duration = synthesize(text, self.VOICE)
        self.add_sound(str(audio_path), time_offset=0)
        tracker = _NarrationTracker(self, duration)
        yield tracker
        remaining = tracker.get_remaining_duration()
        if remaining > 1e-3:
            self.wait(remaining)
