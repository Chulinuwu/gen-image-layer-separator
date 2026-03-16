from __future__ import annotations

import json
import re as _re
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


def extract_style_guide(refs: list[dict]) -> str:
    if not refs:
        return ""

    colors = []
    layouts = []
    typography = []

    for ref in refs:
        desc = ref.get("description", "")

        color_match = _re.search(
            r"(?:Color\s*/?\s*Atmosphere|Colors?)\s*\n(.*?)(?:\n#|\n\n|\Z)",
            desc, _re.DOTALL | _re.IGNORECASE,
        )
        if color_match:
            colors.append(color_match.group(1).strip()[:200])

        typo_match = _re.search(
            r"Typography\s*\n(.*?)(?:\n#|\n\n|\Z)",
            desc, _re.DOTALL | _re.IGNORECASE,
        )
        if typo_match:
            typography.append(typo_match.group(1).strip()[:200])

        struct_match = _re.search(
            r"Structure\s*\n(.*?)(?:\n#|\n\n|\Z)",
            desc, _re.DOTALL | _re.IGNORECASE,
        )
        if struct_match:
            layouts.append(struct_match.group(1).strip()[:300])

    parts = ["STYLE GUIDE (extracted from reference ads):"]

    if colors:
        parts.append("COLOR PALETTE:")
        for i, c in enumerate(colors):
            parts.append(f"  Ref {i+1}: {c}")

    if layouts:
        parts.append("LAYOUT PATTERNS:")
        for i, l in enumerate(layouts):
            parts.append(f"  Ref {i+1}: {l}")

    if typography:
        parts.append("TYPOGRAPHY:")
        for i, t in enumerate(typography):
            parts.append(f"  Ref {i+1}: {t}")

    if len(parts) == 1:
        return ""

    parts.append("")
    parts.append(
        "INSTRUCTION: Your design MUST follow the color palette, layout pattern, "
        "and typography style shown in these references. Match their visual DNA — "
        "use similar colors, similar text hierarchy, similar spacing and composition."
    )
    return "\n".join(parts)


def clear_ref_image_cache() -> None:
    global _cached_index
    _cached_index = None
