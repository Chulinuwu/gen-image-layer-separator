# Visual Quality Improvements Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Improve the visual quality of generated advertisements to look closer to professional graphic design output -- focusing on gradient overlays, richer shadow/glow effects, contrast validation, and component depth.

**Architecture:** Four independent enhancements to the existing flex layout -> SVG pipeline. Each adds a new visual capability: (1) gradient overlay support in FlexNodeStyle + SVG builder, (2) expanded shadow/glow types, (3) objective contrast ratio measurement in the critique loop, (4) automatic drop shadows for die-cut components. All changes flow through the existing flex tree -> compute_flex_layout -> build_flex_svg path.

**Tech Stack:** Python, SVG, Pillow (contrast measurement), existing flex layout engine, cairosvg

**Important code structure notes:**
- `build_flex_svg()` (svg_builder.py:326-397) uses a single `svg_lines: list[str]` to accumulate SVG markup. There are NO separate `defs_parts` or `parts` lists.
- Text box rendering is delegated to `_render_text_box()` (line 233) which returns `(defs: list[str], elements: list[str])`. Defs are inserted into `svg_lines` between lines 342-358 (inside `<defs>...</defs>`). Text elements are collected in `all_text_elements` and appended after components (line 391-393).
- SVG element order in `build_flex_svg()`: background image -> `<defs>` (fonts + clip paths + filters) -> `</defs>` -> background rects -> component images -> text elements -> `</svg>`.
- `computed_boxes` (image.py:662-666) intentionally strips the `style` field. To access style data, use the `flex_boxes` (list of `LayoutBox` objects) from `compute_flex_layout()`.

---

## File Structure

### New Files
- `backend-python/app/utils/contrast.py` -- WCAG contrast ratio calculation utility
- `backend-python/tests/test_contrast.py` -- Tests for contrast utility

### Modified Files
- `backend-python/app/utils/flex_layout.py:8-23` -- FlexNodeStyle: add `gradientOverlay` field
- `backend-python/app/utils/svg_builder.py:1-397` -- Render gradient overlays, new shadow types, component drop shadows
- `backend-python/app/prompts/flex_layout.py:60,82` -- Teach AI about gradient overlays and new shadow options
- `backend-python/app/prompts/critique.py:1-35` -- Add contrast ratio data to prompt
- `backend-python/app/services/vertex.py:467-503` -- Pass contrast data to critique
- `backend-python/app/controllers/image.py:697-855` -- Wire contrast measurement into refinement loop
- `backend-python/tests/test_svg_builder.py` -- Tests for new SVG features

---

## Task 1: Gradient Overlay on Background

Adds a `<linearGradient>` + `<rect>` overlay between the background image and text content. The AI can specify gradient direction, colors, and opacity on any node. Most common use: bottom-to-top dark fade for text readability.

### Files
- Modify: `backend-python/app/utils/flex_layout.py:8-23` (FlexNodeStyle dataclass)
- Modify: `backend-python/app/utils/svg_builder.py:1-8,326-397` (add `import re`, modify `build_flex_svg`)
- Modify: `backend-python/app/prompts/flex_layout.py:60,76-82` (style schema + instructions)
- Test: `backend-python/tests/test_svg_builder.py`

- [ ] **Step 1: Write failing test for gradient overlay in SVG**

Add to `backend-python/tests/test_svg_builder.py`:

```python
def test_gradient_overlay():
    """Gradient overlay renders as linearGradient + rect between bg and content."""
    boxes = [
        LayoutBox(
            id="header", type="text", x=0, y=0, w=500, h=100,
            text="Hello",
            style=FlexNodeStyle(
                fontSize="large", color="#FFFFFF",
                gradientOverlay="to-bottom rgba(0,0,0,0) rgba(0,0,0,0.7)",
            ),
        )
    ]
    result = build_flex_svg(FlexSVGInput(
        boxes=boxes, canvas_w=500, canvas_h=500,
        bg_image_url="https://example.com/bg.jpg",
    ))
    assert "<linearGradient" in result.svg
    assert "stop-color" in result.svg
    assert "stop-opacity" in result.svg
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd backend-python && python -m pytest tests/test_svg_builder.py::test_gradient_overlay -v`
Expected: FAIL -- `gradientOverlay` not a field on FlexNodeStyle

- [ ] **Step 3: Add gradientOverlay field to FlexNodeStyle**

In `backend-python/app/utils/flex_layout.py`, add after `maxLines` field (line 23):

```python
    gradientOverlay: str | None = None  # "to-bottom rgba(0,0,0,0) rgba(0,0,0,0.7)"
```

Format: `"<direction> <start-color> <end-color>"` where direction is `to-bottom`, `to-top`, `to-left`, `to-right`.

- [ ] **Step 4: Add `import re` to svg_builder.py**

At top of `backend-python/app/utils/svg_builder.py`, after line 5 (`from html import escape as html_escape`), add:

```python
import re as _re
```

This is needed for both gradient and shadow parsing (Task 1 and Task 2).

- [ ] **Step 5: Add gradient parsing helper to svg_builder.py**

In `backend-python/app/utils/svg_builder.py`, add before `build_flex_svg()` (before line 326):

```python
def _parse_gradient(spec: str, grad_id: str) -> tuple[str, str] | None:
    """Parse gradient spec -> (defs_snippet, grad_id) or None.

    spec format: "to-bottom rgba(0,0,0,0) rgba(0,0,0,0.7)"
    Returns: (linearGradient SVG string, gradient ID)
    """
    parts = spec.strip().split()
    if len(parts) < 3:
        return None
    direction = parts[0]
    start_color = parts[1]
    end_color = " ".join(parts[2:])

    coords = {
        "to-bottom": 'x1="0" y1="0" x2="0" y2="1"',
        "to-top":    'x1="0" y1="1" x2="0" y2="0"',
        "to-right":  'x1="0" y1="0" x2="1" y2="0"',
        "to-left":   'x1="1" y1="0" x2="0" y2="0"',
    }.get(direction)
    if not coords:
        return None

    def _stop(color: str, offset: str) -> str:
        rgba = _re.match(
            r"rgba?\((\d+),\s*(\d+),\s*(\d+)(?:,\s*([\d.]+))?\)", color
        )
        if rgba:
            r, g, b = rgba.group(1), rgba.group(2), rgba.group(3)
            a = rgba.group(4) or "1"
            return f'<stop offset="{offset}" stop-color="rgb({r},{g},{b})" stop-opacity="{a}"/>'
        return f'<stop offset="{offset}" stop-color="{_escape_xml(color)}" stop-opacity="1"/>'

    defs_snippet = (
        f'    <linearGradient id="{grad_id}" {coords}>'
        f'{_stop(start_color, "0%")}'
        f'{_stop(end_color, "100%")}'
        f'</linearGradient>'
    )
    return defs_snippet, grad_id
```

- [ ] **Step 6: Modify build_flex_svg() to render gradient overlays**

In `build_flex_svg()`, make these changes:

**6a. Collect gradient defs inside the `<defs>` block.** After the text box loop (after line 356, before `svg_lines.append("  </defs>")` at line 358), add:

```python
    # Gradient overlay defs
    gradient_overlays: list[tuple[LayoutBox, str]] = []  # (box, grad_id)
    for box in boxes:
        if box.style and box.style.gradientOverlay:
            grad_id = f"grad-{box.id}"
            parsed = _parse_gradient(box.style.gradientOverlay, grad_id)
            if parsed:
                defs_snippet, _ = parsed
                svg_lines.append(f"  {defs_snippet.lstrip()}")
                gradient_overlays.append((box, grad_id))
```

**6b. Render gradient overlay rects between background rects and component images.** After the background rects loop (after line 376, before the `# Component images` comment at line 378), add:

```python
    # Gradient overlays (between background and content for readability)
    for box, grad_id in gradient_overlays:
        svg_lines.append(
            f'  <rect x="{box.x}" y="{box.y}" width="{box.w}" height="{box.h}" '
            f'fill="url(#{grad_id})"/>'
        )
```

- [ ] **Step 7: Run test to verify it passes**

Run: `cd backend-python && python -m pytest tests/test_svg_builder.py::test_gradient_overlay -v`
Expected: PASS

- [ ] **Step 8: Update flex layout prompt**

In `backend-python/app/prompts/flex_layout.py`:

**8a.** Add `gradientOverlay` to the style schema in the Text leaf line (line 60), inside the style object:

```
"gradientOverlay":"to-bottom rgba(0,0,0,0) rgba(0,0,0,0.7)"
```

**8b.** After the READABILITY rule (line 76), add a new rule:

```
- GRADIENT OVERLAY: For text readability over busy or bright backgrounds, use "gradientOverlay" on the CONTAINER that holds the text.
  - Bottom text over bright bg: "to-bottom rgba(0,0,0,0) rgba(0,0,0,0.7)" on the parent container
  - Top text over bright bg: "to-top rgba(0,0,0,0) rgba(0,0,0,0.6)"
  - This is PREFERRED over backgroundColor for large areas because it looks more natural and professional.
  - Use backgroundColor (solid/semi-transparent) for small elements like CTA buttons and badges.
  - gradientOverlay creates a smooth fade that blends with the image. backgroundColor creates a hard box.
```

**8c.** Update the textShadow description (line 82). Will be done in Task 2.

- [ ] **Step 9: Run full test suite**

Run: `cd backend-python && python -m pytest tests/ -v`
Expected: All tests PASS

- [ ] **Step 10: Commit**

```bash
git add backend-python/app/utils/flex_layout.py backend-python/app/utils/svg_builder.py backend-python/app/prompts/flex_layout.py backend-python/tests/test_svg_builder.py
git commit -m "feat: add gradient overlay support for text readability over backgrounds"
```

---

## Task 2: Expanded Shadow and Glow Effects

Currently shadow parsing (svg_builder.py:282-292) splits on spaces and handles only a single shadow. Add support for multiple comma-separated shadows (glow, multi-layer depth). The change is inside `_render_text_box()` which returns `(defs, elements)`.

**Depends on:** Task 1 Step 4 (the `import re as _re` line). If executing Task 2 independently, add the import first.

### Files
- Modify: `backend-python/app/utils/svg_builder.py:282-292` (shadow parsing in `_render_text_box`)
- Modify: `backend-python/app/prompts/flex_layout.py:82` (shadow docs)
- Test: `backend-python/tests/test_svg_builder.py`

- [ ] **Step 1: Write failing tests for multi-layer shadow and glow**

Add to `backend-python/tests/test_svg_builder.py`:

```python
def test_multi_layer_shadow():
    """Multiple shadow layers render as multiple feDropShadow elements."""
    boxes = [
        LayoutBox(
            id="glow-text", type="text", x=0, y=0, w=500, h=100,
            text="Glow",
            style=FlexNodeStyle(
                fontSize="large", color="#FFFFFF",
                textShadow="0px 0px 8px rgba(255,215,0,0.8), 0px 2px 4px rgba(0,0,0,0.5)",
            ),
        )
    ]
    result = build_flex_svg(FlexSVGInput(
        boxes=boxes, canvas_w=500, canvas_h=500,
    ))
    assert result.svg.count("feDropShadow") == 2


def test_glow_shadow():
    """Glow effect uses 0 offset with large blur."""
    boxes = [
        LayoutBox(
            id="glow", type="text", x=0, y=0, w=500, h=100,
            text="Glow",
            style=FlexNodeStyle(
                fontSize="large", color="#FFFFFF",
                textShadow="0px 0px 12px rgba(255,255,255,0.6)",
            ),
        )
    ]
    result = build_flex_svg(FlexSVGInput(
        boxes=boxes, canvas_w=500, canvas_h=500,
    ))
    assert "feDropShadow" in result.svg
    assert 'stdDeviation="12"' in result.svg
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd backend-python && python -m pytest tests/test_svg_builder.py::test_multi_layer_shadow tests/test_svg_builder.py::test_glow_shadow -v`
Expected: FAIL -- current parser only handles single shadow, splits on spaces (breaks rgba commas)

- [ ] **Step 3: Add shadow parsing helper function**

In `backend-python/app/utils/svg_builder.py`, add before `_render_text_box()` (before line 233):

```python
def _parse_text_shadows(shadow_str: str) -> list[dict]:
    """Parse CSS-like textShadow into list of {dx, dy, blur, color}.

    Supports comma-separated multi-shadow: "1px 1px 3px rgba(0,0,0,0.5), 0px 0px 10px rgba(255,215,0,0.6)"
    """
    shadows = []
    # Split on commas that are NOT inside parentheses
    parts = _re.split(r",\s*(?=-?[\d])", shadow_str)
    for part in parts:
        part = part.strip()
        match = _re.match(
            r"(-?[\d.]+)px\s+(-?[\d.]+)px\s+([\d.]+)px\s+(.*)", part
        )
        if match:
            shadows.append({
                "dx": match.group(1),
                "dy": match.group(2),
                "blur": match.group(3),
                "color": match.group(4).strip(),
            })
    return shadows
```

- [ ] **Step 4: Replace single-shadow parsing in _render_text_box()**

In `backend-python/app/utils/svg_builder.py`, replace lines 282-292 (the entire shadow block inside `_render_text_box`):

**Old code (lines 282-292):**
```python
    shadow_filter_id = ""
    if style.textShadow:
        shadow_filter_id = f"shadow-{clip_id}"
        parts = style.textShadow.split()
        dx = parts[0].replace("px", "") if len(parts) > 0 else "2"
        dy = parts[1].replace("px", "") if len(parts) > 1 else "2"
        blur = parts[2].replace("px", "") if len(parts) > 2 else "3"
        shadow_color = parts[3] if len(parts) > 3 else "rgba(0,0,0,0.5)"
        defs.append(f'    <filter id="{shadow_filter_id}">')
        defs.append(f'      <feDropShadow dx="{dx}" dy="{dy}" stdDeviation="{blur}" flood-color="{shadow_color}" flood-opacity="0.5" />')
        defs.append(f'    </filter>')
```

**New code:**
```python
    shadow_filter_id = ""
    if style.textShadow:
        shadow_filter_id = f"shadow-{clip_id}"
        parsed_shadows = _parse_text_shadows(style.textShadow)
        if parsed_shadows:
            drops = ""
            for s in parsed_shadows:
                flood_opacity = "0.5"
                flood_color = s["color"]
                rgba = _re.match(
                    r"rgba?\((\d+),\s*(\d+),\s*(\d+)(?:,\s*([\d.]+))?\)",
                    s["color"],
                )
                if rgba:
                    flood_color = f"rgb({rgba.group(1)},{rgba.group(2)},{rgba.group(3)})"
                    flood_opacity = rgba.group(4) or "1"
                drops += (
                    f'<feDropShadow dx="{s["dx"]}" dy="{s["dy"]}" '
                    f'stdDeviation="{s["blur"]}" '
                    f'flood-color="{flood_color}" flood-opacity="{flood_opacity}"/>'
                )
            defs.append(f'    <filter id="{shadow_filter_id}">')
            defs.append(f"      {drops}")
            defs.append(f"    </filter>")
        else:
            shadow_filter_id = ""
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `cd backend-python && python -m pytest tests/test_svg_builder.py -v`
Expected: All PASS (including existing `test_text_shadow` -- backward compatible since single shadows still parse correctly)

- [ ] **Step 6: Update flex layout prompt with new shadow options**

In `backend-python/app/prompts/flex_layout.py`, replace line 82:

**Old:**
```
- textShadow: format "Xpx Ypx BLURpx COLOR" for drop shadow. Great for readability on busy backgrounds.
```

**New:**
```
- textShadow: CSS-like shadow. Supports MULTIPLE layers separated by comma:
  - Subtle readability: "1px 1px 3px rgba(0,0,0,0.5)"
  - Strong drop shadow: "2px 2px 6px rgba(0,0,0,0.8)"
  - Glow effect (premium/promo): "0px 0px 10px rgba(255,215,0,0.6), 0px 0px 20px rgba(255,215,0,0.3)"
  - Depth + glow: "0px 0px 8px rgba(255,255,255,0.4), 2px 2px 4px rgba(0,0,0,0.6)"
  USE glow for hero/promo text to make it pop. USE multi-layer for depth.
```

- [ ] **Step 7: Run full test suite**

Run: `cd backend-python && python -m pytest tests/ -v`
Expected: All PASS

- [ ] **Step 8: Commit**

```bash
git add backend-python/app/utils/svg_builder.py backend-python/app/prompts/flex_layout.py backend-python/tests/test_svg_builder.py
git commit -m "feat: support multi-layer shadows and glow effects in SVG text"
```

---

## Task 3: Contrast Ratio Validation in Critique Loop

Add objective WCAG contrast ratio measurement. Before the AI critique step, sample text colors against background pixels and compute actual contrast ratios. Pass these numbers to the critique prompt so it can fail layouts with objectively poor contrast.

**Key data flow:** `_step_refinement_loop` does NOT receive `computed_boxes` or `flex_boxes`. The refinement loop re-generates flex boxes on each iteration (line 811). We need to measure contrast from the composite preview image + the flex boxes available at that point.

### Files
- Create: `backend-python/app/utils/contrast.py`
- Create: `backend-python/tests/test_contrast.py`
- Modify: `backend-python/app/prompts/critique.py:1-7,27-35`
- Modify: `backend-python/app/services/vertex.py:467-503`
- Modify: `backend-python/app/controllers/image.py:697-718,760-767`

- [ ] **Step 1: Write failing test for contrast ratio calculation**

Create `backend-python/tests/test_contrast.py`:

```python
from app.utils.contrast import relative_luminance, contrast_ratio, check_text_contrast
from PIL import Image
import io


def test_relative_luminance_white():
    assert abs(relative_luminance(255, 255, 255) - 1.0) < 0.01


def test_relative_luminance_black():
    assert abs(relative_luminance(0, 0, 0) - 0.0) < 0.01


def test_contrast_ratio_black_on_white():
    ratio = contrast_ratio((255, 255, 255), (0, 0, 0))
    assert abs(ratio - 21.0) < 0.1


def test_contrast_ratio_same_color():
    ratio = contrast_ratio((128, 128, 128), (128, 128, 128))
    assert abs(ratio - 1.0) < 0.01


def test_check_text_contrast_good():
    img = Image.new("RGB", (200, 200), (0, 0, 0))
    buf = io.BytesIO()
    img.save(buf, format="PNG")
    results = check_text_contrast(
        buf.getvalue(),
        [{"id": "h1", "x": 10, "y": 10, "w": 100, "h": 50, "color": "#FFFFFF"}],
    )
    assert results[0]["ratio"] >= 15.0
    assert results[0]["pass_aa"] is True


def test_check_text_contrast_poor():
    img = Image.new("RGB", (200, 200), (140, 140, 140))
    buf = io.BytesIO()
    img.save(buf, format="PNG")
    results = check_text_contrast(
        buf.getvalue(),
        [{"id": "h1", "x": 10, "y": 10, "w": 100, "h": 50, "color": "#999999"}],
    )
    assert results[0]["ratio"] < 3.0
    assert results[0]["pass_aa"] is False
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd backend-python && python -m pytest tests/test_contrast.py -v`
Expected: FAIL -- module not found

- [ ] **Step 3: Implement contrast utility**

Create `backend-python/app/utils/contrast.py`:

```python
from __future__ import annotations
from PIL import Image
import io


def relative_luminance(r: int, g: int, b: int) -> float:
    """WCAG 2.1 relative luminance."""
    def _lin(c: int) -> float:
        s = c / 255.0
        return s / 12.92 if s <= 0.04045 else ((s + 0.055) / 1.055) ** 2.4
    return 0.2126 * _lin(r) + 0.7152 * _lin(g) + 0.0722 * _lin(b)


def contrast_ratio(color1: tuple[int, int, int], color2: tuple[int, int, int]) -> float:
    """WCAG contrast ratio between two RGB colors. Returns 1.0-21.0."""
    l1 = relative_luminance(*color1)
    l2 = relative_luminance(*color2)
    lighter = max(l1, l2)
    darker = min(l1, l2)
    return (lighter + 0.05) / (darker + 0.05)


def _hex_to_rgb(hex_color: str) -> tuple[int, int, int]:
    h = hex_color.lstrip("#")
    if len(h) == 3:
        h = h[0] * 2 + h[1] * 2 + h[2] * 2
    return int(h[0:2], 16), int(h[2:4], 16), int(h[4:6], 16)


def _sample_avg_color(img: Image.Image, x: int, y: int, w: int, h: int) -> tuple[int, int, int]:
    """Sample average RGB color from a region of the image."""
    x = max(0, min(x, img.width - 1))
    y = max(0, min(y, img.height - 1))
    x2 = max(x + 1, min(x + w, img.width))
    y2 = max(y + 1, min(y + h, img.height))
    region = img.crop((x, y, x2, y2)).convert("RGB")
    pixels = list(region.getdata())
    if not pixels:
        return (0, 0, 0)
    r = sum(p[0] for p in pixels) // len(pixels)
    g = sum(p[1] for p in pixels) // len(pixels)
    b = sum(p[2] for p in pixels) // len(pixels)
    return (r, g, b)


def check_text_contrast(
    image_bytes: bytes,
    text_boxes: list[dict],
) -> list[dict]:
    """Measure contrast ratio for each text box against background.

    text_boxes: list of {"id", "x", "y", "w", "h", "color"} (color as hex).
    Returns list of {"id", "ratio", "pass_aa", "pass_aaa", "fg", "bg"}.
    """
    img = Image.open(io.BytesIO(image_bytes)).convert("RGB")
    results = []
    for box in text_boxes:
        fg = _hex_to_rgb(box["color"])
        bg = _sample_avg_color(
            img,
            int(box["x"]), int(box["y"]),
            int(box["w"]), int(box["h"]),
        )
        ratio = contrast_ratio(fg, bg)
        results.append({
            "id": box["id"],
            "ratio": round(ratio, 2),
            "pass_aa": ratio >= 4.5,
            "pass_aaa": ratio >= 7.0,
            "fg": f"rgb{fg}",
            "bg": f"rgb{bg}",
        })
    return results
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd backend-python && python -m pytest tests/test_contrast.py -v`
Expected: All PASS

- [ ] **Step 5: Update build_critique_prompt to accept contrast_data**

In `backend-python/app/prompts/critique.py`, modify the function signature (line 1-7) and add contrast section to the prompt:

**New signature:**
```python
def build_critique_prompt(
    target_text: str,
    style_only: bool,
    has_components: bool = True,
    style_guide: str = "",
    layout_thought: str = "",
    contrast_data: str = "",
) -> str:
```

**Add after `style_guide_section` (after line 25), before the return:**
```python
    contrast_section = ""
    if contrast_data:
        contrast_section = f"""
MEASURED CONTRAST DATA:
{contrast_data}
If any text has contrast ratio below 4.5:1, you MUST FAIL the layout and include "increase contrast" in actionable_steps.
Suggest fixes: add darker backgroundColor, change text color, add strokeColor, or use gradientOverlay on the container."""
```

**Add `{contrast_section}` to the prompt string.** In the return statement (line 27-35), add it after `{style_guide_section}`:

```python
    return f"""You are the STRICTEST ART DIRECTOR in the advertising industry.
IMAGE 1: ORIGINAL reference. IMAGE 2: PREVIEW with text overlays.
AD BRIEF: "{target_text}"
{missing_note}{layout_thought_section}{style_guide_section}{contrast_section}
CRITIQUE CRITERIA: Check text overlap with faces, readability, contrast, composition.
...rest unchanged...
```

- [ ] **Step 6: Update critique_layout() in vertex.py to accept and pass contrast_data**

In `backend-python/app/services/vertex.py`, modify `critique_layout()` signature (line 467-477):

Add `contrast_data: str | None = None` parameter:

```python
    async def critique_layout(
        self,
        original_buffer: bytes,
        preview_buffer: bytes,
        mime_type: str,
        target_text: str,
        style_only: bool = False,
        has_components: bool = True,
        style_guide: str | None = None,
        layout_thought: str | None = None,
        contrast_data: str | None = None,
    ) -> dict:
```

Update the `build_critique_prompt` call (line 479-483) to pass contrast_data:

```python
        prompt = build_critique_prompt(
            target_text, style_only, has_components,
            style_guide=style_guide or "",
            layout_thought=layout_thought or "",
            contrast_data=contrast_data or "",
        )
```

- [ ] **Step 7: Wire contrast measurement into _step_refinement_loop**

In `backend-python/app/controllers/image.py`:

**7a. Add import** at the top of the file:
```python
from app.utils.contrast import check_text_contrast
```

**7b. Add `flex_boxes` parameter to `_step_refinement_loop` signature** (after `layout_thought` at line 717):
```python
    flex_boxes: list | None = None,
```

**7c. Inside the `while` loop (line 727), before the critique call (line 762-767),** add contrast measurement. Insert after `preview_bytes` is set (after line 753):

```python
        # Measure text contrast against the base image.
        # NOTE: This is intentionally conservative -- it measures against the original image
        # WITHOUT gradient overlays. This means if a gradient overlay fixes contrast, the
        # checker may still report a failure. This is acceptable for v1: it errs on the side
        # of caution and pushes the AI to use stronger readability treatments.
        contrast_summary = ""
        current_boxes = flex_boxes or []
        text_boxes_for_contrast = []
        for b in current_boxes:
            if b.type == "text" and b.style and b.style.color:
                text_boxes_for_contrast.append({
                    "id": b.id,
                    "x": round(b.x), "y": round(b.y),
                    "w": round(b.w), "h": round(b.h),
                    "color": b.style.color,
                })
        if text_boxes_for_contrast:
            contrast_results = check_text_contrast(image_bytes, text_boxes_for_contrast)
            failing = [r for r in contrast_results if not r["pass_aa"]]
            if failing:
                lines = [f"  - {r['id']}: ratio {r['ratio']}:1 (fg={r['fg']}, bg={r['bg']}) FAIL AA" for r in failing]
                contrast_summary = "CONTRAST FAILURES (WCAG AA < 4.5:1):\n" + "\n".join(lines)
```

**7d. Update the critique_layout() call** (line 762-767) to pass contrast_data:

```python
        critique = await vertex_service.critique_layout(
            image_bytes, preview_bytes, mime, target_text, False,
            has_components=bool(visual_components),
            style_guide=style_guide,
            layout_thought=layout_thought,
            contrast_data=contrast_summary,
        )
```

**7e. Update flex_boxes after refinement re-layout.** Inside the refinement block (after line 811 `refined_boxes = compute_flex_layout(...)`), add:

```python
            flex_boxes = refined_boxes  # Update for next iteration's contrast check
```

**7f. Update the call site** where `_step_refinement_loop` is called. Find the call (around line 1100 in `create_campaign`) and add the `flex_boxes` argument. The `flex_boxes` come from `_step_flex_layout` -- that function returns `(svg, flex_result, computed_boxes)` but we need the raw `LayoutBox` objects. Either:

Option A (simpler): Store `flex_boxes` from `compute_flex_layout()` and pass it. In `_step_flex_layout()`, change the return to also include `flex_boxes`:

Change return at line 694 from:
```python
    return svg_result.svg, flex_result, computed_boxes
```
to:
```python
    return svg_result.svg, flex_result, computed_boxes, flex_boxes
```

Then at the call site, initialize `flex_boxes` before the try block to handle error paths, unpack the extra value, and pass it to `_step_refinement_loop`:
```python
    flex_boxes = []  # Initialize before try -- avoids NameError if _step_flex_layout raises
    ...
    svg_overlay, flex_result, computed_boxes, flex_boxes = await _step_flex_layout(...)
    ...
    current_svg, last_critique = await _step_refinement_loop(
        ...,
        flex_boxes=flex_boxes,
    )
```

- [ ] **Step 8: Run full test suite**

Run: `cd backend-python && python -m pytest tests/ -v`
Expected: All PASS

- [ ] **Step 9: Commit**

```bash
git add backend-python/app/utils/contrast.py backend-python/tests/test_contrast.py backend-python/app/prompts/critique.py backend-python/app/services/vertex.py backend-python/app/controllers/image.py
git commit -m "feat: add WCAG contrast ratio measurement to critique loop"
```

---

## Task 4: Component Drop Shadow

Die-cut components currently sit flat on the background. Add an automatic drop shadow behind each component `<image>` to create depth. Pure SVG builder change.

### Files
- Modify: `backend-python/app/utils/svg_builder.py:378-389` (replace component rendering)
- Test: `backend-python/tests/test_svg_builder.py`

- [ ] **Step 1: Write failing test for component drop shadow**

Add to `backend-python/tests/test_svg_builder.py`:

```python
def test_component_drop_shadow():
    """Component images get an automatic drop shadow filter."""
    boxes = [
        LayoutBox(
            id="product", type="component", x=100, y=100, w=200, h=200,
            label="phone",
        )
    ]
    result = build_flex_svg(FlexSVGInput(
        boxes=boxes, canvas_w=500, canvas_h=500,
        component_images={"phone": "https://example.com/phone.png"},
    ))
    assert "comp-shadow" in result.svg
    assert "feDropShadow" in result.svg
    assert 'filter="url(#comp-shadow' in result.svg
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd backend-python && python -m pytest tests/test_svg_builder.py::test_component_drop_shadow -v`
Expected: FAIL -- no comp-shadow in output

- [ ] **Step 3: Replace component rendering in build_flex_svg()**

In `backend-python/app/utils/svg_builder.py`, replace lines 378-389 (the entire `# Component images` section):

**Old code (lines 378-389):**
```python
    # Component images
    comp_images = input.component_images or {}
    for box in boxes:
        if box.type == "component":
            img_url = comp_images.get(box.label or "", "")
            if img_url:
                svg_lines.append(
                    f'  <image id="{_escape_xml(box.id)}" data-role="component" data-label="{_escape_xml(box.label or "")}" '
                    f'href="{_escape_xml(img_url)}" '
                    f'x="{box.x}" y="{box.y}" width="{box.w}" height="{box.h}" '
                    f'preserveAspectRatio="xMidYMid meet" />'
                )
```

**New code:**
```python
    # Component images with automatic drop shadow
    comp_images = input.component_images or {}
    for box in boxes:
        if box.type == "component":
            img_url = comp_images.get(box.label or "", "")
            if img_url:
                shadow_id = f"comp-shadow-{box.id}"
                svg_lines.append(
                    f'  <filter id="{shadow_id}" x="-10%" y="-10%" width="130%" height="130%">'
                    f'<feDropShadow dx="3" dy="5" stdDeviation="6" '
                    f'flood-color="rgb(0,0,0)" flood-opacity="0.35"/>'
                    f'</filter>'
                )
                svg_lines.append(
                    f'  <image id="{_escape_xml(box.id)}" data-role="component" '
                    f'data-label="{_escape_xml(box.label or "")}" '
                    f'href="{_escape_xml(img_url)}" '
                    f'x="{box.x}" y="{box.y}" width="{box.w}" height="{box.h}" '
                    f'preserveAspectRatio="xMidYMid meet" '
                    f'filter="url(#{shadow_id})"/>'
                )
```

Note: `flood-color` uses `rgb(0,0,0)` not `rgba(...)` because SVG 1.1 does not support rgba in flood-color. Opacity is set via separate `flood-opacity` attribute.

Note: The `<filter>` element is placed inline before the `<image>` that uses it, outside `<defs>`. SVG allows filters defined anywhere before use. This avoids restructuring the `<defs>` block. If strict SVG validators are needed later, move these filters into the `<defs>` block.

- [ ] **Step 4: Run test to verify it passes**

Run: `cd backend-python && python -m pytest tests/test_svg_builder.py::test_component_drop_shadow -v`
Expected: PASS

- [ ] **Step 5: Verify existing component test still passes**

Run: `cd backend-python && python -m pytest tests/test_svg_builder.py::test_build_flex_svg_with_component -v`
Expected: PASS (still has data-role="component" and image URL)

- [ ] **Step 6: Run full test suite**

Run: `cd backend-python && python -m pytest tests/ -v`
Expected: All PASS

- [ ] **Step 7: Commit**

```bash
git add backend-python/app/utils/svg_builder.py backend-python/tests/test_svg_builder.py
git commit -m "feat: add automatic drop shadow for die-cut components"
```

---

## Task 5: Integration Test

Verify all four features work together in a single SVG output.

### Files
- Test: `backend-python/tests/test_svg_builder.py`

- [ ] **Step 1: Write integration test**

Add to `backend-python/tests/test_svg_builder.py`:

```python
def test_full_quality_features():
    """All visual quality features render together without conflict."""
    boxes = [
        LayoutBox(
            id="bg-fade", type="text", x=0, y=300, w=500, h=200,
            text="",
            style=FlexNodeStyle(
                gradientOverlay="to-bottom rgba(0,0,0,0) rgba(0,0,0,0.7)",
            ),
        ),
        LayoutBox(
            id="headline", type="text", x=50, y=50, w=400, h=80,
            text="Big Sale",
            style=FlexNodeStyle(
                fontSize="xlarge", color="#FFFFFF", fontWeight="900",
                textShadow="0px 0px 10px rgba(255,215,0,0.6), 2px 2px 4px rgba(0,0,0,0.5)",
            ),
        ),
        LayoutBox(
            id="product", type="component", x=150, y=150, w=200, h=200,
            label="phone",
        ),
        LayoutBox(
            id="cta", type="text", x=150, y=420, w=200, h=50,
            text="Buy Now",
            style=FlexNodeStyle(
                fontSize="medium", color="#FFFFFF",
                backgroundColor="#FF0000", borderRadius=8,
            ),
        ),
    ]
    result = build_flex_svg(FlexSVGInput(
        boxes=boxes, canvas_w=500, canvas_h=500,
        bg_image_url="https://example.com/bg.jpg",
        component_images={"phone": "https://example.com/phone.png"},
    ))

    svg = result.svg
    # Gradient overlay
    assert "<linearGradient" in svg
    # Multi-layer shadow (headline has 2 shadows)
    assert svg.count("feDropShadow") >= 2
    # Component shadow
    assert "comp-shadow" in svg
    # Valid SVG
    assert svg.startswith("<svg")
    assert svg.endswith("</svg>")
    # All elements present
    assert "Big Sale" in svg
    assert "Buy Now" in svg
    assert "phone.png" in svg
```

- [ ] **Step 2: Run integration test**

Run: `cd backend-python && python -m pytest tests/test_svg_builder.py::test_full_quality_features -v`
Expected: PASS

- [ ] **Step 3: Run full test suite**

Run: `cd backend-python && python -m pytest tests/ -v`
Expected: All PASS

- [ ] **Step 4: Commit**

```bash
git add backend-python/tests/test_svg_builder.py
git commit -m "test: add integration test for all visual quality features"
```

---

## Summary

| Task | What | Impact | Dependencies |
|------|------|--------|-------------|
| 1 | Gradient overlay | Biggest visual quality jump | None |
| 2 | Multi-layer shadows + glow | Hero/promo text pops | Task 1 Step 4 (`import re`) |
| 3 | Contrast ratio validation | Objective quality gate | None (independent utility) |
| 4 | Component drop shadow | Die-cuts feel grounded | None |
| 5 | Integration test | Ensures everything works | Tasks 1-4 |
