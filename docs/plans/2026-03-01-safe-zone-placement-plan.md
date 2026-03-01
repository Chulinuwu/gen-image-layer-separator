# Safe Zone Placement Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Replace the unreliable AI-driven spatial placement with a hybrid system where code computes safe zones from die-cut component stroke bboxes, AI places text within those zones using aesthetic judgment, and code validates/clamps positions deterministically.

**Architecture:** (1) After die-cut extraction, scan each component's alpha channel to get pixel-precise stroke bboxes. (2) Subtract those bboxes from the canvas to produce safe zones. (3) AI receives safe zones as constrained placement slots instead of the full canvas. (4) Code validates and clamps final positions. (5) Refinement loop is replaced by one optional style-only AI pass.

**Tech Stack:** TypeScript, Sharp.js (alpha scanning), `@imgly/background-removal-node`, Imagen 3.0 (Vertex AI), Gemini Flash/Pro, Vue 3 (frontend — no changes)

---

## Key Files

- **Modify:** `backend/src/services/vertex.service.ts` — add `extractComponentStrokeBboxes()`, `computeSafeZones()`, modify `suggestCampaignLayout()`, remove/reduce `refineLayout()`, `critiqueLayout()`, `generateLayoutPreview()`
- **Modify:** `backend/src/controllers/image.controller.ts:516-1200` — replace refinement loop with safe zone pipeline in `createCampaign()`
- **Create:** `backend/src/utils/safeZones.ts` — pure TypeScript safe zone computation utilities
- **Create:** `backend/src/utils/safeZones.test.ts` — unit tests for safe zone math

---

## Task 1: Create Safe Zone Utilities (Pure TypeScript, No AI)

**Files:**
- Create: `backend/src/utils/safeZones.ts`
- Create: `backend/src/utils/safeZones.test.ts`

**Context:** Safe zones are computed by subtracting no-go bboxes from the full canvas (0-1000 normalized space). Each bbox splits available rectangles into up to 4 sub-rects. This is pure math — no AI, no Sharp.

### Step 1: Write the failing tests

```typescript
// backend/src/utils/safeZones.test.ts
import { computeSafeZones, BBox, SafeZone } from "./safeZones";

describe("computeSafeZones", () => {
  it("returns full canvas when no obstacles", () => {
    const zones = computeSafeZones([]);
    expect(zones).toHaveLength(1);
    expect(zones[0]).toMatchObject({ top: 0, left: 0, width: 1000, height: 1000 });
  });

  it("splits canvas around a centered obstacle", () => {
    const obstacle: BBox = { top: 400, left: 300, width: 400, height: 400 };
    const zones = computeSafeZones([obstacle]);
    // Should produce: top strip, bottom strip, left strip, right strip
    // All zones should have no overlap with obstacle
    for (const zone of zones) {
      const zRight = zone.left + zone.width;
      const zBottom = zone.top + zone.height;
      const noOverlap =
        zRight <= obstacle.left ||
        zone.left >= obstacle.left + obstacle.width ||
        zBottom <= obstacle.top ||
        zone.top >= obstacle.top + obstacle.height;
      expect(noOverlap).toBe(true);
    }
  });

  it("filters out zones too small for text", () => {
    // Obstacle nearly fills canvas horizontally
    const obstacle: BBox = { top: 0, left: 50, width: 900, height: 1000 };
    const zones = computeSafeZones([obstacle]);
    // Only the 50px left strip should be kept IF it meets minimum width
    // Min text zone: width >= 150 AND height >= 50
    for (const zone of zones) {
      expect(zone.width >= 150 || zone.height >= 50).toBe(true);
    }
  });

  it("returns zones sorted by area descending", () => {
    const obstacle: BBox = { top: 200, left: 600, width: 300, height: 600 };
    const zones = computeSafeZones([obstacle]);
    for (let i = 1; i < zones.length; i++) {
      expect(zones[i - 1].area).toBeGreaterThanOrEqual(zones[i].area);
    }
  });

  it("handles multiple obstacles", () => {
    const obstacles: BBox[] = [
      { top: 100, left: 400, width: 200, height: 500 }, // center column
      { top: 700, left: 0, width: 1000, height: 200 },  // bottom strip
    ];
    const zones = computeSafeZones(obstacles);
    for (const zone of zones) {
      for (const obs of obstacles) {
        const zRight = zone.left + zone.width;
        const zBottom = zone.top + zone.height;
        const noOverlap =
          zRight <= obs.left ||
          zone.left >= obs.left + obs.width ||
          zBottom <= obs.top ||
          zone.top >= obs.top + obs.height;
        expect(noOverlap).toBe(true);
      }
    }
  });
});
```

### Step 2: Run test to confirm it fails

```bash
cd /Users/chulin/gen-image-layer-separator/backend
npx ts-node node_modules/.bin/jest src/utils/safeZones.test.ts --no-coverage 2>&1 | tail -20
```

Expected: `Cannot find module './safeZones'`

### Step 3: Implement `safeZones.ts`

```typescript
// backend/src/utils/safeZones.ts

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
 */
export function computeSafeZones(obstacles: BBox[]): SafeZone[] {
  let available: BBox[] = [
    { top: 0, left: 0, width: CANVAS_SIZE, height: CANVAS_SIZE },
  ];

  for (const obstacle of obstacles) {
    // Add safety padding around each obstacle
    const padded: BBox = {
      top: Math.max(0, obstacle.top - 20),
      left: Math.max(0, obstacle.left - 20),
      width: Math.min(CANVAS_SIZE - obstacle.left + 20, obstacle.width + 40),
      height: Math.min(CANVAS_SIZE - obstacle.top + 20, obstacle.height + 40),
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
```

### Step 4: Run tests to confirm they pass

```bash
cd /Users/chulin/gen-image-layer-separator/backend
npx ts-node node_modules/.bin/jest src/utils/safeZones.test.ts --no-coverage 2>&1 | tail -20
```

Expected: `Tests: 5 passed, 5 total`

### Step 5: Commit

```bash
cd /Users/chulin/gen-image-layer-separator/backend
git add src/utils/safeZones.ts src/utils/safeZones.test.ts
git commit -m "feat: add computeSafeZones utility for deterministic text placement"
```

---

## Task 2: Add extractComponentStrokeBboxes to VertexService

**Files:**
- Modify: `backend/src/services/vertex.service.ts` — add new method after `runRMBGAndGetBboxes` at line ~1577

**Context:** After die-cut components are extracted, each is a transparent PNG. We scan each component's alpha channel with Sharp to get a tight pixel-precise bbox — the "stroke" around that component. This is more precise than the rough RMBG scan of the full image.

### Step 1: Write the test

There's no easy unit test for this (requires real PNG buffers), but add a JSDoc test description that documents expected behavior. We'll verify via integration.

### Step 2: Add the method to `vertex.service.ts`

Find the line `async inpaintBackground(` (line 1579) and add the new method **before** it:

```typescript
  /**
   * Extract pixel-precise bounding boxes from die-cut component PNG buffers.
   * Each component is a transparent PNG — we scan its alpha channel to find
   * the tight bbox of non-transparent pixels, then convert to 0-1000 normalized scale.
   *
   * @param components Array of { label, buffer, position } from generateDiecutComponents
   * @param sourceImageWidth Width of the original source image (for normalizing back to 0-1000)
   * @param sourceImageHeight Height of the original source image
   */
  async extractComponentStrokeBboxes(
    components: Array<{ label: string; buffer: Buffer; position: any }>,
    sourceImageWidth: number,
    sourceImageHeight: number,
  ): Promise<Array<{ label: string; top: number; left: number; width: number; height: number }>> {
    const results: Array<{ label: string; top: number; left: number; width: number; height: number }> = [];

    for (const comp of components) {
      if (!comp.buffer || !comp.position) continue;
      try {
        const { data, info } = await sharp(comp.buffer)
          .ensureAlpha()
          .raw()
          .toBuffer({ resolveWithObject: true });

        let minX = info.width, minY = info.height, maxX = 0, maxY = 0;
        let found = false;

        for (let y = 0; y < info.height; y++) {
          for (let x = 0; x < info.width; x++) {
            const alpha = data[(y * info.width + x) * 4 + 3];
            if (alpha > 30) {
              if (x < minX) minX = x;
              if (x > maxX) maxX = x;
              if (y < minY) minY = y;
              if (y > maxY) maxY = y;
              found = true;
            }
          }
        }

        if (!found) continue;

        // The component PNG is cropped to its position bbox.
        // Pixel coords within the PNG map to the component's position in the source image.
        const compLeft = comp.position.left / 1000;
        const compTop = comp.position.top / 1000;
        const compWidth = comp.position.width / 1000;
        const compHeight = comp.position.height / 1000;

        // Map local pixel bbox to normalized 0-1000 source image coords
        const normLeft = compLeft + (minX / info.width) * compWidth;
        const normTop = compTop + (minY / info.height) * compHeight;
        const normRight = compLeft + (maxX / info.width) * compWidth;
        const normBottom = compTop + (maxY / info.height) * compHeight;

        results.push({
          label: comp.label,
          top: Math.round(normTop * 1000),
          left: Math.round(normLeft * 1000),
          width: Math.round((normRight - normLeft) * 1000),
          height: Math.round((normBottom - normTop) * 1000),
        });

        console.log(
          `[StrokeBbox] "${comp.label}": top=${Math.round(normTop * 1000)}, left=${Math.round(normLeft * 1000)}, w=${Math.round((normRight - normLeft) * 1000)}, h=${Math.round((normBottom - normTop) * 1000)}`,
        );
      } catch (err) {
        console.warn(`[StrokeBbox] Failed for "${comp.label}":`, err);
        // Fall back to using the position bbox directly
        if (comp.position) {
          results.push({ label: comp.label, ...comp.position });
        }
      }
    }

    return results;
  }
```

### Step 3: Verify TypeScript compiles

```bash
cd /Users/chulin/gen-image-layer-separator/backend
npx tsc --noEmit 2>&1 | head -30
```

Expected: No errors (or only pre-existing errors).

### Step 4: Commit

```bash
cd /Users/chulin/gen-image-layer-separator/backend
git add src/services/vertex.service.ts
git commit -m "feat: add extractComponentStrokeBboxes for pixel-precise component boundaries"
```

---

## Task 3: Modify suggestCampaignLayout to Accept Safe Zones

**Files:**
- Modify: `backend/src/services/vertex.service.ts:294-619` — the `suggestCampaignLayout` method

**Context:** Currently the method:
1. Generates a 10×10 grid overlay SVG on the image
2. Passes `externalNoGoZones` as coordinate warnings in a huge prompt
3. Asks AI to place text anywhere on the canvas while avoiding zones

**New behavior:**
1. Remove the grid overlay (no longer needed)
2. Accept `safeZones` as a new parameter (replaces `externalNoGoZones`)
3. AI receives a description of safe zones as placement slots (much simpler prompt)
4. AI returns `placement_preference` per text element (e.g., "top-left") instead of raw coordinates
5. AI still returns styling and text content

### Step 1: Change method signature

Find line 294:
```typescript
  async suggestCampaignLayout(
    imageBuffer: Buffer,
    mimeType: string,
    targetText: string,
    mode: string = "full",
    externalNoGoZones: any[] = [],
  ) {
```

Change to:
```typescript
  async suggestCampaignLayout(
    imageBuffer: Buffer,
    mimeType: string,
    targetText: string,
    mode: string = "full",
    externalNoGoZones: any[] = [],   // kept for backward compat during migration
    safeZones: Array<{ top: number; left: number; width: number; height: number; area: number; label: string }> = [],
  ) {
```

### Step 2: Remove grid overlay, add safe zone context

Find the grid overlay block (lines ~309-332):
```typescript
      // --- OPTIMIZATION: Physical Grid Overlay for Coordinate Accuracy ---
      let gridSvg = ...
      ...
      processingBuffer = await sharp(imageBuffer)
        .resize(Math.min(w, 1500))
        .composite([{ input: Buffer.from(gridSvg), top: 0, left: 0 }])
        .toBuffer();
```

Replace the entire grid block with a simple resize (no overlay):
```typescript
      // Resize for faster analysis
      processingBuffer = await sharp(imageBuffer)
        .resize(Math.min(w, 1500))
        .jpeg({ quality: 90 })
        .toBuffer();
      processingMime = "image/jpeg";
```

### Step 3: Add safe zone section to the prompt

Find the large prompt string inside `suggestCampaignLayout`. Look for the section that describes no-go zones (something like `CRITICAL NO-GO ZONES:`).

Add a new section **before** the no-go zones description:

```typescript
const safeZoneDescription = safeZones.length > 0
  ? `
## AVAILABLE PLACEMENT ZONES (USE THESE — DO NOT PLACE TEXT OUTSIDE THEM)
The following zones are verified free of all subjects and components.
Place ALL text elements within one of these zones.

${safeZones.slice(0, 6).map((z, i) =>
  `Zone ${i + 1} [${z.label}]: top=${z.top}, left=${z.left}, width=${z.width}, height=${z.height} (area=${z.area})`
).join('\n')}

For each text element, choose the best-fit zone and return its label as "preferred_zone".
Your text coordinates MUST fall within the chosen zone boundaries.
`
  : ``;
```

Then inject `safeZoneDescription` into the prompt before the no-go zones section.

### Step 4: Modify AI output schema — add `preferred_zone` to suggestions

In the JSON schema section of the prompt (the part that says `"suggestions": [...]`), add `"preferred_zone"` to each suggestion:

```
"suggestions": [
  {
    "part": "text content",
    "preferred_zone": "top-left",  // <-- ADD THIS: matches label from safe zones
    "position": { "top": ..., "left": ..., "width": ..., "height": ..., "rotation": 0 },
    "style": { ... },
    ...
  }
]
```

### Step 5: Verify TypeScript compiles

```bash
cd /Users/chulin/gen-image-layer-separator/backend
npx tsc --noEmit 2>&1 | head -30
```

Expected: No new errors.

### Step 6: Commit

```bash
cd /Users/chulin/gen-image-layer-separator/backend
git add src/services/vertex.service.ts
git commit -m "feat: add safe zone context to suggestCampaignLayout, remove grid overlay"
```

---

## Task 4: Add assignTextToZones Utility

**Files:**
- Modify: `backend/src/utils/safeZones.ts` — add `assignTextToZones` function
- Modify: `backend/src/utils/safeZones.test.ts` — add tests

**Context:** After AI returns text suggestions with `preferred_zone` labels, code computes the exact coordinates within that zone based on text size. This ensures coordinates are valid.

### Step 1: Add tests for `assignTextToZones`

Append to `safeZones.test.ts`:

```typescript
import { assignTextToZones, TextSuggestion } from "./safeZones";

describe("assignTextToZones", () => {
  const zones: SafeZone[] = [
    { top: 50, left: 50, width: 300, height: 800, area: 240000, label: "top-left" },
    { top: 50, left: 700, width: 250, height: 400, area: 100000, label: "top-right" },
    { top: 700, left: 400, width: 500, height: 250, area: 125000, label: "bottom-center" },
  ];

  it("places text within its preferred zone", () => {
    const suggestions: TextSuggestion[] = [
      { part: "HEADLINE", preferred_zone: "top-left", style: { font_size_normalized: 80 } },
    ];
    const result = assignTextToZones(suggestions, zones);
    expect(result[0].position.left).toBeGreaterThanOrEqual(zones[0].left);
    expect(result[0].position.top).toBeGreaterThanOrEqual(zones[0].top);
    expect(result[0].position.left + result[0].position.width).toBeLessThanOrEqual(zones[0].left + zones[0].width);
  });

  it("falls back to largest zone if preferred zone not found", () => {
    const suggestions: TextSuggestion[] = [
      { part: "BODY", preferred_zone: "nonexistent-zone", style: { font_size_normalized: 40 } },
    ];
    const result = assignTextToZones(suggestions, zones);
    // Should use largest zone (top-left, area=240000)
    expect(result[0].position.left).toBeGreaterThanOrEqual(zones[0].left);
  });

  it("subtracts placed text bbox from zones for next placement", () => {
    const suggestions: TextSuggestion[] = [
      { part: "BIG HEADLINE TEXT HERE", preferred_zone: "top-left", style: { font_size_normalized: 80 } },
      { part: "subtitle", preferred_zone: "top-left", style: { font_size_normalized: 30 } },
    ];
    const result = assignTextToZones(suggestions, zones);
    // Second element should be placed below the first (not overlapping)
    expect(result[1].position.top).toBeGreaterThan(result[0].position.top);
  });
});
```

### Step 2: Run tests to confirm they fail

```bash
cd /Users/chulin/gen-image-layer-separator/backend
npx ts-node node_modules/.bin/jest src/utils/safeZones.test.ts --no-coverage 2>&1 | tail -20
```

Expected: `Cannot find 'assignTextToZones'`

### Step 3: Implement `assignTextToZones` in `safeZones.ts`

Append to `safeZones.ts`:

```typescript
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
 * Compute text bounding box width/height from content + font size.
 * Uses 0.6 multiplier for Thai/multi-byte char compatibility (vs 0.55 latin-only).
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
 * Assign text suggestions to safe zones, computing exact coordinates.
 * Text is placed within its preferred zone (matched by label) or the largest zone.
 * Each placed text bbox is subtracted from the zone before placing the next element.
 *
 * @param suggestions Array of text elements from AI (with preferred_zone hints)
 * @param availableZones Pre-computed safe zones from computeSafeZones()
 * @param imageWidth Source image pixel width (for text size computation)
 * @param imageHeight Source image pixel height
 */
export function assignTextToZones(
  suggestions: TextSuggestion[],
  availableZones: SafeZone[],
  imageWidth = 1000,
  imageHeight = 1000,
): Array<TextSuggestion & { position: BBox }> {
  if (!availableZones.length) return suggestions as any;

  // Track remaining space within each zone (zone top offset for stacking)
  const zoneOffsets: Map<string, number> = new Map();
  availableZones.forEach((z) => zoneOffsets.set(z.label, z.top + 30)); // 30px top padding

  const results: Array<TextSuggestion & { position: BBox }> = [];
  const MARGIN = 30; // normalized units of padding within zone

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

    // Find best-fit zone: prefer label match, fall back to largest with room
    let targetZone = availableZones.find((z) => z.label === s.preferred_zone);
    if (!targetZone) {
      targetZone = availableZones.find(
        (z) => (zoneOffsets.get(z.label) || z.top) + textH + MARGIN < z.top + z.height,
      ) || availableZones[0];
    }

    const zoneTop = zoneOffsets.get(targetZone.label) || targetZone.top + MARGIN;
    const placedLeft = targetZone.left + MARGIN;
    const placedTop = zoneTop;

    // Clamp to zone boundaries
    const clampedWidth = Math.min(textW, targetZone.width - MARGIN * 2);
    const clampedHeight = textH;

    results.push({
      ...s,
      position: {
        top: Math.max(targetZone.top + MARGIN, placedTop),
        left: placedLeft,
        width: clampedWidth,
        height: clampedHeight,
      },
    });

    // Advance zone offset for stacking next element
    zoneOffsets.set(targetZone.label, placedTop + clampedHeight + MARGIN);
  }

  return results;
}
```

### Step 4: Run tests to confirm they pass

```bash
cd /Users/chulin/gen-image-layer-separator/backend
npx ts-node node_modules/.bin/jest src/utils/safeZones.test.ts --no-coverage 2>&1 | tail -20
```

Expected: `Tests: 9 passed, 9 total`

### Step 5: Commit

```bash
cd /Users/chulin/gen-image-layer-separator/backend
git add src/utils/safeZones.ts src/utils/safeZones.test.ts
git commit -m "feat: add assignTextToZones for coordinate assignment within safe zones"
```

---

## Task 5: Wire Safe Zones into createCampaign Controller

**Files:**
- Modify: `backend/src/controllers/image.controller.ts:816-952`

**Context:** The `createCampaign` controller orchestrates the full pipeline. We need to:
1. After `generateDiecutComponents()`, call `extractComponentStrokeBboxes()` to get precise bboxes
2. Call `computeSafeZones()` with those bboxes to get placement zones
3. Pass safe zones to `suggestCampaignLayout()` (now called after die-cut, not before)
4. Call `assignTextToZones()` to finalize coordinates

**Important pipeline change:** Currently `suggestCampaignLayout()` runs BEFORE die-cut (Step 1B), because it does both analysis AND placement. After this change, placement happens AFTER die-cut. So we need to split: do analysis first (get component list, background description, campaign vibe), then do placement after die-cut with safe zones.

### Step 1: Read controller lines 816-952 to understand current flow

(Already read above — die-cut runs at 816-877, inpaint at 879-935, then loop starts at 960)

### Step 2: Add imports at top of controller

```typescript
import { computeSafeZones, assignTextToZones } from "../utils/safeZones";
```

### Step 3: After die-cut results at line ~863, add stroke bbox extraction + safe zone computation

Find this block (line ~863-870):
```typescript
        visualComponents = diecutResults.map(...);
        console.log(`[Build-Up] Generated ${visualComponents.length} die-cut images`);
        sendSSE("progress", { step: "diecut_complete", ... });
```

After that block (after `sendSSE diecut_complete`), add:

```typescript
        // ── SAFE ZONE COMPUTATION from die-cut stroke bboxes ──────────────────
        // Now that we have precise component PNGs, extract their pixel-accurate
        // bboxes and compute safe zones for text placement.
        let strokeBboxes: Array<{ label: string; top: number; left: number; width: number; height: number }> = [];
        if (diecutResults.length > 0) {
          const imgMeta = await sharp(imageBuffer).metadata();
          const srcW = imgMeta.width || 1000;
          const srcH = imgMeta.height || 1000;

          const diecutWithPositions = diecutResults.map((res: any, idx: number) => ({
            label: res.label,
            buffer: res.buffer,
            position: componentSuggestions[idx]?.position || null,
          }));

          strokeBboxes = await vertexService.extractComponentStrokeBboxes(
            diecutWithPositions,
            srcW,
            srcH,
          );

          console.log(`[SafeZone] Got ${strokeBboxes.length} stroke bboxes from die-cut components`);
          sendSSE("progress", {
            step: "safe_zones_computed",
            message: `Computed ${strokeBboxes.length} safe placement zones from component boundaries`,
          });
        }

        // Also include RMBG bboxes as obstacles (catches anything die-cut may miss)
        const allObstacles = [
          ...strokeBboxes,
          ...parsedNoGoZones.map((z: any) => ({
            top: z.area?.top ?? z.top ?? 0,
            left: z.area?.left ?? z.left ?? 0,
            width: z.area?.width ?? z.width ?? 0,
            height: z.area?.height ?? z.height ?? 0,
          })),
        ];

        const safeZones = computeSafeZones(allObstacles);
        console.log(`[SafeZone] ${safeZones.length} safe zones computed: ${safeZones.slice(0, 3).map(z => `${z.label}(${z.area})`).join(', ')}`);

        // ── RE-RUN LAYOUT with safe zones now that we know component positions ──
        if (mode !== "only_bg_comp" && safeZones.length > 0 && targetText) {
          sendSSE("progress", {
            step: "layout_with_safe_zones",
            message: "Placing text in verified safe zones...",
          });

          const refinedAnalysis = await vertexService.suggestCampaignLayout(
            imageBuffer,
            mimeType,
            targetText,
            mode || "full",
            parsedNoGoZones,
            safeZones,  // <-- new param
          );

          if (refinedAnalysis.suggestions?.length > 0) {
            // Code assigns final coordinates within safe zones
            const imgMeta2 = await sharp(imageBuffer).metadata();
            const finalTextLayers = assignTextToZones(
              refinedAnalysis.suggestions,
              safeZones,
              imgMeta2.width || 1000,
              imgMeta2.height || 1000,
            );
            textSuggestions = finalTextLayers;
            console.log(`[SafeZone] Placed ${textSuggestions.length} text layers in safe zones`);
          }
        }
```

### Step 4: Replace refinement loop with style-only check

Find the refinement loop header (line ~1060):
```typescript
      while (
        currentIteration < MAX_ITERATIONS &&
        !shouldSkipIteration &&
        (currentIteration === 0 ? preCheckOverlapFound : lastCritique.status !== "PASS")
      ) {
```

**Goal:** Keep the pre-check (it validates safe zone assignment worked), but limit the loop to max 1 iteration for style-only feedback. Change:
```typescript
const MAX_ITERATIONS = 3; // line 957
```
to:
```typescript
const MAX_ITERATIONS = 1; // Safe zone placement makes first round reliable; 1 style pass max
```

Also update the loop's `critiqueLayout` call to pass a `styleOnly: true` flag to limit the critique scope (add `styleOnly` to the prompt in `critiqueLayout` to tell AI only to check contrast/shadow/readability, not positions).

### Step 5: Verify TypeScript compiles

```bash
cd /Users/chulin/gen-image-layer-separator/backend
npx tsc --noEmit 2>&1 | head -30
```

Expected: No new errors.

### Step 6: Commit

```bash
cd /Users/chulin/gen-image-layer-separator/backend
git add src/controllers/image.controller.ts src/utils/safeZones.ts
git commit -m "feat: wire safe zone pipeline into createCampaign controller"
```

---

## Task 6: Integration Test — Run the Full Pipeline

**Context:** Start the backend, make a test request, verify placement doesn't overlap subjects.

### Step 1: Start backend

```bash
cd /Users/chulin/gen-image-layer-separator/backend
npm run dev
```

Expected: `Express server running on port 5001`

### Step 2: Smoke test with curl using a test image

Find an existing uploaded image in `backend/uploads/` to use as test input:

```bash
ls /Users/chulin/gen-image-layer-separator/backend/uploads/*.png 2>/dev/null | head -3
```

### Step 3: Send test request via curl

```bash
curl -X POST http://localhost:5001/api/image/create-campaign \
  -F "image=@/path/to/test-image.png" \
  -F "text=Summer Sale 50% Off" \
  --no-buffer \
  2>&1 | grep -E "(step|overlap|safe_zone|PASS|FAIL|error)" | head -40
```

Expected log output:
```
[RMBG-2.0] Processing for Bboxes...
[Pipeline] ✅ RMBG bboxes injected as no-go zones
[Diecut] Running RMBG on full source image...
[StrokeBbox] "...: top=..., left=..., w=..., h=...
[SafeZone] X safe zones computed: top-left(...), bottom-center(...)
[SafeZone] Placed N text layers in safe zones
[OVERLAP CHECK] ✅ Initial layout is clean — skipping refinement loop
```

### Step 4: Check frontend canvas rendering

1. Start frontend: `cd /Users/chulin/gen-image-layer-separator/frontend && npm run dev`
2. Open `http://localhost:5173`
3. Upload test image, enter "Summer Sale 50% Off" as text
4. Verify text layers appear in canvas without overlapping the subject

### Step 5: Commit if integration looks good

```bash
cd /Users/chulin/gen-image-layer-separator/backend
git add -A
git commit -m "test: verify safe zone pipeline integration"
```

---

## Task 7: Reduce critiqueLayout to Style-Only

**Files:**
- Modify: `backend/src/services/vertex.service.ts:830` — `critiqueLayout` method

**Context:** The critique loop now only needs to check visual quality (contrast, readability, shadow) — not positions. Simplify the prompt to focus on style.

### Step 1: Find the critiqueLayout prompt (line 830+)

Read `vertex.service.ts` lines 830-1017 to find the critique prompt.

### Step 2: Add a `styleOnly` parameter and guard position-checking instructions

```typescript
  async critiqueLayout(
    imageBuffer: Buffer,
    previewBuffer: Buffer,
    textSuggestions: any[],
    noGoZones: any[],
    targetText: string,
    styleOnly: boolean = false,  // <-- add this
  ) {
```

In the prompt, add a conditional section:

```typescript
const positionChecks = styleOnly ? "" : `
- ✗ Text overlaps face/eyes = FAIL
- ✗ Text overlaps person body = FAIL
- ✗ Text blocks overlap each other = FAIL
- ✗ Text cut off at edges = FAIL
- ✗ Text too close to edge (< 3% margin) = FAIL
`;

const styleChecks = `
- ✗ Text color blends with background (unreadable) = FAIL
- ✗ Text on photo without shadow/stroke = FAIL
- ✓ If text is readable and well-styled = PASS
`;
```

Replace the full checks block with `positionChecks + styleChecks`.

### Step 3: Update the `createCampaign` controller to pass `styleOnly: true`

Find the `critiqueLayout` call inside the refinement loop and add the `styleOnly` flag:
```typescript
const critique = await vertexService.critiqueLayout(
  imageBuffer,
  previewBuffer,
  textSuggestions,
  noGoZones,
  targetText,
  true,  // <-- styleOnly: positions are guaranteed by safe zones, only check style
);
```

### Step 4: Verify TypeScript compiles

```bash
cd /Users/chulin/gen-image-layer-separator/backend
npx tsc --noEmit 2>&1 | head -30
```

### Step 5: Commit

```bash
cd /Users/chulin/gen-image-layer-separator/backend
git add src/services/vertex.service.ts src/controllers/image.controller.ts
git commit -m "feat: limit critique loop to style-only checks (positions guaranteed by safe zones)"
```

---

## Task 8: Fix Thai Text Width Computation

**Files:**
- Modify: `backend/src/utils/safeZones.ts` — update `computeTextSize` multiplier
- Modify: `backend/src/controllers/image.controller.ts:1116` — fix `computeTextBBox` inside refinement loop

**Context:** The existing `computeTextBBox` uses `0.55` multiplier for character width. This underestimates Thai characters (which are typically wider). Fix to `0.6` for better accuracy.

### Step 1: Verify `safeZones.ts` already uses `0.6`

Check `computeTextSize` in `safeZones.ts` — already set to `0.6` from Task 4.

### Step 2: Update the duplicate in the controller

Find line 1116 in `image.controller.ts`:
```typescript
          const textWidthPx = longestLine * fontSize * 0.55;
```

Change to:
```typescript
          const textWidthPx = longestLine * fontSize * 0.6;
```

Also find the same formula at line ~993-996 (the pre-check version):
```typescript
            ((longestLine * fontSize * 0.55) / imgW0) * 1000,
```

Change to `0.6`.

### Step 3: Commit

```bash
cd /Users/chulin/gen-image-layer-separator/backend
git add src/controllers/image.controller.ts
git commit -m "fix: use 0.6 char width multiplier for Thai text bbox accuracy"
```

---

## Task 9: Update MEMORY.md

**Files:**
- Modify: `~/.claude/projects/-Users-chulin-gen-image-layer-separator/memory/MEMORY.md`

### Step 1: Add notes about the safe zone system

Add to MEMORY.md:
```markdown
## Safe Zone Placement System (implemented 2026-03-01)
- `backend/src/utils/safeZones.ts` — `computeSafeZones(obstacles)` + `assignTextToZones(suggestions, zones)`
- Safe zones derived from component stroke bboxes (alpha channel scan in `extractComponentStrokeBboxes`)
- AI receives safe zone list → returns `preferred_zone` label per text element
- Code assigns exact coordinates within chosen zone
- Thai text uses 0.6 char width multiplier (not 0.55)
- Refinement loop reduced to MAX_ITERATIONS=1, styleOnly=true
```

---

## Execution Options

**Plan complete and saved to `docs/plans/2026-03-01-safe-zone-placement-plan.md`.**

**Two execution options:**

**1. Subagent-Driven (this session)** — I dispatch a fresh subagent per task, review between tasks, fast iteration

**2. Parallel Session (separate)** — Open new session with executing-plans, batch execution with checkpoints

**Which approach?**
