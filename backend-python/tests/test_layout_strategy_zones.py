from app.prompts.layout_strategy import build_layout_strategy_prompt


def _base_prompt(**kwargs):
    defaults = dict(
        target_text="SALE 50% OFF\nLimited time",
        comp_pos_block="",
        components_available="none",
        text_lines_count=2,
        has_promo=True,
        est_text_h=200,
        comp_pct=0,
    )
    defaults.update(kwargs)
    return build_layout_strategy_prompt(**defaults)


def test_layout_strategy_without_zones():
    prompt = _base_prompt()
    assert "PRE-PLANNED" not in prompt


def test_layout_strategy_with_zones():
    hints = [
        {"role": "headline", "region": "top-center", "height_pct": 25, "description": "clear sky gradient"},
        {"role": "body", "region": "bottom-left", "height_pct": 15, "description": "dark solid area"},
    ]
    prompt = _base_prompt(text_zone_hints=hints)
    assert "PRE-PLANNED TEXT ZONES" in prompt
    assert 'region "top-center"' in prompt
    assert "25% height" in prompt
    assert "clear sky gradient" in prompt
    assert 'region "bottom-left"' in prompt


def test_layout_strategy_zone_prioritizes():
    hints = [{"role": "headline", "region": "top-center", "height_pct": 30, "description": "sky"}]
    prompt = _base_prompt(text_zone_hints=hints)
    assert "PRIORITIZE" in prompt


def test_layout_strategy_prompt_includes_spec_authority_when_provided():
    spec_md = "## 1. Visual Theme\nDiagonal hero right, card left."
    prompt = _base_prompt(style_spec_md=spec_md)
    assert "TARGET DESIGN SYSTEM" in prompt
    assert "Diagonal" in prompt or "composition archetype" in prompt


def test_layout_strategy_prompt_no_spec_block_when_none():
    prompt = _base_prompt(style_spec_md=None)
    assert "TARGET DESIGN SYSTEM" not in prompt
