from __future__ import annotations

import json
from pathlib import Path
from typing import Any

import numpy as np

_index: list[dict[str, Any]] = []


def load_index(base_dir: Path | str) -> list[dict[str, Any]]:
    global _index
    base = Path(base_dir)
    _index = []
    if not base.exists():
        return _index
    for entry in sorted(p for p in base.iterdir() if p.is_dir()):
        emb_file = entry / "embedding.json"
        if not emb_file.exists():
            continue
        data = json.loads(emb_file.read_text(encoding="utf-8"))
        _index.append(
            {
                "id": entry.name,
                "path": str(entry),
                "vector": data["vector"],
            }
        )
    return _index


def _cosine(a: list[float], b: list[float]) -> float:
    if len(a) != len(b) or not a:
        return 0.0
    va = np.asarray(a, dtype=np.float64)
    vb = np.asarray(b, dtype=np.float64)
    denom = np.linalg.norm(va) * np.linalg.norm(vb)
    if denom == 0:
        return 0.0
    return float(np.dot(va, vb) / denom)


def search_top_k(query: list[float], k: int = 1) -> list[dict[str, Any]]:
    if not _index:
        return []
    scored = [
        {"id": e["id"], "path": e["path"], "score": _cosine(query, e["vector"])}
        for e in _index
    ]
    scored.sort(key=lambda x: x["score"], reverse=True)
    return scored[:k]
