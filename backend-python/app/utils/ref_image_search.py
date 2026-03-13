from __future__ import annotations

import json
from pathlib import Path

import numpy as np

REF_DIR = Path(__file__).parent.parent.parent / "assets" / "ref_images"
INDEX_FILE = REF_DIR / "embeddings.json"

_cached_index: list[dict] | None = None


def _load_index() -> list[dict]:
    global _cached_index
    if _cached_index is not None:
        return _cached_index
    if not INDEX_FILE.exists():
        return []
    _cached_index = json.loads(INDEX_FILE.read_text("utf-8"))
    return _cached_index


def cosine_similarity(a: list[float], b: list[float]) -> float:
    if len(a) != len(b) or len(a) == 0:
        return 0.0
    va = np.array(a, dtype=np.float64)
    vb = np.array(b, dtype=np.float64)
    denom = np.linalg.norm(va) * np.linalg.norm(vb)
    if denom == 0:
        return 0.0
    return float(np.dot(va, vb) / denom)


def find_similar_refs(
    query_embedding: list[float], top_k: int = 3
) -> list[dict]:
    index = _load_index()
    if not index:
        return []

    scored = [
        {
            "filename": entry["filename"],
            "description": entry["description"],
            "score": cosine_similarity(query_embedding, entry["embedding"]),
            "filepath": str(REF_DIR / entry["filename"]),
        }
        for entry in index
    ]

    scored.sort(key=lambda x: x["score"], reverse=True)
    return scored[:top_k]


def clear_ref_image_cache() -> None:
    global _cached_index
    _cached_index = None
