from __future__ import annotations

from dataclasses import dataclass
from pathlib import Path

from fontTools.ttLib import TTFont

FONT_DIR = Path(__file__).parent.parent.parent / "assets" / "fonts"

FONT_FILES = {"400": "Kanit-Regular.ttf", "700": "Kanit-Bold.ttf", "900": "Kanit-Black.ttf"}
WEIGHT_ALIASES = {"normal": "400", "regular": "400", "bold": "700", "black": "900"}

_font_cache: dict[str, TTFont] = {}


def _get_font(weight: str = "400") -> TTFont:
    normalized = WEIGHT_ALIASES.get(weight.lower(), weight)
    w = normalized if normalized in FONT_FILES else "400"
    if w not in _font_cache:
        _font_cache[w] = TTFont(str(FONT_DIR / FONT_FILES[w]))
    return _font_cache[w]


def _glyph_width(font: TTFont, text: str, font_size: float) -> float:
    cmap = font.getBestCmap()
    hmtx = font["hmtx"]
    units_per_em = font["head"].unitsPerEm
    total = 0
    for ch in text:
        gid = cmap.get(ord(ch))
        if gid:
            total += hmtx[gid][0]
        else:
            total += units_per_em * 0.5
    return total * font_size / units_per_em


@dataclass
class TextMetrics:
    width: float
    height: float
    ascent: float
    descent: float


def measure_text(text: str, font_size: float, font_weight: str = "400") -> TextMetrics:
    font = _get_font(font_weight)
    width = _glyph_width(font, text, font_size)
    units_per_em = font["head"].unitsPerEm
    os2 = font["OS/2"]
    ascent = os2.sTypoAscender * font_size / units_per_em
    descent = abs(os2.sTypoDescender) * font_size / units_per_em
    return TextMetrics(width=width, height=ascent + descent, ascent=ascent, descent=descent)


@dataclass
class WrapResult:
    lines: list[str]
    line_height: float
    total_height: float


def wrap_text(text: str, max_width: float, font_size: float, font_weight: str = "400") -> WrapResult:
    line_height = font_size * 1.35
    lines: list[str] = []

    for paragraph in text.split("\n"):
        if not paragraph:
            lines.append("")
            continue

        if measure_text(paragraph, font_size, font_weight).width <= max_width:
            lines.append(paragraph)
            continue

        words = paragraph.split()
        current_line = ""
        for word in words:
            candidate = f"{current_line} {word}" if current_line else word
            if measure_text(candidate, font_size, font_weight).width <= max_width:
                current_line = candidate
            else:
                if current_line:
                    lines.append(current_line)
                if measure_text(word, font_size, font_weight).width <= max_width:
                    current_line = word
                else:
                    char_line = ""
                    for ch in word:
                        if measure_text(char_line + ch, font_size, font_weight).width <= max_width:
                            char_line += ch
                        else:
                            if char_line:
                                lines.append(char_line)
                            char_line = ch
                    current_line = char_line
        if current_line:
            lines.append(current_line)

    return WrapResult(lines=lines, line_height=line_height, total_height=len(lines) * line_height)


@dataclass
class AutoFitResult:
    font_size: int
    width: float


def auto_fit_font_size(
    text: str, max_width: float, max_font_size: int, min_font_size: int, font_weight: str = "400"
) -> AutoFitResult:
    lo, hi = min_font_size, max_font_size
    best_size = min_font_size
    best_width = measure_text(text, min_font_size, font_weight).width

    while hi - lo >= 1:
        mid = (lo + hi) // 2
        w = measure_text(text, mid, font_weight).width
        if w <= max_width:
            best_size = mid
            best_width = w
            lo = mid + 1
        else:
            hi = mid - 1

    return AutoFitResult(font_size=best_size, width=best_width)
