"""PR walkthrough — uses # ASSET: manifest + /browse pre-fetch.

Before rendering:
    python -m lib.visuals prefetch \\
        ~/.claude/skills/manim-narration/examples/narrated_pr_walkthrough.py
"""
# ASSET: pr-header | https://github.com/anthropics/claude-code/pull/1 | viewport=1920x1080
# ASSET: pr-files  | https://github.com/anthropics/claude-code/pull/1/files | viewport=1920x1080

import sys
import pathlib

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent.parent))
from lib.voiceover_scene import NarratedScene
from lib.visuals import asset
from lib.transitions import fade_swap
from manim import ImageMobject, FadeIn

THIS_FILE = __file__


class PRWalkthrough(NarratedScene):
    def construct(self):
        header_img = ImageMobject(asset("pr-header", THIS_FILE)).scale(0.6)
        with self.narrate("Here is the pull request we are reviewing today.") as t:
            self.play(FadeIn(header_img))
            self.wait(t.get_remaining_duration())

        files_img = ImageMobject(asset("pr-files", THIS_FILE)).scale(0.6)
        with self.narrate("And these are the files it changes.") as t:
            self.play(fade_swap(header_img, files_img))
            self.wait(t.get_remaining_duration())
