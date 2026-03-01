export interface BBox {
  top: number;    // 0-1000 normalized
  left: number;
  width: number;
  height: number;
}

export interface SafeZone extends BBox {
  area: number;
  label: string;  // e.g. "top-left", "bottom-center"
}

const MIN_ZONE_WIDTH = 150;
const MIN_ZONE_HEIGHT = 50;
const CANVAS_SIZE = 1000;
const MARGIN = 30; // normalized units of padding within zones

/**
 * Subtract a single obstacle bbox from a list of available rectangles.
 * Splits each affected rectangle into up to 4 sub-rects around the obstacle.
 */
function subtractBBox(available: BBox[], obstacle: BBox): BBox[] {
  if (obstacle.width <= 0 || obstacle.height <= 0) return [...available];
  const result: BBox[] = [];
  for (const rect of available) {
    const rRight = rect.left + rect.width;
    const rBottom = rect.top + rect.height;
    const oRight = obstacle.left + obstacle.width;
    const oBottom = obstacle.top + obstacle.height;

    // No overlap — keep rect as-is
    if (
      rRight <= obstacle.left ||
      rect.left >= oRight ||
      rBottom <= obstacle.top ||
      rect.top >= oBottom
    ) {
      result.push(rect);
      continue;
    }

    // Top strip (above obstacle)
    if (rect.top < obstacle.top) {
      result.push({
        top: rect.top,
        left: rect.left,
        width: rect.width,
        height: obstacle.top - rect.top,
      });
    }
    // Bottom strip (below obstacle)
    if (rBottom > oBottom) {
      result.push({
        top: oBottom,
        left: rect.left,
        width: rect.width,
        height: rBottom - oBottom,
      });
    }
    // Left strip (left of obstacle, bounded vertically by obstacle)
    if (rect.left < obstacle.left) {
      result.push({
        top: Math.max(rect.top, obstacle.top),
        left: rect.left,
        width: obstacle.left - rect.left,
        height: Math.min(rBottom, oBottom) - Math.max(rect.top, obstacle.top),
      });
    }
    // Right strip (right of obstacle, bounded vertically by obstacle)
    if (rRight > oRight) {
      result.push({
        top: Math.max(rect.top, obstacle.top),
        left: oRight,
        width: rRight - oRight,
        height: Math.min(rBottom, oBottom) - Math.max(rect.top, obstacle.top),
      });
    }
  }
  return result;
}

function zoneLabel(zone: BBox): string {
  const centerX = zone.left + zone.width / 2;
  const centerY = zone.top + zone.height / 2;
  const vert = centerY < 333 ? "top" : centerY > 666 ? "bottom" : "center";
  const horiz = centerX < 333 ? "left" : centerX > 666 ? "right" : "center";
  return vert === horiz ? vert : `${vert}-${horiz}`;
}

/**
 * Compute safe zones for text placement given a list of obstacle bboxes.
 * Returns zones sorted by area descending, filtered to minimum viable size.
 * Each obstacle gets 20px padding to avoid text sitting right on the edge.
 */
export function computeSafeZones(obstacles: BBox[]): SafeZone[] {
  let available: BBox[] = [
    { top: 0, left: 0, width: CANVAS_SIZE, height: CANVAS_SIZE },
  ];

  for (const obstacle of obstacles) {
    // Add safety padding around each obstacle
    const paddedLeft   = Math.max(0, obstacle.left - 20);
    const paddedTop    = Math.max(0, obstacle.top - 20);
    const paddedRight  = Math.min(CANVAS_SIZE, obstacle.left + obstacle.width + 20);
    const paddedBottom = Math.min(CANVAS_SIZE, obstacle.top + obstacle.height + 20);
    const padded: BBox = {
      top:    paddedTop,
      left:   paddedLeft,
      width:  paddedRight  - paddedLeft,
      height: paddedBottom - paddedTop,
    };
    available = subtractBBox(available, padded);
  }

  return available
    .filter((r) => r.width >= MIN_ZONE_WIDTH && r.height >= MIN_ZONE_HEIGHT)
    .map((r) => ({
      ...r,
      area: r.width * r.height,
      label: zoneLabel(r),
    }))
    .sort((a, b) => b.area - a.area);
}

export interface TextSuggestion {
  part: string;
  preferred_zone?: string;
  style?: {
    font_size_normalized?: number;
    line_height?: number;
    [key: string]: any;
  };
  [key: string]: any;
}

/**
 * Compute text bounding box dimensions from content + font size.
 * Uses 0.6 char width multiplier for Thai/multi-byte char compatibility (vs 0.55 latin-only).
 */
function computeTextSize(
  text: string,
  fontSize: number,
  lineHeight: number,
  imageWidth: number,
  imageHeight: number,
): { width: number; height: number } {
  const lines = text.split("\n");
  const longestLine = Math.max(...lines.map((l) => l.length), 1);
  const widthPx = longestLine * fontSize * 0.6;
  const heightPx = lines.length * fontSize * lineHeight;
  return {
    width: Math.round((widthPx / imageWidth) * 1000),
    height: Math.round((heightPx / imageHeight) * 1000),
  };
}

/**
 * Assign text suggestions to safe zones, computing exact 0-1000 coordinates.
 * Matches each text element to its preferred zone (by label) or the largest zone.
 * Each placed text bbox is tracked to prevent stacking overlap within the same zone.
 *
 * @param suggestions Array of text elements from AI (with optional preferred_zone hints)
 * @param availableZones Pre-computed safe zones from computeSafeZones()
 * @param imageWidth Source image pixel width (for text size computation), defaults to 1000
 * @param imageHeight Source image pixel height, defaults to 1000
 */
export function assignTextToZones(
  suggestions: TextSuggestion[],
  availableZones: SafeZone[],
  imageWidth = 1000,
  imageHeight = 1000,
): Array<TextSuggestion & { position: BBox }> {
  if (!availableZones.length) return suggestions as any;

  // Track the current vertical offset within each zone (for stacking multiple text blocks)
  const zoneOffsets: Map<string, number> = new Map();
  availableZones.forEach((z) => zoneOffsets.set(z.label, z.top + MARGIN));

  const results: Array<TextSuggestion & { position: BBox }> = [];

  for (const s of suggestions) {
    const fontSize = s.style?.font_size_normalized || 40;
    const lineHeight = s.style?.line_height || 1.2;
    const { width: textW, height: textH } = computeTextSize(
      s.part || "",
      fontSize,
      lineHeight,
      imageWidth,
      imageHeight,
    );

    // Find best-fit zone: prefer label match, then fall back to largest zone with room
    let targetZone = availableZones.find((z) => z.label === s.preferred_zone);
    if (!targetZone) {
      targetZone =
        availableZones.find(
          (z) =>
            (zoneOffsets.get(z.label) ?? z.top + MARGIN) + textH + MARGIN <
            z.top + z.height,
        ) || availableZones[0];
    }

    const currentTop = zoneOffsets.get(targetZone.label) ?? targetZone.top + MARGIN;
    const placedLeft = targetZone.left + MARGIN;
    const placedTop = currentTop;

    // Clamp text width to zone width minus margins
    const clampedWidth = Math.min(textW, targetZone.width - MARGIN * 2);

    results.push({
      ...s,
      position: {
        top: Math.max(targetZone.top + MARGIN, placedTop),
        left: placedLeft,
        width: Math.max(50, clampedWidth), // minimum 50 to ensure clickability in editor
        height: Math.max(20, textH),       // minimum 20 for single-line text
      },
    });

    // Advance zone offset so next element in same zone stacks below this one
    zoneOffsets.set(targetZone.label, placedTop + textH + MARGIN);
  }

  return results;
}
