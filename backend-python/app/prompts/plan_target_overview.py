from __future__ import annotations


def build_plan_overview_prompt(
    *,
    brief: str,
    has_user_image: bool,
    aspect_ratio: str,
    footer_text: str | None,
) -> str:
    image_note = (
        "A user-supplied reference image is attached below. "
        "Treat it as directional input for mood and scene, not as a hard template.\n\n"
        if has_user_image
        else ""
    )
    footer_note = f'Footer text to accommodate: "{footer_text}"\n' if footer_text else ""
    return (
        "You are planning the visual style of an advertisement.\n\n"
        "Before writing, internally reason through these aspects and emit them in a "
        "`## THINK` block (concise bullets, no prose):\n"
        "- Product category (insurance / fund / credit / consumer product / etc.)\n"
        "- Intended persona / target audience based on brief wording\n"
        "- Core mood keywords implied by the brief (3-5 words max)\n"
        "- Expected palette character (warm / cool / monochrome / complementary; muted / saturated)\n"
        "- Composition archetype this suggests (studio-product / lifestyle-photo / typography-hero / collage)\n"
        "- 2-3 negative anchors -- traits that would CLASH with this brief (these will go into the 'No X, no Y' clause)\n\n"
        "Then in the `## OUTPUT` block, write ONE natural-language paragraph of 150 to 300 "
        "words describing the ideal design system for this brief. "
        "Cover: mood + energy, palette (temperature, saturation, key hues), "
        "composition archetype, typography character, "
        "scene style (lighting, environment, depth), and text-image relationship. "
        'End with "No X, no Y, no Z" listing 3 specific traits that should NOT appear '
        "(negative anchors for downstream search). "
        "Do not include section headers inside the paragraph. Write as one flowing paragraph. "
        "Be coherent: every trait must reinforce the others.\n\n"
        "Required sections in your response: `## THINK` then `## OUTPUT`. No preamble before `## THINK`.\n\n"
        f"Brief: {brief}\n"
        f"Aspect ratio: {aspect_ratio}\n"
        f"{footer_note}"
        f"{image_note}"
    )
