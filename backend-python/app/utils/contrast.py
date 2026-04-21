from __future__ import annotations
from PIL import Image
import io


def relative_luminance(r: int, g: int, b: int) -> float:
    def _lin(c: int) -> float:
        s = c / 255.0
        return s / 12.92 if s <= 0.04045 else ((s + 0.055) / 1.055) ** 2.4
    return 0.2126 * _lin(r) + 0.7152 * _lin(g) + 0.0722 * _lin(b)


def contrast_ratio(color1: tuple[int, int, int], color2: tuple[int, int, int]) -> float:
    l1 = relative_luminance(*color1)
    l2 = relative_luminance(*color2)
    lighter = max(l1, l2)
    darker = min(l1, l2)
    return (lighter + 0.05) / (darker + 0.05)


def _hex_to_rgb(hex_color: str) -> tuple[int, int, int] | None:
    import re
    hex_color = hex_color.strip()
    # Handle rgb/rgba
    m = re.match(r"rgba?\((\d+),\s*(\d+),\s*(\d+)", hex_color)
    if m:
        return int(m.group(1)), int(m.group(2)), int(m.group(3))
    # Handle hex
    h = hex_color.lstrip("#")
    if len(h) == 3:
        h = h[0] * 2 + h[1] * 2 + h[2] * 2
    if len(h) < 6:
        return None
    try:
        return int(h[0:2], 16), int(h[2:4], 16), int(h[4:6], 16)
    except ValueError:
        return None


def _sample_avg_color(img: Image.Image, x: int, y: int, w: int, h: int) -> tuple[int, int, int]:
    x = max(0, min(x, img.width - 1))
    y = max(0, min(y, img.height - 1))
    x2 = max(x + 1, min(x + w, img.width))
    y2 = max(y + 1, min(y + h, img.height))
    region = img.crop((x, y, x2, y2)).convert("RGB")
    pixels = list(
        region.get_flattened_data() if hasattr(region, "get_flattened_data") else region.getdata()
    )
    if not pixels:
        return (0, 0, 0)
    r = sum(p[0] for p in pixels) // len(pixels)
    g = sum(p[1] for p in pixels) // len(pixels)
    b = sum(p[2] for p in pixels) // len(pixels)
    return (r, g, b)


# WCAG 2.1 SC 1.4.3 thresholds. Large text: >= 24px regular OR >= 18.66px bold (weight >= 700).
# Reference: https://www.w3.org/TR/WCAG21/#contrast-minimum
_WCAG_AA_NORMAL = 4.5
_WCAG_AA_LARGE = 3.0
_WCAG_AAA_NORMAL = 7.0
_WCAG_AAA_LARGE = 4.5
_LARGE_TEXT_PX = 24.0
_LARGE_BOLD_PX = 18.66


def _is_large_text(font_size_px: float | None, font_weight: int | str | None) -> bool:
    if not font_size_px:
        return False
    if font_size_px >= _LARGE_TEXT_PX:
        return True
    try:
        w = int(font_weight) if font_weight is not None else 400
    except (TypeError, ValueError):
        w = 400
    return w >= 700 and font_size_px >= _LARGE_BOLD_PX


def check_text_contrast(
    image_bytes: bytes,
    text_boxes: list[dict],
) -> list[dict]:
    """Measure text-vs-background contrast from the rendered image.

    `image_bytes` must be the composited preview (BG with SVG overlay) so sampled
    background includes container fills, gradient overlays, and drop shadows —
    i.e. the pixels the viewer actually sees. Passing the raw BG before overlay
    compositing produces false positives when containers (cards, pills, price
    boxes) provide the real contrast.

    Each text_box may include optional "font_size" (px) and "font_weight"
    (100-900) so the WCAG threshold is chosen per text per SC 1.4.3.
    """
    img = Image.open(io.BytesIO(image_bytes)).convert("RGB")
    results = []
    for box in text_boxes:
        fg = _hex_to_rgb(box["color"])
        if fg is None:
            continue
        bg = _sample_avg_color(
            img,
            int(box["x"]), int(box["y"]),
            int(box["w"]), int(box["h"]),
        )
        ratio = contrast_ratio(fg, bg)
        large = _is_large_text(box.get("font_size"), box.get("font_weight"))
        aa_threshold = _WCAG_AA_LARGE if large else _WCAG_AA_NORMAL
        aaa_threshold = _WCAG_AAA_LARGE if large else _WCAG_AAA_NORMAL
        results.append({
            "id": box["id"],
            "ratio": round(ratio, 2),
            "pass_aa": ratio >= aa_threshold,
            "pass_aaa": ratio >= aaa_threshold,
            "aa_threshold": aa_threshold,
            "large_text": large,
            "fg": f"rgb{fg}",
            "bg": f"rgb{bg}",
        })
    return results
