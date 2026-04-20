import os
import pytest

from app.services.vertex import with_retry, vertex_service

_HAS_CREDS = bool(os.getenv("GOOGLE_SERVICE_ACCOUNT_CLIENT_EMAIL"))


call_count = 0


async def flaky_fn():
    global call_count
    call_count += 1
    if call_count < 3:
        raise Exception("429 Resource exhausted")
    return "success"


@pytest.mark.asyncio
async def test_with_retry_retries_on_429():
    global call_count
    call_count = 0
    result = await with_retry(flaky_fn, retries=3, delay=0.01)
    assert result == "success"
    assert call_count == 3


@pytest.mark.asyncio
async def test_with_retry_retries_on_timeout():
    global call_count
    call_count = 0

    async def timeout_fn():
        global call_count
        call_count += 1
        if call_count < 2:
            raise Exception("ETIMEDOUT connection failed")
        return "ok"

    result = await with_retry(timeout_fn, retries=3, delay=0.01)
    assert result == "ok"
    assert call_count == 2


@pytest.mark.asyncio
async def test_with_retry_raises_non_retryable():
    async def bad_fn():
        raise ValueError("something else")

    with pytest.raises(ValueError, match="something else"):
        await with_retry(bad_fn, retries=3, delay=0.01)


@pytest.mark.asyncio
async def test_with_retry_exhausts_retries():
    async def always_429():
        raise Exception("429 Resource exhausted")

    with pytest.raises(Exception, match="429"):
        await with_retry(always_429, retries=2, delay=0.01)


@pytest.mark.skipif(not _HAS_CREDS, reason="no creds")
@pytest.mark.asyncio
async def test_plan_target_overview_returns_nonempty_paragraph():
    result = await vertex_service.plan_target_overview(
        brief="a playful snack brand for teens",
        user_image=None,
        mime=None,
        aspect_ratio="4:5",
        footer_text=None,
    )
    assert isinstance(result, str)
    assert 100 < len(result) < 2500
    assert "No " in result


@pytest.mark.skipif(not _HAS_CREDS, reason="no creds")
@pytest.mark.asyncio
async def test_embed_text_returns_vector():
    vec = await vertex_service.embed_text("a dark editorial luxury layout")
    assert isinstance(vec, list)
    assert len(vec) > 0
    assert all(isinstance(x, (int, float)) for x in vec)
