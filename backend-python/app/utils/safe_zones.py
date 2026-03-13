from __future__ import annotations

from dataclasses import dataclass

MIN_ZONE_WIDTH = 150
MIN_ZONE_HEIGHT = 50
CANVAS_SIZE = 1000
MARGIN = 30


@dataclass
class BBox:
    top: float
    left: float
    width: float
    height: float


@dataclass
class SafeZone(BBox):
    area: float = 0
    label: str = ""


@dataclass
class TextSuggestion:
    part: str = ""
    preferred_zone: str | None = None
    style: dict | None = None
    position: BBox | None = None


def _subtract_bbox(available: list[BBox], obstacle: BBox) -> list[BBox]:
    if obstacle.width <= 0 or obstacle.height <= 0:
        return list(available)

    result: list[BBox] = []
    for rect in available:
        r_right = rect.left + rect.width
        r_bottom = rect.top + rect.height
        o_right = obstacle.left + obstacle.width
        o_bottom = obstacle.top + obstacle.height

        if r_right <= obstacle.left or rect.left >= o_right or r_bottom <= obstacle.top or rect.top >= o_bottom:
            result.append(rect)
            continue

        # Top strip
        if rect.top < obstacle.top:
            result.append(BBox(top=rect.top, left=rect.left, width=rect.width, height=obstacle.top - rect.top))
        # Bottom strip
        if r_bottom > o_bottom:
            result.append(BBox(top=o_bottom, left=rect.left, width=rect.width, height=r_bottom - o_bottom))
        # Left strip
        if rect.left < obstacle.left:
            clip_top = max(rect.top, obstacle.top)
            clip_bottom = min(r_bottom, o_bottom)
            result.append(BBox(top=clip_top, left=rect.left, width=obstacle.left - rect.left, height=clip_bottom - clip_top))
        # Right strip
        if r_right > o_right:
            clip_top = max(rect.top, obstacle.top)
            clip_bottom = min(r_bottom, o_bottom)
            result.append(BBox(top=clip_top, left=o_right, width=r_right - o_right, height=clip_bottom - clip_top))

    return result


def _zone_label(zone: BBox) -> str:
    center_x = zone.left + zone.width / 2
    center_y = zone.top + zone.height / 2
    vert = "top" if center_y < 333 else ("bottom" if center_y > 666 else "center")
    horiz = "left" if center_x < 333 else ("right" if center_x > 666 else "center")
    return vert if vert == horiz else f"{vert}-{horiz}"


def compute_safe_zones(obstacles: list[BBox]) -> list[SafeZone]:
    available: list[BBox] = [BBox(top=0, left=0, width=CANVAS_SIZE, height=CANVAS_SIZE)]

    for obstacle in obstacles:
        padded_left = max(0, obstacle.left - 20)
        padded_top = max(0, obstacle.top - 20)
        padded_right = min(CANVAS_SIZE, obstacle.left + obstacle.width + 20)
        padded_bottom = min(CANVAS_SIZE, obstacle.top + obstacle.height + 20)
        padded = BBox(top=padded_top, left=padded_left, width=padded_right - padded_left, height=padded_bottom - padded_top)
        available = _subtract_bbox(available, padded)

    zones = [
        SafeZone(
            top=r.top, left=r.left, width=r.width, height=r.height,
            area=r.width * r.height, label=_zone_label(r),
        )
        for r in available
        if r.width >= MIN_ZONE_WIDTH and r.height >= MIN_ZONE_HEIGHT
    ]
    zones.sort(key=lambda z: z.area, reverse=True)
    return zones


def _compute_text_size(text: str, font_size: float, line_height: float, image_width: float, image_height: float) -> tuple[float, float]:
    lines = text.split("\n")
    longest_line = max((len(line) for line in lines), default=1)
    width_px = longest_line * font_size * 0.6
    height_px = len(lines) * font_size * line_height
    return round(width_px / image_width * 1000), round(height_px / image_height * 1000)


def assign_text_to_zones(
    suggestions: list[TextSuggestion],
    available_zones: list[SafeZone],
    image_width: float = 1000,
    image_height: float = 1000,
) -> list[dict]:
    if not available_zones:
        return [{"suggestion": s} for s in suggestions]

    zone_offsets: dict[str, float] = {z.label: z.top + MARGIN for z in available_zones}
    results: list[dict] = []

    for s in suggestions:
        font_size = (s.style or {}).get("font_size_normalized", 40)
        line_height = (s.style or {}).get("line_height", 1.2)
        text_w, text_h = _compute_text_size(s.part or "", font_size, line_height, image_width, image_height)

        target_zone = next((z for z in available_zones if z.label == s.preferred_zone), None)
        if not target_zone:
            target_zone = next(
                (z for z in available_zones if (zone_offsets.get(z.label, z.top + MARGIN) + text_h + MARGIN < z.top + z.height)),
                available_zones[0],
            )

        current_top = zone_offsets.get(target_zone.label, target_zone.top + MARGIN)
        placed_left = target_zone.left + MARGIN
        clamped_width = min(text_w, target_zone.width - MARGIN * 2)

        entry = {}
        if hasattr(s, '__dict__'):
            entry.update(vars(s))
        entry["position"] = BBox(
                top=max(target_zone.top + MARGIN, current_top),
                left=placed_left,
                width=max(50, clamped_width),
                height=max(20, text_h),
            )
        results.append(entry)

        zone_offsets[target_zone.label] = current_top + text_h + MARGIN

    return results
