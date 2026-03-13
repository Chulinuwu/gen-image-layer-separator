import pytest
from app.utils.ref_image_search import cosine_similarity


def test_cosine_identical():
    assert cosine_similarity([1, 0, 0], [1, 0, 0]) == pytest.approx(1.0)


def test_cosine_orthogonal():
    assert cosine_similarity([1, 0], [0, 1]) == pytest.approx(0.0)


def test_cosine_opposite():
    assert cosine_similarity([1, 0], [-1, 0]) == pytest.approx(-1.0)


def test_cosine_empty():
    assert cosine_similarity([], []) == 0.0


def test_cosine_different_lengths():
    assert cosine_similarity([1, 2], [1, 2, 3]) == 0.0
