def build_flex_thought_prompt(
    target_text: str,
    components_list: str,
    ref_section: str,
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
STYLE MATCHING: Reference images and their style guide are provided above. Your design MUST match their visual DNA:
- Use the SAME color palette (dominant colors, gradients, accents).
- Use SIMILAR typography (font sizes, weights, text colors, stroke effects).
- Match the MOOD (premium, playful, tech-forward, etc.).
- Do NOT copy text content from references -- only copy their VISUAL STYLE.
"""

    return f"""You are a graphic designer planning a text layout over a background image.
Your job is to ANALYZE the image and PLAN where each text element goes, with specific readability treatments.
Do NOT output any JSON or flex tree. Only output your analysis and plan.

{ref_section}{style_section}{image_description_section}{layout_strategy_section}{no_go_zones_section}CAMPAIGN TEXT:
{target_text}

{components_list}
CANVAS: {canvas_size["w"]}x{canvas_size["h"]}px
{style_matching_rules}
a) SCAN THE IMAGE: Describe what you see. Where is the subject? Where are CLEAN areas (sky, solid color, blur, empty space)? Where are BUSY areas (people, objects, details)?

b) LAYOUT STRATEGY based on what you see:
   - Subject in center? -> Text at top + bottom, framing the subject.
   - Subject on left? -> Text on right side.
   - Clean sky at top? -> Headlines go there.
   - Busy everywhere? -> Use gradient overlay or semi-transparent background panels.
   Write your strategy clearly: "I will place text in [area] because [reason]."

c) PLACEMENT & READABILITY -- For EACH text element (or group), write this exact format:
   - ELEMENT: name/text
   - WHERE: position on image (e.g. "top-left over the sky")
   - BACKGROUND: clean-light | clean-dark | busy
   - TREATMENT: the SPECIFIC style properties you will use:
     * clean-light -> dark text color + optional light textShadow
     * clean-dark -> light text color + dark textShadow
     * busy -> pick at least one HEAVY treatment: backgroundColor (e.g. "rgba(0,0,0,0.4)"), gradientOverlay, or backgroundEffects linear-fade. textShadow alone is NOT enough for busy areas.
   Example:
     - ELEMENT: body text section
     - WHERE: mid-left, over a busy scene with objects and people
     - BACKGROUND: busy
     - TREATMENT: backgroundColor "rgba(0,0,0,0.45)" on container + white text "#FFFFFF"
   CONTRAST RULE: shadow/stroke color must ALWAYS contrast with the text color.

d) HIERARCHY: Which text is the HERO (largest)? What's the reading order?

e) GROUPING: Group elements that are spatially near each other.
   - Elements in the same area -> same container.
   - Two parallel sections (left/right)? -> Use a "row" container with two "column" children.
   - Don't stack everything in one flat column -- create structure.

f) BACKGROUND EFFECTS: Do you need canvas-level effects (fade/darken) to improve readability?
   - If text lands on a busy area and you chose backgroundColor on containers, you may skip this.
   - If large text areas need help, consider: linear-fade from top/bottom/left/right, or radial-fade vignette.
   - List any effects you want, or write "none needed".

Output your full analysis as plain text. Be specific with colors, rgba values, and property names."""


def build_flex_tree_prompt(
    target_text: str,
    components_list: str,
    footer_section: str,
    canvas_size: dict,
    layout_thought: str,
) -> str:
    return f"""You are a graphic designer. Convert the design plan below into a flex tree JSON.

DESIGN PLAN (from Art Director -- follow this exactly):
{layout_thought}

CAMPAIGN TEXT:
{target_text}

{components_list}
{footer_section}
CANVAS: {canvas_size["w"]}x{canvas_size["h"]}px

TEXT SIZING REFERENCE (Kanit font, approximate height per line including line spacing):
  fontSize 48+ -> ~65px per line
  fontSize 42  -> ~55px per line
  fontSize 30  -> ~42px per line
  fontSize 24  -> ~34px per line
  fontSize 18  -> ~26px per line
Use this to calculate height%: (lines * px_per_line + padding) / {canvas_size["h"]} * 100.
Example: 3 lines at fontSize 18 with lineHeight 1.4 = 3 * 26 * 1.4 = ~110px. On a {canvas_size["h"]}px canvas = {round(110 / canvas_size["h"] * 100)}%.
Always add ~20px padding per container. If text doesn't fit the box, it gets CLIPPED -- so size generously.

YOUR TASK: Translate the design plan above into a flex tree JSON. Every treatment decision in the plan (backgroundColor, textShadow, gradientOverlay, strokeColor, etc.) MUST appear in the flex tree output. Do NOT skip any treatments.

Output ONLY the JSON object:
{{"flexTree": {{...}}, "campaign_vibe": "...", "background_description": "...", "backgroundEffects": [...]}}

FLEX TREE FORMAT:
Container: {{"id":"...", "direction":"row|column", "justifyContent":"start|end|center|space-between|space-evenly", "alignItems":"start|center|end|stretch", "children":[...], "height":"40%", "width":"60%", "gap":16, "padding":20}}
Spacer: {{"id":"spacer", "direction":"column", "height":"30%", "children":[]}}
Text leaf: {{"id":"...", "type":"text", "text":"...", "height":"30%", "style":{{...}}}}
Component leaf: {{"id":"...", "type":"component", "label":"must match available labels", "height":"50%"}}

STYLE PROPERTIES (on text leaves or containers):
fontSize: "xlarge|large|medium|small|xsmall" or px number (e.g. 48)
fontWeight: "900|700|400"
color: hex (e.g. "#FFFFFF")
strokeColor + strokeWidth: text outline for readability
backgroundColor: solid or rgba for panels/badges/CTAs (use borderRadius for rounded corners). Put on CONTAINER nodes, not text leaves.
textShadow: "Xpx Ypx BLURpx COLOR" -- supports multiple layers with comma
gradientOverlay: "to-bottom rgba(0,0,0,0) rgba(0,0,0,0.7)" -- on CONTAINERS for natural readability fade
align: "left|center|right"
lineHeight: multiplier (1.0-1.2 for headers, 1.4-1.8 for body)
letterSpacing: px (1-4 for premium headlines)
opacity, margin, maxLines, borderRadius

BACKGROUND EFFECTS (canvas-level, in "backgroundEffects" array):
- Linear fade: {{"type": "linear-fade", "from": "bottom|top|left|right", "color": "rgba(0,0,0,0.7)", "size": "40%"}}
- Radial fade: {{"type": "radial-fade", "center": "50% 50%", "radius": "70%", "color": "rgba(0,0,0,0.4)"}}

SIZING RULES:
- EVERY container and text node MUST have an explicit height% (except children inside a row container, which need width% instead).
- Nodes without height% will split remaining space equally, which causes text boxes to be too small or too large. ALWAYS specify height%.
- Size proportional to content: a single-line title needs ~5-8%, a 3-line body paragraph needs ~12-18%, a spacer over the subject needs 30-50%.
- Before outputting, verify: do any text nodes share unsized space? If yes, add explicit height% to each.

RULES:
- Use ONLY the EXACT text from CAMPAIGN TEXT. Do NOT rephrase or add words.
- ONLY create component leaves for labels listed in available die-cut components.
- Root is always "column" with padding and justifyContent "start".
- Use SPACER containers (empty children:[]) to reserve space for the subject/visual.
- TOTAL HEIGHT: All direct children height% in root MUST add up to EXACTLY 100%.
- Footer/disclaimer is handled separately by the system. Do NOT include footer text.
- Hero/promo = LARGEST element (fontSize "xlarge", fontWeight "900")."""
