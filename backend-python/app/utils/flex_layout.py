from __future__ import annotations

import math
from dataclasses import dataclass
from typing import Literal


@dataclass
class FlexNodeStyle:
    fontSize: str | None = None  # "xlarge"|"large"|"medium"|"small"|"xsmall" OR px int like "48"
    fontWeight: str | None = None
    color: str | None = None
    strokeColor: str | None = None
    strokeWidth: int | None = None
    align: Literal["left", "center", "right"] | None = None
    backgroundColor: str | None = None
    lineHeight: float | None = None
    letterSpacing: int | None = None
    borderRadius: int | None = None
    textShadow: str | None = None
    opacity: float | None = None
    margin: int | None = None
    maxLines: int | None = None
    gradientOverlay: str | None = None  # "to-bottom rgba(0,0,0,0) rgba(0,0,0,0.7)"
    skewX: float | None = None       # degrees
    skewY: float | None = None       # degrees
    perspective: float | None = None  # px distance
    rotateX: float | None = None     # degrees (3D tilt forward/back)
    rotateY: float | None = None     # degrees (3D tilt left/right)
    warpType: str | None = None       # "arc"|"wave"|"bulge"|"flag"|"none"
    warpIntensity: float | None = None # -100 to 100 (like Photoshop bend %)
    warpHDistortion: float | None = None  # -100 to 100
    warpVDistortion: float | None = None  # -100 to 100


@dataclass
class FlexNode:
    id: str
    direction: Literal["row", "column"] | None = None
    children: list[FlexNode] | None = None
    type: Literal["text", "component"] | None = None
    text: str | None = None
    label: str | None = None
    width: str | None = None
    height: str | None = None
    style: FlexNodeStyle | None = None
    gap: int | None = None
    padding: int | None = None
    justifyContent: Literal["start", "end", "center", "space-between", "space-evenly"] | None = None
    alignItems: Literal["start", "end", "center", "stretch"] | None = None


@dataclass
class LayoutBox:
    id: str
    type: Literal["text", "component", "container"]
    x: float
    y: float
    w: float
    h: float
    text: str | None = None
    label: str | None = None
    style: FlexNodeStyle | None = None


def _parse_pct(value: str | None) -> float:
    if not value:
        return float("nan")
    trimmed = value.strip()
    if not trimmed.endswith("%"):
        return float("nan")
    try:
        return float(trimmed[:-1]) / 100
    except ValueError:
        return float("nan")


def _safe_int(val) -> int | None:
    if val is None:
        return None
    if isinstance(val, int):
        return val
    if isinstance(val, float):
        return int(val)
    if isinstance(val, str):
        try:
            return int(float(val.strip().rstrip("%")))
        except (ValueError, TypeError):
            return None
    if isinstance(val, dict):
        for k in ("top", "value", "all"):
            if k in val and isinstance(val[k], (int, float)):
                return int(val[k])
        nums = [v for v in val.values() if isinstance(v, (int, float))]
        return int(nums[0]) if nums else None
    return None


def _safe_str(val) -> str | None:
    if val is None:
        return None
    if isinstance(val, str):
        return val
    if isinstance(val, (int, float)):
        return f"{val}%"
    return None


def _dict_to_flex_node(d: dict | FlexNode) -> FlexNode:
    if isinstance(d, FlexNode):
        return d
    if not isinstance(d, dict):
        return FlexNode(id="invalid")
    style_raw = d.get("style")
    style = None
    if isinstance(style_raw, dict):
        filtered = {k: v for k, v in style_raw.items() if k in FlexNodeStyle.__dataclass_fields__}
        for int_field in ("strokeWidth", "letterSpacing", "borderRadius", "margin", "maxLines"):
            if int_field in filtered:
                filtered[int_field] = _safe_int(filtered[int_field])
        for float_field in ("lineHeight", "opacity"):
            if float_field in filtered and filtered[float_field] is not None:
                try:
                    raw = str(filtered[float_field]).replace("px", "").replace("%", "").strip()
                    filtered[float_field] = float(raw)
                except (ValueError, TypeError):
                    filtered[float_field] = None
        style = FlexNodeStyle(**filtered)
    elif isinstance(style_raw, FlexNodeStyle):
        style = style_raw
    # Lift style-like properties from container level into style object
    # AI often places backgroundColor, borderRadius, gradientOverlay at container level
    # instead of inside the "style" dict -- merge them so the renderer sees them.
    _LIFTABLE = set(FlexNodeStyle.__dataclass_fields__.keys())
    for key in list(d.keys()):
        if key in _LIFTABLE and key not in (style_raw or {}):
            if style is None:
                style = FlexNodeStyle()
            if getattr(style, key) is None:
                setattr(style, key, d[key])

    children_raw = d.get("children")
    children = None
    if isinstance(children_raw, list):
        children = [_dict_to_flex_node(c) for c in children_raw]
    return FlexNode(
        id=str(d.get("id", "node")),
        direction=d.get("direction"),
        children=children,
        type=d.get("type"),
        text=d.get("text") if isinstance(d.get("text"), str) else None,
        label=d.get("label") if isinstance(d.get("label"), str) else None,
        width=_safe_str(d.get("width")),
        height=_safe_str(d.get("height")),
        style=style,
        gap=_safe_int(d.get("gap")),
        padding=_safe_int(d.get("padding")),
        justifyContent=d.get("justifyContent"),
        alignItems=d.get("alignItems"),
    )


_MIN_ROOT_PADDING = 20


def compute_flex_layout(root: FlexNode | dict, canvas_w: float, canvas_h: float) -> list[LayoutBox]:
    if isinstance(root, dict):
        root = _dict_to_flex_node(root)
    if root.padding is None or root.padding < _MIN_ROOT_PADDING:
        old = root.padding
        root.padding = _MIN_ROOT_PADDING
        if old is not None and old < _MIN_ROOT_PADDING:
            print(f"[FlexLayout] Enforced min root padding: {old} → {_MIN_ROOT_PADDING}")
    # No auto space-between -- AI controls justifyContent directly
    root_padding = root.padding or _MIN_ROOT_PADDING
    results: list[LayoutBox] = []
    _layout_node(root, 0, 0, canvas_w, canvas_h, results)
    # No post-processing hotfixes -- AI controls layout directly
    return results


def _estimate_text_height(box: LayoutBox, canvas_w: float) -> float:
    if not box.text or box.type != "text":
        return box.h
    style = box.style
    font_size = 24
    if style and style.fontSize:
        fs = style.fontSize
        if isinstance(fs, (int, float)):
            font_size = max(12, int(fs))
        elif isinstance(fs, str):
            try:
                font_size = max(12, int(float(fs)))
            except ValueError:
                size_map = {"xlarge": 72, "large": 48, "medium": 32, "small": 22, "xsmall": 14}
                font_size = size_map.get(fs, 24)
    lh = 1.35
    if style and style.lineHeight:
        lh = style.lineHeight
    line_h = font_size * lh
    chars_per_line = max(1, int(box.w / (font_size * 0.6)))
    num_lines = max(1, math.ceil(len(box.text) / chars_per_line))
    padding = font_size * 0.5
    return num_lines * line_h + padding * 2


def _shrink_oversized_boxes(boxes: list[LayoutBox], canvas_w: float, canvas_h: float) -> None:
    total_saved = 0.0
    for b in boxes:
        if b.type != "text" or not b.text:
            continue
        estimated = _estimate_text_height(b, canvas_w)
        if b.h > estimated * 2.5 and b.h > 80:
            old_h = b.h
            b.h = max(estimated * 1.5, 60)
            saved = old_h - b.h
            total_saved += saved
            print(f"[FlexLayout] Shrunk '{b.id}' height {old_h:.0f} → {b.h:.0f} (text needs ~{estimated:.0f})")
    if total_saved > 0:
        print(f"[FlexLayout] Total height saved: {total_saved:.0f}px")


_FOOTER_KEYWORDS = {"footer", "disclaimer", "fineprint", "fine_print", "legal"}
_FOOTER_MAX_RATIO = 0.10

def _fix_overlapping_boxes(boxes: list[LayoutBox], canvas_w: float, canvas_h: float, root_padding: int = 20) -> None:
    if len(boxes) < 2:
        return
    pad = max(root_padding, _MIN_ROOT_PADDING)
    for b in boxes:
        if any(kw in (b.id or "").lower() for kw in _FOOTER_KEYWORDS):
            max_h = canvas_h * _FOOTER_MAX_RATIO
            if b.h > max_h:
                print(f"[FlexLayout] Clamped footer '{b.id}' height {b.h:.0f} → {max_h:.0f}")
                b.h = max_h
    # Clamp all boxes within root padding bounds
    for b in boxes:
        if b.x < pad:
            b.x = pad
        if b.w > canvas_w - pad * 2:
            b.w = canvas_w - pad * 2
    sorted_boxes = sorted(boxes, key=lambda b: b.y)
    last_bottom = sorted_boxes[-1].y + sorted_boxes[-1].h
    used_ratio = last_bottom / canvas_h if canvas_h > 0 else 1.0
    if used_ratio < 0.5 and len(sorted_boxes) >= 3:
        total_h = sum(b.h for b in sorted_boxes)
        available = canvas_h - pad * 2
        spacing = max(0, (available - total_h) / max(1, len(sorted_boxes) - 1))
        cursor_y = float(pad)
        for b in sorted_boxes:
            b.y = cursor_y
            cursor_y += b.h + spacing
        print(f"[FlexLayout] Redistributed {len(sorted_boxes)} boxes across canvas (was {used_ratio:.0%}, padding={pad})")
        return
    for i in range(1, len(sorted_boxes)):
        prev = sorted_boxes[i - 1]
        curr = sorted_boxes[i]
        prev_bottom = prev.y + prev.h
        if curr.y < prev_bottom:
            curr.y = prev_bottom + 2
            print(f"[FlexLayout] Fixed overlap: pushed '{curr.id}' down to y={curr.y:.0f}")
    for b in boxes:
        if any(kw in (b.id or "").lower() for kw in _FOOTER_KEYWORDS):
            target_y = canvas_h - b.h - pad
            if target_y > b.y:
                print(f"[FlexLayout] Pinned footer '{b.id}' to bottom: y={b.y:.0f} → {target_y:.0f}")
                b.y = target_y


def _layout_node(node: FlexNode | dict, x: float, y: float, w: float, h: float, out: list[LayoutBox]) -> None:
    if isinstance(node, dict):
        node = _dict_to_flex_node(node)
    is_container = node.direction is not None and isinstance(node.children, list)

    if not is_container:
        margin = _safe_int(node.style.margin) if node.style and node.style.margin else 0
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

    # Emit a LayoutBox for containers with visual style (backgroundColor, gradientOverlay)
    # so the SVG renderer draws a background rect before children
    if node.style and (node.style.backgroundColor or node.style.gradientOverlay):
        out.append(LayoutBox(
            id=f"{node.id}-bg",
            type="container",
            x=x, y=y, w=w, h=h,
            style=node.style,
        ))

    children = node.children
    if not children:
        return

    gap = node.gap if node.gap is not None else 8
    padding = node.padding if node.padding is not None else 0

    inner_x = x + padding
    inner_y = y + padding
    inner_w = max(0, w - padding * 2)
    inner_h = max(0, h - padding * 2)

    is_row = node.direction == "row"
    main_size = inner_w if is_row else inner_h
    total_gap = gap * (len(children) - 1)
    available_main = max(0, main_size - total_gap)

    claimed_fraction = 0.0
    unsized_count = 0

    for child in children:
        pct = _parse_pct(child.width if is_row else child.height)
        if not math.isnan(pct):
            claimed_fraction += pct
        else:
            unsized_count += 1

    remaining_fraction = max(0, 1 - claimed_fraction)
    per_unsized = remaining_fraction / unsized_count if unsized_count > 0 else 0

    MIN_TEXT_HEIGHT = 40

    child_sizes = []
    for child in children:
        pct = _parse_pct(child.width if is_row else child.height)
        fraction = per_unsized if math.isnan(pct) else pct
        child_main = fraction * available_main
        if not is_row and child_main < MIN_TEXT_HEIGHT and (child.type == "text" or child.direction is not None):
            child_main = MIN_TEXT_HEIGHT
        child_sizes.append(child_main)

    total_children = sum(child_sizes) + total_gap
    justify = node.justifyContent or "start"
    extra_space = max(0, main_size - total_children)
    n = len(children)

    if justify == "end":
        start_offset = extra_space
        between_extra = 0.0
    elif justify == "center":
        start_offset = extra_space / 2
        between_extra = 0.0
    elif justify == "space-between" and n > 1:
        start_offset = 0.0
        between_extra = extra_space / (n - 1)
    elif justify == "space-evenly":
        between_extra = extra_space / (n + 1)
        start_offset = between_extra
    else:
        start_offset = 0.0
        between_extra = 0.0

    cursor = start_offset
    for i, child in enumerate(children):
        child_main = child_sizes[i]

        # Cross-axis sizing: respect child's explicit cross-axis dimension
        cross_size = inner_h if is_row else inner_w
        child_cross_pct = _parse_pct(child.height if is_row else child.width)
        child_cross = cross_size * child_cross_pct if not math.isnan(child_cross_pct) else cross_size

        # alignItems: position child on cross-axis
        align = node.alignItems or "stretch"
        if align == "stretch" or math.isnan(child_cross_pct):
            cross_offset = 0.0
            child_cross = cross_size  # stretch to fill
        elif align == "center":
            cross_offset = (cross_size - child_cross) / 2
        elif align == "end":
            cross_offset = cross_size - child_cross
        else:  # start
            cross_offset = 0.0

        child_x = (inner_x + cursor) if is_row else (inner_x + cross_offset)
        child_y = (inner_y + cross_offset) if is_row else (inner_y + cursor)
        child_w = child_main if is_row else child_cross
        child_h = child_cross if is_row else child_main

        _layout_node(child, child_x, child_y, child_w, child_h, out)

        cursor += child_main
        if i < len(children) - 1:
            cursor += gap + between_extra
