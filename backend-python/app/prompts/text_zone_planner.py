def build_text_zone_prompt(
    text_brief: str,
    visual_concept: str,
    aspect_ratio: str,
) -> str:
    return f"""You are a senior advertising art director planning a background image composition.
Your job is to analyze the TEXT BRIEF and VISUAL CONCEPT, then decide WHERE in the frame text elements need clean, readable space.
The background image has NOT been generated yet -- your output will shape how it is generated.

ASPECT RATIO: {aspect_ratio}
VISUAL CONCEPT: {visual_concept}

TEXT BRIEF:
\"\"\"{text_brief}\"\"\"

YOUR TASK:
1. Identify the text elements: headline (largest, most important), body copy, promo numbers, brand/CTA.
2. Based on the visual concept and aspect ratio, decide the OPTIMAL placement for each group.
   Think like a designer: where would a clean sky, solid wall, blur, or empty space naturally exist in this scene?
3. Describe spatial constraints in natural language that will be appended to the image generation prompt.

RULES:
- Headline needs the most prominent clean zone (min 20-30% of frame height).
- Body copy needs a secondary clean zone (min 15-20% of frame height).
- Brand/CTA can share space or occupy a small area.
- Zones should NOT overlap significantly.
- Consider the aspect ratio: tall (portrait) images have more vertical stack room; wide images favor side-by-side.
- The bottom 10% of the frame is reserved for footer/disclaimer -- do NOT allocate zones there.
- Describe each zone so the image generator will produce a NATURAL scene element in that area (sky, gradient, blur, solid surface).

OUTPUT JSON only (no markdown, no explanation):
{{
  "text_zones": [
    {{
      "role": "headline",
      "region": "top-center",
      "height_pct": 25,
      "description": "clean open sky or softly blurred background area"
    }},
    {{
      "role": "body",
      "region": "bottom-left",
      "height_pct": 20,
      "description": "soft gradient fade to dark, suitable for light text"
    }}
  ],
  "bg_constraints": "natural language spatial constraints to append to the image generation prompt, e.g.: Leave the top 25% of the frame as clear open sky or a softly blurred neutral area suitable for a headline. The bottom-left 20% should have a soft dark gradient or shadowed surface for body text. Place the main subject in the center-right."
}}
"""
