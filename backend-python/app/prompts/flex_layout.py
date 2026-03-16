def build_flex_layout_prompt(
    target_text: str,
    components_list: str,
    ref_section: str,
    footer_section: str,
    canvas_size: dict,
    style_guide: str = "",
) -> str:
    style_section = f"\n{style_guide}\n" if style_guide else ""

    style_matching_rules = ""
    if style_guide:
        style_matching_rules = """
- STYLE MATCHING: Reference images and their style guide are provided above. Your design MUST match their visual DNA:
  - Use the SAME color palette (dominant colors, gradients, accents).
  - Use SIMILAR typography (font sizes, weights, text colors, stroke effects).
  - Follow SIMILAR layout patterns (element grouping, spacing, hierarchy).
  - Match the MOOD (premium, playful, tech-forward, etc.).
  - Do NOT copy text content from references — only copy their VISUAL STYLE."""

    return f"""You are a master of 2D graphic design and visual composition.

{ref_section}{style_section}CAMPAIGN TEXT:
{target_text}

{components_list}
{footer_section}
CANVAS: {canvas_size["w"]}x{canvas_size["h"]}px

STEP 1 — DESIGN REASONING in <layout_thought>...</layout_thought>
STEP 2 — ELEMENT GROUPING in <grouping>...</grouping>
STEP 3 — FLEX TREE JSON:
{{"flexTree": {{...}}, "campaign_vibe": "...", "background_description": "..."}}

FLEX TREE FORMAT:
Container: {{"id":"...", "direction":"row|column", "justifyContent":"start|end|center|space-between|space-evenly", "children":[...], "height":"40%", "width":"60%", "gap":16, "padding":20}}
Text leaf: {{"id":"...", "type":"text", "text":"...", "height":"30%", "style":{{"fontSize":"xlarge|large|medium|small|xsmall|<px number>", "fontWeight":"900|700|400", "color":"#FFD700", "strokeColor":"#000", "strokeWidth":2, "align":"center|left|right", "backgroundColor":"rgba(0,0,0,0.5)", "lineHeight":1.2, "letterSpacing":2, "borderRadius":12, "textShadow":"2px 2px 4px rgba(0,0,0,0.5)", "opacity":0.8, "margin":10, "maxLines":3}}}}
Component leaf: {{"id":"...", "type":"component", "label":"must match available labels", "height":"50%"}}

RULES:
- Every text line from the CAMPAIGN TEXT MUST appear as a text leaf.
- ONLY create component leaves for labels listed in "Available die-cut components" above. If none are listed, use ZERO component nodes.
- Do NOT invent component nodes for elements mentioned in the brief text (logos, mockups, etc.) unless they appear in the available components list.
- Do NOT create text nodes for visual elements described in the brief (e.g. "Phone mockup", "logo", "badge", "image", "icon", "screenshot"). If the brief describes a visual element but no die-cut exists for it, SKIP it entirely — do NOT create a placeholder, description, or "[...]" bracket text for it.
- ONLY create text nodes for ACTUAL READABLE TEXT that should appear on the final design (headlines, subtext, fund names, dates, CTA text, disclaimers, etc.).
- Root is always "column" with padding. Use "row" inside for horizontal groupings.
- FULL CANVAS USAGE: Use the entire canvas height. Use justifyContent "space-between" on the ROOT container so content spreads from top to bottom with footer pinned at the bottom.
- NO OVERLAPPING: Each child's height% must give it enough vertical space for its text. Headlines need at least 10-15%, body text 8-12%, footer 5-8%.
- justifyContent: Controls distribution of children within a container. Use "space-between" for root (pushes footer to bottom). Use "center" to vertically center a group. Default is "start" (stack from top).
- Hero/promo number = LARGEST element (fontSize "xlarge", fontWeight "900").
- Group related elements together. Use strokeColor for readability on busy backgrounds.
- READABILITY: If text is placed over a busy or bright area of the background, ADD "backgroundColor" with a semi-transparent dark color (e.g. "rgba(0,0,0,0.5)") to ensure the text is readable.
- CTA BUTTON: For call-to-action text, ALWAYS use "backgroundColor" with a solid brand color (e.g. "#4B0082", "#E040FB") to make it look like a clickable button. Use contrasting text color.
- fontSize can be a named size (xlarge/large/medium/small/xsmall) OR a pixel number (e.g. 48, 24, 14). Use px for precise control.
- lineHeight: multiplier for line spacing (default 1.35). Use 1.0-1.2 for tight headers, 1.4-1.8 for body/footer.
- letterSpacing: px between characters. Use 1-4 for premium headlines, -1 for tight body text. Default 0.
- borderRadius: px for rounded corners on backgroundColor rects. Use for badges, tags, buttons.
- textShadow: format "Xpx Ypx BLURpx COLOR" for drop shadow. Great for readability on busy backgrounds.
- opacity: 0.0-1.0 for transparency. Use for watermarks or subtle text.
- margin: px inset from all sides of the node's allocated box. Use to add breathing room.
- maxLines: limit text to N lines. Use for footer/disclaimer truncation.
- FOOTER/DISCLAIMER: Must have small height (3-5%), fontSize "xsmall" or 10-12px, and lineHeight 1.1. Footer should be compact, not take up large canvas space.{style_matching_rules}"""
