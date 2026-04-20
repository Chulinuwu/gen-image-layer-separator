from __future__ import annotations

import re

_BG_SECTIONS = {"A", "B", "D", "E", "F"}


def _extract_bg_sections(spec_md: str) -> str:
    pattern = re.compile(r"(## ([A-I])\. [^\n]+\n)(.*?)(?=\n## [A-I]\.|\Z)", re.DOTALL)
    out_parts: list[str] = []
    for match in pattern.finditer(spec_md):
        header, letter, body = match.group(1), match.group(2), match.group(3)
        if letter in _BG_SECTIONS:
            out_parts.append(header + body.rstrip())
    return "\n\n".join(out_parts).strip()


def build_translate_prompt(*, spec_md: str, brief: str) -> str:
    bg_only = _extract_bg_sections(spec_md)
    return (
        "You are writing a single image generation prompt for Imagen.\n\n"
        f"Brief: {brief}\n\n"
        "Target design system (background-relevant sections only):\n"
        f"{bg_only}\n\n"
        "Write ONE natural-language prompt of 60-120 words describing the scene "
        "to generate. Translate the design fields into concrete visual language "
        "(lighting direction, color hex codes allowed, composition, subject pose, "
        "depth of field, texture). Do NOT describe typography or text overlays -- "
        "we will add text separately.\n\n"
        "IMPORTANT: Any specific subject details in the design system above "
        "(specific people, exact props, exact poses) are illustrative examples "
        "from the source reference ad. The actual subject for this scene comes "
        "from the Brief. Use the spec for visual language (mood, palette, "
        "lighting direction, composition archetype, texture) -- not for literal "
        "subject content.\n\n"
        "Return only the prompt text, no preamble."
    )
