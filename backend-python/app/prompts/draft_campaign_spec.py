from __future__ import annotations


def build_draft_spec_prompt(
    *,
    brief: str,
    visual_hint: str,
    aspect_ratio: str,
    footer_text: str | None,
    library_spec_md: str,
    library_id: str,
) -> str:
    hint_block = (
        f"Visual scene hint (subject/environment direction): {visual_hint}\n\n"
        if visual_hint
        else ""
    )
    footer_block = f'Footer text: "{footer_text}"\n\n' if footer_text else ""
    return (
        "You are drafting the master design system spec for ONE specific advertisement.\n\n"
        "Library spec below is your INSPIRATION only (matched from campaign mood/palette/composition). "
        f"The library spec is from entry \"{library_id}\". It contains placeholder descriptors in brackets "
        "like [short CTA action label, 1-3 words] that you MUST resolve with actual content "
        "derived from the brief. Hex codes, composition ratios, typography hierarchy, and effects "
        "are binding -- copy those structural decisions. Customize anything that should bend to this "
        "specific campaign: subject matter, exact text content, numeric identifiers, and any "
        "campaign-specific accents.\n\n"
        "Write a full drafted spec.md with sections 1-8 (A-I fields inside them). The drafted spec "
        "becomes the MASTER SPEC -- downstream AI (BG generation, flex layout, critique) will "
        "read only what you write here.\n\n"
        f"Campaign brief:\n{brief}\n\n"
        f"Aspect ratio: {aspect_ratio}\n\n"
        f"{hint_block}"
        f"{footer_block}"
        "Library spec (INSPIRATION ONLY -- resolve placeholders, customize per-campaign):\n"
        f"{library_spec_md}\n\n"
        "Required sections in your drafted spec.md output:\n"
        "# <Drafted Style Name -- derived from brief and library>\n\n"
        "## 1. Visual Theme & Atmosphere (paragraph covering A. Visual Mood)\n"
        "## 2. Color Palette & Roles -- B. Color Story (all hex codes, grouped by role)\n"
        "## 3. Typography Rules -- C. Typography (hierarchy table)\n"
        "## 4. Component & Element Stylings -- D. Components / E. Elements (CTAs, cards, callouts -- with RESOLVED text content)\n"
        "## 5. Layout Principles -- F. Layout (zone map, spacing)\n"
        "## 6. Photography / Rendering Rules -- G. Photography, H. Rendering\n"
        "## 7. Do's and Don'ts -- I. Do's and Don'ts\n"
        "## 8. Agent Prompt Guide (quick palette + typography + example prompts)\n\n"
        "OUTPUT RULES:\n"
        "- Return ONLY the drafted spec markdown. No preamble, no fenced code block.\n"
        "- Resolve every [placeholder descriptor] with concrete content derived from the brief.\n"
        "- Preserve the library's structural DNA (palette, typography hierarchy, composition archetype).\n"
        "- Write all example prompts in section 8 using the actual campaign text and hex codes.\n"
        "- Be specific and detailed -- this is the source of truth.\n"
    )
