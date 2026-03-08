import opentype from 'opentype.js';
import path from 'path';

// Font weight → file mapping
const FONT_FILES: Record<string, string> = {
  '400': 'Kanit-Regular.ttf',
  '700': 'Kanit-Bold.ttf',
  '900': 'Kanit-Black.ttf',
};

// Normalize weight aliases to canonical values
const WEIGHT_ALIASES: Record<string, string> = {
  normal: '400',
  regular: '400',
  bold: '700',
  black: '900',
};

// Lazy-loaded font cache (singleton per weight)
const fontCache = new Map<string, opentype.Font>();

function getFont(fontWeight: string = '400'): opentype.Font {
  // Normalize weight
  const normalized = WEIGHT_ALIASES[fontWeight.toLowerCase()] ?? fontWeight;
  const weight = FONT_FILES[normalized] ? normalized : '400';

  const cached = fontCache.get(weight);
  if (cached) return cached;

  const filename = FONT_FILES[weight];
  const fontPath = path.resolve(__dirname, '../../assets/fonts/', filename);
  const font = opentype.loadSync(fontPath);
  fontCache.set(weight, font);
  return font;
}

export interface TextMetrics {
  width: number;
  height: number;
  ascent: number;
  descent: number;
}

export function measureText(
  text: string,
  fontSize: number,
  fontWeight?: string
): TextMetrics {
  const font = getFont(fontWeight);
  const width = font.getAdvanceWidth(text, fontSize);
  const ascent = (font.ascender / font.unitsPerEm) * fontSize;
  const descent = Math.abs(font.descender / font.unitsPerEm) * fontSize;
  const height = ascent + descent;
  return { width, height, ascent, descent };
}

export interface WrapResult {
  lines: string[];
  lineHeight: number;
  totalHeight: number;
}

export function wrapText(
  text: string,
  maxWidth: number,
  fontSize: number,
  fontWeight?: string
): WrapResult {
  const lineHeight = fontSize * 1.35;
  const lines: string[] = [];

  // Split by explicit newlines first
  const paragraphs = text.split('\n');

  for (const paragraph of paragraphs) {
    if (paragraph === '') {
      lines.push('');
      continue;
    }

    const measured = measureText(paragraph, fontSize, fontWeight);
    if (measured.width <= maxWidth) {
      lines.push(paragraph);
      continue;
    }

    // Word-based splitting
    const words = paragraph.split(/\s+/);
    let currentLine = '';

    for (const word of words) {
      const candidate = currentLine ? `${currentLine} ${word}` : word;
      const candidateWidth = measureText(candidate, fontSize, fontWeight).width;

      if (candidateWidth <= maxWidth) {
        currentLine = candidate;
      } else {
        // Push current line if non-empty
        if (currentLine) {
          lines.push(currentLine);
        }

        // Check if the single word fits
        const wordWidth = measureText(word, fontSize, fontWeight).width;
        if (wordWidth <= maxWidth) {
          currentLine = word;
        } else {
          // Force-break at character level
          let charLine = '';
          for (const char of word) {
            const charCandidate = charLine + char;
            if (measureText(charCandidate, fontSize, fontWeight).width <= maxWidth) {
              charLine = charCandidate;
            } else {
              if (charLine) lines.push(charLine);
              charLine = char;
            }
          }
          currentLine = charLine;
        }
      }
    }

    if (currentLine) {
      lines.push(currentLine);
    }
  }

  return {
    lines,
    lineHeight,
    totalHeight: lines.length * lineHeight,
  };
}

export interface AutoFitResult {
  fontSize: number;
  width: number;
}

export function autoFitFontSize(
  text: string,
  maxWidth: number,
  maxFontSize: number,
  minFontSize: number,
  fontWeight?: string
): AutoFitResult {
  let lo = minFontSize;
  let hi = maxFontSize;
  let bestSize = minFontSize;
  let bestWidth = measureText(text, minFontSize, fontWeight).width;

  // Binary search for largest fontSize where width <= maxWidth
  while (hi - lo >= 1) {
    const mid = Math.floor((lo + hi) / 2);
    const w = measureText(text, mid, fontWeight).width;

    if (w <= maxWidth) {
      bestSize = mid;
      bestWidth = w;
      lo = mid + 1;
    } else {
      hi = mid - 1;
    }
  }

  return { fontSize: bestSize, width: bestWidth };
}
