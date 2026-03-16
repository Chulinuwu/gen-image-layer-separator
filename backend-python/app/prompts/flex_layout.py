def build_flex_layout_prompt(
    target_text: str,
    components_list: str,
    ref_section: str,
    footer_section: str,
    canvas_size: dict,
) -> str:
    return f"""You are a master of 2D graphic design and visual composition.

{ref_section}CAMPAIGN TEXT:
{target_text}

{components_list}
{footer_section}
CANVAS: {canvas_size["w"]}x{canvas_size["h"]}px

STEP 1 — DESIGN REASONING in <layout_thought>...</layout_thought>
STEP 2 — ELEMENT GROUPING in <grouping>...</grouping>
STEP 3 — FLEX TREE JSON:
{{"flexTree": {{...}}, "campaign_vibe": "...", "background_description": "..."}}

FLEX TREE FORMAT:
Container: {{"id":"...", "direction":"row|column", "children":[...], "height":"40%", "width":"60%", "gap":16, "padding":20}}
Text leaf: {{"id":"...", "type":"text", "text":"...", "height":"30%", "style":{{"fontSize":"xlarge|large|medium|small|xsmall", "fontWeight":"900|700|400", "color":"#FFD700", "strokeColor":"#000", "strokeWidth":2, "align":"center|left|right", "backgroundColor":"rgba(0,0,0,0.5)"}}}}
Component leaf: {{"id":"...", "type":"component", "label":"must match available labels", "height":"50%"}}

RULES:
- Every text line from the CAMPAIGN TEXT MUST appear as a text leaf.
- ONLY create component leaves for labels listed in "Available die-cut components" above. If none are listed, use ZERO component nodes.
- Do NOT invent component nodes for elements mentioned in the brief text (logos, mockups, etc.) unless they appear in the available components list.
- Do NOT create text nodes for visual elements described in the brief (e.g. "Phone mockup", "logo", "badge", "image", "icon", "screenshot"). If the brief describes a visual element but no die-cut exists for it, SKIP it entirely — do NOT create a placeholder, description, or "[...]" bracket text for it.
- ONLY create text nodes for ACTUAL READABLE TEXT that should appear on the final design (headlines, subtext, fund names, dates, CTA text, disclaimers, etc.).
- Root is always "column" with padding. Use "row" inside for horizontal groupings.
- Hero/promo number = LARGEST element (fontSize "xlarge", fontWeight "900").
- Group related elements together. Use strokeColor for readability on busy backgrounds.
- READABILITY: If text is placed over a busy or bright area of the background, ADD "backgroundColor" with a semi-transparent dark color (e.g. "rgba(0,0,0,0.5)") to ensure the text is readable.
- CTA BUTTON: For call-to-action text, ALWAYS use "backgroundColor" with a solid brand color (e.g. "#4B0082", "#E040FB") to make it look like a clickable button. Use contrasting text color."""
