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

CRITICAL -- NATURAL BLENDING:
- Clean zones must be described as NATURAL parts of the scene -- NOT as blank rectangles or pasted-on patches.
- Good: "the sky naturally extends across the upper portion with soft clouds" or "the scene fades into soft bokeh/blur on the left side"
- Bad: "leave a blank rectangle at the top" or "clear empty area in the corner"
- The bg_constraints should read like a photographer's composition note, NOT a layout grid.
- The image must look like ONE cohesive photograph, not a collage with text zones cut out.

OUTPUT JSON only (no markdown, no explanation):
{{
  "text_zones": [
    {{
      "role": "headline",
      "region": "top-center",
      "height_pct": 25,
      "description": "open sky with soft gradient, naturally uncluttered"
    }},
    {{
      "role": "body",
      "region": "bottom-left",
      "height_pct": 20,
      "description": "scene fades into soft dark tones, naturally less detailed"
    }}
  ],
  "bg_constraints": "Compose the scene so that the upper portion naturally features open sky or atmosphere with minimal objects, creating a calm area suitable for overlay text. The main subject should be positioned in the center or lower-center. Let the scene naturally fade or simplify toward the edges where text will be placed -- do NOT create obvious blank patches or sharp boundaries."
}}
"""
