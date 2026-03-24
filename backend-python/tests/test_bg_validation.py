from unittest.mock import AsyncMock, MagicMock, patch

import pytest

from app.services.vertex import VertexService

_FAKE_IMAGE = b"\x89PNG fake"
_FAKE_PROC = (b"fake-jpeg", "image/jpeg")
_TEXT_ZONES = [{"role": "headline", "region": "top-center", "height_pct": 25}]


@pytest.mark.asyncio
@patch("app.services.vertex._resize_for_processing", return_value=_FAKE_PROC)
async def test_validate_bg_constraints_pass(mock_resize):
    svc = VertexService.__new__(VertexService)
    mock_response = MagicMock()
    mock_response.text = '{"result": "PASS", "suggestions": "Clean sky area available"}'
    svc._generate_content = AsyncMock(return_value=mock_response)
    svc._text_model = lambda: "gemini-test"

    result = await svc.validate_bg_constraints(_FAKE_IMAGE, _TEXT_ZONES)

    assert result["result"] == "PASS"


@pytest.mark.asyncio
@patch("app.services.vertex._resize_for_processing", return_value=_FAKE_PROC)
async def test_validate_bg_constraints_fail(mock_resize):
    svc = VertexService.__new__(VertexService)
    mock_response = MagicMock()
    mock_response.text = '{"result": "FAIL", "suggestions": "Top area too cluttered"}'
    svc._generate_content = AsyncMock(return_value=mock_response)
    svc._text_model = lambda: "gemini-test"

    result = await svc.validate_bg_constraints(_FAKE_IMAGE, _TEXT_ZONES)

    assert result["result"] == "FAIL"


@pytest.mark.asyncio
@patch("app.services.vertex._resize_for_processing", return_value=_FAKE_PROC)
async def test_validate_bg_constraints_returns_pass_on_parse_error(mock_resize):
    svc = VertexService.__new__(VertexService)
    mock_response = MagicMock()
    mock_response.text = "This is not valid JSON at all!!!"
    svc._generate_content = AsyncMock(return_value=mock_response)
    svc._text_model = lambda: "gemini-test"

    result = await svc.validate_bg_constraints(_FAKE_IMAGE, _TEXT_ZONES)

    assert result["result"] == "PASS"
