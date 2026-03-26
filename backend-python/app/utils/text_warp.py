from __future__ import annotations

import math
import re
from dataclasses import dataclass
from pathlib import Path

FONT_DIR = Path(__file__).parent.parent.parent / "assets" / "fonts"
FONT_MAP = {
    "400": "Kanit-Regular.ttf",
    "700": "Kanit-Bold.ttf",
    "900": "Kanit-Black.ttf",
}


@dataclass
class WarpConfig:
    warp_type: str  # 15 Photoshop presets + "none"
    intensity: float  # -100 to 100
    h_distortion: float = 0  # -100 to 100
    v_distortion: float = 0  # -100 to 100


@dataclass
class GlyphPath:
    d: str
    x: float
    y: float
    width: float
    height: float


def _get_font_path(weight: str) -> Path:
    filename = FONT_MAP.get(weight, FONT_MAP["700"])
    return FONT_DIR / filename


def text_to_glyph_paths(
    text: str,
    font_size: float,
    font_weight: str = "700",
    letter_spacing: float = 0,
) -> list[GlyphPath]:
    import freetype

    face = freetype.Face(str(_get_font_path(font_weight)))
    face.set_char_size(int(font_size * 64))

    paths: list[GlyphPath] = []
    pen_x = 0.0

    for char in text:
        face.load_char(char, freetype.FT_LOAD_NO_BITMAP)
        outline = face.glyph.outline

        if outline.n_points == 0:
            pen_x += face.glyph.advance.x / 64.0 + letter_spacing
            continue

        points = outline.points
        tags = outline.tags
        contours = outline.contours

        d = ""
        start = 0
        for contour_end in contours:
            contour_points = points[start : contour_end + 1]
            contour_tags = tags[start : contour_end + 1]

            first_on = None
            for idx, tag in enumerate(contour_tags):
                if tag & 1:
                    first_on = idx
                    break

            if first_on is None:
                mid_x = (contour_points[0][0] + contour_points[1][0]) / 2
                mid_y = (contour_points[0][1] + contour_points[1][1]) / 2
                d += f"M{(pen_x + mid_x / 64.0):.2f},{(-mid_y / 64.0):.2f}"
                first_on = 0
            else:
                px = pen_x + contour_points[first_on][0] / 64.0
                py = -contour_points[first_on][1] / 64.0
                d += f"M{px:.2f},{py:.2f}"

            n = len(contour_points)
            i = (first_on + 1) % n
            visited = 0
            while visited < n:
                if i == first_on:
                    break

                tag = contour_tags[i]
                px = pen_x + contour_points[i][0] / 64.0
                py = -contour_points[i][1] / 64.0

                if tag & 1:
                    d += f"L{px:.2f},{py:.2f}"
                    i = (i + 1) % n
                    visited += 1
                else:
                    next_i = (i + 1) % n
                    next_tag = contour_tags[next_i]
                    next_px = pen_x + contour_points[next_i][0] / 64.0
                    next_py = -contour_points[next_i][1] / 64.0

                    if next_tag & 1:
                        d += f"Q{px:.2f},{py:.2f},{next_px:.2f},{next_py:.2f}"
                        i = (next_i + 1) % n
                        visited += 2
                    else:
                        mid_x = (px + next_px) / 2
                        mid_y = (py + next_py) / 2
                        d += f"Q{px:.2f},{py:.2f},{mid_x:.2f},{mid_y:.2f}"
                        i = next_i
                        visited += 1

            d += "Z"
            start = contour_end + 1

        paths.append(
            GlyphPath(
                d=d,
                x=pen_x,
                y=0,
                width=face.glyph.advance.x / 64.0,
                height=font_size,
            )
        )

        pen_x += face.glyph.advance.x / 64.0 + letter_spacing

    return paths


def _warp_point(
    x: float,
    y: float,
    total_width: float,
    total_height: float,
    config: WarpConfig,
) -> tuple[float, float]:
    if config.warp_type == "none" or (config.intensity == 0 and config.h_distortion == 0 and config.v_distortion == 0):
        return x, y

    tw = total_width if total_width > 0 else 1
    th = total_height if total_height > 0 else 1
    t = x / tw
    s = y / th
    bend = config.intensity / 100.0

    wx, wy = x, y

    if config.warp_type == "arc":
        wy = y - bend * th * 0.5 * 4 * t * (1 - t)

    elif config.warp_type == "arc_lower":
        curve = bend * th * 0.5 * 4 * t * (1 - t)
        wy = y - curve * s

    elif config.warp_type == "arc_upper":
        curve = bend * th * 0.5 * 4 * t * (1 - t)
        wy = y - curve * (1 - s)

    elif config.warp_type == "arch":
        curve = 4 * t * (1 - t)
        wy = y - bend * th * 0.5 * curve
        cx = tw / 2
        squeeze = 1.0 - abs(bend) * 0.3 * curve
        wx = cx + (x - cx) * squeeze

    elif config.warp_type == "bulge":
        cx, cy = tw / 2, th / 2
        dx, dy = x - cx, y - cy
        dist = math.sqrt(dx * dx + dy * dy) if (dx or dy) else 0
        max_dist = math.sqrt(cx * cx + cy * cy) if (cx or cy) else 1
        r = dist / max_dist
        factor = 1.0 + bend * 0.5 * (1 - r)
        wx = cx + dx * factor
        wy = cy + dy * factor

    elif config.warp_type == "shell_lower":
        curve = math.sin(math.pi * t)
        wy = y - bend * th * 0.4 * curve * s
        cx = tw / 2
        wx = cx + (x - cx) * (1 + bend * 0.15 * s)

    elif config.warp_type == "shell_upper":
        curve = math.sin(math.pi * t)
        wy = y - bend * th * 0.4 * curve * (1 - s)
        cx = tw / 2
        wx = cx + (x - cx) * (1 + bend * 0.15 * (1 - s))

    elif config.warp_type == "flag":
        wy = y - bend * th * 0.4 * t * math.sin(t * math.pi * 3)

    elif config.warp_type == "wave":
        wy = y - bend * th * 0.3 * math.sin(t * math.pi * 4)

    elif config.warp_type == "fish":
        cx, cy = tw / 2, th / 2
        dx, dy = x - cx, y - cy
        dist = math.sqrt(dx * dx + dy * dy) if (dx or dy) else 0
        max_dist = math.sqrt(cx * cx + cy * cy) if (cx or cy) else 1
        r = dist / max_dist
        r_new = r * (1 + bend * 0.5 * r * r)
        if dist > 0:
            scale = (r_new / r) if r > 0 else 1
            wx = cx + dx * scale
            wy = cy + dy * scale

    elif config.warp_type == "rise":
        wy = y - bend * th * 0.5 * t

    elif config.warp_type == "fisheye":
        cx, cy = tw / 2, th / 2
        dx, dy = x - cx, y - cy
        dist = math.sqrt(dx * dx + dy * dy) if (dx or dy) else 0
        max_dist = max(cx, cy) if (cx or cy) else 1
        r = dist / max_dist
        power = 1.0 + bend * 0.8
        r_new = math.pow(r, power) if r > 0 else 0
        if dist > 0:
            scale = (r_new * max_dist) / dist
            wx = cx + dx * scale
            wy = cy + dy * scale

    elif config.warp_type == "inflate":
        cx, cy = tw / 2, th / 2
        dx, dy = x - cx, y - cy
        dist = math.sqrt(dx * dx + dy * dy) if (dx or dy) else 0
        max_dist = math.sqrt(cx * cx + cy * cy) if (cx or cy) else 1
        r = dist / max_dist
        push = bend * 0.4 * (1 - r * r)
        if dist > 0:
            wx = x + dx / dist * push * max_dist * 0.3
            wy = y + dy / dist * push * max_dist * 0.3

    elif config.warp_type == "squeeze":
        cx = tw / 2
        cy = th / 2
        h_factor = 1.0 - bend * 0.4 * (1 - abs(2 * t - 1))
        v_factor = 1.0 + bend * 0.3 * (1 - abs(2 * t - 1))
        wx = cx + (x - cx) * h_factor
        wy = cy + (y - cy) * v_factor

    elif config.warp_type == "twist":
        cx, cy = tw / 2, th / 2
        dx, dy = x - cx, y - cy
        dist = math.sqrt(dx * dx + dy * dy) if (dx or dy) else 0
        max_dist = math.sqrt(cx * cx + cy * cy) if (cx or cy) else 1
        r = dist / max_dist
        angle = bend * math.pi * 0.5 * r
        cos_a = math.cos(angle)
        sin_a = math.sin(angle)
        wx = cx + dx * cos_a - dy * sin_a
        wy = cy + dx * sin_a + dy * cos_a

    if config.h_distortion != 0:
        h = config.h_distortion / 100.0
        cy = th / 2
        factor = 1.0 + h * ((wy - cy) / th if th > 0 else 0)
        cx = tw / 2
        wx = cx + (wx - cx) * factor

    if config.v_distortion != 0:
        v = config.v_distortion / 100.0
        cx = tw / 2
        factor = 1.0 + v * ((wx - cx) / tw if tw > 0 else 0)
        cy = th / 2
        wy = cy + (wy - cy) * factor

    return wx, wy


def _warp_path_data(
    d: str, total_width: float, total_height: float, config: WarpConfig
) -> str:
    if config.warp_type == "none" or (config.intensity == 0 and config.h_distortion == 0 and config.v_distortion == 0):
        return d

    tokens = re.findall(r"[MmLlHhVvCcSsQqTtAaZz]|[-+]?[0-9]*\.?[0-9]+", d)

    result: list[str] = []
    i = 0
    while i < len(tokens):
        token = tokens[i]
        if token in "MLQCSZmlqcszTtHhVvAa":
            result.append(token)
            i += 1
        else:
            x = float(token)
            if i + 1 < len(tokens) and tokens[i + 1] not in "MLQCSZmlqcszTtHhVvAa":
                y = float(tokens[i + 1])
                wx, wy = _warp_point(x, y, total_width, total_height, config)
                result.append(f"{wx:.2f}")
                result.append(f"{wy:.2f}")
                i += 2
            else:
                result.append(token)
                i += 1

    return " ".join(result)


def render_warped_text(
    text: str,
    font_size: float,
    font_weight: str = "700",
    color: str = "#FFFFFF",
    warp_config: WarpConfig | None = None,
    letter_spacing: float = 0,
    stroke_color: str | None = None,
    stroke_width: float | None = None,
) -> tuple[str, float, float]:
    """
    Render text as warped SVG path elements.

    Returns (svg_group_string, total_width, total_height).
    The svg_group_string is a <g> element containing <path> elements.
    Returns empty string if no warp needed (caller should use normal text rendering).
    """
    if not warp_config or warp_config.warp_type == "none":
        return "", 0, 0

    glyphs = text_to_glyph_paths(text, font_size, font_weight, letter_spacing)
    if not glyphs:
        return "", 0, 0

    total_width = sum(g.width for g in glyphs)
    total_height = font_size

    combined_d = " ".join(g.d for g in glyphs)
    warped_d = _warp_path_data(combined_d, total_width, total_height, warp_config)

    attrs = f'fill="{color}"'
    if stroke_color and stroke_width:
        attrs += f' stroke="{stroke_color}" stroke-width="{stroke_width}" stroke-linejoin="round" paint-order="stroke"'

    svg = f'<g><path d="{warped_d}" {attrs} /></g>'

    return svg, total_width, total_height


__all__ = ["WarpConfig", "render_warped_text", "text_to_glyph_paths"]
