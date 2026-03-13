import pytest

from app.services.vertex import with_retry


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
