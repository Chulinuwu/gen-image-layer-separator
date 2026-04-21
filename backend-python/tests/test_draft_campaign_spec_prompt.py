from __future__ import annotations

from app.prompts.draft_campaign_spec import build_draft_spec_prompt


LIBRARY_SPEC = """# Royal Purple Wealth

## 1. Visual Theme & Atmosphere
Luxurious, institutional, prestigious. Deep royal purple + rich gold.

## A. Visual Mood
luxury, serious. Energy: institutional-solid.

## B. Color Story
- dominant: #3F1F6C deep royal purple
- accent: #D4AF37 rich gold

## I. Do's and Don'ts
Do: deep royal purple + gold only. Don't: pastels, teals.
"""


def test_prompt_includes_brief_and_library_spec():
    p = build_draft_spec_prompt(
        brief="luxury watch for executives, premium Swiss-made",
        visual_hint="",
        aspect_ratio="3:4",
        footer_text=None,
        library_spec_md=LIBRARY_SPEC,
        library_id="commo_gold_scbgoldh",
    )
    assert "luxury watch" in p
    assert "Royal Purple Wealth" in p or "#3F1F6C" in p
    assert "commo_gold_scbgoldh" in p
    assert "3:4" in p


def test_prompt_asks_for_full_spec_sections_A_through_I():
    p = build_draft_spec_prompt(
        brief="x", visual_hint="", aspect_ratio="1:1", footer_text=None,
        library_spec_md="## A. Visual Mood\nluxury.", library_id="x",
    )
    assert "A. Visual Mood" in p
    assert "B. Color Story" in p
    assert "I. Do's and Don'ts" in p or "Do's and Don'ts" in p


def test_prompt_instructs_to_resolve_placeholders():
    p = build_draft_spec_prompt(
        brief="x", visual_hint="", aspect_ratio="1:1", footer_text=None,
        library_spec_md="## A. Visual Mood\nluxury.", library_id="x",
    )
    assert "resolve" in p.lower() or "replace" in p.lower() or "actual content" in p.lower()
    assert "placeholder" in p.lower() or "[..." in p


def test_prompt_asks_for_think_then_output_blocks():
    p = build_draft_spec_prompt(
        brief="x", visual_hint="", aspect_ratio="1:1", footer_text=None,
        library_spec_md=LIBRARY_SPEC, library_id="x",
    )
    assert "## THINK" in p
    assert "## OUTPUT" in p
    assert "Before" in p or "before" in p
    assert p.index("## THINK") < p.index("## OUTPUT")


def test_prompt_handles_optional_visual_hint():
    p_without = build_draft_spec_prompt(
        brief="x", visual_hint="", aspect_ratio="1:1", footer_text=None,
        library_spec_md="x", library_id="x",
    )
    p_with = build_draft_spec_prompt(
        brief="x", visual_hint="mother and daughter in bedroom", aspect_ratio="1:1", footer_text=None,
        library_spec_md="x", library_id="x",
    )
    assert "mother and daughter" in p_with
    assert "mother and daughter" not in p_without
