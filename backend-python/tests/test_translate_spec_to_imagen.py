from __future__ import annotations

from app.prompts.translate_spec_to_imagen import build_translate_prompt


SAMPLE_SPEC_LETTER = """
## A. Visual Mood
luxury, serious, editorial.

## B. Color Story
dominant: #2a1a1a deep burgundy
accent: #c9a961 muted gold

## C. Typography Personality
display serif, tight tracking.

## D. Composition Archetype
centered symmetric. Subject dead-center. 40% negative space.

## E. Scene / Photo Style
dramatic top-down lighting, shallow DoF, studio.

## F. Subject Treatment
hero-dominant, full view.

## G. Text-Image Relationship
overlay-dark-image.

## H. Effects Library
subtle drop shadow.

## I. Do's and Don'ts
Don't use neon.
"""


SAMPLE_SPEC_NUMERIC = """
## 1. Visual Theme & Atmosphere
Luxurious mood, institutional, deep burgundy palette.

## 2. Color Palette & Roles
dominant: #3F1F6C deep royal purple
accent: #D4AF37 rich gold

## 3. Typography Rules
Bold Thai sans 800, tight tracking.

## 4. Component & Element Stylings
Frosted card with rounded corners, purple pill CTA.

## 5. Layout Principles
Diagonal composition, hero right, card left.

## 6. Photography / Rendering Rules
Dramatic single-key studio light on hero product, polished metal surface.

## 7. Do's and Don'ts
Don't use pastels or lifestyle photography.

## 8. Agent Prompt Guide
Quick palette reference and example render prompts.
"""


def test_prompt_includes_scene_relevant_sections_letter_format():
    p = build_translate_prompt(spec_md=SAMPLE_SPEC_LETTER, brief="a luxury watch")
    assert "luxury watch" in p
    assert "Visual Mood" in p or "luxury" in p
    assert "Color Story" in p or "burgundy" in p
    assert "Scene" in p or "lighting" in p
    assert "Typography Personality" not in p
    assert "Text-Image Relationship" not in p
    assert "Effects Library" not in p


def test_prompt_includes_scene_relevant_sections_numeric_format():
    p = build_translate_prompt(spec_md=SAMPLE_SPEC_NUMERIC, brief="a gold fund ad")
    assert "gold fund" in p
    assert "Visual Theme" in p or "Luxurious" in p
    assert "Color Palette" in p or "#3F1F6C" in p
    assert "Layout Principles" in p or "Diagonal composition" in p
    assert "Photography" in p or "studio light" in p
    assert "Do's and Don'ts" in p or "pastels" in p
    # non-BG sections must be excluded
    assert "Typography Rules" not in p
    assert "Component & Element" not in p
    assert "Agent Prompt Guide" not in p


def test_prompt_asks_for_think_then_output_blocks():
    p = build_translate_prompt(spec_md=SAMPLE_SPEC_NUMERIC, brief="x")
    assert "## THINK" in p
    assert "## OUTPUT" in p
    assert "Before" in p or "before" in p
    assert p.index("## THINK") < p.index("## OUTPUT")


def test_prompt_requests_single_imagen_prompt_output():
    p = build_translate_prompt(spec_md=SAMPLE_SPEC_NUMERIC, brief="x")
    assert "single" in p.lower() or "one " in p.lower()
    assert "imagen" in p.lower() or "image generation" in p.lower()
