DESCRIBE_PROMPT = """Analyze this advertisement image in detail. Provide a structured description in TWO parts:

## Part 1 — Background (No Text)
Describe the background image as if no text existed:
- **Color / Atmosphere**: Dominant colors, gradients, mood, aesthetic (e.g. premium, playful, tech-forward)
- **Visual Elements**: List every visual element — 3D objects, illustrations, photos, patterns, effects (glow, particles, bokeh). Describe their position (center, top-left, etc.), style (holographic, flat, realistic), and relative size.

## Part 2 — Layout + Text
Describe the full composition including text overlays:
- **Structure**: Describe the top-to-bottom layout as a table: Position | Content (e.g. "Top Left | Badge reading 'กองทุนใหม่!' in pink-purple")
- **Components**: List any visual components overlaid on the background (phone mockups, product photos, logos, mascots) with their position and size
- **Typography**: Describe the font hierarchy — which text is largest, colors used for text, stroke/shadow effects, alignment

Be specific about colors (hex if possible), positions, and visual relationships between elements."""

DESCRIBE_PROMPT_SHORT = "Describe this image for ad-layout similarity matching in 2-3 sentences. Cover: layout areas, dominant colors, visual style, mood."
