from app.utils.ref_image_search import extract_style_guide

SAMPLE_REFS = [
    {
        "filename": "test1.png",
        "description": (
            "## Part 1 — Background\n"
            "### Color / Atmosphere\n"
            "Purple gradient (#582C7D to #3A1B5E), premium feel, warm mood.\n"
            "### Visual Elements\n"
            "3D globe, floating coins, bokeh particles.\n\n"
            "## Part 2 — Layout + Text\n"
            "### Structure\n"
            "| Position | Content |\n"
            "| Top Left | Badge 'กองทุนใหม่!' in pink |\n"
            "| Upper Center | Main headline white bold |\n"
            "| Center | Phone mockup |\n"
            "| Bottom | CTA button purple bg |\n"
            "### Typography\n"
            "Large white headlines, gold accent (#FFD700), stroke for readability."
        ),
        "score": 0.92,
    },
    {
        "filename": "test2.png",
        "description": (
            "## Part 1 — Background\n"
            "### Color / Atmosphere\n"
            "Deep blue (#1A237E) to dark navy, tech-forward, modern.\n"
            "### Visual Elements\n"
            "Circuit patterns, glowing lines.\n\n"
            "## Part 2 — Layout + Text\n"
            "### Structure\n"
            "| Position | Content |\n"
            "| Top | Logo |\n"
            "| Center | Hero number xlarge gold |\n"
            "| Bottom | Fine print white |\n"
            "### Typography\n"
            "Bold gold numbers, white body text, no stroke."
        ),
        "score": 0.85,
    },
]


def test_extract_style_guide_returns_string():
    result = extract_style_guide(SAMPLE_REFS)
    assert isinstance(result, str)
    assert len(result) > 50


def test_extract_style_guide_empty_refs():
    result = extract_style_guide([])
    assert result == ""


def test_extract_style_guide_contains_key_sections():
    result = extract_style_guide(SAMPLE_REFS)
    assert "color" in result.lower() or "palette" in result.lower()
    assert "layout" in result.lower() or "structure" in result.lower()
