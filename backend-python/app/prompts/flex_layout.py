def build_flex_layout_prompt(
    target_text: str,
    components_list: str,
    ref_section: str,
    footer_section: str,
    canvas_size: dict,
    style_guide: str = "",
    layout_strategy_section: str = "",
    no_go_zones_section: str = "",
    image_description_section: str = "",
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

    return f"""You are a graphic designer. You LOOK at the background image first, then decide where text goes.

{ref_section}{style_section}{image_description_section}{layout_strategy_section}{no_go_zones_section}CAMPAIGN TEXT:
{target_text}

{components_list}
{footer_section}
CANVAS: {canvas_size["w"]}x{canvas_size["h"]}px

Think like a real designer — image first, then text.

STEP 1 — LOOK AT THE IMAGE in <layout_thought>...</layout_thought>

a) SCAN THE IMAGE: Describe what you see. Where is the subject? Where are CLEAN areas (sky, solid color, blur, empty space)? Where are BUSY areas (people, objects, details)?

b) CHOOSE A LAYOUT STRATEGY based on what you see:
   - Subject in center? -> Text at top + bottom, framing the subject.
   - Subject on left? -> Text on right side.
   - Subject at bottom? -> Text at top.
   - Clean sky at top? -> Headlines go there.
   - Busy everywhere? -> Use gradient overlay or semi-transparent background panels.
   Write your strategy clearly: "I will place text in [area] because [reason]."

c) PLACEMENT — For EACH text element, decide:
   - WHERE on the image it goes (e.g. "top-left over the sky", "bottom-right over the road")
   - WHY that spot (e.g. "clean area, good contrast", "near related content")
   - WHAT readability treatment it needs based on what's behind it:
     * Clean light area -> dark text + subtle textShadow
     * Clean dark area -> light text + subtle textShadow
     * Busy area -> gradientOverlay on container, OR backgroundColor, OR bold strokeColor
   EVERY text node MUST have at least one readability treatment. No exceptions.

d) HIERARCHY: Which text is the HERO (largest)? What's the reading order?

STEP 2 — GROUPING in <grouping>...</grouping>
Based on your placement decisions, group elements that are spatially near each other.
- Elements in the same area of the image -> same container.
- Two parallel sections (left/right, before/after)? -> Use a "row" container with two "column" children.
- Don't stack everything in one flat column — create structure.

STEP 3 — FLEX TREE JSON
Translate your placement and grouping into a flex tree.
Your flex tree MUST reflect the placement decisions from Step 1.

CRITICAL RULE: height% directly controls WHERE on the canvas the content appears.
- If you decided "headline at the top over the sky (top 25%)" -> headline container height ~20%, placed first.
- If the subject occupies the middle 30-50% of the image -> add an EMPTY SPACER container there to keep it clear.
- If footer goes at the bottom -> footer is the last child.

Example — subject in center, text above and below:
{{"id":"root", "direction":"column", "justifyContent":"start", "padding":20, "children":[
  {{"id":"top-content", "direction":"column", "height":"30%", "children":[...]}},
  {{"id":"spacer", "direction":"column", "height":"35%", "children":[]}},
  {{"id":"bottom-content", "direction":"column", "height":"30%", "children":[...]}},
  {{"id":"footer", "type":"text", "text":"...", "height":"5%", "style":{{...}}}}
]}}

The spacer is an EMPTY container that reserves space for the subject/visual. Use it to AVOID placing text over busy areas. Adjust spacer height based on where the subject is in the image.

{{"flexTree": {{...}}, "campaign_vibe": "...", "background_description": "..."}}

FLEX TREE FORMAT:
Container: {{"id":"...", "direction":"row|column", "justifyContent":"start|end|center|space-between|space-evenly", "children":[...], "height":"40%", "width":"60%", "gap":16, "padding":20}}
Spacer: {{"id":"spacer", "direction":"column", "height":"30%", "children":[]}}
Text leaf: {{"id":"...", "type":"text", "text":"...", "height":"30%", "style":{{...}}}}
Component leaf: {{"id":"...", "type":"component", "label":"must match available labels", "height":"50%"}}

STYLE PROPERTIES:
fontSize: "xlarge|large|medium|small|xsmall" or px number (e.g. 48)
fontWeight: "900|700|400"
color: hex (e.g. "#FFFFFF")
strokeColor + strokeWidth: text outline for readability
backgroundColor: solid or rgba for panels/badges/CTAs (use borderRadius for rounded corners)
textShadow: "Xpx Ypx BLURpx COLOR" — supports multiple layers with comma: "0px 0px 10px rgba(255,215,0,0.6), 2px 2px 4px rgba(0,0,0,0.5)"
gradientOverlay: "to-bottom rgba(0,0,0,0) rgba(0,0,0,0.7)" — on CONTAINERS for natural readability fade
align: "left|center|right"
lineHeight: multiplier (1.0-1.2 for headers, 1.4-1.8 for body)
letterSpacing: px (1-4 for premium headlines)
opacity, margin, maxLines, borderRadius

RULES:
- Use ONLY the EXACT text from CAMPAIGN TEXT. Do NOT rephrase or add words.
- If the brief contains positioning instructions (x%, y%, px sizes, font specs) — IGNORE them. YOU decide layout based on the IMAGE.
- ONLY create component leaves for labels listed in available die-cut components. Do NOT invent components.
- Do NOT create text nodes for visual elements described in the brief (mockups, logos, icons) unless they exist as die-cut components.
- Root is always "column" with padding and justifyContent "start" (NOT "space-between" — you control placement with explicit height% and spacers).
- Height% of each node should match its content — a single-line badge needs much less than a multi-line paragraph.
- Use SPACER containers (empty children:[]) to reserve space for the subject/visual in the image. This is how you avoid placing text over busy areas.
- CTA buttons: ALWAYS use backgroundColor with a brand color + contrasting text.
- Footer/disclaimer: small height (3-5%), fontSize "xsmall" or 10-12px, lineHeight 1.1.
- Hero/promo = LARGEST element (fontSize "xlarge", fontWeight "900").{style_matching_rules}"""
