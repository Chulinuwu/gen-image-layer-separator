import { measureText, wrapText, autoFitFontSize } from './textMeasure';
import { LayoutBox } from './flexLayout';

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
    if (totalUsed > availableH) {
      console.warn(`[svgBuilder] Text still overflows after scaling: ${Math.round(totalUsed)}px > ${Math.round(availableH)}px zone height`);
    }
  }

  // Step 3 — build SVG string
  const svgLines: string[] = [];
  svgLines.push(
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${canvasSize.w} ${canvasSize.h}" width="${canvasSize.w}" height="${canvasSize.h}">`,
  );
  svgLines.push('  <defs>');
  svgLines.push('    <filter id="textShadow">');
  svgLines.push(
    '      <feDropShadow dx="0" dy="2" stdDeviation="3" flood-color="#000000" flood-opacity="0.5" />',
  );
  svgLines.push('    </filter>');
  // Hard clip: nothing renders outside the text zone
  svgLines.push(`    <clipPath id="zoneClip">`);
  svgLines.push(`      <rect x="${zone.x}" y="${zone.y}" width="${zone.w}" height="${zone.h}" />`);
  svgLines.push(`    </clipPath>`);
  svgLines.push('  </defs>');
  svgLines.push(`  <g clip-path="url(#zoneClip)">`);

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
      `  <g id="block-${p.role}-${resultBlocks.length}" transform="translate(${blockX}, ${blockY})"${filterAttr}>`,
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

  svgLines.push('  </g>'); // close zoneClip group
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

// ── Flex SVG Builder ─────────────────────────────────────────────────────

export interface FlexSVGInput {
  boxes: LayoutBox[];
  canvasW: number;
  canvasH: number;
  bgImageUrl?: string;
  componentImages?: Map<string, string>; // label → image URL
}

export interface FlexSVGResult {
  svg: string;
  boxes: LayoutBox[];
}

// Semantic font sizes used as a RATIO hint — actual size scales to fill the box
const FLEX_FONT_RATIO: Record<string, number> = {
  xlarge: 1.0,   // fill box fully
  large: 0.75,
  medium: 0.5,
  small: 0.35,
  xsmall: 0.22,
};

interface FlexTextRender {
  defs: string[];    // clipPath elements for <defs>
  elements: string[]; // text elements for the body
}

/**
 * Render a single text box into SVG elements.
 * Auto-shrinks font until wrapped text fits within box height.
 */
function renderTextBox(box: LayoutBox, clipId: string): FlexTextRender {
  const defs: string[] = [];
  const elements: string[] = [];
  const style = box.style ?? {};
  const text = box.text ?? '';
  if (!text) return { defs, elements };

  const align = style.align ?? 'center';
  const anchor = anchorForAlign(align);
  const fontWeight = style.fontWeight ?? '700';
  const color = style.color ?? '#FFFFFF';

  // Scale font to fill the box — semantic size is a ratio hint, not a cap
  const ratio = FLEX_FONT_RATIO[style.fontSize ?? 'medium'] ?? 0.5;
  const boxPadding = 4;
  const maxTextWidth = box.w - boxPadding * 2;

  // Start from a font size proportional to box height, then binary-search down to fit width
  const startFont = Math.round(box.h * ratio);
  const minFont = Math.max(12, Math.round(startFont * 0.15));

  let fontSize = Math.max(minFont, startFont);
  let wrapped = wrapText(text, maxTextWidth, fontSize, fontWeight);

  // Shrink until wrapped text fits both width and height
  while (wrapped.totalHeight > box.h * 0.95 && fontSize > minFont) {
    fontSize = Math.max(minFont, Math.round(fontSize * 0.9));
    wrapped = wrapText(text, maxTextWidth, fontSize, fontWeight);
  }

  const lineHeight = fontSize * 1.35;
  const totalTextHeight = wrapped.lines.length * lineHeight;

  // Center text vertically within the box
  const offsetY = Math.max(0, (box.h - totalTextHeight) / 2);

  // Compute X based on alignment
  let textX: number;
  if (align === 'center') {
    textX = box.x + box.w / 2;
  } else if (align === 'right') {
    textX = box.x + box.w - boxPadding;
  } else {
    textX = box.x + boxPadding;
  }

  // ClipPath for safety
  defs.push(`    <clipPath id="${clipId}">`);
  defs.push(`      <rect x="${box.x}" y="${box.y}" width="${box.w}" height="${box.h}" />`);
  defs.push(`    </clipPath>`);

  // Stroke attributes
  let strokeAttrs = '';
  if (style.strokeColor) {
    const sw = style.strokeWidth ?? 2;
    strokeAttrs = ` stroke="${escapeXml(style.strokeColor)}" stroke-width="${sw}" paint-order="stroke"`;
  }

  const metrics = measureText(text, fontSize, fontWeight);
  const baselineY = box.y + offsetY + metrics.ascent;

  elements.push(
    `  <text id="${escapeXml(box.id)}" data-role="text" clip-path="url(#${clipId})" ` +
    `font-family="Kanit, sans-serif" font-size="${fontSize}" font-weight="${fontWeight}" ` +
    `fill="${escapeXml(color)}"${strokeAttrs} text-anchor="${anchor}">`,
  );

  wrapped.lines.forEach((line, i) => {
    const dy = i === 0 ? String(baselineY) : String(lineHeight);
    const dyAttr = i === 0 ? `y="${dy}"` : `dy="${dy}"`;
    elements.push(
      `    <tspan x="${textX}" ${dyAttr}>${escapeXml(line)}</tspan>`,
    );
  });

  elements.push('  </text>');
  return { defs, elements };
}

/**
 * Build a complete SVG from flex layout boxes.
 */
export function buildFlexSVG(input: FlexSVGInput): FlexSVGResult {
  const { boxes, canvasW, canvasH, bgImageUrl, componentImages } = input;

  const svgLines: string[] = [];
  svgLines.push(
    `<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" ` +
    `viewBox="0 0 ${canvasW} ${canvasH}" width="${canvasW}" height="${canvasH}">`,
  );

  // Background image
  if (bgImageUrl) {
    svgLines.push(
      `  <image href="${escapeXml(bgImageUrl)}" x="0" y="0" width="${canvasW}" height="${canvasH}" preserveAspectRatio="xMidYMid slice" />`,
    );
  }

  svgLines.push('  <defs>');

  // Pre-render all text boxes to collect clipPath defs and text elements
  const allTextElements: string[] = [];
  let clipIdx = 0;

  for (const box of boxes) {
    if (box.type === 'text') {
      const clipId = `flex-clip-${clipIdx++}`;
      const { defs, elements } = renderTextBox(box, clipId);
      for (const d of defs) {
        svgLines.push(`  ${d.trimStart()}`);
      }
      allTextElements.push(...elements);
    }
  }

  svgLines.push('  </defs>');

  // Render component images
  for (const box of boxes) {
    if (box.type === 'component') {
      const imgUrl = componentImages?.get(box.label ?? '') ?? '';
      if (imgUrl) {
        svgLines.push(
          `  <image id="${escapeXml(box.id)}" data-role="component" data-label="${escapeXml(box.label ?? '')}" ` +
          `href="${escapeXml(imgUrl)}" ` +
          `x="${box.x}" y="${box.y}" width="${box.w}" height="${box.h}" ` +
          `preserveAspectRatio="xMidYMid meet" />`,
        );
      }
    }
  }

  // Render text elements
  for (const el of allTextElements) {
    svgLines.push(`  ${el.trimStart()}`);
  }

  svgLines.push('</svg>');

  return { svg: svgLines.join('\n'), boxes };
}
