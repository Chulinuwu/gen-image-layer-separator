# Flex Layout Style Expansion — Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Expand the flex layout system with 8 new style properties (px fontSize, lineHeight, letterSpacing, borderRadius, textShadow, opacity, margin, maxLines) so AI can produce more varied and polished ad designs.

**Architecture:** All changes are backwards-compatible — new style fields are optional with sensible defaults. The dataclass `FlexNodeStyle` gains new fields, `_render_text_box()` in svg_builder.py reads them, and the flex_layout.py prompt is updated to advertise the new options. Existing layouts continue to work unchanged.

**Tech Stack:** Python, SVG, Pillow (text measurement)

---

## Current State

- `FlexNodeStyle` has 7 fields: fontSize (5 named sizes), fontWeight, color, strokeColor, strokeWidth, align, backgroundColor
- `_render_text_box()` in svg_builder.py converts style → SVG attributes
- `build_flex_svg()` renders background rects with borderRadius only for CTA-keyword nodes
- fontSize is a named ratio (xlarge=1.0, large=0.75, etc.) of box height — no px control
- lineHeight hardcoded at `font_size * 1.35`
- No letterSpacing, textShadow, opacity, margin, or maxLines support

## File Structure

| File | Action | Responsibility |
|------|--------|----------------|
| `app/utils/flex_layout.py` | Modify | Add new fields to `FlexNodeStyle`, handle margin in `_layout_node` |
| `app/utils/svg_builder.py` | Modify | Render new style properties in `_render_text_box` and `build_flex_svg` |
| `app/prompts/flex_layout.py` | Modify | Advertise new style options in prompt |
| `tests/test_svg_builder.py` | Modify | Tests for new style rendering |
| `tests/test_flex_layout.py` | Modify | Tests for margin handling |

---

## Chunk 1: FlexNodeStyle Expansion + fontSize px

### Task 1: Add new fields to FlexNodeStyle

**Files:**
- Modify: `backend-python/app/utils/flex_layout.py:8-16`
- Modify: `backend-python/tests/test_flex_layout.py`

- [ ] **Step 1: Add test for margin in layout computation**

Add to `backend-python/tests/test_flex_layout.py`:

```python
def test_margin_shifts_position():
    from app.utils.flex_layout import compute_flex_layout
    root = {
        "id": "root", "direction": "column", "padding": 0, "gap": 0,
        "children": [
            {"id": "a", "type": "text", "text": "A", "height": "50%",
             "style": {"fontSize": "large", "margin": 10}},
            {"id": "b", "type": "text", "text": "B", "height": "50%"},
        ],
    }
    boxes = compute_flex_layout(root, 400, 200)
    a = next(b for b in boxes if b.id == "a")
    b = next(b for b in boxes if b.id == "b")
    # a has margin=10 so it should be inset by 10 on all sides
    assert a.x == 10
    assert a.y == 10
    assert a.w == 380  # 400 - 10*2
    assert a.h == 80   # 100 - 10*2
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd backend-python && python -m pytest tests/test_flex_layout.py::test_margin_shifts_position -v`
Expected: FAIL (FlexNodeStyle has no `margin` field)

- [ ] **Step 3: Expand FlexNodeStyle dataclass**

In `backend-python/app/utils/flex_layout.py`, replace the `FlexNodeStyle` dataclass:

```python
@dataclass
class FlexNodeStyle:
    fontSize: str | None = None  # "xlarge"|"large"|"medium"|"small"|"xsmall" OR px int like 48
    fontWeight: str | None = None
    color: str | None = None
    strokeColor: str | None = None
    strokeWidth: int | None = None
    align: Literal["left", "center", "right"] | None = None
    backgroundColor: str | None = None
    lineHeight: float | None = None       # multiplier e.g. 1.2, 1.5 (default 1.35)
    letterSpacing: int | None = None      # px, e.g. 2, -1
    borderRadius: int | None = None       # px for background rect corners
    textShadow: str | None = None         # e.g. "2px 2px 4px rgba(0,0,0,0.5)"
    opacity: float | None = None          # 0.0-1.0
    margin: int | None = None             # px, applied to all sides of this node's box
    maxLines: int | None = None           # truncate text to N lines
```

- [ ] **Step 4: Handle margin in `_layout_node`**

In `backend-python/app/utils/flex_layout.py`, modify the leaf-node branch of `_layout_node` (around line 133):

```python
    if not is_container:
        margin = 0
        if node.style and node.style.margin:
            margin = node.style.margin
        out.append(LayoutBox(
            id=node.id,
            type=node.type or "text",
            x=x + margin, y=y + margin,
            w=max(0, w - margin * 2), h=max(0, h - margin * 2),
            text=node.text,
            label=node.label,
            style=node.style,
        ))
        return
```

- [ ] **Step 5: Update `_dict_to_flex_node` to parse new style fields**

The existing `_dict_to_flex_node` already does `FlexNodeStyle(**{k: v for k, v in style_raw.items() if k in FlexNodeStyle.__dataclass_fields__})` — this automatically picks up new fields. No change needed.

- [ ] **Step 6: Run tests**

Run: `cd backend-python && python -m pytest tests/test_flex_layout.py -v`
Expected: All tests PASS including new `test_margin_shifts_position`

- [ ] **Step 7: Commit**

```bash
git add backend-python/app/utils/flex_layout.py backend-python/tests/test_flex_layout.py
git commit -m "feat: expand FlexNodeStyle with margin, lineHeight, letterSpacing, borderRadius, textShadow, opacity, maxLines"
```

---

## Chunk 2: SVG Rendering of New Styles

### Task 2: Render px fontSize + lineHeight + letterSpacing

**Files:**
- Modify: `backend-python/app/utils/svg_builder.py:220-283` (`_render_text_box`)
- Modify: `backend-python/tests/test_svg_builder.py`

- [ ] **Step 1: Add tests for new style rendering**

Add to `backend-python/tests/test_svg_builder.py`:

```python
from app.utils.flex_layout import LayoutBox, FlexNodeStyle
from app.utils.svg_builder import build_flex_svg, FlexSVGInput


def test_px_font_size():
    box = LayoutBox(id="t", type="text", x=0, y=0, w=400, h=100, text="Hello",
                    style=FlexNodeStyle(fontSize="48", fontWeight="700", color="#FFF"))
    result = build_flex_svg(FlexSVGInput(boxes=[box], canvas_w=400, canvas_h=100))
    assert 'font-size="48"' in result.svg


def test_letter_spacing():
    box = LayoutBox(id="t", type="text", x=0, y=0, w=400, h=100, text="Hello",
                    style=FlexNodeStyle(fontSize="large", letterSpacing=3, color="#FFF"))
    result = build_flex_svg(FlexSVGInput(boxes=[box], canvas_w=400, canvas_h=100))
    assert 'letter-spacing="3"' in result.svg


def test_line_height_custom():
    box = LayoutBox(id="t", type="text", x=0, y=0, w=400, h=200, text="Line one and line two test",
                    style=FlexNodeStyle(fontSize="medium", lineHeight=1.8, color="#FFF"))
    result = build_flex_svg(FlexSVGInput(boxes=[box], canvas_w=400, canvas_h=200))
    assert result.svg  # renders without error


def test_opacity():
    box = LayoutBox(id="t", type="text", x=0, y=0, w=400, h=100, text="Faded",
                    style=FlexNodeStyle(fontSize="large", opacity=0.5, color="#FFF"))
    result = build_flex_svg(FlexSVGInput(boxes=[box], canvas_w=400, canvas_h=100))
    assert 'opacity="0.5"' in result.svg


def test_border_radius_on_any_node():
    box = LayoutBox(id="badge", type="text", x=0, y=0, w=200, h=50, text="NEW",
                    style=FlexNodeStyle(fontSize="small", backgroundColor="#FF00FF",
                                        borderRadius=12, color="#FFF"))
    result = build_flex_svg(FlexSVGInput(boxes=[box], canvas_w=200, canvas_h=50))
    assert 'rx="12"' in result.svg


def test_text_shadow():
    box = LayoutBox(id="t", type="text", x=0, y=0, w=400, h=100, text="Shadow",
                    style=FlexNodeStyle(fontSize="large", textShadow="2px 2px 4px rgba(0,0,0,0.5)",
                                        color="#FFF"))
    result = build_flex_svg(FlexSVGInput(boxes=[box], canvas_w=400, canvas_h=100))
    assert 'filter=' in result.svg


def test_max_lines():
    long_text = "Word " * 100  # very long text
    box = LayoutBox(id="t", type="text", x=0, y=0, w=300, h=100, text=long_text,
                    style=FlexNodeStyle(fontSize="small", maxLines=2, color="#FFF"))
    result = build_flex_svg(FlexSVGInput(boxes=[box], canvas_w=300, canvas_h=100))
    tspan_count = result.svg.count("<tspan")
    assert tspan_count <= 2
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd backend-python && python -m pytest tests/test_svg_builder.py::test_px_font_size tests/test_svg_builder.py::test_letter_spacing tests/test_svg_builder.py::test_opacity tests/test_svg_builder.py::test_border_radius_on_any_node tests/test_svg_builder.py::test_text_shadow tests/test_svg_builder.py::test_max_lines -v`
Expected: Multiple FAILs

- [ ] **Step 3: Update `_render_text_box` to handle all new styles**

Replace `_render_text_box` in `backend-python/app/utils/svg_builder.py`:

```python
def _resolve_font_size(style: FlexNodeStyle, box_h: float) -> int:
    """Resolve fontSize — supports named sizes ('xlarge') and px values ('48' or 48)."""
    raw = style.fontSize or "medium"
    if isinstance(raw, (int, float)):
        return max(12, int(raw))
    if isinstance(raw, str):
        # Try parsing as integer px value
        try:
            return max(12, int(raw))
        except ValueError:
            pass
    ratio = FLEX_FONT_RATIO.get(raw, 0.5)
    return max(12, round(box_h * ratio))


def _render_text_box(box: LayoutBox, clip_id: str) -> tuple[list[str], list[str]]:
    defs: list[str] = []
    elements: list[str] = []
    style = box.style or FlexNodeStyle()
    text = box.text or ""
    if not text:
        return defs, elements

    align = style.align or "center"
    anchor = _anchor_for_align(align)
    font_weight = style.fontWeight or "700"
    color = style.color or "#FFFFFF"
    custom_line_height = style.lineHeight  # None means use default 1.35

    box_padding = 20 if style.backgroundColor else 4
    max_text_width = box.w - box_padding * 2

    start_font = _resolve_font_size(style, box.h)
    min_font = max(12, round(start_font * 0.15))

    font_size = max(min_font, start_font)
    wrapped = wrap_text(text, max_text_width, font_size, font_weight)

    while wrapped.total_height > box.h * 0.95 and font_size > min_font:
        font_size = max(min_font, round(font_size * 0.9))
        wrapped = wrap_text(text, max_text_width, font_size, font_weight)

    # Apply maxLines truncation
    max_lines = style.maxLines
    if max_lines and len(wrapped.lines) > max_lines:
        wrapped = wrapped._replace(lines=wrapped.lines[:max_lines]) if hasattr(wrapped, '_replace') else type(wrapped)(
            lines=wrapped.lines[:max_lines],
            line_height=wrapped.line_height,
            total_height=wrapped.line_height * max_lines,
        )

    lh_mult = custom_line_height or 1.35
    line_height = font_size * lh_mult
    total_text_height = len(wrapped.lines) * line_height
    offset_y = max(0, (box.h - total_text_height) / 2)

    if align == "center":
        text_x = box.x + box.w / 2
    elif align == "right":
        text_x = box.x + box.w - box_padding
    else:
        text_x = box.x + box_padding

    defs.append(f'    <clipPath id="{clip_id}">')
    defs.append(f'      <rect x="{box.x}" y="{box.y}" width="{box.w}" height="{box.h}" />')
    defs.append(f"    </clipPath>")

    # Text shadow filter
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

    stroke_attrs = ""
    if style.strokeColor:
        sw = style.strokeWidth or 2
        stroke_attrs = f' stroke="{_escape_xml(style.strokeColor)}" stroke-width="{sw}" paint-order="stroke"'

    letter_spacing_attr = ""
    if style.letterSpacing:
        letter_spacing_attr = f' letter-spacing="{style.letterSpacing}"'

    opacity_attr = ""
    if style.opacity is not None and style.opacity < 1.0:
        opacity_attr = f' opacity="{style.opacity}"'

    filter_attr = ""
    if shadow_filter_id:
        filter_attr = f' filter="url(#{shadow_filter_id})"'

    metrics = measure_text(text, font_size, font_weight)
    baseline_y = box.y + offset_y + metrics.ascent

    elements.append(
        f'  <text id="{_escape_xml(box.id)}" data-role="text" clip-path="url(#{clip_id})" '
        f'font-family="Kanit, sans-serif" font-size="{font_size}" font-weight="{font_weight}" '
        f'fill="{_escape_xml(color)}"{stroke_attrs}{letter_spacing_attr}{opacity_attr}{filter_attr} text-anchor="{anchor}">'
    )

    for i, line in enumerate(wrapped.lines):
        if i == 0:
            elements.append(f'    <tspan x="{text_x}" y="{baseline_y}">{_escape_xml(line)}</tspan>')
        else:
            elements.append(f'    <tspan x="{text_x}" dy="{line_height}">{_escape_xml(line)}</tspan>')

    elements.append("  </text>")
    return defs, elements
```

- [ ] **Step 4: Update `build_flex_svg` background rect to use borderRadius from style**

In `build_flex_svg`, replace the background rects section:

```python
    # Background rects
    CTA_KEYWORDS = {"cta", "button", "btn"}
    for box in boxes:
        if box.style and box.style.backgroundColor:
            rx = 0
            if box.style.borderRadius is not None:
                rx = box.style.borderRadius
            elif any(kw in (box.id or "").lower() for kw in CTA_KEYWORDS):
                rx = min(12, box.h / 2)
            rx_attr = f' rx="{rx:.0f}" ry="{rx:.0f}"' if rx > 0 else ""
            opacity_attr = ""
            if box.style.opacity is not None and box.style.opacity < 1.0:
                opacity_attr = f' opacity="{box.style.opacity}"'
            svg_lines.append(
                f'  <rect x="{box.x}" y="{box.y}" width="{box.w}" height="{box.h}"{rx_attr} '
                f'fill="{_escape_xml(box.style.backgroundColor)}"{opacity_attr} />'
            )
```

- [ ] **Step 5: Run all tests**

Run: `cd backend-python && python -m pytest tests/test_svg_builder.py -v`
Expected: All tests PASS

- [ ] **Step 6: Commit**

```bash
git add backend-python/app/utils/svg_builder.py backend-python/tests/test_svg_builder.py
git commit -m "feat: render px fontSize, lineHeight, letterSpacing, borderRadius, textShadow, opacity, maxLines in SVG"
```

---

## Chunk 3: Update Prompt

### Task 3: Advertise new style properties in flex layout prompt

**Files:**
- Modify: `backend-python/app/prompts/flex_layout.py`

- [ ] **Step 1: Update the text leaf format in the prompt**

In `build_flex_layout_prompt`, update the FLEX TREE FORMAT section. Replace the Text leaf line:

```
Text leaf: {{"id":"...", "type":"text", "text":"...", "height":"30%", "style":{{"fontSize":"xlarge|large|medium|small|xsmall", "fontWeight":"900|700|400", "color":"#FFD700", "strokeColor":"#000", "strokeWidth":2, "align":"center|left|right", "backgroundColor":"rgba(0,0,0,0.5)"}}}}
```

With:

```
Text leaf: {{"id":"...", "type":"text", "text":"...", "height":"30%", "style":{{"fontSize":"xlarge|large|medium|small|xsmall|<px number>", "fontWeight":"900|700|400", "color":"#FFD700", "strokeColor":"#000", "strokeWidth":2, "align":"center|left|right", "backgroundColor":"rgba(0,0,0,0.5)", "lineHeight":1.2, "letterSpacing":2, "borderRadius":12, "textShadow":"2px 2px 4px rgba(0,0,0,0.5)", "opacity":0.8, "margin":10, "maxLines":3}}}}
```

- [ ] **Step 2: Add style guidance rules**

Add after the CTA BUTTON rule:

```
- fontSize can be a named size (xlarge/large/medium/small/xsmall) OR a pixel number (e.g. 48, 24, 14). Use px for precise control.
- lineHeight: multiplier for line spacing (default 1.35). Use 1.0-1.2 for tight headers, 1.4-1.8 for body/footer.
- letterSpacing: px between characters. Use 1-4 for premium headlines, -1 for tight body text. Default 0.
- borderRadius: px for rounded corners on backgroundColor rects. Use for badges, tags, buttons.
- textShadow: format "Xpx Ypx BLURpx COLOR" for drop shadow. Great for readability on busy backgrounds.
- opacity: 0.0-1.0 for transparency. Use for watermarks or subtle text.
- margin: px inset from all sides of the node's allocated box. Use to add breathing room.
- maxLines: limit text to N lines. Use for footer/disclaimer truncation.
```

- [ ] **Step 3: Verify prompt builds without error**

Run: `cd backend-python && python -c "from app.prompts.flex_layout import build_flex_layout_prompt; p = build_flex_layout_prompt('test', 'none', '', '', {'w': 1000, 'h': 1500}); print(len(p), 'chars'); print('letterSpacing' in p)"`
Expected: prints char count and `True`

- [ ] **Step 4: Commit**

```bash
git add backend-python/app/prompts/flex_layout.py
git commit -m "feat: advertise new style properties in flex layout prompt"
```

---

## Chunk 4: Final Verification

### Task 4: Run full test suite and verify

**Files:**
- None new

- [ ] **Step 1: Run complete test suite**

Run: `cd backend-python && python -m pytest tests/ -v`
Expected: All tests PASS (existing + new)

- [ ] **Step 2: Verify server starts**

Run: `cd backend-python && python -c "from app.services.vertex import vertex_service; from app.controllers.image import create_campaign; print('OK')"`
Expected: `OK`

- [ ] **Step 3: Verify backwards compatibility**

Existing flex trees without new style fields should still render correctly. The test suite covers this via existing `test_build_flex_svg_with_text_box` etc.

- [ ] **Step 4: Final commit**

```bash
git add -A
git commit -m "feat: complete flex layout style expansion (8 new properties)"
```

---

## Summary

| Task | What | Key files |
|------|------|-----------|
| Task 1 | FlexNodeStyle expansion + margin in layout | `flex_layout.py` |
| Task 2 | SVG rendering of all new styles | `svg_builder.py` |
| Task 3 | Prompt update to advertise new options | `flex_layout.py` (prompt) |
| Task 4 | Full test suite verification | All |

**New style properties:**

| Property | Type | Default | SVG Rendering |
|----------|------|---------|---------------|
| `fontSize` (px) | int string `"48"` | named ratio | `font-size="48"` |
| `lineHeight` | float `1.2` | `1.35` | tspan `dy` spacing |
| `letterSpacing` | int `2` | `0` | `letter-spacing="2"` |
| `borderRadius` | int `12` | `0` (CTA auto) | `rx="12" ry="12"` on bg rect |
| `textShadow` | string | none | SVG `feDropShadow` filter |
| `opacity` | float `0.5` | `1.0` | `opacity="0.5"` |
| `margin` | int `10` | `0` | Insets box x/y/w/h |
| `maxLines` | int `3` | unlimited | Truncates wrapped lines |

**Backwards compatible:** All new fields are optional with `None` default. Existing flex trees render identically.
