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


def _hex_to_rgb(hex_color: str) -> tuple[int, int, int]:
    h = hex_color.lstrip("#")
    if len(h) == 3:
        h = h[0] * 2 + h[1] * 2 + h[2] * 2
    return int(h[0:2], 16), int(h[2:4], 16), int(h[4:6], 16)


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


def check_text_contrast(
    image_bytes: bytes,
    text_boxes: list[dict],
) -> list[dict]:
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
