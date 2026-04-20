from __future__ import annotations

from app.prompts.critique import build_critique_prompt


def test_critique_prompt_includes_spec_compliance_schema():
    p = build_critique_prompt(
        target_text="Headline",
        style_only=False,
        has_components=False,
        style_spec_md="## A. Visual Mood\n\nluxury.",
        layout_thought="",
        contrast_data="",
    )
    assert "spec_compliance" in p
    assert "violations" in p
    assert "luxury" in p


def test_critique_prompt_runs_without_style_spec():
    p = build_critique_prompt(
        target_text="Headline",
        style_only=False,
        has_components=False,
        style_spec_md=None,
        layout_thought="",
        contrast_data="",
    )
    assert "Headline" in p
