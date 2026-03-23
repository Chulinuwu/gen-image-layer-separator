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
Look at the background image carefully. Output a LAYOUT STRATEGY in JSON only.

FIRST: Analyze the image.
- Where is the main subject/visual? (center, left, right, top, bottom?)
- Where are CLEAN areas suitable for text? (sky, solid color, blur, empty space?)
- Where are BUSY areas to avoid? (people, objects, details?)

THEN: Plan the layout based on what you see AND the text brief.
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
  "layout_concept": "one short phrase describing the layout approach",
  "dominant_element": "the SINGLE most important text/number",
  "image_analysis": {{
    "subject_position": "where the main visual subject is (e.g. center, left-center, top-right)",
    "clean_areas": ["list of clean areas, e.g. top-sky, bottom-road, left-blur"],
    "busy_areas": ["list of busy areas to avoid"]
  }},
  "text_zones": [
    {{"zone": "top-left", "content": "headline group", "top": 0, "left": 0, "width": 50, "height": 25}},
    {{"zone": "bottom-row", "content": "importer + exporter columns", "top": 60, "left": 0, "width": 100, "height": 30}}
  ],
  "component_layout": [{{"label": "name", "top": 0, "left": 0, "width": 0, "height": 0}}],
  "layout_type": "single-column | two-column | split-top-bottom | l-shape | full-spread",
  "composition_notes": "1-2 sentence design decision explaining WHY this layout works with the image"
}}"""
