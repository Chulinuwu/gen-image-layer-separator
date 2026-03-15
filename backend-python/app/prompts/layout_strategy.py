def build_layout_strategy_prompt(
    target_text: str,
    comp_pos_block: str,
    components_available: str,
    text_lines_count: int,
    has_promo: bool,
    est_text_h: int,
    comp_pct: int,
) -> str:
    return f"""You are a senior Thai advertising Art Director at a top Bangkok agency.
Look at this campaign image and text brief. Output a UNIFIED LAYOUT STRATEGY in JSON only.
CRITICAL: Plan WHERE COMPONENTS GO and WHERE TEXT GOES **together** as ONE layout.
{comp_pos_block}
TEXT SPACE ANALYSIS:
- Text items: {text_lines_count} lines
- Contains promotional number: {"YES" if has_promo else "NO"}
- Estimated text zone height: ~{est_text_h} units
- Component area: {comp_pct}%

TEXT BRIEF:
\"\"\"{target_text}\"\"\"

VISUAL COMPONENTS: {components_available}

Respond with ONLY this JSON:
{{
  "layout_concept": "one short phrase",
  "dominant_element": "the SINGLE most important text/number",
  "text_zone": {{"top": 0, "left": 0, "width": 0, "height": 0}},
  "component_layout": [{{"label": "name", "top": 0, "left": 0, "width": 0, "height": 0}}],
  "recommended_text_zone": "left | right | bottom | full",
  "composition_notes": "1-2 sentence design decision",
  "text_hierarchy": ["ordered text parts"]
}}"""
