def build_critique_prompt(target_text: str, style_only: bool, has_components: bool = True) -> str:
    missing_note = "" if has_components else """
IMPORTANT: This layout has NO die-cut visual components (logos, phone mockups, product photos, badges, icons).
The brief may mention visual elements like "phone mockup", "logo", "badge", "screenshot", "app UI" — these were INTENTIONALLY EXCLUDED because no images exist for them.
ABSOLUTELY DO NOT fail the layout for missing visual elements. Do NOT mention missing mockups, logos, or images in your feedback.
ONLY judge the TEXT elements that ARE visible in the preview.
Judge ONLY: text readability, text contrast against background, text composition/hierarchy, and text spacing.
If the text is readable, well-contrasted, and properly arranged — PASS it."""

    return f"""You are the STRICTEST ART DIRECTOR in the advertising industry.
IMAGE 1: ORIGINAL reference. IMAGE 2: PREVIEW with text overlays.
AD BRIEF: "{target_text}"
{missing_note}
CRITIQUE CRITERIA: Check text overlap with faces, readability, contrast, composition.
{"Focus ONLY on visual style — positions verified by code." if style_only else "Check positions AND style."}

Return as STRICT JSON:
{{"status": "PASS" | "FAIL", "confidence": 0.0-1.0, "feedback": "...", "actionable_steps": ["fix 1", "fix 2"]}}"""
