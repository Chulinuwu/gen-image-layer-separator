from unittest.mock import AsyncMock, patch

import pytest


@patch("app.controllers.image.vertex_service")
def test_generate_integrated_happy_path(mock_vs, client):
    mock_vs.plan_text_zones = AsyncMock(return_value={
        "text_zones": [{"role": "headline", "region": "top-center", "height_pct": 25}],
        "bg_constraints": "Leave the top 25% as clear sky for text.",
    })
    mock_vs.generate_image = AsyncMock(return_value={
        "buffer": b"\x89PNG fake image data",
        "text": "ok",
        "prompt": "enriched prompt",
    })

    resp = client.post("/api/image/generate-integrated", json={
        "text_brief": "SUMMER SALE 50% OFF",
        "visual_concept": "a beach scene at sunset",
        "aspect_ratio": "3:4",
    })

    assert resp.status_code == 200
    data = resp.json()
    assert data["success"] is True
    assert "imageUrl" in data["data"]
    assert "textZones" in data["data"]
    assert "bgConstraints" in data["data"]
    assert data["data"]["bgConstraints"] == "Leave the top 25% as clear sky for text."

    call_kwargs = mock_vs.generate_image.call_args
    prompt_used = call_kwargs.kwargs.get("prompt") or call_kwargs.args[0]
    assert "Leave the top 25% as clear sky for text." in prompt_used
    assert "beach scene at sunset" in prompt_used


@patch("app.controllers.image.vertex_service")
def test_generate_integrated_missing_text_brief(mock_vs, client):
    resp = client.post("/api/image/generate-integrated", json={
        "visual_concept": "a beach scene",
    })
    assert resp.status_code == 400
    assert "text_brief" in resp.json()["error"].lower()


@patch("app.controllers.image.vertex_service")
def test_generate_integrated_missing_visual_concept(mock_vs, client):
    resp = client.post("/api/image/generate-integrated", json={
        "text_brief": "SUMMER SALE",
    })
    assert resp.status_code == 400
    assert "visual_concept" in resp.json()["error"].lower()


def test_create_campaign_accepts_text_zone_hints_no_422(client):
    hints = '[{"role": "headline", "region": "top-center", "height_pct": 25, "description": "clear sky"}]'
    resp = client.post(
        "/api/image/create-campaign",
        data={
            "text": "SUMMER SALE",
            "textZoneHints": hints,
        },
    )
    # Should not be 422 (unprocessable entity) -- field is accepted by FastAPI
    assert resp.status_code != 422
