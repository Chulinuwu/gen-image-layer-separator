from __future__ import annotations


def build_critique_prompt(
    target_text: str,
    style_only: bool,
    has_components: bool = True,
    style_guide: str = "",
    layout_thought: str = "",
    contrast_data: str = "",
    style_spec_md: str | None = None,
) -> str:
    missing_note = "" if has_components else """
IMPORTANT: This layout has NO die-cut visual components (logos, phone mockups, product photos, badges, icons).
The brief may mention visual elements like "phone mockup", "logo", "badge", "screenshot", "app UI" — these were INTENTIONALLY EXCLUDED because no images exist for them.
ABSOLUTELY DO NOT fail the layout for missing visual elements. Do NOT mention missing mockups, logos, or images in your feedback.
ONLY judge the TEXT elements that ARE visible in the preview.
Judge ONLY: text readability, text contrast against background, text composition/hierarchy, and text spacing.
If the text is readable, well-contrasted, and properly arranged — PASS it."""

    layout_thought_section = (
        f"\nINTENDED STYLE (from designer's reasoning):\n{layout_thought[:800]}\n"
        "Verify that the preview MATCHES these style intentions."
        if layout_thought else ""
    )
    style_guide_section = (
        f"\nREFERENCE STYLE GUIDE:\n{style_guide[:500]}\n"
        "Verify style matching with references."
        if style_guide else ""
    )

    contrast_section = ""
    if contrast_data:
        contrast_section = (
            f"\nMEASURED CONTRAST DATA:\n{contrast_data}\n"
            'If any text has contrast ratio below 4.5:1, you MUST FAIL the layout and include "increase contrast" in actionable_steps.\n'
            "Suggest fixes: add darker backgroundColor, change text color, add strokeColor, or use gradientOverlay on the container."
        )

    spec_section = (
        "\n\nTARGET DESIGN SYSTEM:\n"
        f"{style_spec_md}\n\n"
        "Also check if the output adheres to the design system. "
        "List any violations concretely."
        if style_spec_md
        else ""
    )

    style_focus = (
        "Focus ONLY on visual style — positions verified by code."
        if style_only
        else "Check positions AND style."
    )

    json_schema = (
        '{"status": "PASS" | "FAIL", "confidence": 0.0-1.0, "feedback": "...", '
        '"actionable_steps": ["fix 1", "fix 2"], '
        '"spec_compliance": {"pass": true | false, "violations": ["violation 1"]}}'
    )

    return (
        "You are the STRICTEST ART DIRECTOR in the advertising industry.\n"
        "IMAGE 1: ORIGINAL reference. IMAGE 2: PREVIEW with text overlays.\n"
        f'AD BRIEF: "{target_text}"\n'
        f"{missing_note}{layout_thought_section}{style_guide_section}{contrast_section}{spec_section}\n"
        "CRITIQUE CRITERIA: Check text overlap with faces, readability, contrast, composition.\n"
        f"{style_focus}\n\n"
        "Return as STRICT JSON with exactly these keys:\n"
        "  status: \"PASS\" | \"FAIL\"\n"
        "  confidence: float 0.0-1.0\n"
        "  feedback: string\n"
        "  actionable_steps: array of strings\n"
        "  spec_compliance:\n"
        "    pass: boolean\n"
        "    violations: array of strings (empty if pass)\n\n"
        f"Example: {json_schema}"
    )
