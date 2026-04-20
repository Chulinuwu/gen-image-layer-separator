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
        "You are planning the visual style of an advertisement.\n"
        "Write ONE natural-language paragraph of 150 to 300 words describing the ideal "
        "design system for this brief.\n\n"
        "Cover: mood + energy, palette (temperature, saturation, key hues), "
        "composition archetype, typography character, "
        "scene style (lighting, environment, depth), and text-image relationship.\n\n"
        'End with "No X, no Y, no Z" listing 3 specific traits that should NOT appear '
        "(negative anchors for downstream search).\n\n"
        "Do not include section headers. Write as one flowing paragraph. "
        "Be coherent: every trait must reinforce the others.\n\n"
        f"Brief: {brief}\n"
        f"Aspect ratio: {aspect_ratio}\n"
        f"{footer_note}"
        f"{image_note}"
    )
