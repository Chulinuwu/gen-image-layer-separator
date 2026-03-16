from __future__ import annotations

import base64
from dataclasses import dataclass, field
from html import escape as html_escape
from pathlib import Path

from app.utils.flex_layout import LayoutBox, FlexNodeStyle
from app.utils.text_measure import measure_text, wrap_text, auto_fit_font_size


def _kanit_font_style() -> str:
    font_dir = Path(__file__).parent.parent.parent / "assets" / "fonts"
    style = ""
    for weight, filename in [("400", "Kanit-Regular.ttf"), ("700", "Kanit-Bold.ttf"), ("900", "Kanit-Black.ttf")]:
        font_path = font_dir / filename
        if font_path.exists():
            b64 = base64.b64encode(font_path.read_bytes()).decode()
            style += f"@font-face{{font-family:'Kanit';font-weight:{weight};src:url('data:font/ttf;base64,{b64}') format('truetype');}}"
    return style

# ── Interfaces ──

@dataclass
class TextBlock:
    text: str
    role: str  # promo, headline, subheadline, body, offer, fineprint
    fontSize: int
    fontWeight: str
    color: str
    strokeColor: str | None = None
    strokeWidth: int | None = None
    align: str = "left"


@dataclass
class LayoutIntent:
    blocks: list[TextBlock]
    textZone: dict  # {x, y, w, h}
    canvasSize: dict  # {w, h}


@dataclass
class BuildSVGResult:
    svg: str
    blocks: list[dict]


@dataclass
class FlexSVGInput:
    boxes: list[LayoutBox]
    canvas_w: int
    canvas_h: int
    bg_image_url: str | None = None
    component_images: dict[str, str] | None = None


@dataclass
class FlexSVGResult:
    svg: str
    boxes: list[LayoutBox]


# ── Helpers ──

MIN_FONT_SIZES = {"promo": 40, "headline": 20, "subheadline": 18, "body": 16, "offer": 20, "fineprint": 10}
ROLE_GAP_FACTOR = {"promo": 0, "headline": 0.3, "subheadline": 0.3, "body": 0.2, "offer": 0.2, "fineprint": 0.5}

FLEX_FONT_RATIO = {"xlarge": 1.0, "large": 0.75, "medium": 0.5, "small": 0.35, "xsmall": 0.22}


def _escape_xml(s: str) -> str:
    return s.replace("&", "&amp;").replace("<", "&lt;").replace(">", "&gt;").replace('"', "&quot;").replace("'", "&apos;")


def _anchor_for_align(align: str) -> str:
    if align == "center":
        return "middle"
    if align == "right":
        return "end"
    return "start"


# ── buildSVG (text-zone based) ──

def build_svg(intent: LayoutIntent) -> BuildSVGResult:
    zone = intent.textZone
    canvas = intent.canvasSize
    max_text_width = zone["w"] * 0.95
    padding = zone["h"] * 0.03

    measured = _measure_all_blocks(intent.blocks, max_text_width)
    placements, total_used = _compute_vertical_stack(measured, zone, padding)

    available_h = zone["h"] - padding * 2
    if total_used > available_h:
        scale = (available_h / total_used) * 0.95
        scaled = [
            TextBlock(
                text=b.text, role=b.role,
                fontSize=max(round(b.fontSize * scale), MIN_FONT_SIZES.get(b.role, 10)),
                fontWeight=b.fontWeight, color=b.color,
                strokeColor=b.strokeColor, strokeWidth=b.strokeWidth, align=b.align,
            )
            for b in intent.blocks
        ]
        measured = _measure_all_blocks(scaled, max_text_width)
        placements, total_used = _compute_vertical_stack(measured, zone, padding)

    lines: list[str] = []
    lines.append(f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 {canvas["w"]} {canvas["h"]}" width="{canvas["w"]}" height="{canvas["h"]}">')
    lines.append("  <defs>")
    lines.append('    <filter id="textShadow">')
    lines.append('      <feDropShadow dx="0" dy="2" stdDeviation="3" flood-color="#000000" flood-opacity="0.5" />')
    lines.append("    </filter>")
    lines.append(f'    <clipPath id="zoneClip">')
    lines.append(f'      <rect x="{zone["x"]}" y="{zone["y"]}" width="{zone["w"]}" height="{zone["h"]}" />')
    lines.append("    </clipPath>")
    lines.append("  </defs>")
    lines.append('  <g clip-path="url(#zoneClip)">')

    result_blocks: list[dict] = []
    for p in placements:
        align = p["align"]
        anchor = _anchor_for_align(align)

        if align == "center":
            block_x = zone["x"] + zone["w"] / 2
        elif align == "right":
            block_x = zone["x"] + zone["w"] - padding
        else:
            block_x = zone["x"] + padding

        block_y = p["y"] + p["ascent"]
        filter_attr = ' filter="url(#textShadow)"' if p["role"] != "fineprint" else ""

        stroke_attrs = ""
        if p.get("strokeColor"):
            sw = p.get("strokeWidth", 1)
            stroke_attrs = f' stroke="{_escape_xml(p["strokeColor"])}" stroke-width="{sw}" paint-order="stroke"'

        lines.append(f'  <g id="block-{p["role"]}-{len(result_blocks)}" transform="translate({block_x}, {block_y})"{filter_attr}>')
        lines.append(f'    <text font-family="Kanit, sans-serif" font-size="{p["fontSize"]}" font-weight="{p["fontWeight"]}" fill="{_escape_xml(p["color"])}"{stroke_attrs} text-anchor="{anchor}">')

        for i, line in enumerate(p["lines"]):
            dy = "0" if i == 0 else str(p["lineHeight"])
            lines.append(f'      <tspan x="0" dy="{dy}">{_escape_xml(line)}</tspan>')

        lines.append("    </text>")
        lines.append("  </g>")

        result_blocks.append({
            "role": p["role"], "text": p["text"], "x": block_x, "y": p["y"],
            "fontSize": p["fontSize"], "lines": p["lines"],
            "measuredWidth": p["measuredWidth"], "measuredHeight": p["totalHeight"],
        })

    lines.append("  </g>")
    lines.append("</svg>")

    return BuildSVGResult(svg="\n".join(lines), blocks=result_blocks)


def _measure_all_blocks(blocks: list[TextBlock], max_text_width: float) -> list[dict]:
    result = []
    for block in blocks:
        min_fs = MIN_FONT_SIZES.get(block.role, 10)
        align = block.align or "left"

        fitted = auto_fit_font_size(block.text, max_text_width, block.fontSize, min_fs, block.fontWeight)
        is_promo = block.role == "promo"

        if is_promo and fitted.width <= max_text_width:
            metrics = measure_text(block.text, fitted.font_size, block.fontWeight)
            result.append({
                "role": block.role, "text": block.text, "fontSize": fitted.font_size,
                "fontWeight": block.fontWeight, "color": block.color,
                "strokeColor": block.strokeColor, "strokeWidth": block.strokeWidth,
                "align": align, "lines": [block.text],
                "lineHeight": fitted.font_size * 1.35, "totalHeight": fitted.font_size * 1.35,
                "measuredWidth": fitted.width, "ascent": metrics.ascent,
            })
            continue

        use_size = min_fs if is_promo else fitted.font_size
        wrapped = wrap_text(block.text, max_text_width, use_size, block.fontWeight)
        metrics = measure_text(block.text, use_size, block.fontWeight)

        max_line_w = max((measure_text(line, use_size, block.fontWeight).width for line in wrapped.lines), default=0)

        result.append({
            "role": block.role, "text": block.text, "fontSize": use_size,
            "fontWeight": block.fontWeight, "color": block.color,
            "strokeColor": block.strokeColor, "strokeWidth": block.strokeWidth,
            "align": align, "lines": wrapped.lines,
            "lineHeight": wrapped.line_height, "totalHeight": wrapped.total_height,
            "measuredWidth": max_line_w, "ascent": metrics.ascent,
        })
    return result


def _compute_vertical_stack(measured: list[dict], zone: dict, padding: float) -> tuple[list[dict], float]:
    placements = []
    cursor_y = zone["y"] + padding

    for i, m in enumerate(measured):
        if i > 0:
            gap_factor = ROLE_GAP_FACTOR.get(m["role"], 0.2)
            cursor_y += m["fontSize"] * gap_factor

        placements.append({**m, "y": cursor_y})
        cursor_y += m["totalHeight"]

    total_used = cursor_y - (zone["y"] + padding)
    return placements, total_used


# ── buildFlexSVG ──

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

    ratio = FLEX_FONT_RATIO.get(style.fontSize or "medium", 0.5)
    box_padding = 20 if style.backgroundColor else 4
    max_text_width = box.w - box_padding * 2

    start_font = round(box.h * ratio)
    min_font = max(12, round(start_font * 0.15))

    font_size = max(min_font, start_font)
    wrapped = wrap_text(text, max_text_width, font_size, font_weight)

    while wrapped.total_height > box.h * 0.95 and font_size > min_font:
        font_size = max(min_font, round(font_size * 0.9))
        wrapped = wrap_text(text, max_text_width, font_size, font_weight)

    line_height = font_size * 1.35
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

    stroke_attrs = ""
    if style.strokeColor:
        sw = style.strokeWidth or 2
        stroke_attrs = f' stroke="{_escape_xml(style.strokeColor)}" stroke-width="{sw}" paint-order="stroke"'

    metrics = measure_text(text, font_size, font_weight)
    baseline_y = box.y + offset_y + metrics.ascent

    elements.append(
        f'  <text id="{_escape_xml(box.id)}" data-role="text" clip-path="url(#{clip_id})" '
        f'font-family="Kanit, sans-serif" font-size="{font_size}" font-weight="{font_weight}" '
        f'fill="{_escape_xml(color)}"{stroke_attrs} text-anchor="{anchor}">'
    )

    for i, line in enumerate(wrapped.lines):
        if i == 0:
            elements.append(f'    <tspan x="{text_x}" y="{baseline_y}">{_escape_xml(line)}</tspan>')
        else:
            elements.append(f'    <tspan x="{text_x}" dy="{line_height}">{_escape_xml(line)}</tspan>')

    elements.append("  </text>")
    return defs, elements


def build_flex_svg(input: FlexSVGInput) -> FlexSVGResult:
    boxes = input.boxes
    cw, ch = input.canvas_w, input.canvas_h

    svg_lines: list[str] = []
    svg_lines.append(
        f'<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" '
        f'viewBox="0 0 {cw} {ch}" width="{cw}" height="{ch}">'
    )

    if input.bg_image_url:
        svg_lines.append(
            f'  <image href="{_escape_xml(input.bg_image_url)}" x="0" y="0" width="{cw}" height="{ch}" preserveAspectRatio="xMidYMid slice" />'
        )

    font_css = _kanit_font_style()
    svg_lines.append("  <defs>")
    if font_css:
        svg_lines.append(f"    <style>{font_css}</style>")

    all_text_elements: list[str] = []
    clip_idx = 0

    for box in boxes:
        if box.type == "text":
            clip_id = f"flex-clip-{clip_idx}"
            clip_idx += 1
            box_defs, box_elements = _render_text_box(box, clip_id)
            for d in box_defs:
                svg_lines.append(f"  {d.lstrip()}")
            all_text_elements.extend(box_elements)

    svg_lines.append("  </defs>")

    # Background rects (rounded for CTA-like elements)
    CTA_KEYWORDS = {"cta", "button", "btn"}
    for box in boxes:
        if box.style and box.style.backgroundColor:
            is_cta = any(kw in (box.id or "").lower() for kw in CTA_KEYWORDS)
            rx = min(12, box.h / 2) if is_cta else 0
            rx_attr = f' rx="{rx:.0f}" ry="{rx:.0f}"' if rx > 0 else ""
            svg_lines.append(
                f'  <rect x="{box.x}" y="{box.y}" width="{box.w}" height="{box.h}"{rx_attr} '
                f'fill="{_escape_xml(box.style.backgroundColor)}" />'
            )

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

    # Text elements
    for el in all_text_elements:
        svg_lines.append(f"  {el.lstrip()}")

    svg_lines.append("</svg>")

    return FlexSVGResult(svg="\n".join(svg_lines), boxes=boxes)
