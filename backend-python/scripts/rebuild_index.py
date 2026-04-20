"""Walk design_systems/, embed any overview.md that changed, rebuild index.json.

Run from backend-python/:
    python -m scripts.rebuild_index
    python -m scripts.rebuild_index --force         # re-embed everything
    python -m scripts.rebuild_index --only <id>     # single entry
"""

from __future__ import annotations

import argparse
import asyncio
import hashlib
import json
import sys
from pathlib import Path

BASE = Path(__file__).parent.parent
OUT_DIR = BASE / "assets" / "design_systems"
INDEX_FILE = OUT_DIR / "index.json"


def _sha1_text(s: str) -> str:
    return hashlib.sha1(s.encode("utf-8")).hexdigest()


async def _embed_one(entry: Path, *, force: bool) -> dict | None:
    from app.services.vertex import vertex_service

    overview_file = entry / "overview.md"
    spec_file = entry / "spec.md"
    if not overview_file.exists() or not spec_file.exists():
        print(f"[skip-incomplete] {entry.name} (missing overview.md or spec.md)")
        return None

    overview = overview_file.read_text(encoding="utf-8")
    current_hash = _sha1_text(overview)

    emb_file = entry / "embedding.json"
    if not force and emb_file.exists():
        existing = json.loads(emb_file.read_text(encoding="utf-8"))
        if existing.get("source_hash") == current_hash:
            print(f"[skip] {entry.name}")
            return {"id": entry.name, "vector": existing["vector"]}

    print(f"[embed] {entry.name}")
    vector = await vertex_service.embed_text(overview)
    emb_file.write_text(
        json.dumps(
            {
                "vector": vector,
                "model": "gemini-embedding-001",
                "source_hash": current_hash,
            }
        ),
        encoding="utf-8",
    )
    return {"id": entry.name, "vector": vector}


async def main(force: bool, only: str | None) -> int:
    if not OUT_DIR.exists():
        print(f"[error] missing dir: {OUT_DIR}", file=sys.stderr)
        return 1

    entries = sorted(p for p in OUT_DIR.iterdir() if p.is_dir())
    if only:
        entries = [p for p in entries if p.name == only]

    index_entries: list[dict] = []
    for entry in entries:
        try:
            result = await _embed_one(entry, force=force)
            if result is not None:
                index_entries.append(result)
        except Exception as e:
            print(f"[fail] {entry.name}: {e}", file=sys.stderr)

    INDEX_FILE.write_text(
        json.dumps({"entries": index_entries}, indent=2), encoding="utf-8"
    )
    print(f"[done] wrote {len(index_entries)} entries -> {INDEX_FILE}")
    return 0


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--force", action="store_true")
    parser.add_argument("--only", type=str, default=None)
    args = parser.parse_args()
    sys.exit(asyncio.run(main(args.force, args.only)))
