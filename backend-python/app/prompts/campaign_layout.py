CAMPAIGN_LAYOUT_SCHEMA = """{
  "background_description": "...",
  "campaign_vibe": "...",
  "composition_text_zone": {"top": 0, "left": 0, "width": 400, "height": 1000},
  "spatial_analysis": {"safe_zone": "LEFT|CENTER|RIGHT", "blocked_zones": [], "strategy": "..."},
  "no_go_zones": [{"priority": "HIGH", "label": "...", "area": {"top": 0, "left": 0, "width": 0, "height": 0}, "reason": "..."}],
  "suggestions": [{"part": "text", "preferred_zone": "zone-label", "position": {"top": 0, "left": 0, "width": 0, "height": 0},
    "style": {"font_family": "Kanit", "font_weight": "bold", "color_hex": "#FFF", "font_size_normalized": 40,
      "text_align": "left", "shadow": "strong", "stroke_hex": "#000", "stroke_width": 4},
    "hierarchy": "Headline|Body|FinePrint"}],
  "components": [{"label": "...", "description": "...", "position": {"top": 0, "left": 0, "width": 0, "height": 0},
    "suggested_position": {"top": 0, "left": 0, "width": 0, "height": 0}, "z_index": 15,
    "interaction_zone": {"enabled": false}}]
}"""


def build_campaign_layout_prompt(
    target_text: str,
    fixed_comp_note: str,
    safe_inst: str,
    no_go_inst: str,
    hint_block: str,
    is_comp_only: bool,
) -> str:
    return f"""Act as a professional graphic designer.
Use 0-1000 normalized coordinates.

AD BRIEF:
\"\"\"{target_text}\"\"\"
{fixed_comp_note}{safe_inst or no_go_inst}{hint_block}

TASKS:
{"1. COMPONENT COMPOSITION: Detect visual components that ACTUALLY EXIST in the provided image. CRITICAL: Only list components you can visually SEE in the image pixels. Do NOT hallucinate components mentioned in the ad brief text that are not visible in the image. If the brief mentions a logo, phone mockup, or other element that is NOT visible in the image, do NOT include it in components. Components array must ONLY contain elements you can point to in the image." if is_comp_only else "1. PLACEMENT STRATEGY + TEXT EXTRACTION + COMPONENT COMPOSITION. CRITICAL: components array must ONLY contain elements visually present in the image, NOT elements mentioned in the brief text."}

Return as STRICT JSON:
{{
  "background_description": "...",
  "campaign_vibe": "...",
  "composition_text_zone": {{"top": 0, "left": 0, "width": 400, "height": 1000}},
  "spatial_analysis": {{"safe_zone": "LEFT|CENTER|RIGHT", "blocked_zones": [], "strategy": "..."}},
  "no_go_zones": [{{"priority": "HIGH", "label": "...", "area": {{"top": 0, "left": 0, "width": 0, "height": 0}}, "reason": "..."}}],
  "suggestions": [{{"part": "text", "preferred_zone": "zone-label", "position": {{"top": 0, "left": 0, "width": 0, "height": 0}},
    "style": {{"font_family": "Kanit", "font_weight": "bold", "color_hex": "#FFF", "font_size_normalized": 40,
      "text_align": "left", "shadow": "strong", "stroke_hex": "#000", "stroke_width": 4}},
    "hierarchy": "Headline|Body|FinePrint"}}],
  "components": [{{"label": "...", "description": "...", "position": {{"top": 0, "left": 0, "width": 0, "height": 0}},
    "suggested_position": {{"top": 0, "left": 0, "width": 0, "height": 0}}, "z_index": 15,
    "interaction_zone": {{"enabled": false}}}}]
}}

FONT RULES: font_family MUST be "Kanit" for ALL elements. font_weight: headline="800", body="600", fineprint="400", promo="900".
STROKE+SHADOW MANDATORY on all text. visual_container always "none"."""
