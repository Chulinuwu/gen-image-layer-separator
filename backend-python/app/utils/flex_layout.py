from __future__ import annotations

import math
from dataclasses import dataclass
from typing import Literal


@dataclass
class FlexNodeStyle:
    fontSize: Literal["xlarge", "large", "medium", "small", "xsmall"] | None = None
    fontWeight: str | None = None
    color: str | None = None
    strokeColor: str | None = None
    strokeWidth: int | None = None
    align: Literal["left", "center", "right"] | None = None
    backgroundColor: str | None = None


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


@dataclass
class LayoutBox:
    id: str
    type: Literal["text", "component"]
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
        style = FlexNodeStyle(**{k: v for k, v in style_raw.items() if k in FlexNodeStyle.__dataclass_fields__})
    elif isinstance(style_raw, FlexNodeStyle):
        style = style_raw
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
    )


def compute_flex_layout(root: FlexNode | dict, canvas_w: float, canvas_h: float) -> list[LayoutBox]:
    if isinstance(root, dict):
        root = _dict_to_flex_node(root)
    results: list[LayoutBox] = []
    _layout_node(root, 0, 0, canvas_w, canvas_h, results)
    return results


def _layout_node(node: FlexNode | dict, x: float, y: float, w: float, h: float, out: list[LayoutBox]) -> None:
    if isinstance(node, dict):
        node = _dict_to_flex_node(node)
    is_container = node.direction is not None and isinstance(node.children, list)

    if not is_container:
        out.append(LayoutBox(
            id=node.id,
            type=node.type or "text",
            x=x, y=y, w=w, h=h,
            text=node.text,
            label=node.label,
            style=node.style,
        ))
        return

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

    cursor = 0.0
    for i, child in enumerate(children):
        pct = _parse_pct(child.width if is_row else child.height)
        fraction = per_unsized if math.isnan(pct) else pct
        child_main = fraction * available_main

        child_x = inner_x + cursor if is_row else inner_x
        child_y = inner_y if is_row else inner_y + cursor
        child_w = child_main if is_row else inner_w
        child_h = inner_h if is_row else child_main

        _layout_node(child, child_x, child_y, child_w, child_h, out)

        cursor += child_main
        if i < len(children) - 1:
            cursor += gap
