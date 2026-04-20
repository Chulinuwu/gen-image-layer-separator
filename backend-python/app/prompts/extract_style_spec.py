from __future__ import annotations


def build_core_dna_prompt() -> str:
    return (
        "You are analyzing an advertisement image.\n"
        "Identify the core visual DNA in 1-2 sentences per field.\n\n"
        "Return ONLY valid JSON with these keys:\n"
        '  "mood":        array of 3 keywords max (e.g. ["luxury","serious","editorial"])\n'
        '  "palette":     short string: temperature + saturation + key hues\n'
        '                 (e.g. "cool muted deep burgundy with gold accent")\n'
        '  "composition": one of "centered" | "rule-of-thirds" | "diagonal" | "grid"\n\n'
        "Base your answer ONLY on what is visually present. "
        "Do not invent traits. Do not hedge."
    )


def build_detail_prompt(core_dna: str) -> str:
    return (
        "You are writing a detailed design system for an advertisement.\n\n"
        f"The ad has this core DNA:\n{core_dna}\n\n"
        "Write a full design system in markdown with sections A through I.\n"
        "CRITICAL: every section must be consistent with the core DNA above.\n"
        "Do not introduce traits that contradict mood, palette, or composition.\n"
        "If a trait seems to contradict, reconcile toward the core DNA.\n\n"
        "Use this exact structure:\n\n"
        "## A. Visual Mood\n"
        "mood_keywords, energy_level, atmosphere (1 paragraph).\n\n"
        "## B. Color Story\n"
        "dominant / accent / text_primary / text_secondary / shadow / highlight.\n"
        "Include hex codes. palette_relationship (complementary/analogous/monochromatic).\n\n"
        "## C. Typography Personality\n"
        "font_character, weight_hierarchy, tracking_behavior, text_treatments.\n\n"
        "## D. Composition Archetype\n"
        "focal_pattern, text_zones, negative_space_ratio, subject_position.\n\n"
        "## E. Scene / Photo Style\n"
        "lighting_direction + quality, depth, environment, texture.\n\n"
        "## F. Subject Treatment\n"
        "posing, scale, cropping.\n\n"
        "## G. Text-Image Relationship\n"
        "pattern, contrast_strategy.\n\n"
        "## H. Effects Library\n"
        "gradients, glows, strokes, drop_shadows.\n\n"
        "## I. Do's and Don'ts\n"
        "Do: ...\nDon't: ...\n"
    )


def build_overview_prompt(spec_md: str) -> str:
    return (
        "Summarize this design system in a single natural-language paragraph "
        "of 150 to 300 words for semantic search.\n\n"
        "Requirements:\n"
        "- Start with mood + palette + composition.\n"
        '- End with "No X, no Y, no Z" listing 3 specific traits that DO NOT fit this style '
        "(negative anchors for embedding discrimination).\n"
        "- Do not include hex codes. Do not include section headers.\n"
        "- Write as one flowing paragraph.\n\n"
        f"Design system:\n{spec_md}\n"
    )
