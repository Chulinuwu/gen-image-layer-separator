import pytest

from app.services.vertex import VertexService, with_retry


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


# --- Fuzzy label matching ---

class TestFuzzyMatchLabel:
    def test_exact_match(self):
        labels = ["Woman with smartphone", "Product bottle"]
        assert VertexService._fuzzy_match_label("Woman with smartphone", labels) == "Woman with smartphone"

    def test_case_insensitive(self):
        labels = ["Woman with smartphone", "Product bottle"]
        assert VertexService._fuzzy_match_label("woman with smartphone", labels) == "Woman with smartphone"

    def test_token_overlap(self):
        labels = ["Woman with smartphone and water gun", "Product bottle"]
        assert VertexService._fuzzy_match_label("woman_smartphone", labels) == "Woman with smartphone and water gun"

    def test_substring_match(self):
        labels = ["Woman with smartphone and water gun", "Product bottle"]
        assert VertexService._fuzzy_match_label("bottle", labels) == "Product bottle"

    def test_ai_shorthand(self):
        labels = ["Woman with smartphone and water gun", "Singha water bottle"]
        result = VertexService._fuzzy_match_label("woman_component", labels)
        assert result == "Woman with smartphone and water gun"

    def test_no_match_returns_none(self):
        labels = ["Woman with smartphone"]
        assert VertexService._fuzzy_match_label("completely_unrelated_xyz", labels) is None

    def test_empty_labels(self):
        assert VertexService._fuzzy_match_label("anything", []) is None

    def test_validate_tree_auto_fixes_label(self):
        svc = VertexService.__new__(VertexService)
        tree = {"id": "c1", "type": "component", "label": "woman_smartphone"}
        labels = ["Woman with smartphone and water gun", "Product bottle"]
        warnings = svc._validate_flex_tree(tree, labels)
        assert not warnings
        assert tree["label"] == "Woman with smartphone and water gun"

    def test_validate_tree_warns_on_overflow_percentages(self):
        svc = VertexService.__new__(VertexService)
        tree = {
            "id": "root", "direction": "column", "children": [
                {"id": "t1", "type": "text", "text": "A", "height": "60%"},
                {"id": "t2", "type": "text", "text": "B", "height": "60%"},
            ]
        }
        warnings = svc._validate_flex_tree(tree, [])
        assert any("120%" in w for w in warnings)


# --- Canvas clamping ---

class TestCanvasClamping:
    def test_boxes_clamped_to_canvas(self):
        from app.utils.flex_layout import compute_flex_layout
        tree = {
            "id": "root", "direction": "column", "padding": 0, "children": [
                {"id": "t1", "type": "text", "text": "A", "height": "80%"},
                {"id": "t2", "type": "text", "text": "B", "height": "80%"},
            ]
        }
        boxes = compute_flex_layout(tree, 100, 100)
        for box in boxes:
            assert box.x >= 0
            assert box.y >= 0
            assert box.x + box.w <= 100
            assert box.y + box.h <= 100
