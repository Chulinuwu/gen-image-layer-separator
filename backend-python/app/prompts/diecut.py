def build_diecut_prompt(label: str, description: str, is_character: bool) -> str:
    return (
        f'Recreate "{label}" as a HIGH-RESOLUTION CUTOUT on PURE WHITE BACKGROUND. '
        f'{description} '
        f'{"FULL BODY from head to toes. No cropping." if is_character else "OBJECT ONLY, no hands/arms holding it."} '
        f'No text, no borders, no shadows. Centered with generous padding.'
    )
