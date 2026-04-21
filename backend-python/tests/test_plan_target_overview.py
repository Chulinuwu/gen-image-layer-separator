from __future__ import annotations

from app.prompts.plan_target_overview import build_plan_overview_prompt


def test_prompt_includes_brief_and_requests_paragraph():
    p = build_plan_overview_prompt(
        brief="luxury watch for executives",
        has_user_image=False,
        aspect_ratio="1:1",
        footer_text=None,
    )
    assert "luxury watch for executives" in p
    assert "1:1" in p
    assert "150" in p and "300" in p
    assert "No " in p


def test_prompt_asks_for_think_then_output_blocks():
    p = build_plan_overview_prompt(
        brief="luxury watch",
        has_user_image=False,
        aspect_ratio="1:1",
        footer_text=None,
    )
    assert "## THINK" in p
    assert "## OUTPUT" in p
    assert "Before" in p or "before" in p
    assert p.index("## THINK") < p.index("## OUTPUT")


def test_prompt_flags_user_image_presence():
    p = build_plan_overview_prompt(
        brief="x", has_user_image=True, aspect_ratio="4:5", footer_text="terms apply"
    )
    assert "user-supplied reference image" in p.lower()
    assert "terms apply" in p
