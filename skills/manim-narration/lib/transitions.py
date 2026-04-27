"""Cinematic transition primitives — use instead of plain FadeIn/FadeOut."""

from __future__ import annotations
from manim import (
    LEFT,
    RIGHT,
    AnimationGroup,
    FadeIn,
    FadeOut,
    Mobject,
    ReplacementTransform,
    Succession,
    rate_functions,
)


def slide_in_from(
    mobj: Mobject, direction=LEFT, distance: float = 2.0, run_time: float = 0.6
):
    target_pos = mobj.get_center()
    mobj.shift(direction * distance)
    mobj.set_opacity(0.0)
    return AnimationGroup(
        mobj.animate(run_time=run_time, rate_func=rate_functions.ease_out_cubic)
        .move_to(target_pos)
        .set_opacity(1.0),
    )


def swipe_replace(
    out_group: Mobject, in_group: Mobject, direction=RIGHT, run_time: float = 0.9
):
    in_group.shift(-direction * 4.0).set_opacity(0.0)
    return Succession(
        AnimationGroup(
            out_group.animate(
                run_time=run_time * 0.5, rate_func=rate_functions.ease_in_cubic
            )
            .shift(direction * 4.0)
            .set_opacity(0.0)
        ),
        AnimationGroup(
            in_group.animate(
                run_time=run_time * 0.5, rate_func=rate_functions.ease_out_cubic
            )
            .shift(direction * 4.0)
            .set_opacity(1.0)
        ),
    )


def morph_card(card_a: Mobject, card_b: Mobject, run_time: float = 0.8):
    return ReplacementTransform(card_a, card_b, run_time=run_time)


def fade_swap(out_group: Mobject, in_group: Mobject, run_time: float = 0.7):
    return AnimationGroup(
        FadeOut(out_group, run_time=run_time * 0.8),
        FadeIn(in_group, run_time=run_time),
        lag_ratio=0.3,
    )
