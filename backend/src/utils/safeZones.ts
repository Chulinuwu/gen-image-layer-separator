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
