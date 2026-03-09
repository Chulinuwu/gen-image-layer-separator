# Flex-Tree Layout Engine Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Replace coordinate-based AI layout with flex-tree system — AI thinks in layout terms (row/column/%), code computes geometry, output is a single editable SVG.

**Architecture:** AI outputs flex tree JSON (nested row/column containers with % sizing). New `flexLayout.ts` recursively computes bounding boxes from the tree. Modified `svgBuilder.ts` renders a single SVG with BG image + component images + text — all positioned by computed boxes. Frontend displays the SVG; editing and AI refinement operate on the flex tree.

**Tech Stack:** TypeScript, opentype.js (text measurement), Vertex AI Gemini (flex tree JSON output), Vue 3 (frontend SVG display)

---

### Task 1: Create `flexLayout.ts` — Flex Tree → Bounding Boxes

**Files:**
- Create: `backend/src/utils/flexLayout.ts`

**Step 1: Define TypeScript interfaces**

```typescript
/** A node in the flex tree — either a container (has children) or a leaf (has type) */
export interface FlexNode {
  id: string;
  direction?: 'row' | 'column';        // containers only
  children?: FlexNode[];                // containers only
  type?: 'text' | 'component';         // leaves only
  text?: string;                        // text leaves
  label?: string;                       // component leaves (matches die-cut label)
  width?: string;                       // e.g. "55%" — used when parent direction=row
  height?: string;                      // e.g. "40%" — used when parent direction=column
  style?: {
    fontSize?: 'xlarge' | 'large' | 'medium' | 'small' | 'xsmall';
    fontWeight?: string;
    color?: string;
    strokeColor?: string;
    strokeWidth?: number;
    align?: 'left' | 'center' | 'right';
  };
  gap?: number;                         // px gap between children (default 8)
  padding?: number;                     // px inset from edges (default 0)
}

/** Computed bounding box for a leaf node */
export interface LayoutBox {
  id: string;
  type: 'text' | 'component';
  x: number;
  y: number;
  w: number;
  h: number;
  text?: string;
  label?: string;
  style?: FlexNode['style'];
}
```

**Step 2: Implement recursive layout computation**

```typescript
/**
 * Compute bounding boxes from a flex tree.
 * @param root  The flex tree root node
 * @param canvasW  Canvas width in pixels (e.g. 1024)
 * @param canvasH  Canvas height in pixels (e.g. 1024)
 * @returns Flat array of leaf bounding boxes
 */
export function computeFlexLayout(
  root: FlexNode,
  canvasW: number,
  canvasH: number,
): LayoutBox[] {
  const boxes: LayoutBox[] = [];
  layoutNode(root, 0, 0, canvasW, canvasH, boxes);
  return boxes;
}

function layoutNode(
  node: FlexNode,
  x: number,
  y: number,
  w: number,
  h: number,
  boxes: LayoutBox[],
): void {
  const pad = node.padding ?? 0;
  const innerX = x + pad;
  const innerY = y + pad;
  const innerW = w - pad * 2;
  const innerH = h - pad * 2;

  // Leaf node — emit bounding box
  if (node.type && !node.children?.length) {
    boxes.push({
      id: node.id,
      type: node.type,
      x: innerX,
      y: innerY,
      w: innerW,
      h: innerH,
      text: node.text,
      label: node.label,
      style: node.style,
    });
    return;
  }

  // Container node — distribute children along direction
  const children = node.children ?? [];
  if (children.length === 0) return;

  const dir = node.direction ?? 'column';
  const gap = node.gap ?? 8;
  const totalGap = gap * (children.length - 1);
  const availMain = (dir === 'row' ? innerW : innerH) - totalGap;

  // Parse % sizes; children without explicit size share remaining space equally
  const sizes = children.map(c => {
    const pct = dir === 'row' ? c.width : c.height;
    return pct ? parseFloat(pct) / 100 : null;
  });
  const allocatedFrac = sizes.reduce((sum, s) => sum + (s ?? 0), 0);
  const unallocatedCount = sizes.filter(s => s === null).length;
  const remainingFrac = Math.max(0, 1 - allocatedFrac);
  const eachUnallocated = unallocatedCount > 0 ? remainingFrac / unallocatedCount : 0;

  let cursor = dir === 'row' ? innerX : innerY;

  for (let i = 0; i < children.length; i++) {
    const frac = sizes[i] ?? eachUnallocated;
    const mainSize = availMain * frac;

    const childX = dir === 'row' ? cursor : innerX;
    const childY = dir === 'row' ? innerY : cursor;
    const childW = dir === 'row' ? mainSize : innerW;
    const childH = dir === 'row' ? innerH : mainSize;

    layoutNode(children[i], childX, childY, childW, childH, boxes);

    cursor += mainSize + gap;
  }
}
```

**Step 3: Run backend type-check**

Run: `cd /Users/chulin/gen-image-layer-separator/backend && npx tsc --noEmit`
Expected: No errors

**Step 4: Commit**

```bash
git add backend/src/utils/flexLayout.ts
git commit -m "feat: add flexLayout.ts — recursive flex tree to bounding box computation"
```

---

### Task 2: Modify `svgBuilder.ts` — Render Single SVG from LayoutBoxes

**Files:**
- Modify: `backend/src/utils/svgBuilder.ts`

**Step 1: Add new interface and entry function**

Add at the top of the file (after existing imports):

```typescript
import { LayoutBox } from './flexLayout';
import { wrapText, autoFitFontSize, measureText } from './textMeasure';

export interface FlexSVGInput {
  boxes: LayoutBox[];
  canvasW: number;
  canvasH: number;
  bgImageUrl?: string;              // background image URL (absolute or relative)
  componentImages?: Map<string, string>;  // label → image URL for die-cut components
}

export interface FlexSVGResult {
  svg: string;
  boxes: LayoutBox[];  // pass-through for frontend reference
}
```

**Step 2: Implement `buildFlexSVG()`**

```typescript
const FLEX_FONT_SIZES: Record<string, number> = {
  xlarge: 72,
  large: 56,
  medium: 36,
  small: 24,
  xsmall: 16,
};

export function buildFlexSVG(input: FlexSVGInput): FlexSVGResult {
  const { boxes, canvasW, canvasH, bgImageUrl, componentImages } = input;
  const parts: string[] = [];

  parts.push(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${canvasW} ${canvasH}" width="${canvasW}" height="${canvasH}">`);

  // Background image (full canvas)
  if (bgImageUrl) {
    parts.push(`  <image href="${escapeXml(bgImageUrl)}" x="0" y="0" width="${canvasW}" height="${canvasH}" preserveAspectRatio="xMidYMid slice" />`);
  }

  // Render each box
  for (const box of boxes) {
    if (box.type === 'component') {
      const imgUrl = componentImages?.get(box.label ?? box.id);
      if (imgUrl) {
        parts.push(`  <image id="${escapeXml(box.id)}" data-role="component" data-label="${escapeXml(box.label ?? '')}" href="${escapeXml(imgUrl)}" x="${box.x}" y="${box.y}" width="${box.w}" height="${box.h}" preserveAspectRatio="xMidYMid meet" />`);
      }
    } else if (box.type === 'text' && box.text) {
      parts.push(renderTextBox(box));
    }
  }

  parts.push('</svg>');
  return { svg: parts.join('\n'), boxes };
}

function renderTextBox(box: LayoutBox): string {
  const style = box.style ?? {};
  const maxFontSize = FLEX_FONT_SIZES[style.fontSize ?? 'medium'] ?? 36;
  const fontWeight = style.fontWeight ?? '700';
  const color = style.color ?? '#FFFFFF';
  const align = style.align ?? 'center';
  const anchor = anchorForAlign(align);

  // Auto-fit: find largest font that wraps within box
  let fontSize = maxFontSize;
  let wrapped = wrapText(box.text!, box.w, fontSize, fontWeight);
  const minFont = Math.max(12, maxFontSize * 0.3);
  while (wrapped.totalHeight > box.h && fontSize > minFont) {
    fontSize = Math.round(fontSize * 0.9);
    wrapped = wrapText(box.text!, box.w, fontSize, fontWeight);
  }

  // Compute text-anchor X
  let textX = box.x;
  if (align === 'center') textX = box.x + box.w / 2;
  else if (align === 'right') textX = box.x + box.w;

  // Vertical centering within box
  const totalTextH = wrapped.totalHeight;
  let startY = box.y + (box.h - totalTextH) / 2 + wrapped.lineHeight * 0.8;

  const lines: string[] = [];

  // Clip path for this text box
  const clipId = `clip-${box.id}`;
  lines.push(`  <defs><clipPath id="${clipId}"><rect x="${box.x}" y="${box.y}" width="${box.w}" height="${box.h}" /></clipPath></defs>`);
  lines.push(`  <g id="${escapeXml(box.id)}" data-role="text" clip-path="url(#${clipId})">`);

  for (const line of wrapped.lines) {
    // Stroke (outline) first, then fill
    if (style.strokeColor && (style.strokeWidth ?? 0) > 0) {
      lines.push(`    <text x="${textX}" y="${startY}" font-family="Kanit, sans-serif" font-size="${fontSize}" font-weight="${fontWeight}" fill="none" stroke="${escapeXml(style.strokeColor)}" stroke-width="${style.strokeWidth}" text-anchor="${anchor}">${escapeXml(line)}</text>`);
    }
    lines.push(`    <text x="${textX}" y="${startY}" font-family="Kanit, sans-serif" font-size="${fontSize}" font-weight="${fontWeight}" fill="${escapeXml(color)}" text-anchor="${anchor}">${escapeXml(line)}</text>`);
    startY += wrapped.lineHeight;
  }

  lines.push('  </g>');
  return lines.join('\n');
}
```

**Step 3: Run backend type-check**

Run: `cd /Users/chulin/gen-image-layer-separator/backend && npx tsc --noEmit`
Expected: No errors

**Step 4: Commit**

```bash
git add backend/src/utils/svgBuilder.ts
git commit -m "feat: add buildFlexSVG() — render single SVG from flex layout boxes"
```

---

### Task 3: Modify AI Prompt — Output Flex Tree JSON Instead of Coordinates

**Files:**
- Modify: `backend/src/services/vertex.service.ts` (the `suggestLayoutIntent()` method, lines ~2316-2500)

**Step 1: Rename and rewrite `suggestLayoutIntent()` to output flex tree**

Change the method signature and prompt to request flex tree JSON. The method should:

1. Accept: `imageBuffer, mimeType, targetText, componentLabels: string[], canvasSize: {w, h}`
2. Prompt AI to output flex tree JSON (nested row/column with % sizing, matching the design doc format)
3. Parse and validate the returned JSON
4. Return: `{ flexTree: FlexNode, campaign_vibe: string, background_description: string }`

The new prompt should:
- Describe flex tree format with examples
- List available component labels (from die-cuts)
- Ask AI to assign all text lines + components into the tree
- Use style hints (fontSize semantic sizes, fontWeight, color)
- Mention that `type: "component"` nodes need a `label` matching one of the provided component labels

```typescript
async suggestFlexLayout(
  imageBuffer: Buffer,
  mimeType: string,
  targetText: string,
  componentLabels: string[],
  canvasSize: { w: number; h: number },
): Promise<{ flexTree: FlexNode; campaign_vibe: string; background_description: string }> {
  // ... resize image for AI input ...

  const componentListBlock = componentLabels.length > 0
    ? `\nAVAILABLE COMPONENTS (die-cut images you can place):\n${componentLabels.map(l => `- "${l}"`).join('\n')}\nPlace each component exactly once using type:"component" with matching label.`
    : '\nNo die-cut components available — use text nodes only.';

  const prompt = `You are a professional graphic designer creating an advertising layout.

Given the background image and this campaign text:
"""
${targetText}
"""
${componentListBlock}

OUTPUT a flex tree JSON describing the layout. The flex tree uses CSS-like flex concepts:
- Root node has direction: "row" or "column"
- Container nodes have "direction" and "children"
- Leaf nodes have "type" ("text" or "component"), plus content
- Sizing uses percentage strings: "width": "55%" (for row children) or "height": "40%" (for column children)
- Children without explicit size share remaining space equally

TEXT LEAF FORMAT:
{
  "id": "unique-id",
  "type": "text",
  "text": "the text content",
  "height": "30%",
  "style": {
    "fontSize": "large",        // xlarge|large|medium|small|xsmall
    "fontWeight": "900",        // 400|700|900
    "color": "#FFFFFF",
    "strokeColor": "#000000",   // optional outline
    "strokeWidth": 2,           // optional outline width
    "align": "center"           // left|center|right
  }
}

COMPONENT LEAF FORMAT:
{
  "id": "unique-id",
  "type": "component",
  "label": "exact label from AVAILABLE COMPONENTS",
  "height": "60%"
}

RULES:
1. Every text line from the campaign text must appear in exactly one text leaf
2. Every component from AVAILABLE COMPONENTS must appear exactly once
3. Use 2-level nesting max (root → columns → items within each column)
4. Promotional numbers (prices, discounts) should be LARGE (fontSize: "xlarge" or "large")
5. Fine print / conditions should be SMALL
6. Components and text should be in separate columns when possible
7. Percentages within each container should sum to ~100%
8. Choose colors that contrast well with the background image
9. Use strokeColor for text over busy backgrounds

RESPOND WITH ONLY valid JSON — no markdown, no explanation. Format:
{
  "flexTree": { ... the flex tree root node ... },
  "campaign_vibe": "energetic / calm / premium / playful / etc",
  "background_description": "brief description of the background image"
}`;

  // ... call AI model, parse JSON, validate, return ...
}
```

**Step 2: Add JSON validation for the flex tree**

```typescript
function validateFlexTree(node: any, componentLabels: string[]): string[] {
  const errors: string[] = [];
  if (!node.id) errors.push('Node missing id');
  if (node.children && Array.isArray(node.children)) {
    for (const child of node.children) {
      errors.push(...validateFlexTree(child, componentLabels));
    }
  } else if (node.type === 'component') {
    if (!componentLabels.includes(node.label)) {
      errors.push(`Component label "${node.label}" not in available labels`);
    }
  } else if (node.type === 'text') {
    if (!node.text) errors.push(`Text node "${node.id}" has no text`);
  } else if (!node.children) {
    errors.push(`Node "${node.id}" is neither container nor leaf`);
  }
  return errors;
}
```

**Step 3: Run backend type-check**

Run: `cd /Users/chulin/gen-image-layer-separator/backend && npx tsc --noEmit`
Expected: No errors

**Step 4: Commit**

```bash
git add backend/src/services/vertex.service.ts
git commit -m "feat: add suggestFlexLayout() — AI outputs flex tree JSON instead of coordinates"
```

---

### Task 4: Wire Flex Pipeline into `createCampaign` Controller

**Files:**
- Modify: `backend/src/controllers/image.controller.ts` (lines ~1540-1609, the layout pass)

**Step 1: Replace `suggestLayoutIntent()` + `buildSVG()` with flex pipeline**

In the `createCampaign` method, find the primary layout pass (around line 1572) and replace with:

```typescript
// 1. Collect component labels from die-cuts
const componentLabels = visualComponents.map(c => c.label);

// 2. AI generates flex tree
const flexResult = await vertexService.suggestFlexLayout(
  bgImageBuffer,
  'image/jpeg',
  targetText,
  componentLabels,
  { w: 1024, h: 1024 },
);

// 3. Compute bounding boxes from flex tree
import { computeFlexLayout } from '../utils/flexLayout';
const boxes = computeFlexLayout(flexResult.flexTree, 1024, 1024);

// 4. Build component image URL map
const componentImages = new Map<string, string>();
for (const comp of visualComponents) {
  if (comp.imageUrl) {
    componentImages.set(comp.label, comp.imageUrl);
  }
}

// 5. Build single SVG
import { buildFlexSVG } from '../utils/svgBuilder';
const svgResult = buildFlexSVG({
  boxes,
  canvasW: 1024,
  canvasH: 1024,
  bgImageUrl: bgImageUrl,
  componentImages,
});

analysis.svg_overlay = svgResult.svg;
analysis.campaign_vibe = flexResult.campaign_vibe;
analysis.background_description = flexResult.background_description;

// Store flex tree for AI refinement loop
analysis.flexTree = flexResult.flexTree;
```

**Step 2: Update refinement loop (around line 2066)**

Replace the refinement's `suggestLayoutIntent()` call with `suggestFlexLayout()`, same pattern. On critique, pass the current flex tree as context to the AI so it can adjust.

**Step 3: Update SSE response to include flexTree**

In the final `"done"` SSE event, include `flexTree` alongside `svg_overlay` so the frontend can use it for editing and AI refinement:

```typescript
res.write(`data: ${JSON.stringify({
  type: 'done',
  svg_overlay: analysis.svg_overlay,
  flexTree: analysis.flexTree,
  campaign_vibe: analysis.campaign_vibe,
  // ... existing fields ...
})}\n\n`);
```

**Step 4: Run backend type-check**

Run: `cd /Users/chulin/gen-image-layer-separator/backend && npx tsc --noEmit`
Expected: No errors

**Step 5: Commit**

```bash
git add backend/src/controllers/image.controller.ts
git commit -m "feat: wire flex tree pipeline into createCampaign controller"
```

---

### Task 5: Update Frontend — Display Single SVG

**Files:**
- Modify: `frontend/src/components/AIRefinementPreview.vue`
- Modify: `frontend/src/components/LayerEditor.vue`

**Step 1: Update AIRefinementPreview to use the single SVG**

The preview already renders `svg_overlay` via `v-html`. The main change: since the SVG now contains BG + components + text, remove the separate background `<img>` and component overlay divs when SVG mode is active.

In the template, wrap the background image in a `v-if="!hasSvgOverlay"`:

```html
<!-- Background image: only show when NO SVG overlay (SVG includes its own BG) -->
<img v-if="!hasSvgOverlay" :src="bgUrl" class="canvas-bg" @load="onPreviewImageLoad" />

<!-- Single SVG with everything (BG + components + text) -->
<div v-if="hasSvgOverlay" v-html="sanitizedSvgOverlay" class="svg-overlay-layer full-svg" />
```

Add computed:
```typescript
const hasSvgOverlay = computed(() => !!liveSvgOverlay.value && liveSvgOverlay.value.length > 50);
```

CSS for `.full-svg`:
```css
.full-svg :deep(svg) {
  width: 100%;
  height: auto;
  display: block;
}
```

**Step 2: Store flexTree from SSE for future refinement**

In the `"done"` event handler, save the flex tree:

```typescript
if (data.flexTree) {
  currentFlexTree.value = data.flexTree;
}
```

**Step 3: Update LayerEditor similarly**

Same pattern — when `svg_overlay` is present, show only the SVG (it has BG baked in). Hide separate BG image and component layers in SVG mode.

**Step 4: Run frontend type-check**

Run: `cd /Users/chulin/gen-image-layer-separator/frontend && npx vue-tsc --noEmit`
Expected: No errors (or only pre-existing warnings)

**Step 5: Commit**

```bash
git add frontend/src/components/AIRefinementPreview.vue frontend/src/components/LayerEditor.vue
git commit -m "feat: update frontend to display single SVG with BG + components + text"
```

---

### Task 6: End-to-End Verification

**Step 1: Start backend**

Run: `cd /Users/chulin/gen-image-layer-separator/backend && npm run dev`

**Step 2: Start frontend**

Run: `cd /Users/chulin/gen-image-layer-separator/frontend && npm run dev`

**Step 3: Test campaign creation**

1. Upload an image with multiple components (e.g. person + mascot)
2. Enter campaign text with promotional numbers + fine print
3. Verify:
   - Backend logs show flex tree JSON from AI
   - Backend logs show computed bounding boxes (no overlaps by construction)
   - Preview (Tab 2) shows single SVG with BG + components + text
   - No element overlaps any other element
   - Text is readable and properly sized
   - Editor (Tab 3) shows the same SVG
   - SVG can be downloaded/exported

**Step 4: Commit any adjustments**

```bash
git add -A
git commit -m "fix: adjust flex tree layout based on e2e test"
```

---

### Task 7: Clean Up Legacy Code

**Files:**
- Modify: `backend/src/services/vertex.service.ts`
- Modify: `backend/src/controllers/image.controller.ts`

**Step 1: Remove or deprecate old layout functions**

- Mark `suggestLayoutSVG()` as deprecated (add `@deprecated` JSDoc)
- Mark `planLayoutStrategy()` as deprecated
- Remove `computeSafeZones()` if it exists and is only used by deprecated paths
- Remove the old `normalizedToPixelsClamped()` helper if unused

Do NOT delete these yet — just mark deprecated. They can be removed in a future cleanup once the flex tree path is confirmed stable.

**Step 2: Remove overlap detection code from prompt (Task 1 of no-overlap plan)**

The overlap detection in the AI prompt (`overlapWarnings` block in `planLayoutStrategy`) is no longer needed since the flex tree prevents overlap by design. Mark as deprecated alongside the function.

**Step 3: Run backend type-check**

Run: `cd /Users/chulin/gen-image-layer-separator/backend && npx tsc --noEmit`
Expected: No errors

**Step 4: Commit**

```bash
git add backend/src/services/vertex.service.ts backend/src/controllers/image.controller.ts
git commit -m "chore: deprecate old coordinate-based layout functions (replaced by flex tree)"
```
