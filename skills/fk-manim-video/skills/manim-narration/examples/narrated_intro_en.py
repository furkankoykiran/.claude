"""Minimal hello narrated manim — English default voice."""

import sys
import pathlib

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent.parent))
from lib.voiceover_scene import NarratedScene
from lib.theme import make_header
from manim import AddTextLetterByLetter


class NarratedIntro(NarratedScene):
    def construct(self):
        header = make_header("Hello, narrated Manim.")
        with self.narrate(
            "This is a thirty second test. The animation paces itself "
            "to the duration of this sentence."
        ) as t:
            self.play(AddTextLetterByLetter(header), run_time=1.0)
            self.wait(t.get_remaining_duration())
