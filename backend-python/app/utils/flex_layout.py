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


def compute_flex_layout(root: FlexNode, canvas_w: float, canvas_h: float) -> list[LayoutBox]:
    results: list[LayoutBox] = []
    _layout_node(root, 0, 0, canvas_w, canvas_h, results)
    return results


def _layout_node(node: FlexNode, x: float, y: float, w: float, h: float, out: list[LayoutBox]) -> None:
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
