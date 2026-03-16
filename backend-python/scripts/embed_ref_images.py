#!/usr/bin/env python3
"""Batch-embed reference images in assets/ref_images/.

Usage:
    cd backend-python
    source venv/bin/activate
    python scripts/embed_ref_images.py

Reads every image in assets/ref_images/, calls describe_and_embed() for each,
and writes embeddings.json incrementally (safe to interrupt and resume).
"""
from __future__ import annotations

import asyncio
import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent.parent))

REF_DIR = Path(__file__).parent.parent / "assets" / "ref_images"
OUTPUT = REF_DIR / "embeddings.json"
IMAGE_EXTS = {".png", ".jpg", ".jpeg", ".webp"}


def _load_existing() -> dict[str, dict]:
    if not OUTPUT.exists():
        return {}
    try:
        return {e["filename"]: e for e in json.loads(OUTPUT.read_text("utf-8"))}
    except (json.JSONDecodeError, KeyError):
        return {}


def _save(entries: dict[str, dict]) -> None:
    OUTPUT.write_text(
        json.dumps(list(entries.values()), ensure_ascii=False, indent=2), "utf-8"
    )


async def main():
    from app.services.vertex import vertex_service

    images = sorted(f for f in REF_DIR.iterdir() if f.suffix.lower() in IMAGE_EXTS)
    if not images:
        print(f"No images found in {REF_DIR}")
        return

    entries = _load_existing()
    new_count = 0

    for i, img_path in enumerate(images):
        fname = img_path.name
        if fname in entries:
            print(f"[{i+1}/{len(images)}] {fname} — cached")
            continue

        print(f"[{i+1}/{len(images)}] {fname} — embedding...")
        try:
            buf = img_path.read_bytes()
            mime = "image/png" if img_path.suffix.lower() == ".png" else "image/jpeg"
            result = await vertex_service.describe_and_embed(buf, mime)
            entries[fname] = {
                "filename": fname,
                "description": result.get("description", ""),
                "embedding": result.get("embedding", []),
            }
            _save(entries)
            new_count += 1
            print(f"  ✅ {result.get('description', '')[:80]}...")
            await asyncio.sleep(1)
        except Exception as e:
            print(f"  ❌ Failed: {e}")

    # Clean up entries for deleted images
    current_filenames = {f.name for f in images}
    removed = [k for k in entries if k not in current_filenames]
    for k in removed:
        del entries[k]
        print(f"  🗑️ Removed stale entry: {k}")
    if removed:
        _save(entries)

    print(f"\nDone! {len(entries)} total entries ({new_count} new) in {OUTPUT}")


if __name__ == "__main__":
    asyncio.run(main())
