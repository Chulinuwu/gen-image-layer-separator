from __future__ import annotations

from app.prompts.translate_spec_to_imagen import build_translate_prompt


SAMPLE_SPEC = """
## A. Visual Mood
luxury, serious, editorial.

## B. Color Story
dominant: #2a1a1a deep burgundy
accent: #c9a961 muted gold
text_primary: #f5ebd4

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


def test_prompt_includes_scene_relevant_sections():
    p = build_translate_prompt(spec_md=SAMPLE_SPEC, brief="a luxury watch")
    assert "luxury watch" in p
    assert "Visual Mood" in p or "luxury" in p
    assert "Color Story" in p or "burgundy" in p
    assert "Scene" in p or "lighting" in p
    assert "Typography Personality" not in p
    assert "Text-Image Relationship" not in p
    assert "Effects Library" not in p


def test_prompt_requests_single_imagen_prompt_output():
    p = build_translate_prompt(spec_md=SAMPLE_SPEC, brief="x")
    assert "single" in p.lower() or "one " in p.lower()
    assert "imagen" in p.lower() or "image generation" in p.lower()
