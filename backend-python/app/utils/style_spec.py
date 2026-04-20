from __future__ import annotations

from dataclasses import dataclass
from pathlib import Path


@dataclass
class StyleSpec:
    id: str
    overview: str
    spec_markdown: str
    source_image_path: str


def load_spec(entry_dir: Path | str) -> StyleSpec:
    entry_dir = Path(entry_dir)
    overview = (entry_dir / "overview.md").read_text(encoding="utf-8")
    spec_md = (entry_dir / "spec.md").read_text(encoding="utf-8")
    source = entry_dir / "source.jpg"
    if not source.exists():
        raise FileNotFoundError(f"StyleSpec source image missing: {source}")
    return StyleSpec(
        id=entry_dir.name,
        overview=overview,
        spec_markdown=spec_md,
        source_image_path=str(source),
    )
