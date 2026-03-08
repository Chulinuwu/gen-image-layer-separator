import { measureText, wrapText, autoFitFontSize } from './textMeasure';

// ── Interfaces ──────────────────────────────────────────────────────────

export interface TextBlock {
  text: string;
  role: 'promo' | 'headline' | 'subheadline' | 'body' | 'offer' | 'fineprint';
  fontSize: number;
  fontWeight: string;
  color: string;
  strokeColor?: string;
  strokeWidth?: number;
  align?: 'left' | 'center' | 'right';
}

export interface LayoutIntent {
  blocks: TextBlock[];
  textZone: { x: number; y: number; w: number; h: number };
  canvasSize: { w: number; h: number };
}

export interface BuildSVGResult {
  svg: string;
  blocks: Array<{
    role: string;
    text: string;
    x: number;
    y: number;
    fontSize: number;
    lines: string[];
    measuredWidth: number;
    measuredHeight: number;
  }>;
}

// ── Helpers ─────────────────────────────────────────────────────────────

const MIN_FONT_SIZES: Record<string, number> = {
  promo: 40,
  headline: 20,
  subheadline: 18,
  body: 16,
  offer: 20,
  fineprint: 10,
};

const ROLE_GAP_FACTOR: Record<string, number> = {
  promo: 0,
  headline: 0.3,
  subheadline: 0.3,
  body: 0.2,
  offer: 0.2,
  fineprint: 0.5,
};

function escapeXml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

function anchorForAlign(align: string): string {
  if (align === 'center') return 'middle';
  if (align === 'right') return 'end';
  return 'start';
}

// ── Measured block (internal) ───────────────────────────────────────────

interface MeasuredBlock {
  role: string;
  text: string;
  fontSize: number;
  fontWeight: string;
  color: string;
  strokeColor?: string;
  strokeWidth?: number;
  align: string;
  lines: string[];
  lineHeight: number;
  totalHeight: number;
  measuredWidth: number;
  ascent: number;
}

// ── Core ────────────────────────────────────────────────────────────────

export function buildSVG(intent: LayoutIntent): BuildSVGResult {
  const { blocks, textZone: zone, canvasSize } = intent;
  const maxTextWidth = zone.w * 0.95;
  const padding = zone.h * 0.03;

  // Step 1 — measure every block
  let measured = measureAllBlocks(blocks, maxTextWidth);

  // Step 2 — vertical stacking (first pass)
  let { placements, totalUsed } = computeVerticalStack(measured, zone, padding);

  // If total height exceeds zone, scale down proportionally and recompute
  const availableH = zone.h - padding * 2;
  if (totalUsed > availableH) {
    const scale = (availableH / totalUsed) * 0.95;
    const scaled = blocks.map((b) => ({
      ...b,
      fontSize: Math.max(
        Math.round(b.fontSize * scale),
        MIN_FONT_SIZES[b.role] ?? 10,
      ),
    }));
    measured = measureAllBlocks(scaled, maxTextWidth);
    ({ placements, totalUsed } = computeVerticalStack(measured, zone, padding));
  }

  // Step 3 — build SVG string
  const svgLines: string[] = [];
  svgLines.push(
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${canvasSize.w} ${canvasSize.h}" width="${canvasSize.w}" height="${canvasSize.h}">`,
  );
  svgLines.push('  <defs>');
  svgLines.push('    <filter id="textShadow">');
  svgLines.push(
    '      <feDropShadow dx="0" dy="2" stdDeviation="3" flood-color="rgba(0,0,0,0.5)" />',
  );
  svgLines.push('    </filter>');
  svgLines.push('  </defs>');

  const resultBlocks: BuildSVGResult['blocks'] = [];

  for (const p of placements) {
    const align = p.align;
    const anchor = anchorForAlign(align);

    // Compute blockX based on alignment
    let blockX: number;
    if (align === 'center') {
      blockX = zone.x + zone.w / 2;
    } else if (align === 'right') {
      blockX = zone.x + zone.w - padding;
    } else {
      blockX = zone.x + padding;
    }

    // blockY includes ascent so the first baseline is correct
    const blockY = p.y + p.ascent;
    const tspanX = 0;

    const filterAttr = p.role !== 'fineprint' ? ' filter="url(#textShadow)"' : '';

    // Stroke attributes
    let strokeAttrs = '';
    if (p.strokeColor) {
      strokeAttrs = ` stroke="${escapeXml(p.strokeColor)}" stroke-width="${p.strokeWidth ?? 1}" paint-order="stroke"`;
    }

    svgLines.push(
      `  <g id="block-${p.role}" transform="translate(${blockX}, ${blockY})"${filterAttr}>`,
    );
    svgLines.push(
      `    <text font-family="Kanit, sans-serif" font-size="${p.fontSize}" font-weight="${p.fontWeight}" fill="${escapeXml(p.color)}"${strokeAttrs} text-anchor="${anchor}">`,
    );

    p.lines.forEach((line, i) => {
      const dy = i === 0 ? '0' : String(p.lineHeight);
      svgLines.push(
        `      <tspan x="${tspanX}" dy="${dy}">${escapeXml(line)}</tspan>`,
      );
    });

    svgLines.push('    </text>');
    svgLines.push('  </g>');

    resultBlocks.push({
      role: p.role,
      text: p.text,
      x: blockX,
      y: p.y,
      fontSize: p.fontSize,
      lines: p.lines,
      measuredWidth: p.measuredWidth,
      measuredHeight: p.totalHeight,
    });
  }

  svgLines.push('</svg>');

  return { svg: svgLines.join('\n'), blocks: resultBlocks };
}

// ── Internal helpers ────────────────────────────────────────────────────

function measureAllBlocks(
  blocks: TextBlock[],
  maxTextWidth: number,
): MeasuredBlock[] {
  return blocks.map((block) => {
    const minFS = MIN_FONT_SIZES[block.role] ?? 10;
    const align = block.align ?? 'left';

    // Auto-fit to find largest font that fits single line
    const fitted = autoFitFontSize(
      block.text,
      maxTextWidth,
      block.fontSize,
      minFS,
      block.fontWeight,
    );

    const isPromo = block.role === 'promo';

    // For promo: prefer single line; only wrap if doesn't fit at min size
    if (isPromo && fitted.width <= maxTextWidth) {
      const metrics = measureText(block.text, fitted.fontSize, block.fontWeight);
      return {
        role: block.role,
        text: block.text,
        fontSize: fitted.fontSize,
        fontWeight: block.fontWeight,
        color: block.color,
        strokeColor: block.strokeColor,
        strokeWidth: block.strokeWidth,
        align,
        lines: [block.text],
        lineHeight: fitted.fontSize * 1.35,
        totalHeight: fitted.fontSize * 1.35,
        measuredWidth: fitted.width,
        ascent: metrics.ascent,
      };
    }

    // Wrap text at the fitted (or original for promo fallback) size
    const useSize = isPromo ? minFS : fitted.fontSize;
    const wrapped = wrapText(block.text, maxTextWidth, useSize, block.fontWeight);
    const metrics = measureText(block.text, useSize, block.fontWeight);

    // Compute max line width
    let maxLineW = 0;
    for (const line of wrapped.lines) {
      const lw = measureText(line, useSize, block.fontWeight).width;
      if (lw > maxLineW) maxLineW = lw;
    }

    return {
      role: block.role,
      text: block.text,
      fontSize: useSize,
      fontWeight: block.fontWeight,
      color: block.color,
      strokeColor: block.strokeColor,
      strokeWidth: block.strokeWidth,
      align,
      lines: wrapped.lines,
      lineHeight: wrapped.lineHeight,
      totalHeight: wrapped.totalHeight,
      measuredWidth: maxLineW,
      ascent: metrics.ascent,
    };
  });
}

interface PlacedBlock extends MeasuredBlock {
  y: number;
}

function computeVerticalStack(
  measured: MeasuredBlock[],
  zone: { x: number; y: number; w: number; h: number },
  padding: number,
): { placements: PlacedBlock[]; totalUsed: number } {
  const placements: PlacedBlock[] = [];
  let cursorY = zone.y + padding;

  measured.forEach((m, i) => {
    // Add role-based gap (skip gap for first block)
    if (i > 0) {
      const gapFactor = ROLE_GAP_FACTOR[m.role] ?? 0.2;
      cursorY += m.fontSize * gapFactor;
    }

    placements.push({ ...m, y: cursorY });
    cursorY += m.totalHeight;
  });

  const totalUsed = cursorY - (zone.y + padding);
  return { placements, totalUsed };
}
