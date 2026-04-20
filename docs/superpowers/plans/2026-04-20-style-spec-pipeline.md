# StyleSpec Pipeline Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the current raw-image reference mechanism with a structured StyleSpec library. A StyleSpec is selected from user inputs at Step 0, then conditions background generation, flex layout, and critique throughout the pipeline.

**Architecture:** Agent-driven per-image extraction (Claude Code Opus, Task 9) produces `design_systems/<id>/{overview.md, spec.md, source.jpg}`; a lightweight script (`rebuild_index.py`, Task 8) embeds overviews and builds `index.json`. Runtime: AI plans a target overview paragraph from user inputs → cosine search top-1 → StyleSpec threads through downstream steps. Pipeline core (RMBG, die-cut, inpaint, flex compute, SVG build) unchanged.

**Tech Stack:** Python 3.11+, FastAPI, google-genai SDK, numpy (cosine), Pillow, pytest + pytest-asyncio. Frontend: Vue 3 (minor SSE handler changes).

**Spec:** `docs/superpowers/specs/2026-04-20-style-spec-pipeline-design.md`

---

## File Structure

### New files

```
backend-python/
  app/
    utils/style_spec.py                     # StyleSpec dataclass + parse helpers
    services/style_library.py               # load_index + cosine search
    prompts/plan_target_overview.py         # plan query paragraph
    prompts/extract_style_spec.py           # 2-pass extraction
    prompts/translate_spec_to_imagen.py     # spec → Imagen prompt
  scripts/
    rebuild_index.py                        # embed overviews + write index.json
  tests/
    test_style_spec.py
    test_style_library.py
    test_plan_target_overview.py
    test_extract_style_spec_prompts.py
    test_translate_spec_to_imagen.py
```

### Modified files

```
backend-python/
  app/
    main.py                                 # lifespan: load_index
    controllers/image.py                    # prepend _step_plan_and_match
    services/vertex.py                      # new methods + updated signatures
    prompts/flex_layout.py                  # rewrite: consume StyleSpec
    prompts/critique.py                     # rewrite: add spec_compliance
    prompts/campaign_layout.py              # minor: accept style hints
    constants/pipeline.py                   # add dir + model consts
frontend/src/components/
    CampaignLayout.vue                      # SSE handlers for style events
```

### Deleted files

```
backend-python/app/utils/ref_image_search.py
backend-python/assets/ref_images/embeddings.json   # (after library is built)
backend-python/tests/test_ref_image_search.py
backend-python/tests/test_ref_style.py
```

---

## Conventions Used In This Plan

- Every code block is the exact content to write.
- Commit messages use plain format (no Co-Authored-By).
- Run tests via `python -m pytest tests/<file>.py::<name> -v` from `backend-python/`.
- Assume `source venv/bin/activate` has been done.
- The ASSETS dir lives at `backend-python/assets/`. `pytest` is run from `backend-python/` (where `pyproject.toml` lives).

---

## Task 1: Constants + StyleSpec Dataclass

**Files:**
- Modify: `backend-python/app/constants/pipeline.py` (append)
- Create: `backend-python/app/utils/style_spec.py`
- Test: `backend-python/tests/test_style_spec.py`

- [ ] **Step 1: Write the failing test**

Create `backend-python/tests/test_style_spec.py`:

```python
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


def test_styleSpec_is_picklable_dataclass():
    spec = StyleSpec(
        id="x",
        overview="o",
        spec_markdown="s",
        source_image_path="/tmp/x.jpg",
    )
    assert spec.id == "x"
```

- [ ] **Step 2: Run test to verify it fails**

Run: `python -m pytest tests/test_style_spec.py -v`
Expected: FAIL — module `app.utils.style_spec` does not exist.

- [ ] **Step 3: Append constants**

Open `backend-python/app/constants/pipeline.py` and append to the bottom:

```python

# --- StyleSpec library ---
STYLE_SPEC_DIR = "assets/design_systems"
STYLE_EMBED_MODEL = "gemini-embedding-001"
STYLE_SPEC_TOP_K = 1
```

- [ ] **Step 4: Implement `style_spec.py`**

Create `backend-python/app/utils/style_spec.py`:

```python
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
    return StyleSpec(
        id=entry_dir.name,
        overview=overview,
        spec_markdown=spec_md,
        source_image_path=str(source),
    )
```

- [ ] **Step 5: Run test to verify it passes**

Run: `python -m pytest tests/test_style_spec.py -v`
Expected: PASS — 2 tests green.

- [ ] **Step 6: Commit**

```bash
git add backend-python/app/constants/pipeline.py \
        backend-python/app/utils/style_spec.py \
        backend-python/tests/test_style_spec.py
git commit -m "feat(style-spec): add StyleSpec dataclass and loader"
```

---

## Task 2: Style Library Service — Cosine Search

**Files:**
- Create: `backend-python/app/services/style_library.py`
- Test: `backend-python/tests/test_style_library.py`

- [ ] **Step 1: Write the failing test**

Create `backend-python/tests/test_style_library.py`:

```python
import json
from pathlib import Path

from app.services import style_library


def _write_entry(base: Path, eid: str, vector: list[float], overview: str = "ov") -> None:
    d = base / eid
    d.mkdir(parents=True)
    (d / "overview.md").write_text(overview, encoding="utf-8")
    (d / "spec.md").write_text("spec body", encoding="utf-8")
    (d / "source.jpg").write_bytes(b"fake")
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
```

- [ ] **Step 2: Run test to verify it fails**

Run: `python -m pytest tests/test_style_library.py -v`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement `style_library.py`**

Create `backend-python/app/services/style_library.py`:

```python
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
```

- [ ] **Step 4: Run test to verify it passes**

Run: `python -m pytest tests/test_style_library.py -v`
Expected: PASS — 3 tests green.

- [ ] **Step 5: Commit**

```bash
git add backend-python/app/services/style_library.py \
        backend-python/tests/test_style_library.py
git commit -m "feat(style-spec): style_library service with load_index + cosine search"
```

---

## Task 3: Wire Library Loading Into Lifespan

**Files:**
- Modify: `backend-python/app/main.py`

- [ ] **Step 1: Edit lifespan**

Replace the lifespan function in `backend-python/app/main.py` with:

```python
@asynccontextmanager
async def lifespan(app: FastAPI):
    from app.services.vertex import vertex_service
    from app.services import style_library
    from app.constants.pipeline import STYLE_SPEC_DIR

    try:
        await vertex_service.warmup_rmbg2()
        print("\n[ML] RMBG-2.0 system is ready and idle.")
    except Exception as e:
        print(f"\n[ML] Warmup failed: {e}")

    try:
        base = Path(__file__).parent.parent / STYLE_SPEC_DIR
        index = style_library.load_index(base)
        print(f"\n[STYLE] Loaded {len(index)} design systems from {base}")
    except Exception as e:
        print(f"\n[STYLE] Library load failed: {e}")

    yield
```

- [ ] **Step 2: Manual smoke test**

Run from `backend-python/`:
```bash
python -m uvicorn app.main:app --port 5001
```
Expected in console (library is empty pre-build):
```
[STYLE] Loaded 0 design systems from .../assets/design_systems
```
Stop the server (Ctrl+C).

- [ ] **Step 3: Commit**

```bash
git add backend-python/app/main.py
git commit -m "feat(style-spec): load style library on FastAPI startup"
```

---

## Task 4: Extraction Prompt Builders (core DNA + detail + overview)

> **Note:** For v1, the initial library is built by an agent (Claude Code) doing
> deep per-image analysis — see Task 9. These prompt builders exist as the
> **rubric** for what a spec and overview should contain, and as the hook point
> for a future auto-extraction fallback when new images are added. They are not
> called at runtime in v1.

**Files:**
- Create: `backend-python/app/prompts/extract_style_spec.py`
- Test: `backend-python/tests/test_extract_style_spec_prompts.py`

- [ ] **Step 1: Write the failing test**

Create `backend-python/tests/test_extract_style_spec_prompts.py`:

```python
from app.prompts.extract_style_spec import (
    build_core_dna_prompt,
    build_detail_prompt,
    build_overview_prompt,
)


def test_core_dna_prompt_asks_for_mood_palette_composition():
    p = build_core_dna_prompt()
    assert "mood" in p.lower()
    assert "palette" in p.lower()
    assert "composition" in p.lower()
    assert "JSON" in p


def test_detail_prompt_enforces_core_dna_consistency():
    p = build_detail_prompt(core_dna='{"mood": ["luxury"], "palette": "warm muted", "composition": "centered"}')
    assert "luxury" in p
    assert "consistent" in p.lower()
    assert "## A. Visual Mood" in p


def test_overview_prompt_requests_negative_anchors():
    p = build_overview_prompt(spec_md="## A. Visual Mood\n\nLuxury.")
    assert "Luxury" in p
    assert "No " in p  # negative anchors
```

- [ ] **Step 2: Run test to verify it fails**

Run: `python -m pytest tests/test_extract_style_spec_prompts.py -v`
Expected: FAIL — module missing.

- [ ] **Step 3: Implement prompts**

Create `backend-python/app/prompts/extract_style_spec.py`:

```python
from __future__ import annotations


def build_core_dna_prompt() -> str:
    return (
        "You are analyzing an advertisement image.\n"
        "Identify the core visual DNA in 1-2 sentences per field.\n\n"
        "Return ONLY valid JSON with these keys:\n"
        '  "mood":        array of 3 keywords max (e.g. ["luxury","serious","editorial"])\n'
        '  "palette":     short string: temperature + saturation + key hues\n'
        '                 (e.g. "cool muted deep burgundy with gold accent")\n'
        '  "composition": one of "centered" | "rule-of-thirds" | "diagonal" | "grid"\n\n'
        "Base your answer ONLY on what is visually present. "
        "Do not invent traits. Do not hedge."
    )


def build_detail_prompt(core_dna: str) -> str:
    return (
        "You are writing a detailed design system for an advertisement.\n\n"
        f"The ad has this core DNA:\n{core_dna}\n\n"
        "Write a full design system in markdown with sections A through I.\n"
        "CRITICAL: every section must be consistent with the core DNA above.\n"
        "Do not introduce traits that contradict mood, palette, or composition.\n"
        "If a trait seems to contradict, reconcile toward the core DNA.\n\n"
        "Use this exact structure:\n\n"
        "## A. Visual Mood\n"
        "mood_keywords, energy_level, atmosphere (1 paragraph).\n\n"
        "## B. Color Story\n"
        "dominant / accent / text_primary / text_secondary / shadow / highlight.\n"
        "Include hex codes. palette_relationship (complementary/analogous/monochromatic).\n\n"
        "## C. Typography Personality\n"
        "font_character, weight_hierarchy, tracking_behavior, text_treatments.\n\n"
        "## D. Composition Archetype\n"
        "focal_pattern, text_zones, negative_space_ratio, subject_position.\n\n"
        "## E. Scene / Photo Style\n"
        "lighting_direction + quality, depth, environment, texture.\n\n"
        "## F. Subject Treatment\n"
        "posing, scale, cropping.\n\n"
        "## G. Text-Image Relationship\n"
        "pattern, contrast_strategy.\n\n"
        "## H. Effects Library\n"
        "gradients, glows, strokes, drop_shadows.\n\n"
        "## I. Do's and Don'ts\n"
        "Do: ...\nDon't: ...\n"
    )


def build_overview_prompt(spec_md: str) -> str:
    return (
        "Summarize this design system in a single natural-language paragraph "
        "of 150 to 300 words for semantic search.\n\n"
        "Requirements:\n"
        "- Start with mood + palette + composition.\n"
        '- End with "No X, no Y, no Z" listing 3 specific traits that DO NOT fit this style '
        "(negative anchors for embedding discrimination).\n"
        "- Do not include hex codes. Do not include section headers.\n"
        "- Write as one flowing paragraph.\n\n"
        f"Design system:\n{spec_md}\n"
    )
```

- [ ] **Step 4: Run test to verify it passes**

Run: `python -m pytest tests/test_extract_style_spec_prompts.py -v`
Expected: PASS — 3 tests green.

- [ ] **Step 5: Commit**

```bash
git add backend-python/app/prompts/extract_style_spec.py \
        backend-python/tests/test_extract_style_spec_prompts.py
git commit -m "feat(style-spec): add extraction prompt builders (core DNA, detail, overview)"
```

---

## Task 5: Plan Target Overview Prompt Builder

**Files:**
- Create: `backend-python/app/prompts/plan_target_overview.py`
- Test: `backend-python/tests/test_plan_target_overview.py`

- [ ] **Step 1: Write the failing test**

Create `backend-python/tests/test_plan_target_overview.py`:

```python
from app.prompts.plan_target_overview import build_plan_overview_prompt


def test_prompt_includes_brief_and_requests_paragraph():
    p = build_plan_overview_prompt(
        brief="luxury watch for executives",
        has_user_image=False,
        aspect_ratio="1:1",
        footer_text=None,
    )
    assert "luxury watch for executives" in p
    assert "1:1" in p
    assert "150" in p and "300" in p  # word range
    assert "No " in p


def test_prompt_flags_user_image_presence():
    p = build_plan_overview_prompt(
        brief="x", has_user_image=True, aspect_ratio="4:5", footer_text="terms apply"
    )
    assert "user-supplied reference image" in p.lower()
    assert "terms apply" in p
```

- [ ] **Step 2: Run test to verify it fails**

Run: `python -m pytest tests/test_plan_target_overview.py -v`
Expected: FAIL — module missing.

- [ ] **Step 3: Implement**

Create `backend-python/app/prompts/plan_target_overview.py`:

```python
from __future__ import annotations


def build_plan_overview_prompt(
    *,
    brief: str,
    has_user_image: bool,
    aspect_ratio: str,
    footer_text: str | None,
) -> str:
    image_note = (
        "A user-supplied reference image is attached below. "
        "Treat it as directional input for mood and scene, not as a hard template.\n\n"
        if has_user_image
        else ""
    )
    footer_note = f'Footer text to accommodate: "{footer_text}"\n' if footer_text else ""
    return (
        "You are planning the visual style of an advertisement.\n"
        "Write ONE natural-language paragraph of 150 to 300 words describing the ideal "
        "design system for this brief.\n\n"
        "Cover: mood + energy, palette (temperature, saturation, key hues), "
        "composition archetype, typography character, "
        "scene style (lighting, environment, depth), and text-image relationship.\n\n"
        'End with "No X, no Y, no Z" listing 3 specific traits that should NOT appear '
        "(negative anchors for downstream search).\n\n"
        "Do not include section headers. Write as one flowing paragraph. "
        "Be coherent: every trait must reinforce the others.\n\n"
        f"Brief: {brief}\n"
        f"Aspect ratio: {aspect_ratio}\n"
        f"{footer_note}"
        f"{image_note}"
    )
```

- [ ] **Step 4: Run test to verify it passes**

Run: `python -m pytest tests/test_plan_target_overview.py -v`
Expected: PASS — 2 tests green.

- [ ] **Step 5: Commit**

```bash
git add backend-python/app/prompts/plan_target_overview.py \
        backend-python/tests/test_plan_target_overview.py
git commit -m "feat(style-spec): plan_target_overview prompt builder"
```

---

## Task 6: Translate Spec to Imagen Prompt Builder

**Files:**
- Create: `backend-python/app/prompts/translate_spec_to_imagen.py`
- Test: `backend-python/tests/test_translate_spec_to_imagen.py`

- [ ] **Step 1: Write the failing test**

Create `backend-python/tests/test_translate_spec_to_imagen.py`:

```python
from app.prompts.translate_spec_to_imagen import build_translate_prompt


SAMPLE_SPEC = """
## A. Visual Mood
luxury, serious, editorial.

## B. Color Story
dominant: #2a1a1a deep burgundy
accent: #c9a961 muted gold
text_primary: #f5ebd4

## C. Typography Personality
display serif, tight tracking.

## D. Composition Archetype
centered symmetric. Subject dead-center. 40% negative space.

## E. Scene / Photo Style
dramatic top-down lighting, shallow DoF, studio.

## F. Subject Treatment
hero-dominant, full view.

## G. Text-Image Relationship
overlay-dark-image.

## H. Effects Library
subtle drop shadow.

## I. Do's and Don'ts
Don't use neon.
"""


def test_prompt_includes_scene_relevant_sections():
    p = build_translate_prompt(spec_md=SAMPLE_SPEC, brief="a luxury watch")
    assert "luxury watch" in p
    # BG-relevant sections
    assert "Visual Mood" in p or "luxury" in p
    assert "Color Story" in p or "burgundy" in p
    assert "Scene" in p or "lighting" in p
    # Non-BG sections must be excluded
    assert "Typography Personality" not in p
    assert "Text-Image Relationship" not in p
    assert "Effects Library" not in p


def test_prompt_requests_single_imagen_prompt_output():
    p = build_translate_prompt(spec_md=SAMPLE_SPEC, brief="x")
    assert "single" in p.lower() or "one " in p.lower()
    assert "imagen" in p.lower() or "image generation" in p.lower()
```

- [ ] **Step 2: Run test to verify it fails**

Run: `python -m pytest tests/test_translate_spec_to_imagen.py -v`
Expected: FAIL — module missing.

- [ ] **Step 3: Implement**

Create `backend-python/app/prompts/translate_spec_to_imagen.py`:

```python
from __future__ import annotations

import re

_BG_SECTIONS = {"A", "B", "D", "E", "F"}


def _extract_bg_sections(spec_md: str) -> str:
    pattern = re.compile(r"(## ([A-I])\. [^\n]+\n)(.*?)(?=\n## [A-I]\.|\Z)", re.DOTALL)
    out_parts: list[str] = []
    for match in pattern.finditer(spec_md):
        header, letter, body = match.group(1), match.group(2), match.group(3)
        if letter in _BG_SECTIONS:
            out_parts.append(header + body.rstrip())
    return "\n\n".join(out_parts).strip()


def build_translate_prompt(*, spec_md: str, brief: str) -> str:
    bg_only = _extract_bg_sections(spec_md)
    return (
        "You are writing a single image generation prompt for Imagen.\n\n"
        f"Brief: {brief}\n\n"
        "Target design system (background-relevant sections only):\n"
        f"{bg_only}\n\n"
        "Write ONE natural-language prompt of 60-120 words describing the scene "
        "to generate. Translate the design fields into concrete visual language "
        "(lighting direction, color hex codes allowed, composition, subject pose, "
        "depth of field, texture). Do NOT describe typography or text overlays -- "
        "we will add text separately.\n\n"
        "Return only the prompt text, no preamble."
    )
```

- [ ] **Step 4: Run test to verify it passes**

Run: `python -m pytest tests/test_translate_spec_to_imagen.py -v`
Expected: PASS — 2 tests green.

- [ ] **Step 5: Commit**

```bash
git add backend-python/app/prompts/translate_spec_to_imagen.py \
        backend-python/tests/test_translate_spec_to_imagen.py
git commit -m "feat(style-spec): translate_spec_to_imagen prompt builder"
```

---

## Task 7: Vertex Service Methods (extraction + plan + translate + embed)

**Files:**
- Modify: `backend-python/app/services/vertex.py`
- Test: `backend-python/tests/test_vertex_service.py` (add cases)

- [ ] **Step 1: Write the failing test**

Append to `backend-python/tests/test_vertex_service.py`:

```python
import pytest

from app.services.vertex import vertex_service


@pytest.mark.asyncio
async def test_plan_target_overview_returns_nonempty_paragraph():
    result = await vertex_service.plan_target_overview(
        brief="a playful snack brand for teens",
        user_image=None,
        mime=None,
        aspect_ratio="4:5",
        footer_text=None,
    )
    assert isinstance(result, str)
    assert 100 < len(result) < 2500
    assert "No " in result


@pytest.mark.asyncio
async def test_embed_text_returns_vector():
    vec = await vertex_service.embed_text("a dark editorial luxury layout")
    assert isinstance(vec, list)
    assert len(vec) > 0
    assert all(isinstance(x, (int, float)) for x in vec)
```

- [ ] **Step 2: Run test to verify it fails**

Run: `python -m pytest tests/test_vertex_service.py -k "plan_target_overview or embed_text" -v`
Expected: FAIL — methods do not exist.

- [ ] **Step 3: Add methods to VertexService**

Open `backend-python/app/services/vertex.py`. Near the other methods (e.g. below `describe_and_embed`), add:

```python
    async def plan_target_overview(
        self,
        *,
        brief: str,
        user_image: bytes | None,
        mime: str | None,
        aspect_ratio: str,
        footer_text: str | None,
    ) -> str:
        from app.prompts.plan_target_overview import build_plan_overview_prompt

        prompt = build_plan_overview_prompt(
            brief=brief,
            has_user_image=user_image is not None,
            aspect_ratio=aspect_ratio,
            footer_text=footer_text,
        )
        parts: list = [prompt]
        if user_image is not None and mime:
            from google.genai import types
            parts.append(types.Part.from_bytes(data=user_image, mime_type=mime))
        response = await self.with_retry(
            lambda: self._client.aio.models.generate_content(
                model=get_text_model_best(),
                contents=parts,
                config=SAFETY_OFF,
            )
        )
        return (response.text or "").strip()

    async def embed_text(self, text: str) -> list[float]:
        from app.constants.pipeline import STYLE_EMBED_MODEL

        response = await self.with_retry(
            lambda: self._client.aio.models.embed_content(
                model=STYLE_EMBED_MODEL,
                contents=text,
            )
        )
        emb = response.embeddings[0]
        return list(emb.values)

    async def translate_spec_to_imagen_prompt(
        self, *, spec_md: str, brief: str
    ) -> str:
        from app.prompts.translate_spec_to_imagen import build_translate_prompt

        prompt = build_translate_prompt(spec_md=spec_md, brief=brief)
        response = await self.with_retry(
            lambda: self._client.aio.models.generate_content(
                model=get_text_model_best(),
                contents=[prompt],
                config=SAFETY_OFF,
            )
        )
        return (response.text or "").strip()
```

If `get_text_model_best` and `SAFETY_OFF` are not already imported at the top of the file, add the appropriate import from `app.constants.models`.

- [ ] **Step 4: Run tests to verify they pass**

Run (requires valid `.env` with Vertex credentials):
```
python -m pytest tests/test_vertex_service.py -k "plan_target_overview or embed_text" -v
```
Expected: PASS. If credentials are missing or the calls fail due to auth, mark the test with `@pytest.mark.skipif(not _creds_available(), reason="no creds")` and document in the task notes. Real coverage lands in Task 9 when we run the build end-to-end.

- [ ] **Step 5: Commit**

```bash
git add backend-python/app/services/vertex.py \
        backend-python/tests/test_vertex_service.py
git commit -m "feat(style-spec): add vertex methods for plan, embed, extract, translate"
```

---

## Task 8: `rebuild_index.py` — Embed Overviews + Write Index

> **Purpose:** v1 extraction is agent-driven (Task 9). This script is the
> post-extraction step: it walks `design_systems/`, embeds each `overview.md`
> via Gemini, writes per-entry `embedding.json`, and builds the global
> `index.json`. It is idempotent: re-runs only re-embed entries whose
> `overview.md` hash has changed.

**Files:**
- Create: `backend-python/scripts/__init__.py` (empty)
- Create: `backend-python/scripts/rebuild_index.py`

- [ ] **Step 1: Create package marker**

Create empty `backend-python/scripts/__init__.py` (zero bytes).

- [ ] **Step 2: Create rebuild script**

Create `backend-python/scripts/rebuild_index.py`:

```python
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
```

- [ ] **Step 3: Smoke test — empty library**

Run from `backend-python/`:
```
python -m scripts.rebuild_index
```
Expected (library dir empty or doesn't exist yet): creates empty `index.json`, prints `[done] wrote 0 entries`. If the dir doesn't exist, create it first: `mkdir -p assets/design_systems` and re-run.

- [ ] **Step 4: Commit**

```bash
git add backend-python/scripts/__init__.py \
        backend-python/scripts/rebuild_index.py
git commit -m "feat(style-spec): rebuild_index script — embed overviews and build index"
```

---

## Task 9: Agent-Driven Library Extraction (Claude Code)

> **Purpose:** Produce a high-quality, deeply-reasoned design system per ref
> image. The agent (Claude Code, Opus) views each image, thinks carefully
> about A-I sections with coherence enforced, and writes `spec.md` +
> `overview.md` by hand per entry. This is slow and token-heavy but produces
> significantly better specs than scripted extraction.

**Files:**
- Creates: `backend-python/assets/design_systems/<id>/{spec.md, overview.md, source.jpg}` × N
- Creates: `backend-python/assets/design_systems/index.json` (via Task 8 script)

### 9.1 Per-Image Workflow (repeat for every ref image)

For each image in `backend-python/assets/ref_images/` (skip any that already
have a complete entry under `design_systems/`):

- [ ] **Step 1: View the image**

Load the image. Look at it for real — color, composition, lighting, typography,
subject, mood. No shortcuts.

- [ ] **Step 2: Internal two-pass extraction**

- **Pass 1 (core DNA, in your head before writing):** Identify
  - `mood`: up to 3 keywords
  - `palette`: temperature + saturation + key hues (no hex yet)
  - `composition`: one of `centered | rule-of-thirds | diagonal | grid`
  Write these down at the top of a scratch.

- **Pass 2 (detail, coherent with Pass 1):** Expand into sections A–I.
  Every section must reinforce mood / palette / composition. If a trait wants
  to contradict the core, reconcile toward the core.

- [ ] **Step 3: Write `spec.md`**

Target path: `backend-python/assets/design_systems/<slug>/spec.md`

Slug rule (same as rebuild_index would produce): lowercase, replace spaces
with `_`, `&` with `and`, `/` with `_`.

Use this exact structure (mirrors design spec section 4.2):

```markdown
# <Descriptive Style Name>  e.g. "Dark Editorial Luxury"

## A. Visual Mood
<mood_keywords, energy_level, atmosphere — 1 paragraph>

## B. Color Story
- dominant: #hex — role
- accent: #hex — role
- text_primary: #hex
- text_secondary: #hex
- shadow: #hex
- highlight: #hex
- palette_relationship: complementary | analogous | monochromatic | triadic | split

## C. Typography Personality
- font_character: serif | sans | display | script | mixed (describe specifically)
- weight_hierarchy: e.g. headline 800, body 500, caption 400
- tracking_behavior: tight at display, normal at body | etc.
- text_treatments: stroke? shadow? gradient fill? outline-only? (state which are used)

## D. Composition Archetype
- focal_pattern: centered | rule-of-thirds | diagonal | grid
- text_zones: where text sits (top-band / bottom-band / side / overlay-center / ...)
- negative_space_ratio: ~% of canvas empty
- subject_position: centered / left / right / lower-third / etc.

## E. Scene / Photo Style
- lighting_direction + quality: e.g. top-down dramatic | diffuse soft | side hard
- depth: shallow DoF | deep focus | flat graphic
- environment: studio | lifestyle | abstract | collage | product
- texture: matte | glossy | film-grain | clean-digital

## F. Subject Treatment
- posing: centered-static | dynamic | off-canvas | etc.
- scale: hero-dominant | proportional | integrated
- cropping: full | tight-crop | breaks-frame

## G. Text-Image Relationship
- pattern: overlay-dark-image | integrated-within-scene | banner-separate | caption-pinned-edge
- contrast_strategy: stroke | shadow | scrim | inherent-bg-contrast

## H. Effects Library
- gradients: [describe specific gradients if any]
- glows: yes/no + intensity
- strokes: usage patterns
- drop_shadows: common values

## I. Do's and Don'ts
Do:
- [concrete, specific]
- [specific]
Don't:
- [concrete anti-pattern]
- [anti-pattern]
```

No TBDs. Every field filled based on actual observation of the image.

- [ ] **Step 4: Write `overview.md`**

Target path: `backend-python/assets/design_systems/<slug>/overview.md`

One flowing paragraph, 150–300 words. Follow this pattern:
1. Open with mood + palette + composition in natural language.
2. Middle describes typography, scene style, text-image relationship.
3. End with `No X, no Y, no Z` — three specific traits that do NOT fit this
   style (negative anchors for embedding discrimination).

No hex codes. No section headers. No list syntax. Just prose.

Quality bar: a stranger reading the overview should be able to picture the
visual space without seeing the image.

- [ ] **Step 5: Copy `source.jpg`**

Convert the source PNG to JPEG (quality 92) and place it at
`backend-python/assets/design_systems/<slug>/source.jpg`.

Command (bash, per image — adjust paths):
```
python -c "from PIL import Image; Image.open('assets/ref_images/<file>.png').convert('RGB').save('assets/design_systems/<slug>/source.jpg', 'JPEG', quality=92)"
```

### 9.2 Batch Structure

With ~100 images, don't try to do it all in one session. Work in batches of
5–10 images. After each batch, run `rebuild_index` (Task 8) and commit.

- [ ] **Step 1: Start small — batch of 5 diverse images**

Pick 5 images that look visually **different** from each other (different
mood, palette, subject type). Run the per-image workflow on each.

Commit after the batch:
```bash
git add backend-python/assets/design_systems/
git commit -m "chore(style-spec): extract design system for batch 1 (5 entries)"
```

- [ ] **Step 2: Run rebuild_index to embed + write index.json**

```
cd backend-python
python -m scripts.rebuild_index
```
Expected: `[embed] <id>` for each of the 5 entries, then `[done] wrote 5 entries -> .../index.json`.

Commit:
```bash
git add backend-python/assets/design_systems/index.json \
        backend-python/assets/design_systems/*/embedding.json
git commit -m "chore(style-spec): embed + index batch 1"
```

- [ ] **Step 3: End-to-end smoke with 5-entry library**

Before scaling to all ~100, verify the whole runtime pipeline works on a
small library. Start uvicorn:
```
python -m uvicorn app.main:app --port 5001
```
Expected: `[STYLE] Loaded 5 design systems from ...`

Run one integrated campaign through the frontend. Confirm:
- `style_selection` SSE event fires with one of the 5 ids
- Pipeline completes without errors (may produce a less-than-ideal
  match — we only have 5 refs to choose from)

If everything works, proceed to the full library. If it fails, fix before
continuing — no point extracting 95 more entries if the plumbing is broken.

- [ ] **Step 4: Extract remaining images in batches**

Continue extracting in batches of 10. After each batch:
1. Run `python -m scripts.rebuild_index`
2. Commit both the new entries and the updated index

Keep notes on any image that is ambiguous or that the agent re-reads multiple
times — those may need human review later.

- [ ] **Step 5: Final library sanity check**

After all images are done:
1. `ls backend-python/assets/design_systems/` — count matches ref count (minus
   any deliberate skips)
2. Open 10 random `spec.md` files — confirm no TBDs, all sections filled,
   coherent traits
3. Open 10 random `overview.md` files — single paragraph, 150–300 words,
   ends with "No X, no Y, no Z"
4. Startup log shows `[STYLE] Loaded N design systems from ...`

- [ ] **Step 6: Size + commit check**

Check the library size (each entry ~100KB; ~100 entries ~10MB). This is fine
to commit. The library is intentionally versioned in git so the design record
evolves alongside code.

Final commit (if any loose changes):
```bash
git add backend-python/assets/design_systems/
git commit -m "chore(style-spec): complete design system library extraction"
```

---

## Task 10: Step 0 Integration — Plan + Match in Controller

**Files:**
- Modify: `backend-python/app/controllers/image.py`

- [ ] **Step 1: Add `_step_plan_and_match` helper**

In `backend-python/app/controllers/image.py`, near the other `_step_*` helpers (above `_step_rmbg_prescan` is fine), add:

```python
async def _step_plan_and_match(
    *,
    send_sse,
    brief: str,
    user_image: bytes | None,
    mime: str | None,
    aspect_ratio: str,
    footer_text: str | None,
):
    from app.services.vertex import vertex_service
    from app.services import style_library
    from app.utils.style_spec import load_spec

    await send_sse("progress", {"step": "style_planning", "message": "Planning target style..."})
    overview = await vertex_service.plan_target_overview(
        brief=brief,
        user_image=user_image,
        mime=mime,
        aspect_ratio=aspect_ratio,
        footer_text=footer_text,
    )

    vector = await vertex_service.embed_text(overview)
    hits = style_library.search_top_k(vector, k=1)
    if not hits:
        await send_sse("progress", {"step": "style_selection", "message": "No style library — running without StyleSpec"})
        return None, overview

    top = hits[0]
    spec = load_spec(top["path"])
    await send_sse("progress", {
        "step": "style_selection",
        "message": f"Matched style: {spec.id} (score {top['score']:.3f})",
    })
    await send_sse("debug", {
        "step": "style_spec",
        "id": spec.id,
        "overview": spec.overview,
        "source_image_url": f"/assets/design_systems/{spec.id}/source.jpg",
    })
    return spec, overview
```

- [ ] **Step 2: Call it at the top of both create-campaign endpoints**

Locate `create_campaign` (SSE handler, roughly around line 1035) and `create_campaign_integrated` in the same file. In each, **before** the existing `_step_rmbg_prescan` call, add:

```python
    style_spec, planned_overview = await _step_plan_and_match(
        send_sse=send_sse,
        brief=text,
        user_image=image_bytes if mode != "integrated" else None,
        mime=mime if mode != "integrated" else None,
        aspect_ratio=aspect_ratio if "aspect_ratio" in locals() else "1:1",
        footer_text=footer_text if "footer_text" in locals() else None,
    )
```

Adjust variable names (`text`, `image_bytes`, `mime`, `footer_text`, `aspect_ratio`) to match what exists in each handler's scope — inspect each handler before writing the call to use correct locals.

Thread `style_spec` downstream as a keyword argument to `_step_flex_layout` and `_step_refinement_loop` (signatures will be updated in Tasks 11 and 14).

- [ ] **Step 3: Manual smoke test**

Restart uvicorn. Send a test request (or click through the frontend) and confirm SSE stream contains:
```
progress { step: "style_planning" }
progress { step: "style_selection", message: "Matched style: ..." }
debug    { step: "style_spec", id, overview, source_image_url }
```
Pipeline may fail downstream (flex layout not yet updated) — that's expected. Only Step 0 needs to work here.

- [ ] **Step 4: Commit**

```bash
git add backend-python/app/controllers/image.py
git commit -m "feat(style-spec): step 0 — plan + match StyleSpec in create-campaign endpoints"
```

---

## Task 11: Rewrite Flex Layout Prompt to Consume StyleSpec

**Files:**
- Modify: `backend-python/app/prompts/flex_layout.py`
- Test: `backend-python/tests/test_flex_layout.py` (add)

- [ ] **Step 1: Write the failing test**

Append to `backend-python/tests/test_flex_layout.py`:

```python
from app.prompts.flex_layout import build_flex_thought_prompt


def test_flex_thought_includes_style_spec_when_provided():
    spec_md = "## A. Visual Mood\n\nluxury serious editorial.\n\n## C. Typography Personality\n\ntight tracking display serif."
    p = build_flex_thought_prompt(
        target_text="Headline",
        components_list="",
        canvas_size={"w": 1000, "h": 1000},
        style_spec_md=spec_md,
    )
    assert "luxury" in p
    assert "Typography Personality" in p
    assert "match" in p.lower() or "adhere" in p.lower()


def test_flex_thought_works_without_style_spec():
    p = build_flex_thought_prompt(
        target_text="Headline",
        components_list="",
        canvas_size={"w": 1000, "h": 1000},
        style_spec_md=None,
    )
    assert "Headline" in p
```

- [ ] **Step 2: Run to verify the failure mode**

Run: `python -m pytest tests/test_flex_layout.py -k "style_spec" -v`
Expected: FAIL — `build_flex_thought_prompt` does not accept `style_spec_md` kwarg yet.

- [ ] **Step 3: Update prompt builders**

Edit `backend-python/app/prompts/flex_layout.py`:

1. Update `build_flex_thought_prompt` signature to accept `style_spec_md: str | None = None` (keep existing params; remove any `ref_descriptions`/`style_guide` params or mark them deprecated — deprecation cleanup is Task 16).
2. Where the old prompt injected `ref_section` or `style_guide_section`, replace with a StyleSpec block that reads:

```python
    style_section = (
        "\n\nTARGET DESIGN SYSTEM (match strictly):\n"
        f"{style_spec_md}\n\n"
        "Your flex tree MUST adhere to this design system. Typography, color, "
        "effects, and text-image relationship fields are binding.\n"
        if style_spec_md
        else ""
    )
```

Do the equivalent change in `build_flex_tree_prompt` — pass `style_spec_md` through and reference it as constraints during tree construction.

- [ ] **Step 4: Run test to verify pass**

Run: `python -m pytest tests/test_flex_layout.py -v`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add backend-python/app/prompts/flex_layout.py \
        backend-python/tests/test_flex_layout.py
git commit -m "feat(style-spec): flex_layout prompts consume StyleSpec markdown"
```

---

## Task 12: Update `suggest_flex_layout` Signature + Controller Threading

**Files:**
- Modify: `backend-python/app/services/vertex.py` (`suggest_flex_layout`)
- Modify: `backend-python/app/controllers/image.py` (`_step_flex_layout`)

- [ ] **Step 1: Update `suggest_flex_layout` in vertex.py**

Change the signature to accept `style_spec: StyleSpec | None = None` and remove the old `ref_image_buffers, ref_descriptions, style_guide` kwargs.

Inside, when constructing the prompt call, pass `style_spec_md=style_spec.spec_markdown if style_spec else None` to `build_flex_thought_prompt` and `build_flex_tree_prompt`.

Attach the anchor image bytes to the model call:

```python
    anchor_parts = []
    if style_spec and style_spec.source_image_path:
        from pathlib import Path
        anchor_bytes = Path(style_spec.source_image_path).read_bytes()
        from google.genai import types
        anchor_parts.append(types.Part.from_bytes(data=anchor_bytes, mime_type="image/jpeg"))
```

Append `anchor_parts` to the `contents` list on both the thought and tree generate calls.

Import `StyleSpec` at the top:
```python
from app.utils.style_spec import StyleSpec
```

- [ ] **Step 2: Update `_step_flex_layout` in controllers/image.py**

Change the function signature to accept `style_spec: StyleSpec | None = None` and pass it into `vertex_service.suggest_flex_layout(..., style_spec=style_spec, ...)`. Remove old `ref_image_buffers`, `ref_descriptions`, `style_guide` parameters from its call.

In both `create_campaign` and `create_campaign_integrated`, thread `style_spec` from Task 10's Step 0 into this call.

- [ ] **Step 3: Manual smoke test**

Restart uvicorn. Run one full `/create-campaign-integrated` request via the frontend. Watch the SSE stream and logs:
- Expect successful style_selection event.
- Expect `_step_flex_layout` to complete without a TypeError.
- Expect a flex tree in the `debug { step: "flex_layout" }` event.

If there are runtime errors, fix them before proceeding. Run `pytest tests/test_flex_layout.py` to confirm unit coverage still green.

- [ ] **Step 4: Commit**

```bash
git add backend-python/app/services/vertex.py \
        backend-python/app/controllers/image.py
git commit -m "feat(style-spec): thread StyleSpec through suggest_flex_layout"
```

---

## Task 13: Rewrite Critique Prompt — Add spec_compliance

**Files:**
- Modify: `backend-python/app/prompts/critique.py`
- Test: `backend-python/tests/test_campaign_render.py` or new `tests/test_critique_prompt.py`

- [ ] **Step 1: Write the failing test**

Create `backend-python/tests/test_critique_prompt.py`:

```python
from app.prompts.critique import build_critique_prompt


def test_critique_prompt_includes_spec_compliance_schema():
    p = build_critique_prompt(
        target_text="Headline",
        style_only=False,
        has_components=False,
        style_spec_md="## A. Visual Mood\n\nluxury.",
        layout_thought="",
        contrast_data="",
    )
    assert "spec_compliance" in p
    assert "violations" in p
    assert "luxury" in p


def test_critique_prompt_runs_without_style_spec():
    p = build_critique_prompt(
        target_text="Headline",
        style_only=False,
        has_components=False,
        style_spec_md=None,
        layout_thought="",
        contrast_data="",
    )
    assert "Headline" in p
```

- [ ] **Step 2: Run test to verify it fails**

Run: `python -m pytest tests/test_critique_prompt.py -v`
Expected: FAIL — `build_critique_prompt` does not accept `style_spec_md` yet.

- [ ] **Step 3: Update `build_critique_prompt`**

In `backend-python/app/prompts/critique.py`:

1. Add `style_spec_md: str | None = None` parameter. Remove old `style_guide` parameter if present.
2. Inject a spec compliance section into the prompt when `style_spec_md` is non-null:

```python
    spec_section = (
        "\n\nTARGET DESIGN SYSTEM:\n"
        f"{style_spec_md}\n\n"
        "Also check if the output adheres to the design system. "
        "List any violations concretely."
        if style_spec_md
        else ""
    )
```

3. Update the output schema description in the prompt to demand:

```
Return JSON with exactly these keys:
  status: "PASS" | "FAIL"
  confidence: float 0.0-1.0
  feedback: string
  actionable_steps: array of strings
  spec_compliance:
    pass: boolean
    violations: array of strings (empty if pass)
```

- [ ] **Step 4: Run test to verify pass**

Run: `python -m pytest tests/test_critique_prompt.py -v`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add backend-python/app/prompts/critique.py \
        backend-python/tests/test_critique_prompt.py
git commit -m "feat(style-spec): critique prompt accepts StyleSpec and emits spec_compliance"
```

---

## Task 14: Update `critique_layout` Method + Refinement Loop

**Files:**
- Modify: `backend-python/app/services/vertex.py` (`critique_layout`)
- Modify: `backend-python/app/controllers/image.py` (`_step_refinement_loop`)

- [ ] **Step 1: Update `critique_layout` signature**

In `vertex.py`, change `critique_layout`:

1. Replace the `style_guide: str = ""` parameter with `style_spec: StyleSpec | None = None`.
2. Pass `style_spec_md=style_spec.spec_markdown if style_spec else None` into `build_critique_prompt`.
3. Parse the extended JSON output to include `spec_compliance` (keep the existing parse logic; add the two new keys). Return shape:
```python
{
    "status": ...,
    "confidence": ...,
    "feedback": ...,
    "actionable_steps": [...],
    "spec_compliance": {"pass": bool, "violations": [...]},
}
```
If the model response is missing `spec_compliance`, default it to `{"pass": True, "violations": []}`.

- [ ] **Step 2: Update `_step_refinement_loop`**

In `controllers/image.py`:

1. Accept `style_spec: StyleSpec | None = None` kwarg.
2. Pass `style_spec=style_spec` into `critique_layout` call.
3. Update the FAIL condition: iteration should fail if **either** `status == "FAIL"` **or** `spec_compliance.pass is False`.
4. When refining (building `refined_text`), append spec_compliance violations to the feedback passed back to `suggest_flex_layout`:

```python
    violations = critique.get("spec_compliance", {}).get("violations", [])
    violation_block = ""
    if violations:
        violation_block = "\n\n[SPEC VIOLATIONS]:\n- " + "\n- ".join(violations)
    refined_text = target_text + "\n\n[REFINEMENT FEEDBACK]:\n" + feedback + violation_block
```

5. Emit `spec_compliance` in the `critique_complete` SSE event payload alongside `status`, `confidence`, `feedback`, `actionableSteps`.

6. Thread `style_spec` from the create-campaign handlers into this call.

- [ ] **Step 3: Manual smoke test**

Restart uvicorn. Run one `/create-campaign-integrated` request. Confirm:
- `critique_complete` SSE includes `spec_compliance` key
- No runtime errors in refinement loop

- [ ] **Step 4: Commit**

```bash
git add backend-python/app/services/vertex.py \
        backend-python/app/controllers/image.py
git commit -m "feat(style-spec): critique_layout emits spec_compliance, refinement loop consumes it"
```

---

## Task 15: Condition Flow B Background Generation on StyleSpec

**Files:**
- Modify: `backend-python/app/services/vertex.py` (`generate_image`)
- Modify: `backend-python/app/controllers/image.py` (`create_campaign_integrated`)

- [ ] **Step 1: Update `generate_image`**

In `vertex.py`, change `generate_image` to accept optional StyleSpec parameters:

```python
    async def generate_image(
        self,
        prompt: str,
        aspect_ratio: str = "3:4",
        resolution: str | None = None,
        input_images: list[dict] | None = None,
        *,
        style_spec: "StyleSpec | None" = None,
        brief_for_translation: str | None = None,
    ) -> dict:
```

If `style_spec` is provided:
1. Call `translate_spec_to_imagen_prompt(spec_md=style_spec.spec_markdown, brief=brief_for_translation or prompt)` → `translated_prompt`
2. Use `translated_prompt` as the Imagen prompt (replacing or prepending `prompt`).
3. Load `style_spec.source_image_path` → bytes, append to `input_images` as an additional anchor.

Leave behavior unchanged when `style_spec is None`.

- [ ] **Step 2: Update `create_campaign_integrated`**

In `controllers/image.py`, the integrated endpoint currently calls `vertex_service.generate_image(prompt=text, aspect_ratio=..., ...)`. Add:

```python
        style_spec=style_spec,
        brief_for_translation=text,
```

- [ ] **Step 3: Manual smoke test**

Restart uvicorn. Through the frontend, run `/create-campaign-integrated` with a distinctive brief (e.g. "luxury watch for executives"). Check:
- Generated BG reflects the matched StyleSpec's palette + lighting + composition (side-by-side vs. pre-change if you can)
- No runtime errors
- SSE `style_selection` event shows matched spec name

- [ ] **Step 4: Commit**

```bash
git add backend-python/app/services/vertex.py \
        backend-python/app/controllers/image.py
git commit -m "feat(style-spec): Flow B BG generation conditioned on StyleSpec"
```

---

## Task 16: Minor Update to campaign_layout Prompt + Cleanup Old Params

**Files:**
- Modify: `backend-python/app/prompts/campaign_layout.py`
- Modify: `backend-python/app/prompts/flex_layout.py` (remove deprecated params)
- Modify: `backend-python/app/services/vertex.py` (remove deprecated params)

- [ ] **Step 1: Add style hint parameter**

In `campaign_layout.py`, add `style_hint: str = ""` to `build_campaign_layout_prompt`. Inject into the prompt as:

```python
    style_block = f"\n\nTarget style hint: {style_hint}\n" if style_hint else ""
```

Place it before the composition instructions.

In `vertex.suggest_campaign_layout`, pass `style_hint=style_spec.overview if style_spec else ""`. Update its signature to accept `style_spec: StyleSpec | None = None`.

- [ ] **Step 2: Remove deprecated parameters**

In `prompts/flex_layout.py`: remove `ref_descriptions`, `style_guide`, `ref_section` params / code paths that are no longer reachable.

In `services/vertex.py::suggest_flex_layout`: drop the old `ref_image_buffers`, `ref_descriptions`, `style_guide` kwargs.

Search for callers:
```
grep -rn "ref_image_buffers\|ref_descriptions\|style_guide" backend-python/app backend-python/tests
```
Fix or delete each callsite. If a test file is exclusively about the deleted functionality, delete the test file (preempting Task 17).

- [ ] **Step 3: Run full test suite**

Run: `python -m pytest tests/ -v`
Expected: all tests pass. If failures come from orphaned references, fix them.

- [ ] **Step 4: Commit**

```bash
git add backend-python/app/prompts/campaign_layout.py \
        backend-python/app/prompts/flex_layout.py \
        backend-python/app/services/vertex.py \
        backend-python/tests/
git commit -m "chore(style-spec): remove deprecated ref_* params, add style_hint to campaign prompt"
```

---

## Task 17: Delete ref_image_search + Old Embeddings + Tests

**Files:**
- Delete: `backend-python/app/utils/ref_image_search.py`
- Delete: `backend-python/assets/ref_images/embeddings.json`
- Delete: `backend-python/tests/test_ref_image_search.py`
- Delete: `backend-python/tests/test_ref_style.py`

- [ ] **Step 1: Verify no imports remain**

Run:
```
grep -rn "ref_image_search\|extract_style_guide\|find_similar_refs" backend-python/app backend-python/tests
```
Expected: no output. If any hits remain, remove them before deleting the files.

- [ ] **Step 2: Delete files**

```
rm backend-python/app/utils/ref_image_search.py
rm backend-python/assets/ref_images/embeddings.json
rm backend-python/tests/test_ref_image_search.py
rm backend-python/tests/test_ref_style.py
```

- [ ] **Step 3: Run full test suite**

Run: `python -m pytest tests/ -v`
Expected: all tests pass.

- [ ] **Step 4: Commit**

```bash
git add -A
git commit -m "chore(style-spec): remove deprecated ref_image_search module and tests"
```

---

## Task 18: Frontend SSE Handlers for Style Events

**Files:**
- Modify: `frontend/src/components/CampaignLayout.vue`

- [ ] **Step 1: Add handlers for new SSE events**

In `CampaignLayout.vue`, find the existing SSE event handler (likely a `switch` on `event.type` or similar dispatch). Add two cases:

```ts
// inside the SSE event handler
case 'progress':
  if (data.step === 'style_planning' || data.step === 'style_selection') {
    currentStyleStatus.value = data.message
  }
  // keep existing progress handling too
  break

case 'debug':
  if (data.step === 'style_spec') {
    matchedStyle.value = {
      id: data.id,
      overview: data.overview,
      sourceImageUrl: data.source_image_url,
    }
  }
  break
```

- [ ] **Step 2: Add reactive state + minimal UI chip**

Near the top of the `<script setup>` section, add:

```ts
const currentStyleStatus = ref<string>('')
const matchedStyle = ref<{ id: string; overview: string; sourceImageUrl: string } | null>(null)
```

In the template, add a small status chip near the progress display:

```html
<div v-if="matchedStyle" class="style-chip">
  Style: {{ matchedStyle.id }}
  <img :src="matchedStyle.sourceImageUrl" alt="" class="style-anchor" />
</div>
```

Add minimal CSS (scoped) for `.style-chip` + `.style-anchor` so it doesn't break the layout. Size it small — this is an informational badge, not a hero element.

- [ ] **Step 3: Manual smoke test**

Start frontend:
```
cd frontend && npm run dev
```
Click through a create-campaign flow. Confirm the chip appears once the `style_spec` debug event arrives.

- [ ] **Step 4: Commit**

```bash
git add frontend/src/components/CampaignLayout.vue
git commit -m "feat(style-spec): frontend shows matched style chip during pipeline"
```

---

## Task 19: End-to-End Verification + Docs Update

**Files:**
- Modify: `architecture.md` (top-level, update the ref-search section)
- Modify: `backend-python/README.md` if present, otherwise skip

- [ ] **Step 1: Full test suite green**

Run: `python -m pytest tests/ -v`
Expected: all tests pass. Fix anything red.

- [ ] **Step 2: Flow A end-to-end**

Upload a reference image via the frontend. Verify:
- Style chip appears with a matched spec id
- Pipeline completes (die-cut, inpaint, layout, critique)
- Final layout visibly reflects the matched spec's typography + palette
- User's uploaded image remains as the base BG (not replaced by spec source)

- [ ] **Step 3: Flow B end-to-end**

Run integrated flow with a distinctive brief ("luxury editorial watch campaign"). Verify:
- Style chip appears
- Generated BG matches the matched spec's scene style, palette, composition
- Run the same brief 2–3 times: output is stable (same spec matched each time)
- Compare vs. a pre-change output (git stash or branch) — the new output is more style-coherent

- [ ] **Step 4: Update architecture.md**

Replace the existing "Reference Style Intelligence" subsection in `architecture.md` with a pointer to the StyleSpec design:

```markdown
### 9.5 Reference Style Intelligence → StyleSpec

See `docs/superpowers/specs/2026-04-20-style-spec-pipeline-design.md` for the
current design system.

At runtime, Step 0 plans a target style overview from all user inputs,
cosine-searches the curated `design_systems/` library, and threads the
matched StyleSpec through image generation, flex layout, and critique.
```

Update the high-level pipeline graph (section 5.1) to include a `Step 0: plan + match` node before `Step 1A`.

- [ ] **Step 5: Commit**

```bash
git add architecture.md
git commit -m "docs: update architecture.md to describe StyleSpec pipeline"
```

- [ ] **Step 6: Final verification**

Run once more:
```
python -m pytest tests/ -v
```
Confirm clean pass. The implementation is complete.

---

## Self-Review

**Spec coverage (cross-check vs. 2026-04-20-style-spec-pipeline-design.md):**

| Spec section | Implemented in task |
|---|---|
| 2 Design Decisions | All threaded through Tasks 1–18 |
| 3 Architecture Overview | Tasks 10 (Step 0), 12 (layout), 14 (critique), 15 (BG) |
| 4.1 Library Layout | Tasks 8 (index builder), 9 (content) |
| 4.2 spec.md schema | Task 9 Step 3 (exact schema), Task 4 (rubric reference) |
| 4.3 overview.md shape | Task 9 Step 4 (exact shape), Task 4 (rubric reference) |
| 4.4 In-memory model | Task 1 (StyleSpec), Task 2 (library) |
| 5.1 Step 0 | Task 10 |
| 5.2 BG (Flow A/B) | Flow A: unchanged; Flow B: Task 15 |
| 5.3 Die-cut + inpaint | Unchanged (no task) |
| 5.4 Flex layout | Tasks 11, 12 |
| 5.5 Critique | Tasks 13, 14 |
| 5.6 Prompts touch map | Tasks 4, 5, 6, 11, 13, 16 |
| 6 Module map | All tasks |
| 7 Library build | Task 8 (embed + index), Task 9 (agent extraction) |
| 8 Verification plan | Task 19 (manual), unit tests throughout |
| 9 Risks | Addressed in task design (two-pass reasoning in Task 9, hybrid translate, etc.) |

**Placeholder scan:** No "TBD"/"TODO"/"implement later" present. Steps that depend on existing function internals (e.g. Task 10 variable names) are noted as "inspect each handler before writing" — this is a request for verification, not a placeholder.

**Type consistency:** `StyleSpec` fields (`id`, `overview`, `spec_markdown`, `source_image_path`) are used identically across Tasks 1, 10, 12, 14, 15. The `critique_layout` output shape (including new `spec_compliance`) is consistent between Tasks 13 and 14.

**Scope:** Single implementation plan, one subsystem swap. Not decomposed further.

---

**End of plan.**
