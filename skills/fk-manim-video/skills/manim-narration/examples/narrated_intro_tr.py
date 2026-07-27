"""Türkçe ses örneği — per-class VOICE override."""

import sys
import pathlib

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent.parent))
from lib.voiceover_scene import NarratedScene
from lib.theme import make_header
from manim import AddTextLetterByLetter


class TurkishIntro(NarratedScene):
    VOICE = "tr-TR-EmelNeural"

    def construct(self):
        header = make_header("Merhaba, anlatımlı Manim.")
        with self.narrate(
            "Bu bir test anlatımıdır. Animasyon kendi temposunu "
            "konuşmanın süresine göre ayarlar."
        ) as t:
            self.play(AddTextLetterByLetter(header), run_time=1.0)
            self.wait(t.get_remaining_duration())
