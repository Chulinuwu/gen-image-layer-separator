from __future__ import annotations

import re

# BG-relevant sections from the drafted/library spec structure (numeric 1-8).
# 1: Visual Theme & Atmosphere, 2: Color Palette, 5: Layout Principles,
# 6: Photography / Rendering Rules, 7: Do's and Don'ts.
# Excluded (non-BG): 3 Typography, 4 Components, 8 Agent Prompt Guide.
_BG_SECTIONS_NUMERIC = {"1", "2", "5", "6", "7"}

# Legacy letter format (old library specs used A-I headers).
_BG_SECTIONS_LETTER = {"A", "B", "D", "E", "F"}


def _extract_bg_sections(spec_md: str) -> str:
    # Match both `## 1. Title` and `## A. Title` to support legacy + drafted specs.
    pattern = re.compile(
        r"(## ([A-I]|\d+)\. [^\n]+\n)(.*?)(?=\n## (?:[A-I]|\d+)\.|\Z)",
        re.DOTALL,
    )
    out_parts: list[str] = []
    for match in pattern.finditer(spec_md):
        header, marker, body = match.group(1), match.group(2), match.group(3)
        is_bg = (
            marker in _BG_SECTIONS_NUMERIC
            or marker in _BG_SECTIONS_LETTER
        )
        if is_bg:
            out_parts.append(header + body.rstrip())
    return "\n\n".join(out_parts).strip()


def build_translate_prompt(*, spec_md: str, brief: str) -> str:
    bg_only = _extract_bg_sections(spec_md)
    return (
        "You are writing a single image generation prompt for Imagen.\n\n"
        f"Brief: {brief}\n\n"
        "Target design system (background-relevant sections only):\n"
        f"{bg_only}\n\n"
        "Before writing, reason through these in a `## THINK` block (concise bullets, no prose):\n"
        "- Hero type: is the primary visual a product (studio shot), a human subject (lifestyle portrait), "
        "an abstract scene (typography-hero with atmospheric backdrop), or a composite?\n"
        "- Lighting direction + quality: extract from Section E (Scene / Photo Style)\n"
        "- 2-3 dominant color hex codes from Section B (Color Palette) that MUST appear in the render\n"
        "- Composition archetype from Section D -- where does the hero sit and what clean zones does text need preserved\n"
        "- Depth of field: extracted from Section E -- shallow/deep/flat\n"
        "- Texture keywords from Section E -- matte/glossy/film-grain/clean-digital\n"
        "- Any 'don'ts' from Section I that would ruin the generation (e.g. 'no typography in render', 'no people in frame')\n"
        "- Subject direction from Section F (Subject Treatment) -- posing, scale, cropping\n\n"
        "Then in the `## OUTPUT` block, write ONE natural-language prompt of 60-120 words for Imagen. "
        "Translate the reasoning above into concrete visual language. Include hex codes, lighting "
        "direction, composition, subject pose, depth of field, texture. Do NOT describe typography or "
        "text overlays (text added separately). Return only the prompt text in the OUTPUT block.\n\n"
        "IMPORTANT: Any specific subject details in the design system above "
        "(specific people, exact props, exact poses) are illustrative examples "
        "from the source reference ad. The actual subject for this scene comes "
        "from the Brief. Use the spec for visual language (mood, palette, "
        "lighting direction, composition archetype, texture) -- not for literal "
        "subject content.\n\n"
        "Required sections in your response: `## THINK` then `## OUTPUT`. No preamble before `## THINK`."
    )
