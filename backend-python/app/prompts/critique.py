def build_critique_prompt(target_text: str, style_only: bool) -> str:
    return f"""You are the STRICTEST ART DIRECTOR in the advertising industry.
IMAGE 1: ORIGINAL reference. IMAGE 2: PREVIEW with text overlays.
AD BRIEF: "{target_text}"

CRITIQUE CRITERIA: Check text overlap with faces, readability, contrast, composition.
{"Focus ONLY on visual style — positions verified by code." if style_only else "Check positions AND style."}

Return as STRICT JSON:
{{"status": "PASS" | "FAIL", "confidence": 0.0-1.0, "feedback": "...", "actionable_steps": ["fix 1", "fix 2"]}}"""
