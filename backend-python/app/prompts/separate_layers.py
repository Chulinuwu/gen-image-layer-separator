def build_separate_layers_prompt(comparison: str, hint: str) -> str:
    return f"""{comparison} {hint}
Analyze the image(s) and identify all individual text layers.
Return as STRICT JSON:
{{"layers": [{{"type": "text", "content": "...", "position": {{"top": 0, "left": 0, "width": 0, "height": 0}},
  "style": {{"font_family": "Kanit", "font_weight": "bold", "color_hex": "#FFF", "font_size_normalized": 40}}}}],
 "background": {{"description": "..."}}}}"""


def build_analyze_components_prompt() -> str:
    return """Analyze the image and identify all NON-TEXT visual components overlaid on the background.
Include: ribbons, banners, stickers, mascots, characters, logos, icons, person cutouts.
EXCLUDE: text, background scene itself.

GROUPING: If a person holds an object, it's ONE component (not separate).

Return as STRICT JSON:
{"components": [{"label": "short label", "description": "detailed visual description",
  "position": {"top": 0, "left": 0, "width": 0, "height": 0, "rotation": 0},
  "z_index": 15, "interaction_zone": {"enabled": false}}]}"""
