from app.prompts.text_zone_planner import build_text_zone_prompt

def test_build_text_zone_prompt_contains_brief():
    prompt = build_text_zone_prompt(
        text_brief="SUMMER SALE 50% OFF\nLimited time offer",
        visual_concept="a beach scene at sunset",
        aspect_ratio="3:4",
    )
    assert "SUMMER SALE 50% OFF" in prompt
    assert "beach scene at sunset" in prompt
    assert "3:4" in prompt

def test_build_text_zone_prompt_requests_json():
    prompt = build_text_zone_prompt(
        text_brief="Headline\nBody",
        visual_concept="city skyline",
        aspect_ratio="16:9",
    )
    assert "text_zones" in prompt
    assert "bg_constraints" in prompt
    assert "JSON" in prompt

def test_build_text_zone_prompt_includes_role_guidance():
    prompt = build_text_zone_prompt(
        text_brief="BIG PROMO 999",
        visual_concept="product shot",
        aspect_ratio="1:1",
    )
    assert "headline" in prompt.lower()
    assert "region" in prompt.lower()
