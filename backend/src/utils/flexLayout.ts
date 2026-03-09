/**
 * flexLayout.ts — Recursive flex-tree layout engine.
 *
 * AI outputs a flex-tree JSON (nested row/column containers with % sizing)
 * and this module computes pixel-level bounding boxes for every leaf node.
 */

// ---------------------------------------------------------------------------
// Interfaces
// ---------------------------------------------------------------------------

export interface FlexNodeStyle {
  fontSize?: 'xlarge' | 'large' | 'medium' | 'small' | 'xsmall';
  fontWeight?: string;
  color?: string;
  strokeColor?: string;
  strokeWidth?: number;
  align?: 'left' | 'center' | 'right';
}

export interface FlexNode {
  id: string;

  /** Container properties */
  direction?: 'row' | 'column';
  children?: FlexNode[];

  /** Leaf properties */
  type?: 'text' | 'component';
  text?: string;
  label?: string;

  /** Sizing — percentage strings relative to parent's main axis */
  width?: string;   // e.g. "55%" — consumed when parent direction = row
  height?: string;  // e.g. "40%" — consumed when parent direction = column

  /** Styling (leaf nodes) */
  style?: FlexNodeStyle;

  /** Container spacing */
  gap?: number;     // px gap between children (default 8)
  padding?: number; // px inset from edges (default 0)
}

export interface LayoutBox {
  id: string;
  type: 'text' | 'component';
  x: number;
  y: number;
  w: number;
  h: number;
  text?: string;
  label?: string;
  style?: FlexNodeStyle;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Parse a percentage string like "55%" into a fraction (0.55). Returns NaN on failure. */
function parsePct(value: string | undefined): number {
  if (!value) return NaN;
  const trimmed = value.trim();
  if (!trimmed.endsWith('%')) return NaN;
  const num = parseFloat(trimmed.slice(0, -1));
  return isNaN(num) ? NaN : num / 100;
}

// ---------------------------------------------------------------------------
// Core layout
// ---------------------------------------------------------------------------

/**
 * Recursively compute bounding boxes for all leaf nodes in the flex tree.
 *
 * @param root    The flex-tree root node.
 * @param canvasW Canvas width in pixels.
 * @param canvasH Canvas height in pixels.
 * @returns Flat array of LayoutBox for every leaf node.
 */
export function computeFlexLayout(
  root: FlexNode,
  canvasW: number,
  canvasH: number,
): LayoutBox[] {
  const results: LayoutBox[] = [];
  layoutNode(root, 0, 0, canvasW, canvasH, results);
  return results;
}

function layoutNode(
  node: FlexNode,
  x: number,
  y: number,
  w: number,
  h: number,
  out: LayoutBox[],
): void {
  const isContainer =
    node.direction !== undefined && Array.isArray(node.children);

  if (!isContainer) {
    // Leaf node — emit a LayoutBox
    out.push({
      id: node.id,
      type: node.type ?? 'text',
      x,
      y,
      w,
      h,
      ...(node.text !== undefined ? { text: node.text } : {}),
      ...(node.label !== undefined ? { label: node.label } : {}),
      ...(node.style !== undefined ? { style: node.style } : {}),
    });
    return;
  }

  // Container node — distribute children along the main axis
  const children = node.children!;
  if (children.length === 0) return;

  const gap = node.gap ?? 8;
  const padding = node.padding ?? 0;

  // Inset by padding
  const innerX = x + padding;
  const innerY = y + padding;
  const innerW = Math.max(0, w - padding * 2);
  const innerH = Math.max(0, h - padding * 2);

  const isRow = node.direction === 'row';
  const mainSize = isRow ? innerW : innerH;
  const totalGap = gap * (children.length - 1);
  const availableMain = Math.max(0, mainSize - totalGap);

  // First pass: figure out how much space is explicitly claimed via %
  let claimedFraction = 0;
  let unsizedCount = 0;

  for (const child of children) {
    const pct = parsePct(isRow ? child.width : child.height);
    if (!isNaN(pct)) {
      claimedFraction += pct;
    } else {
      unsizedCount++;
    }
  }

  // Fraction left for unsized children to share equally
  const remainingFraction = Math.max(0, 1 - claimedFraction);
  const perUnsized =
    unsizedCount > 0 ? remainingFraction / unsizedCount : 0;

  // Second pass: lay out each child
  let cursor = 0; // px offset along the main axis within the inner box

  for (let i = 0; i < children.length; i++) {
    const child = children[i];
    const pct = parsePct(isRow ? child.width : child.height);
    const fraction = isNaN(pct) ? perUnsized : pct;
    const childMain = fraction * availableMain;

    const childX = isRow ? innerX + cursor : innerX;
    const childY = isRow ? innerY : innerY + cursor;
    const childW = isRow ? childMain : innerW;
    const childH = isRow ? innerH : childMain;

    layoutNode(child, childX, childY, childW, childH, out);

    cursor += childMain;
    if (i < children.length - 1) {
      cursor += gap;
    }
  }
}
