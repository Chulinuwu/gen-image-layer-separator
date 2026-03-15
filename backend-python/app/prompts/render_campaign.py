def build_render_prompt(suggestions: list, has_background: bool) -> str:
    text_desc = "\n".join(
        f'LINE {i+1}: "{s.get("part", "")}"\n'
        f'       - Style: {s.get("style", {}).get("font_family", "")}, '
        f'{s.get("style", {}).get("font_weight", "")}, Color {s.get("style", {}).get("color_hex", "")}\n'
        f'       - Container: {s.get("visual_container", "none")}\n'
        f'       - Size: {s.get("style", {}).get("font_size_normalized", 40)}\n'
        f'       - Position: {s.get("position", {}).get("explanation", "")}'
        for i, s in enumerate(suggestions)
    )
    base_inst = (
        "USE THE SECOND IMAGE AS YOUR CLEAN BACKGROUND CANVAS. Do NOT leave any ghosting of original text."
        if has_background else "Use the provided image as background."
    )
    return f"""Create a high-quality, professional advertisement.
REFERENCE IMAGE 1: Desired layout, quality, and graphic style.
{"REFERENCE IMAGE 2: Clean background canvas to work on." if has_background else ""}

TASK:
1. {base_inst}
2. There are EXACTLY {len(suggestions)} text elements. Each one MUST appear on its OWN VISUAL LINE:
{text_desc}

CRITICAL DESIGN INSTRUCTIONS:
- Each LINE above is a SEPARATE visual line. Do NOT combine any two LINEs into one horizontal string.
- MATCH THE TEXT LAYOUT from Reference Image 1 exactly.
- If a 'Container' like 'yellow_ribbon' or 'red_banner' is mentioned, RECREATE that graphic element professionally.
- Text must be crisp, perfectly spelled, and high-contrast.
- Final result must look like a single, cohesive, high-end production."""
