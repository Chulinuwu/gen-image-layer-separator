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


from unittest.mock import AsyncMock, MagicMock, patch
import pytest

@pytest.mark.asyncio
@patch("app.services.vertex.VertexService._generate_content")
async def test_plan_text_zones_parses_response(mock_gen):
    from app.services.vertex import VertexService
    svc = VertexService.__new__(VertexService)

    mock_response = MagicMock()
    mock_response.text = """{
      "text_zones": [
        {"role": "headline", "region": "top-center", "height_pct": 25, "description": "clear sky"}
      ],
      "bg_constraints": "Leave the top 25% as clear sky."
    }"""
    mock_gen.return_value = mock_response

    result = await svc.plan_text_zones(
        text_brief="BIG PROMO 50%",
        visual_concept="beach sunset",
        aspect_ratio="3:4",
    )
    assert "text_zones" in result
    assert len(result["text_zones"]) == 1
    assert result["text_zones"][0]["role"] == "headline"
    assert "bg_constraints" in result

@pytest.mark.asyncio
@patch("app.services.vertex.VertexService._generate_content")
async def test_plan_text_zones_strips_markdown_fences(mock_gen):
    from app.services.vertex import VertexService
    svc = VertexService.__new__(VertexService)

    mock_response = MagicMock()
    mock_response.text = "```json\n{\"text_zones\": [], \"bg_constraints\": \"none\"}\n```"
    mock_gen.return_value = mock_response

    result = await svc.plan_text_zones(
        text_brief="Hello",
        visual_concept="forest",
        aspect_ratio="1:1",
    )
    assert result["bg_constraints"] == "none"


def test_text_zone_prompt_includes_spec_authority_when_provided():
    spec_md = "## 5. Layout Principles\n\nTop 0-25%: headline. 25-70%: hero."
    p = build_text_zone_prompt(
        "brief text",
        "visual concept",
        "3:4",
        style_spec_md=spec_md,
    )
    assert "TARGET DESIGN SYSTEM" in p
    assert "headline" in p or "hero" in p
    assert "5. Layout Principles" in p or "zone map" in p


def test_text_zone_prompt_no_spec_block_when_none():
    p = build_text_zone_prompt("brief", "visual", "3:4", style_spec_md=None)
    assert "TARGET DESIGN SYSTEM" not in p
