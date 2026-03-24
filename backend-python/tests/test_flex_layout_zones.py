from app.prompts.flex_layout import build_flex_thought_prompt


def _base_prompt(**kwargs):
    defaults = dict(
        target_text="SALE 50% OFF\nLimited time",
        components_list="No die-cut components available.",
        ref_section="",
        canvas_size={"w": 900, "h": 1200},
    )
    defaults.update(kwargs)
    return build_flex_thought_prompt(**defaults)


def test_flex_thought_without_zones():
    prompt = _base_prompt()
    assert "PRE-PLANNED ZONES" not in prompt


def test_flex_thought_with_zones():
    hints = [
        {"role": "headline", "region": "top-center", "height_pct": 25, "description": "clear sky gradient"},
        {"role": "body", "region": "bottom-left", "height_pct": 15, "description": "dark solid area"},
    ]
    prompt = _base_prompt(zone_hints=hints)
    assert "PRE-PLANNED ZONES" in prompt
    assert 'region "top-center"' in prompt
    assert "25% of frame height" in prompt
    assert "clear sky gradient" in prompt
    assert 'region "bottom-left"' in prompt
    assert "PRIMARY text placement targets" in prompt
