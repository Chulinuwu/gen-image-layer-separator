from pathlib import Path

from app.utils.style_spec import StyleSpec, load_spec


def test_load_spec_reads_overview_and_spec(tmp_path: Path):
    entry = tmp_path / "abc"
    entry.mkdir()
    (entry / "overview.md").write_text("A luxury mood.", encoding="utf-8")
    (entry / "spec.md").write_text("## A. Visual Mood\n\nLuxury.", encoding="utf-8")
    (entry / "source.jpg").write_bytes(b"fake")

    spec = load_spec(entry)

    assert spec.id == "abc"
    assert spec.overview == "A luxury mood."
    assert "Visual Mood" in spec.spec_markdown
    assert spec.source_image_path.endswith("source.jpg")


def test_stylespec_constructs_with_all_fields():
    spec = StyleSpec(
        id="x",
        overview="o",
        spec_markdown="s",
        source_image_path="/tmp/x.jpg",
    )
    assert spec.id == "x"


def test_load_spec_raises_when_source_missing(tmp_path: Path):
    entry = tmp_path / "abc"
    entry.mkdir()
    (entry / "overview.md").write_text("o", encoding="utf-8")
    (entry / "spec.md").write_text("s", encoding="utf-8")
    # no source.jpg

    import pytest
    with pytest.raises(FileNotFoundError):
        load_spec(entry)
