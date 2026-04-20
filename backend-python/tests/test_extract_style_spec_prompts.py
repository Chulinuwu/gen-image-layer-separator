from __future__ import annotations

from app.prompts.extract_style_spec import (
    build_core_dna_prompt,
    build_detail_prompt,
    build_overview_prompt,
)


def test_core_dna_prompt_asks_for_mood_palette_composition():
    p = build_core_dna_prompt()
    assert "mood" in p.lower()
    assert "palette" in p.lower()
    assert "composition" in p.lower()
    assert "JSON" in p


def test_detail_prompt_enforces_core_dna_consistency():
    p = build_detail_prompt(core_dna='{"mood": ["luxury"], "palette": "warm muted", "composition": "centered"}')
    assert "luxury" in p
    assert "consistent" in p.lower()
    assert "## A. Visual Mood" in p


def test_overview_prompt_requests_negative_anchors():
    p = build_overview_prompt(spec_md="## A. Visual Mood\n\nLuxury.")
    assert "Luxury" in p
    assert "No " in p
