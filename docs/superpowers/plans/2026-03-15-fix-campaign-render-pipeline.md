# Fix Campaign Render Pipeline — Text/Components Not Rendering

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix three independent bugs that cause text and components to never appear on the final campaign canvas.

**Architecture:** The `create_campaign` SSE pipeline generates AI layout suggestions, builds an SVG overlay via `build_flex_svg`, runs a critique loop, then sends the SVG to the frontend. Bug 1 crashes SVG building (wrong call signature), Bug 2 makes critique useless (preview is bare background), Bug 3 sends empty `textLayers` regardless.

**Tech Stack:** Python 3.11, FastAPI, Pillow, dataclasses, SVG generation, pytest

---

## File Map

| File | Action | Responsibility |
|------|--------|---------------|
| `backend-python/app/controllers/image.py` | Modify | Fix call signatures (L666, L681, L791, L796), composite SVG onto preview (L718-725), populate textLayers (L1072) |
| `backend-python/app/utils/svg_builder.py` | Read-only | Reference for `FlexSVGInput`/`FlexSVGResult` dataclass signatures |
| `backend-python/tests/test_svg_builder.py` | Read-only | Existing tests show correct usage: `build_flex_svg(FlexSVGInput(...))` |
| `backend-python/tests/test_campaign_render.py` | Create | Regression tests for all 3 bugs |

---

## Chunk 1: Bug Fixes

### Task 1: Fix `build_flex_svg` call signature (Bug 1 — Root Cause)

**Files:**
- Modify: `backend-python/app/controllers/image.py:666-672` (primary call)
- Modify: `backend-python/app/controllers/image.py:791-794` (refinement call)
- Modify: `backend-python/app/controllers/image.py:681` (dict access on dataclass)
- Modify: `backend-python/app/controllers/image.py:796` (dict access on dataclass)

**Context:** `build_flex_svg` accepts a single `FlexSVGInput` dataclass, not kwargs. The existing tests in `test_svg_builder.py` confirm the correct pattern: `build_flex_svg(FlexSVGInput(boxes=..., canvas_w=...))`. Additionally, the return type is `FlexSVGResult` (a dataclass), but the controller accesses it as a dict (`svg_result["svg"]`). Must use attribute access (`svg_result.svg`).

- [ ] **Step 1: Write regression test for Bug 1**

Create `backend-python/tests/test_campaign_render.py`:

```python
from unittest.mock import MagicMock
from app.utils.svg_builder import build_flex_svg, FlexSVGInput, FlexSVGResult
from app.utils.flex_layout import LayoutBox, FlexNodeStyle


def test_build_flex_svg_accepts_dataclass_not_kwargs():
    """Bug 1: build_flex_svg must be called with FlexSVGInput, not kwargs."""
    boxes = [LayoutBox(id="t1", type="text", x=10, y=10, w=400, h=100,
                       text="Test", style=FlexNodeStyle(fontSize="medium", color="#FFF"))]
    result = build_flex_svg(FlexSVGInput(
        boxes=boxes, canvas_w=1000, canvas_h=1777,
    ))
    assert isinstance(result, FlexSVGResult)
    assert isinstance(result.svg, str)
    assert "<svg" in result.svg
    assert "Test" in result.svg


def test_flex_svg_result_is_dataclass_not_dict():
    """Bug 1b: FlexSVGResult uses attribute access, not dict access."""
    boxes = [LayoutBox(id="t1", type="text", x=0, y=0, w=100, h=50,
                       text="Hi", style=FlexNodeStyle(fontSize="small", color="#000"))]
    result = build_flex_svg(FlexSVGInput(boxes=boxes, canvas_w=500, canvas_h=500))
    assert hasattr(result, "svg")
    assert hasattr(result, "boxes")
    try:
        _ = result["svg"]
        assert False, "FlexSVGResult should not support dict access"
    except TypeError:
        pass
```

- [ ] **Step 2: Run test to verify it passes (confirms correct API)**

Run: `cd backend-python && source venv/bin/activate && python -m pytest tests/test_campaign_render.py -v`
Expected: PASS (tests confirm the correct calling convention)

- [ ] **Step 3: Fix primary call site at line 666**

In `backend-python/app/controllers/image.py`, change lines 666-672 from:
```python
    svg_result = build_flex_svg(
        boxes=flex_boxes,
        canvas_w=canvas_w,
        canvas_h=canvas_h,
        bg_image_url=svg_bg_url,
        component_images=component_images,
    )
```
To:
```python
    svg_result = build_flex_svg(FlexSVGInput(
        boxes=flex_boxes,
        canvas_w=canvas_w,
        canvas_h=canvas_h,
        bg_image_url=svg_bg_url,
        component_images=component_images,
    ))
```

- [ ] **Step 4: Fix return value access at line 681**

Change line 681 from:
```python
    return svg_result["svg"], flex_result
```
To:
```python
    return svg_result.svg, flex_result
```

- [ ] **Step 5: Fix refinement call site at line 791-794**

Change from:
```python
            refined_svg_result = build_flex_svg(
                boxes=refined_boxes, canvas_w=canvas_w, canvas_h=canvas_h,
                bg_image_url=svg_bg, component_images=comp_imgs,
            )
```
To:
```python
            refined_svg_result = build_flex_svg(FlexSVGInput(
                boxes=refined_boxes, canvas_w=canvas_w, canvas_h=canvas_h,
                bg_image_url=svg_bg, component_images=comp_imgs,
            ))
```

- [ ] **Step 6: Fix refinement return value access at line 796-797**

Change from:
```python
            if refined_svg_result["svg"] and len(refined_svg_result["svg"]) > 50:
                current_svg = refined_svg_result["svg"]
```
To:
```python
            if refined_svg_result.svg and len(refined_svg_result.svg) > 50:
                current_svg = refined_svg_result.svg
```

- [ ] **Step 7: Add missing import for FlexSVGInput**

At the top of `image.py`, change:
```python
from app.utils.svg_builder import build_flex_svg
```
To:
```python
from app.utils.svg_builder import build_flex_svg, FlexSVGInput
```

- [ ] **Step 8: Run all existing tests**

Run: `cd backend-python && source venv/bin/activate && python -m pytest tests/ -v`
Expected: All PASS

- [ ] **Step 9: Commit**

```bash
git add backend-python/app/controllers/image.py backend-python/tests/test_campaign_render.py
git commit -m "fix: wrap build_flex_svg calls with FlexSVGInput dataclass and use attribute access

build_flex_svg() accepts a single FlexSVGInput object, not kwargs.
FlexSVGResult is a dataclass, not a dict — use .svg not ['svg'].
Both the primary call (L666) and refinement call (L791) were broken,
causing TypeError silently caught by try/except, leaving svg_overlay empty."
```

---

### Task 2: Fix critique preview to composite SVG (Bug 2)

**Files:**
- Modify: `backend-python/app/controllers/image.py:718-725`

**Context:** The critique loop generates a "preview" to send to the AI for evaluation. Currently it just saves the bare background image — the SVG overlay is never composited onto it. This means the AI critique evaluates a blank canvas and hallucinates that text is present. The fix: render `current_svg` onto `base_img` using cairosvg (or fallback to sending SVG string directly).

- [ ] **Step 1: Check if cairosvg is available**

Run: `cd backend-python && source venv/bin/activate && python -c "import cairosvg; print('available')" 2>&1 || echo "NOT_INSTALLED"`

If not installed: `pip install cairosvg` and add to pyproject.toml dependencies.

- [ ] **Step 2: Write the composite preview logic**

In `backend-python/app/controllers/image.py`, replace lines 718-725:

From:
```python
        try:
            base_img = Image.open(BytesIO(image_bytes)).convert("RGBA")
            preview_buf = BytesIO()
            base_img.save(preview_buf, format="PNG")
            preview_bytes = preview_buf.getvalue()
        except Exception:
            preview_bytes = image_bytes
```

To:
```python
        try:
            base_img = Image.open(BytesIO(image_bytes)).convert("RGBA")
            if current_svg and len(current_svg) > 50:
                try:
                    import cairosvg
                    svg_png = cairosvg.svg2png(
                        bytestring=current_svg.encode("utf-8"),
                        output_width=base_img.width,
                        output_height=base_img.height,
                    )
                    svg_layer = Image.open(BytesIO(svg_png)).convert("RGBA")
                    base_img = Image.alpha_composite(base_img, svg_layer)
                except ImportError:
                    pass
            preview_buf = BytesIO()
            base_img.save(preview_buf, format="PNG")
            preview_bytes = preview_buf.getvalue()
        except Exception:
            preview_bytes = image_bytes
```

- [ ] **Step 3: Run tests**

Run: `cd backend-python && source venv/bin/activate && python -m pytest tests/ -v`
Expected: All PASS

- [ ] **Step 4: Commit**

```bash
git add backend-python/app/controllers/image.py
git commit -m "fix: composite SVG overlay onto critique preview image

The critique loop was sending bare background to AI for evaluation,
causing hallucinated PASS. Now renders current_svg onto base_img
via cairosvg before sending to critique_layout()."
```

---

### Task 3: Populate textLayers from flex tree (Bug 3)

**Files:**
- Modify: `backend-python/app/controllers/image.py:1072`

**Context:** The frontend reads both `svg_overlay` AND `textLayers` from the done event. `svg_overlay` is the primary render path (used in LayerEditor.vue L376-384), but `textLayers` is used for the text layer list in CampaignLayout.vue and as fallback in AIRefinementPreview.vue. Currently hardcoded to `[]`. Should extract text nodes from the flex tree boxes.

- [ ] **Step 1: Write helper to extract textLayers from flex tree**

Add before the `done` SSE event (around line 1060):

```python
            text_layers = []
            if flex_tree:
                def _extract_text_nodes(node):
                    if not isinstance(node, dict):
                        return
                    if node.get("type") == "text" and node.get("text"):
                        text_layers.append({
                            "text": node["text"],
                            "position": {
                                "top": node.get("top", 0),
                                "left": node.get("left", 0),
                                "width": node.get("width", 0),
                                "height": node.get("height", 0),
                            },
                            "style": node.get("style", {}),
                        })
                    for child in node.get("children", []):
                        _extract_text_nodes(child)
                _extract_text_nodes(flex_tree)
```

- [ ] **Step 2: Replace hardcoded empty list**

Change line 1072 from:
```python
                    "textLayers": [],
```
To:
```python
                    "textLayers": text_layers,
```

- [ ] **Step 3: Run tests**

Run: `cd backend-python && source venv/bin/activate && python -m pytest tests/ -v`
Expected: All PASS

- [ ] **Step 4: Commit**

```bash
git add backend-python/app/controllers/image.py
git commit -m "fix: populate textLayers from flex tree instead of hardcoded empty list

Frontend CampaignLayout.vue and AIRefinementPreview.vue read textLayers
for display. Was always [] regardless of AI output."
```

---

## Verification

After all 3 tasks:

1. Start the backend: `cd backend-python && source venv/bin/activate && python -m uvicorn app.main:app --reload --port 5001`
2. Run a create-campaign request from the frontend
3. Check server logs for absence of `[Pass2] Layout intent pipeline failed` errors
4. Verify the `done` SSE event contains non-empty `svg_overlay` (SVG string with `<svg` tag)
5. Verify the canvas shows text overlays and components rendered
6. Verify `textLayers` array is populated in the done event
