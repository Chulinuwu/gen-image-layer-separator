from __future__ import annotations

import base64
from dataclasses import dataclass, field
from html import escape as html_escape
import re as _re
from pathlib import Path

from app.utils.flex_layout import LayoutBox, FlexNodeStyle
from app.utils.text_measure import measure_text, wrap_text, auto_fit_font_size
from app.utils.text_warp import render_warped_text, WarpConfig


def _hex_to_rgb(hex_color: str) -> tuple[int, int, int]:
    h = hex_color.lstrip("#")
    if len(h) == 3:
        h = h[0]*2 + h[1]*2 + h[2]*2
    try:
        return int(h[0:2], 16), int(h[2:4], 16), int(h[4:6], 16)
    except (ValueError, IndexError):
        return 128, 128, 128


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
    background_effects: list[dict] | None = None  # canvas-level fade/darken effects


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

def _resolve_font_size(style: FlexNodeStyle, box_h: float) -> int:
    raw = style.fontSize or "medium"
    if isinstance(raw, (int, float)):
        return max(12, int(raw))
    if isinstance(raw, str):
        try:
            return max(12, int(raw))
        except ValueError:
            pass
    ratio = FLEX_FONT_RATIO.get(raw, 0.5)
    return max(12, round(box_h * ratio))


def _parse_text_shadows(shadow_str: str) -> list[dict]:
    shadows = []
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

    box_padding = 20 if style.backgroundColor else 4
    max_text_width = box.w - box_padding * 2

    font_size = _resolve_font_size(style, box.h)
    lh_mult = style.lineHeight or 1.35
    min_fs = 12

    wrapped = wrap_text(text, max_text_width, font_size, font_weight)
    line_height = font_size * lh_mult
    total_text_height = len(wrapped.lines) * line_height

    while total_text_height > box.h and font_size > min_fs:
        font_size = max(min_fs, font_size - 2)
        wrapped = wrap_text(text, max_text_width, font_size, font_weight)
        line_height = font_size * lh_mult
        total_text_height = len(wrapped.lines) * line_height

    if style.maxLines and len(wrapped.lines) > style.maxLines:
        wrapped = type(wrapped)(
            lines=wrapped.lines[:style.maxLines],
            line_height=wrapped.line_height,
            total_height=wrapped.line_height * style.maxLines,
        )
        total_text_height = len(wrapped.lines) * line_height

    # Warp rendering: convert text to glyph paths and apply warp deformation
    if style.warpType and style.warpType != "none" and style.warpIntensity is not None:
        warp_config = WarpConfig(
            warp_type=style.warpType,
            intensity=style.warpIntensity,
            h_distortion=style.warpHDistortion or 0,
            v_distortion=style.warpVDistortion or 0,
        )
        try:
            warped_svg, text_width, text_height = render_warped_text(
                text=text,
                font_size=font_size,
                font_weight=font_weight,
                color=color,
                warp_config=warp_config,
                letter_spacing=style.letterSpacing or 0,
                stroke_color=style.strokeColor,
                stroke_width=style.strokeWidth,
            )
            if warped_svg:
                x_offset = box.x + (box.w - text_width) / 2
                y_offset = box.y + box.h * 0.75
                elements.append(f'<g transform="translate({x_offset:.1f},{y_offset:.1f})">{warped_svg}</g>')
                return defs, elements
        except Exception as e:
            print(f"[Warp] Failed for '{text}': {e}, falling back to normal text")

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

    stroke_attrs = ""
    if style.strokeColor:
        sr, sg, sb = _hex_to_rgb(style.strokeColor)
        stroke_lum = 0.299 * sr + 0.587 * sg + 0.114 * sb
        if stroke_lum < 200:
            sw = style.strokeWidth or max(3, round(font_size * 0.08))
            stroke_attrs = f' stroke="{_escape_xml(style.strokeColor)}" stroke-width="{sw}" stroke-linejoin="round" paint-order="stroke"'
    else:
        r, g, b = _hex_to_rgb(color)
        luminance = 0.299 * r + 0.587 * g + 0.114 * b
        auto_width = max(5, round(font_size * 0.18))
        if luminance < 128:
            stroke_attrs = f' stroke="#FFFFFF" stroke-width="{auto_width}" stroke-linejoin="round" paint-order="stroke"'

    extra_attrs = ""
    if style.letterSpacing:
        extra_attrs += f' letter-spacing="{style.letterSpacing}"'
    if style.opacity is not None and style.opacity < 1.0:
        extra_attrs += f' opacity="{style.opacity}"'
    if shadow_filter_id:
        extra_attrs += f' filter="url(#{shadow_filter_id})"'

    metrics = measure_text(text, font_size, font_weight)
    baseline_y = box.y + offset_y + metrics.ascent

    fill_value = _escape_xml(color)
    if style.textGradient:
        grad_id = f"textgrad-{clip_id}"
        parsed = _parse_gradient(style.textGradient, grad_id)
        if parsed:
            defs_snippet, _ = parsed
            defs.append(f"    {defs_snippet.lstrip()}")
            fill_value = f"url(#{grad_id})"

    skew_transforms = []
    if style.skewX:
        skew_transforms.append(f"skewX({style.skewX})")
    if style.skewY:
        skew_transforms.append(f"skewY({style.skewY})")
    skew_wrap = bool(skew_transforms)
    if skew_wrap:
        elements.append(f'  <g transform="{" ".join(skew_transforms)}">')

    indent = "    " if skew_wrap else "  "
    inner_indent = "      " if skew_wrap else "    "
    elements.append(
        f'{indent}<text id="{_escape_xml(box.id)}" data-role="text" clip-path="url(#{clip_id})" '
        f'font-family="Kanit, sans-serif" font-size="{font_size}" font-weight="{font_weight}" '
        f'fill="{fill_value}"{stroke_attrs}{extra_attrs} text-anchor="{anchor}">'
    )

    for i, line in enumerate(wrapped.lines):
        if i == 0:
            elements.append(f'{inner_indent}<tspan x="{text_x}" y="{baseline_y}">{_escape_xml(line)}</tspan>')
        else:
            elements.append(f'{inner_indent}<tspan x="{text_x}" dy="{line_height}">{_escape_xml(line)}</tspan>')

    elements.append(f"{indent}</text>")
    if skew_wrap:
        elements.append("  </g>")
    return defs, elements


def _parse_gradient(spec: str, grad_id: str) -> tuple[str, str] | None:
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


def _render_background_effects(effects: list[dict], cw: int, ch: int) -> tuple[list[str], list[str]]:
    """Render canvas-level background effects (fades, vignettes).

    Returns (defs_lines, rect_lines) to insert into SVG.
    """
    defs: list[str] = []
    rects: list[str] = []

    for i, fx in enumerate(effects):
        fx_type = fx.get("type", "")
        color = fx.get("color", "rgba(0,0,0,0.5)")

        rgba = _re.match(r"rgba?\((\d+),\s*(\d+),\s*(\d+)(?:,\s*([\d.]+))?\)", color)
        if rgba:
            rgb = f"rgb({rgba.group(1)},{rgba.group(2)},{rgba.group(3)})"
            opacity = rgba.group(4) or "1"
        else:
            rgb = color
            opacity = "1"

        if fx_type == "linear-fade":
            grad_id = f"bg-fade-{i}"
            direction = fx.get("from", "bottom")
            size_pct = min(100, max(10, int(fx.get("size", "40").replace("%", ""))))

            if direction == "bottom":
                start_offset = f"{100 - size_pct}%"
                coords = 'x1="0" y1="0" x2="0" y2="1"'
            elif direction == "top":
                start_offset = f"{size_pct}%"
                coords = 'x1="0" y1="1" x2="0" y2="0"'
            elif direction == "left":
                start_offset = f"{size_pct}%"
                coords = 'x1="1" y1="0" x2="0" y2="0"'
            elif direction == "right":
                start_offset = f"{100 - size_pct}%"
                coords = 'x1="0" y1="0" x2="1" y2="0"'
            else:
                continue

            defs.append(
                f'    <linearGradient id="{grad_id}" {coords}>'
                f'<stop offset="0%" stop-color="{rgb}" stop-opacity="0"/>'
                f'<stop offset="{start_offset}" stop-color="{rgb}" stop-opacity="0"/>'
                f'<stop offset="100%" stop-color="{rgb}" stop-opacity="{opacity}"/>'
                f'</linearGradient>'
            )
            rects.append(f'  <rect x="0" y="0" width="{cw}" height="{ch}" fill="url(#{grad_id})"/>')

        elif fx_type == "radial-fade":
            grad_id = f"bg-radial-{i}"
            center = fx.get("center", "50% 50%")
            radius = fx.get("radius", "70%")

            cx_str, cy_str = center.split()
            cx = cx_str.replace("%", "")
            cy = cy_str.replace("%", "")
            r = radius.replace("%", "")

            defs.append(
                f'    <radialGradient id="{grad_id}" cx="{cx}%" cy="{cy}%" r="{r}%" fx="{cx}%" fy="{cy}%">'
                f'<stop offset="0%" stop-color="{rgb}" stop-opacity="0"/>'
                f'<stop offset="60%" stop-color="{rgb}" stop-opacity="0"/>'
                f'<stop offset="100%" stop-color="{rgb}" stop-opacity="{opacity}"/>'
                f'</radialGradient>'
            )
            rects.append(f'  <rect x="0" y="0" width="{cw}" height="{ch}" fill="url(#{grad_id})"/>')

    return defs, rects


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

    # Background effects (canvas-level fades, vignettes)
    bg_effect_defs: list[str] = []
    bg_effect_rects: list[str] = []
    if input.background_effects:
        bg_effect_defs, bg_effect_rects = _render_background_effects(input.background_effects, cw, ch)

    font_css = _kanit_font_style()
    svg_lines.append("  <defs>")
    if font_css:
        svg_lines.append(f"    <style>{font_css}</style>")
    for d in bg_effect_defs:
        svg_lines.append(f"  {d.lstrip()}")

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

    # Gradient overlay defs
    gradient_overlays: list[tuple] = []  # (box, grad_id)
    for box in boxes:
        if box.style and box.style.gradientOverlay:
            grad_id = f"grad-{box.id}"
            parsed = _parse_gradient(box.style.gradientOverlay, grad_id)
            if parsed:
                defs_snippet, _ = parsed
                svg_lines.append(f"  {defs_snippet.lstrip()}")
                gradient_overlays.append((box, grad_id))

    svg_lines.append("  </defs>")

    # Background effects (full-canvas fades/vignettes, rendered right after bg image)
    for r in bg_effect_rects:
        svg_lines.append(r)

    # Background rects (+ optional border outline)
    CTA_KEYWORDS = {"cta", "button", "btn"}
    for box in boxes:
        if not box.style:
            continue
        has_bg = bool(box.style.backgroundColor)
        has_border = bool(box.style.borderWidth and box.style.borderColor)
        if not (has_bg or has_border):
            continue
        rx = 0
        if box.style.borderRadius is not None:
            rx = box.style.borderRadius
        elif any(kw in (box.id or "").lower() for kw in CTA_KEYWORDS):
            rx = min(12, box.h / 2)
        rx_attr = f' rx="{rx:.0f}" ry="{rx:.0f}"' if rx > 0 else ""
        opacity_attr = ""
        if box.style.opacity is not None and box.style.opacity < 1.0:
            opacity_attr = f' opacity="{box.style.opacity}"'
        fill_attr = (
            f'fill="{_escape_xml(box.style.backgroundColor)}"' if has_bg else 'fill="none"'
        )
        stroke_attr = ""
        if has_border:
            stroke_attr = (
                f' stroke="{_escape_xml(box.style.borderColor)}" '
                f'stroke-width="{int(box.style.borderWidth)}"'
            )
            if (box.style.borderStyle or "").lower() == "dashed":
                dash = max(4, int(box.style.borderWidth) * 3)
                stroke_attr += f' stroke-dasharray="{dash},{dash}"'
        svg_lines.append(
            f'  <rect x="{box.x}" y="{box.y}" width="{box.w}" height="{box.h}"{rx_attr} '
            f'{fill_attr}{stroke_attr}{opacity_attr} />'
        )

    # Gradient overlays (between background and content for readability)
    for box, grad_id in gradient_overlays:
        svg_lines.append(
            f'  <rect x="{box.x}" y="{box.y}" width="{box.w}" height="{box.h}" '
            f'fill="url(#{grad_id})"/>'
        )

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

    # Text elements
    for el in all_text_elements:
        svg_lines.append(f"  {el.lstrip()}")

    svg_lines.append("</svg>")

    return FlexSVGResult(svg="\n".join(svg_lines), boxes=boxes)
