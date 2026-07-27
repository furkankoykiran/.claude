"""Generic palette + reusable mobject builders. Project-agnostic."""

from __future__ import annotations
from manim import BOLD, DOWN, Mobject, RoundedRectangle, Text, VGroup

BG = "#0b0d12"
TEAL = "#2dd4bf"
MUTED = "#9ca3af"
BODY = "#e5e7eb"
CARD_FILL = "#11151c"
GREEN = "#22c55e"
BLUE = "#3b82f6"
GREY = "#6b7280"
AMBER = "#f59e0b"
RED = "#ef4444"
PURPLE = "#a855f7"


def make_header(text: str, *, font_size: int = 44, color: str = TEAL) -> Text:
    return Text(text, font_size=font_size, color=color, weight=BOLD)


def make_card(
    label: str,
    value_mobj: Mobject,
    *,
    width: float = 5.6,
    height: float = 2.1,
    stroke_color: str = TEAL,
) -> VGroup:
    box = RoundedRectangle(
        corner_radius=0.22,
        width=width,
        height=height,
        stroke_color=stroke_color,
        stroke_width=2.0,
        fill_color=CARD_FILL,
        fill_opacity=1.0,
    )
    label_txt = Text(label, font_size=24, color=MUTED)
    label_txt.move_to(box.get_top() + DOWN * 0.55)
    value_mobj.move_to(box.get_center() + DOWN * 0.2)
    return VGroup(box, label_txt, value_mobj)


def make_badge(text: str, color: str = TEAL) -> VGroup:
    label = Text(text, font_size=20, color=color, weight=BOLD)
    pad_x, pad_y = 0.35, 0.18
    box = RoundedRectangle(
        corner_radius=0.22,
        width=label.width + pad_x * 2,
        height=label.height + pad_y * 2,
        stroke_color=color,
        stroke_width=1.5,
        fill_color=color,
        fill_opacity=0.15,
    )
    label.move_to(box.get_center())
    return VGroup(box, label)
