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
     * Clean light area -> dark text + LIGHT shadow (e.g. "0px 0px 4px rgba(255,255,255,0.5)") or dark strokeColor
     * Clean dark area -> light text + DARK shadow (e.g. "1px 1px 3px rgba(0,0,0,0.7)") or light strokeColor
     * Busy area -> gradientOverlay/backgroundFade on container, OR backgroundColor, OR bold strokeColor with CONTRASTING color
   CONTRAST RULE: shadow/stroke color must ALWAYS contrast with the text color. Dark text needs light shadow or dark stroke on light bg. Light text needs dark shadow. Same-color treatment (white text + white shadow, dark text + dark shadow) is USELESS and WRONG.

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
- Footer/disclaimer is handled separately by the system. Do NOT include footer text in your flex tree.

Example — subject in center, text above and below:
{{"id":"root", "direction":"column", "justifyContent":"start", "padding":20, "children":[
  {{"id":"top-content", "direction":"column", "height":"___", "children":[...]}},
  {{"id":"spacer", "direction":"column", "height":"___", "children":[]}},
  {{"id":"bottom-content", "direction":"column", "height":"___", "children":[...]}}
]}}

The spacer is an EMPTY container that reserves space for the subject/visual. Use it to AVOID placing text over busy areas.

All direct children height% of root MUST total exactly 100%. Your output will be REJECTED if it exceeds 100%.

{{"flexTree": {{...}}, "campaign_vibe": "...", "background_description": "...", "backgroundEffects": [...]}}

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

BACKGROUND EFFECTS (canvas-level, in "backgroundEffects" array):
Use these to darken/lighten areas of the background image for text readability. Applied OVER the background, UNDER all content.
- Linear fade from edge: {{"type": "linear-fade", "from": "bottom|top|left|right", "color": "rgba(0,0,0,0.7)", "size": "40%"}}
  Example: darken bottom 40% for text readability.
- Radial fade (vignette): {{"type": "radial-fade", "center": "50% 50%", "radius": "70%", "color": "rgba(0,0,0,0.4)"}}
  Example: darken edges to focus attention on center subject.
You can stack multiple effects. Use when the background is busy and text needs a clean area.
Common patterns:
  - Bottom scrim: linear-fade from bottom, 30-40%, rgba(0,0,0,0.6)
  - Side darken for text column: linear-fade from left/right, 40-50%, rgba(0,0,0,0.5)
  - Vignette for focus: radial-fade center 50% 50%, radius 60-80%, rgba(0,0,0,0.3-0.5)

RULES:
- Use ONLY the EXACT text from CAMPAIGN TEXT. Do NOT rephrase or add words.
- If the brief contains positioning instructions (x%, y%, px sizes, font specs) — IGNORE them. YOU decide layout based on the IMAGE.
- ONLY create component leaves for labels listed in available die-cut components. Do NOT invent components.
- Do NOT create text nodes for visual elements described in the brief (mockups, logos, icons) unless they exist as die-cut components.
- Root is always "column" with padding and justifyContent "start" (NOT "space-between" — you control placement with explicit height% and spacers).
- Height% of each node should match its content — a single-line badge needs much less than a multi-line paragraph.
- Use SPACER containers (empty children:[]) to reserve space for the subject/visual in the image. This is how you avoid placing text over busy areas.
- CTA buttons: ALWAYS use backgroundColor with a brand color + contrasting text.
- TOTAL HEIGHT: All direct children height% in root MUST add up to EXACTLY 100%. If they exceed 100%, content will overflow and overlap. Count before outputting.
- Hero/promo = LARGEST element (fontSize "xlarge", fontWeight "900").{style_matching_rules}"""
