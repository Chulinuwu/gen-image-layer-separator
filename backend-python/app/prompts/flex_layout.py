def build_flex_thought_prompt(
    target_text: str,
    components_list: str,
    ref_section: str,
    canvas_size: dict,
    style_guide: str = "",
    layout_strategy_section: str = "",
    no_go_zones_section: str = "",
    image_description_section: str = "",
    zone_hints: list[dict] | None = None,
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

    zone_hints_section = ""
    if zone_hints:
        lines = ["PRE-PLANNED ZONES (background was generated with these clean areas):"]
        for z in zone_hints:
            lines.append(f'  - {z.get("role", "text")} zone: region "{z.get("region", "")}", approx {z.get("height_pct", 0)}% of frame height, background type: "{z.get("description", "")}"')
        lines.append("Use these zones as your PRIMARY text placement targets. They are already clean in the background.")
        lines.append("")
        zone_hints_section = "\n".join(lines) + "\n"

    return f"""You are a graphic designer planning a text layout over a background image.
Your job is to ANALYZE the image and PLAN where each text element goes, with specific readability treatments.
Do NOT output any JSON or flex tree. Only output your analysis and plan.

{ref_section}{style_section}{image_description_section}{layout_strategy_section}{no_go_zones_section}{zone_hints_section}CAMPAIGN TEXT:
{target_text}

{components_list}
CANVAS: {canvas_size["w"]}x{canvas_size["h"]}px
{style_matching_rules}
BRIGHTNESS HEATMAP: The last image before this text is a brightness heatmap of the background.
Blue/purple = dark areas, Green = mid-tones, Yellow/red/white = bright areas.
Use this heatmap to accurately classify each text zone as clean-light, clean-dark, or busy.
Do NOT guess brightness -- refer to the heatmap.

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
   BACKGROUND CLASSIFICATION RULES -- look at the ACTUAL IMAGE, not assumptions:
     * "clean-light" = the area behind the text is visually LIGHT (bright sky, white surface, light gradient). No objects. Dark text works here.
     * "clean-dark" = the area behind the text is visually DARK (dark surface, shadow, dark gradient). No objects. MUST use white/light text. Dark text on dark surface is INVISIBLE.
     * "busy" = ANY area with objects, textures, patterns, or mixed colors behind it. When in doubt, classify as busy.
     * To decide light vs dark: imagine placing white text there -- would it be readable? If yes, it is dark. Imagine placing dark text -- would it be readable? If yes, it is light. If neither works well, it is busy.
   COLOR RULES:
     * NEVER use pure black (#000000) or near-black (#333333) for text on photos. It looks dull and unreadable.
     * Prefer brand-tone dark colors: deep purple (#3C1F7B, #4A266A), dark navy (#1B2A4A), or rich dark tones that match the image mood.
     * On DARK backgrounds: use white or light text + dark textShadow (e.g. "1px 2px 4px rgba(0,0,0,0.6)").
     * On LIGHT backgrounds: use dark brand-color text + light strokeColor or subtle textShadow (e.g. "0px 1px 3px rgba(255,255,255,0.5)").
     * On BUSY backgrounds: use white text + backgroundColor on container, OR use bold strokeColor (e.g. strokeColor "#000000", strokeWidth 2) to separate text from background.
   FONT SIZE RULES (relative to canvas):
     * Hero headline: fontSize 48-60. Must be unmistakably the biggest element.
     * Section titles (like category headers): fontSize 32-42. These must be clearly visible -- not shy or tiny.
     * Body text: fontSize 22-28. Anything below 22 is too small for an ad.
     * Brand/CTA: fontSize 28-36.
     * On a 1080px-tall canvas, body text at fontSize 18 is barely 1.7% of the canvas height -- too small.
     * FILL THE SPACE: If the text brief has few lines and the canvas is large, USE LARGER FONT SIZES to fill the available space. An ad with tiny text and huge empty areas looks amateurish. Scale text up to use at least 50-60% of the canvas height for content.
   CONTRAST RULE: shadow/stroke color must ALWAYS contrast with the text color.

d) HIERARCHY: Which text is the HERO (largest)? What's the reading order?

e) GROUPING: Group elements that are spatially near each other.
   - Elements in the same area -> same container.
   - Two parallel sections (left/right)? -> Use a "row" container with two "column" children.
   - Don't stack everything in one flat column -- create structure.
   - Consider visual BALANCE: does the overall composition feel symmetric or intentionally asymmetric? Make sure alignment choices across sections feel cohesive, not accidental.

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

TEXT SIZING REFERENCE (Kanit Thai font -- includes space for Thai tone marks and upper vowels):
  fontSize 48+ -> ~85px per line
  fontSize 42  -> ~75px per line
  fontSize 36  -> ~63px per line
  fontSize 30  -> ~53px per line
  fontSize 24  -> ~42px per line
  fontSize 20  -> ~35px per line
These are GENEROUS sizes. Thai script has tall ascenders (tone marks, upper vowels) that need extra vertical space.
Use this to calculate height%: (lines * px_per_line + padding) / {canvas_size["h"]} * 100.
Example: 3 lines at fontSize 24 with lineHeight 1.4 = 3 * 42 * 1.4 = ~176px. On a {canvas_size["h"]}px canvas = {round(176 / canvas_size["h"] * 100)}%.
Always add ~30px padding per container. If text doesn't fit the box, it gets CLIPPED -- so ALWAYS round up.

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
- Root is always "column" with padding >= 30 and justifyContent "start". This root padding is the SAFE MARGIN -- text must never touch the canvas edge.
- Every text node's bounding box must stay at least 30px away from ALL canvas edges (top, bottom, left, right). If text is right-aligned, ensure the right edge of the container still has >= 30px margin from canvas right. Check EVERY text node before outputting.
- Use SPACER containers (empty children:[]) to reserve space for the subject/visual.
- TOTAL HEIGHT: All direct children height% in root MUST add up to EXACTLY 100%.
- Footer/disclaimer is handled separately by the system. Do NOT include footer text.
- Hero/promo = LARGEST element (fontSize "xlarge", fontWeight "900")."""
