from __future__ import annotations

import json
from pathlib import Path

from app.services import style_library


def _write_entry(base: Path, eid: str, vector: list[float]) -> None:
    d = base / eid
    d.mkdir(parents=True)
    (d / "embedding.json").write_text(
        json.dumps({"vector": vector, "model": "test"}), encoding="utf-8"
    )


def test_load_index_from_disk(tmp_path: Path):
    _write_entry(tmp_path, "a", [1.0, 0.0])
    _write_entry(tmp_path, "b", [0.0, 1.0])

    index = style_library.load_index(tmp_path)

    assert {e["id"] for e in index} == {"a", "b"}


def test_search_top_k_returns_nearest(tmp_path: Path):
    _write_entry(tmp_path, "a", [1.0, 0.0])
    _write_entry(tmp_path, "b", [0.0, 1.0])
    style_library.load_index(tmp_path)

    top = style_library.search_top_k([0.9, 0.1], k=1)

    assert len(top) == 1
    assert top[0]["id"] == "a"


def test_search_with_empty_index_returns_empty(tmp_path: Path):
    style_library.load_index(tmp_path)

    assert style_library.search_top_k([1.0, 0.0], k=1) == []


def test_cosine_mismatched_lengths_returns_zero():
    assert style_library._cosine([1.0, 0.0], [1.0]) == 0.0


def test_cosine_zero_vector_returns_zero():
    assert style_library._cosine([0.0, 0.0], [1.0, 0.0]) == 0.0
