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

IMPORTANT RULES:
- Text zones should be SPREAD across the canvas, not crammed into one small area.
- Main content (headlines, body copy, section labels) should occupy the TOP 60% of the canvas. Do NOT push main content below 70%.
- Only footer/disclaimer text goes in the bottom 10%.
- If the subject blocks the middle, place content ABOVE the subject (in the sky/clean area) and use the area just below the subject for secondary content. Do NOT skip the upper area and put everything at the bottom.
- Real advertisements spread content vertically with breathing room. A layout where all text is packed into the bottom 20% is ALWAYS wrong.
- The bottom 10% of the canvas is RESERVED for footer/disclaimer (handled by the system). Do NOT place any content below top 85%. All your text_zones must have top + height <= 85.
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
