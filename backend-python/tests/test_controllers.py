from unittest.mock import AsyncMock, patch

import pytest


def test_generate_requires_prompt(client):
    resp = client.post("/api/image/generate", data={})
    assert resp.status_code in (400, 422)


@patch("app.controllers.image.vertex_service")
def test_generate_returns_image_url(mock_vs, client):
    mock_vs.generate_image = AsyncMock(return_value={
        "buffer": b"\x89PNG fake image data",
        "text": "ok",
        "prompt": "test",
    })
    resp = client.post("/api/image/generate", data={"prompt": "test bg"})
    assert resp.status_code == 200
    data = resp.json()
    assert data["success"] is True
    assert "imageUrl" in data["data"]


def test_add_text_requires_image(client):
    resp = client.post("/api/image/add-text", data={"text": "hello"})
    assert resp.status_code in (400, 422)


def test_render_text_requires_suggestions(client):
    resp = client.post("/api/image/render-text", data={})
    assert resp.status_code in (400, 422)


def test_export_svg_requires_svg_string(client):
    resp = client.post("/api/image/export-svg", json={})
    assert resp.status_code == 400
