# Reference Style Intelligence — Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the AI deeply understand and replicate the visual style of reference images by enriching the flex layout prompt with structured style descriptions extracted from ref image embeddings.

**Architecture:** Three changes: (1) Extract a concise "style guide" from ref image descriptions at search time, (2) Pass ref descriptions + style guide into the flex layout prompt so AI can read AND see the references, (3) Add a comparison instruction telling AI to match specific style traits from refs.

**Tech Stack:** Python, Gemini API (existing), embeddings.json (existing data)

---

## Current State

- `embeddings.json` stores per-image: `filename`, `description` (rich AI-generated layout analysis), `embedding` (vector)
- `find_similar_refs()` returns top-k refs with `filename`, `description`, `score`, `filepath`
- `suggest_flex_layout()` receives `ref_images: list[bytes]` (raw image buffers only)
- The prompt says "Study their composition" but AI only sees pixels — no text description
- `description` field in embeddings.json contains detailed layout analysis (color palette, text hierarchy, component positions, typography) that is completely unused at layout time

## File Structure

| File | Action | Responsibility |
|------|--------|----------------|
| `app/utils/ref_image_search.py` | Modify | Add `extract_style_guide()` that summarizes key traits from ref descriptions |
| `app/services/vertex.py` | Modify | Pass ref descriptions + style guide to `suggest_flex_layout()` |
| `app/prompts/flex_layout.py` | Modify | Accept and render style guide + ref descriptions in prompt |
| `app/controllers/image.py` | Modify | Wire ref metadata (descriptions, style guide) through pipeline |
| `tests/test_ref_style.py` | Create | Tests for style extraction logic |

---

## Chunk 1: Style Guide Extraction

### Task 1: Extract style traits from ref descriptions

**Files:**
- Create: `backend-python/tests/test_ref_style.py`
- Modify: `backend-python/app/utils/ref_image_search.py`

The core idea: parse the rich description text from `embeddings.json` and extract a concise style guide that captures: color palette, layout pattern, typography style, mood/vibe.

- [ ] **Step 1: Write failing test for `extract_style_guide`**

```python
# tests/test_ref_style.py
from app.utils.ref_image_search import extract_style_guide

SAMPLE_REFS = [
    {
        "filename": "test1.png",
        "description": (
            "## Part 1 — Background\n"
            "### Color / Atmosphere\n"
            "Purple gradient (#582C7D to #3A1B5E), premium feel, warm mood.\n"
            "### Visual Elements\n"
            "3D globe, floating coins, bokeh particles.\n\n"
            "## Part 2 — Layout + Text\n"
            "### Structure\n"
            "| Position | Content |\n"
            "| Top Left | Badge 'กองทุนใหม่!' in pink |\n"
            "| Upper Center | Main headline white bold |\n"
            "| Center | Phone mockup |\n"
            "| Bottom | CTA button purple bg |\n"
            "### Typography\n"
            "Large white headlines, gold accent (#FFD700), stroke for readability."
        ),
        "score": 0.92,
    },
    {
        "filename": "test2.png",
        "description": (
            "## Part 1 — Background\n"
            "### Color / Atmosphere\n"
            "Deep blue (#1A237E) to dark navy, tech-forward, modern.\n"
            "### Visual Elements\n"
            "Circuit patterns, glowing lines.\n\n"
            "## Part 2 — Layout + Text\n"
            "### Structure\n"
            "| Position | Content |\n"
            "| Top | Logo |\n"
            "| Center | Hero number xlarge gold |\n"
            "| Bottom | Fine print white |\n"
            "### Typography\n"
            "Bold gold numbers, white body text, no stroke."
        ),
        "score": 0.85,
    },
]


def test_extract_style_guide_returns_string():
    result = extract_style_guide(SAMPLE_REFS)
    assert isinstance(result, str)
    assert len(result) > 50


def test_extract_style_guide_empty_refs():
    result = extract_style_guide([])
    assert result == ""


def test_extract_style_guide_contains_key_sections():
    result = extract_style_guide(SAMPLE_REFS)
    assert "color" in result.lower() or "palette" in result.lower()
    assert "layout" in result.lower() or "structure" in result.lower()
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd backend-python && python -m pytest tests/test_ref_style.py -v`
Expected: FAIL with `ImportError: cannot import name 'extract_style_guide'`

- [ ] **Step 3: Implement `extract_style_guide` in `ref_image_search.py`**

Add to `backend-python/app/utils/ref_image_search.py`:

```python
import re as _re

def extract_style_guide(refs: list[dict]) -> str:
    if not refs:
        return ""

    colors = []
    layouts = []
    typography = []

    for ref in refs:
        desc = ref.get("description", "")
        score = ref.get("score", 0)

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
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd backend-python && python -m pytest tests/test_ref_style.py -v`
Expected: All 3 tests PASS

- [ ] **Step 5: Commit**

```bash
git add backend-python/tests/test_ref_style.py backend-python/app/utils/ref_image_search.py
git commit -m "feat: add extract_style_guide to parse ref image descriptions"
```

---

## Chunk 2: Wire Style Guide + Descriptions into Flex Layout

### Task 2: Update `suggest_flex_layout` to accept ref metadata

**Files:**
- Modify: `backend-python/app/services/vertex.py:1211-1245` (suggest_flex_layout method)
- Modify: `backend-python/app/prompts/flex_layout.py`

- [ ] **Step 1: Update `suggest_flex_layout` signature to accept ref descriptions and style guide**

In `backend-python/app/services/vertex.py`, modify `suggest_flex_layout`:

```python
async def suggest_flex_layout(
    self,
    image_buffer: bytes,
    mime_type: str,
    target_text: str,
    component_labels: list[str],
    canvas_size: dict,
    ref_images: list[bytes] | None = None,
    footer_text: str | None = None,
    ref_descriptions: list[str] | None = None,  # NEW
    style_guide: str | None = None,              # NEW
) -> dict:
```

- [ ] **Step 2: Build ref_section with descriptions**

Replace the existing `ref_section` building logic in `suggest_flex_layout`:

```python
ref_section = ""
if ref_images:
    ref_section = f"REFERENCE IMAGES:\nThe first {len(ref_images)} images are examples of well-designed layouts.\n"
    ref_section += "Study their composition, colors, typography, and spacing. THE LAST IMAGE is the actual background.\n"
    if ref_descriptions:
        ref_section += "\nREFERENCE DESCRIPTIONS:\n"
        for i, desc in enumerate(ref_descriptions):
            # Take the first 500 chars of each description to keep prompt manageable
            truncated = desc[:500] + "..." if len(desc) > 500 else desc
            ref_section += f"\n--- Ref {i+1} ---\n{truncated}\n"
    ref_section += "\n"
```

- [ ] **Step 3: Update `build_flex_layout_prompt` to accept style_guide**

In `backend-python/app/prompts/flex_layout.py`:

```python
def build_flex_layout_prompt(
    target_text: str,
    components_list: str,
    ref_section: str,
    footer_section: str,
    canvas_size: dict,
    style_guide: str = "",  # NEW
) -> str:
    style_section = f"\n{style_guide}\n" if style_guide else ""
    return f"""You are a master of 2D graphic design and visual composition.

{ref_section}{style_section}CAMPAIGN TEXT:
{target_text}
...
```

(Keep the rest of the prompt unchanged.)

- [ ] **Step 4: Pass style_guide through to `build_flex_layout_prompt` call**

In `suggest_flex_layout`, update the call:

```python
prompt = build_flex_layout_prompt(
    target_text, components_list, ref_section, footer_section, canvas_size,
    style_guide=style_guide or "",
)
```

- [ ] **Step 5: Verify server starts without errors**

Run: `cd backend-python && python -c "from app.services.vertex import vertex_service; print('OK')"`
Expected: `OK`

- [ ] **Step 6: Commit**

```bash
git add backend-python/app/services/vertex.py backend-python/app/prompts/flex_layout.py
git commit -m "feat: pass ref descriptions and style guide to flex layout prompt"
```

---

### Task 3: Wire ref metadata through the controller

**Files:**
- Modify: `backend-python/app/controllers/image.py:977-1018` (ref lookup + flex layout call)
- Modify: `backend-python/app/controllers/image.py:627-645` (`_step_flex_layout` function)

- [ ] **Step 1: Update `_step_flex_layout` to accept new params**

In `backend-python/app/controllers/image.py`, modify `_step_flex_layout`:

```python
async def _step_flex_layout(
    image_bytes: bytes,
    mime: str,
    target_text: str,
    visual_components: list[dict],
    canvas_w: int,
    canvas_h: int,
    ref_image_buffers: list[bytes],
    footer_text: str | None,
    generated_bg_url: str | None,
    ref_image_url: str,
    origin: str,
    send_sse,
    ref_descriptions: list[str] | None = None,  # NEW
    style_guide: str | None = None,              # NEW
) -> tuple[str, dict | None]:
    component_labels = [c["label"] for c in visual_components]
    flex_result = await vertex_service.suggest_flex_layout(
        image_bytes, mime, target_text, component_labels,
        {"w": canvas_w, "h": canvas_h},
        ref_image_buffers, footer_text or None,
        ref_descriptions=ref_descriptions,    # NEW
        style_guide=style_guide,              # NEW
    )
```

- [ ] **Step 2: Extract descriptions and style guide in the controller pipeline**

In the main event_generator (around line 977-990), after `find_similar_refs`:

```python
# Reference image lookup
ref_image_buffers: list[bytes] = []
ref_descriptions: list[str] = []
style_guide: str = ""
try:
    desc_result = await vertex_service.describe_and_embed(image_buffer, mime_type)
    refs = find_similar_refs(desc_result["embedding"], 3)
    if refs:
        ref_image_buffers = [Path(r["filepath"]).read_bytes() for r in refs]
        ref_descriptions = [r["description"] for r in refs]
        style_guide = extract_style_guide(refs)
        send_sse("debug", {
            "step": "ref_images",
            "message": f"Found {len(refs)} similar reference ads",
            "style_guide_preview": style_guide[:200],
        })
except Exception as e:
    print(f"[Pass2] Reference image search failed: {e}")
```

- [ ] **Step 3: Add import for `extract_style_guide` at top of `image.py`**

```python
from app.utils.ref_image_search import find_similar_refs, extract_style_guide
```

- [ ] **Step 4: Pass new params to `_step_flex_layout` call (around line 1007)**

```python
svg_overlay, flex_result = await _step_flex_layout(
    image_bytes=image_buffer, mime=mime_type,
    target_text=target_text,
    visual_components=visual_components,
    canvas_w=canvas_w, canvas_h=canvas_h,
    ref_image_buffers=ref_image_buffers,
    footer_text=footer_text or None,
    generated_bg_url=generated_bg_url,
    ref_image_url=ref_url,
    origin=origin,
    send_sse=send_sse,
    ref_descriptions=ref_descriptions,    # NEW
    style_guide=style_guide,              # NEW
)
```

- [ ] **Step 5: Also pass to `_step_refinement_loop` call (if it calls flex layout internally)**

Check `_step_refinement_loop` — it calls `_step_flex_layout` internally around line 786. Add the same params there:

```python
svg_overlay, flex_result = await _step_flex_layout(
    ...
    ref_descriptions=ref_descriptions,
    style_guide=style_guide,
)
```

This requires `_step_refinement_loop` to also accept and forward these params. Update its signature similarly.

- [ ] **Step 6: Verify server starts and can handle a request**

Run: `cd backend-python && python -m uvicorn app.main:app --port 5001` — verify no import errors.

- [ ] **Step 7: Commit**

```bash
git add backend-python/app/controllers/image.py
git commit -m "feat: wire ref descriptions and style guide through campaign pipeline"
```

---

## Chunk 3: Enhance Prompt with Style Matching Instructions

### Task 4: Update flex layout prompt with style matching rules

**Files:**
- Modify: `backend-python/app/prompts/flex_layout.py`

- [ ] **Step 1: Add style matching rules to the prompt**

In `build_flex_layout_prompt`, add these rules after the existing RULES section:

```python
STYLE MATCHING (when reference images are provided):
- ANALYZE the reference images and their descriptions carefully before designing.
- MATCH the color palette: Use the same dominant colors, gradients, and accent colors as the references.
- MATCH the typography style: Use similar font sizes, weights, and color choices for headlines, subtext, and CTAs.
- MATCH the layout pattern: Follow a similar top-to-bottom structure and element grouping as the references.
- MATCH the mood/vibe: If references feel "premium", make yours premium. If "playful", make yours playful.
- DO NOT copy text content from references — only copy their VISUAL STYLE.
```

Only include this block when `style_guide` is non-empty.

- [ ] **Step 2: Implement conditional style matching rules**

Full updated `build_flex_layout_prompt`:

```python
def build_flex_layout_prompt(
    target_text: str,
    components_list: str,
    ref_section: str,
    footer_section: str,
    canvas_size: dict,
    style_guide: str = "",
) -> str:
    style_section = f"\n{style_guide}\n" if style_guide else ""

    style_matching_rules = ""
    if style_guide:
        style_matching_rules = """
- STYLE MATCHING: Reference images and their style guide are provided above. Your design MUST match their visual DNA:
  - Use the SAME color palette (dominant colors, gradients, accents).
  - Use SIMILAR typography (font sizes, weights, text colors, stroke effects).
  - Follow SIMILAR layout patterns (element grouping, spacing, hierarchy).
  - Match the MOOD (premium, playful, tech-forward, etc.).
  - Do NOT copy text content from references — only copy their VISUAL STYLE."""

    return f"""You are a master of 2D graphic design and visual composition.

{ref_section}{style_section}CAMPAIGN TEXT:
{target_text}

{components_list}
{footer_section}
CANVAS: {canvas_size["w"]}x{canvas_size["h"]}px

STEP 1 — DESIGN REASONING in <layout_thought>...</layout_thought>
STEP 2 — ELEMENT GROUPING in <grouping>...</grouping>
STEP 3 — FLEX TREE JSON:
{{"flexTree": {{...}}, "campaign_vibe": "...", "background_description": "..."}}

FLEX TREE FORMAT:
Container: {{"id":"...", "direction":"row|column", "children":[...], "height":"40%", "width":"60%", "gap":16, "padding":20}}
Text leaf: {{"id":"...", "type":"text", "text":"...", "height":"30%", "style":{{"fontSize":"xlarge|large|medium|small|xsmall", "fontWeight":"900|700|400", "color":"#FFD700", "strokeColor":"#000", "strokeWidth":2, "align":"center|left|right", "backgroundColor":"rgba(0,0,0,0.5)"}}}}
Component leaf: {{"id":"...", "type":"component", "label":"must match available labels", "height":"50%"}}

RULES:
- Every text line from the CAMPAIGN TEXT MUST appear as a text leaf.
- ONLY create component leaves for labels listed in "Available die-cut components" above. If none are listed, use ZERO component nodes.
- Do NOT invent component nodes for elements mentioned in the brief text (logos, mockups, etc.) unless they appear in the available components list.
- Do NOT create text nodes for visual elements described in the brief (e.g. "Phone mockup", "logo", "badge", "image", "icon", "screenshot"). If the brief describes a visual element but no die-cut exists for it, SKIP it entirely — do NOT create a placeholder, description, or "[...]" bracket text for it.
- ONLY create text nodes for ACTUAL READABLE TEXT that should appear on the final design (headlines, subtext, fund names, dates, CTA text, disclaimers, etc.).
- Root is always "column" with padding. Use "row" inside for horizontal groupings.
- Hero/promo number = LARGEST element (fontSize "xlarge", fontWeight "900").
- Group related elements together. Use strokeColor for readability on busy backgrounds.
- READABILITY: If text is placed over a busy or bright area of the background, ADD "backgroundColor" with a semi-transparent dark color (e.g. "rgba(0,0,0,0.5)") to ensure the text is readable.
- CTA BUTTON: For call-to-action text, ALWAYS use "backgroundColor" with a solid brand color (e.g. "#4B0082", "#E040FB") to make it look like a clickable button. Use contrasting text color.{style_matching_rules}"""
```

- [ ] **Step 3: Verify server starts**

Run: `cd backend-python && python -c "from app.prompts.flex_layout import build_flex_layout_prompt; print('OK')"`
Expected: `OK`

- [ ] **Step 4: Commit**

```bash
git add backend-python/app/prompts/flex_layout.py
git commit -m "feat: add style matching rules to flex layout prompt"
```

---

## Chunk 4: Integration Test

### Task 5: End-to-end verification

**Files:**
- None new — manual verification

- [ ] **Step 1: Start the dev server**

Run: `cd backend-python && source venv/bin/activate && python -m uvicorn app.main:app --reload --port 5001`
Expected: Server starts without errors.

- [ ] **Step 2: Run existing tests**

Run: `cd backend-python && python -m pytest tests/ -v`
Expected: All tests pass (including new `test_ref_style.py`).

- [ ] **Step 3: Test with a real campaign request**

Use the frontend to create a campaign. Check the ai-trace.md log for:
1. `REFERENCE DESCRIPTIONS:` section appears in the prompt
2. `STYLE GUIDE` section appears in the prompt
3. `STYLE MATCHING` rules appear in the prompt
4. AI's `<layout_thought>` mentions reference style analysis
5. Output colors/typography are closer to reference style

- [ ] **Step 4: Check ai-trace.md for style guide content**

Run: `tail -200 backend-python/logs/ai-trace.md | grep -A5 "STYLE GUIDE"`
Expected: Style guide with COLOR PALETTE, LAYOUT PATTERNS, TYPOGRAPHY sections.

- [ ] **Step 5: Final commit**

```bash
git add -A
git commit -m "feat: complete ref style intelligence pipeline"
```

---

## Summary

| Task | What it does | Key file |
|------|-------------|----------|
| Task 1 | Extract style guide from ref descriptions | `ref_image_search.py` |
| Task 2 | Pass descriptions + style guide to flex layout | `vertex.py`, `flex_layout.py` |
| Task 3 | Wire through controller pipeline | `image.py` |
| Task 4 | Add style matching rules to prompt | `flex_layout.py` |
| Task 5 | Integration test | Manual verification |

**Token budget impact:** ~300-500 extra tokens in the flex layout prompt (ref descriptions truncated to 500 chars each × 3 refs + style guide ~200 tokens). Well within limits.
