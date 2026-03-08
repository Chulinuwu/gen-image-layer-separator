# Plan: Measure → SVG Architecture

**Date:** 2026-03-08  
**Brainstorm ref:** [brainstorm.md](file:///Users/chulin/gen-image-layer-separator/artifacts/superpowers/brainstorm.md)  
**Goal:** Replace AI-guessed SVG coordinates with server-measured layout → editable native SVG output

---

## Architecture Overview

```
BEFORE (Phase 6):
  AI prompt → AI writes raw SVG string → clipPath + hope for the best → 💀

AFTER (Phase 7):
  AI → Layout Intent JSON (creative decisions only)
      ↓
  Server measures text widths (canvas API + Kanit font)
      ↓
  Server auto-fits: resize if overflow, wrap if needed
      ↓
  Server builds native SVG from measured coordinates
      ↓
  Clean <text>/<tspan> elements → editable in Illustrator ✅
```

---

## Step 1: Add Text Measurement Utility

**File:** `backend/src/utils/textMeasure.ts` (new)  
**Dependency:** `@napi-rs/canvas` (fast Rust-based canvas for Node) or fallback `canvas` (node-canvas)

```typescript
// Core API:
measureText(text: string, fontSize: number, fontWeight: string, fontFamily?: string)
  → { width: number, height: number, ascent: number, descent: number }

wrapText(text: string, maxWidth: number, fontSize: number, fontWeight: string)
  → { lines: string[], lineHeight: number, totalHeight: number }

autoFitFontSize(text: string, maxWidth: number, maxFontSize: number, minFontSize: number)
  → { fontSize: number, width: number }
```

**What it does:**

1. Loads Kanit font file (woff2/ttf from `backend/assets/fonts/`)
2. Creates a canvas context, sets font, calls `ctx.measureText()`
3. Returns real pixel dimensions
4. `wrapText`: iteratively splits text into lines that fit `maxWidth`
5. `autoFitFontSize`: binary search for largest font-size that fits

**Verify:**

```bash
npx ts-node -e "
  import { measureText } from './src/utils/textMeasure';
  console.log(measureText('2 ต่อ', 200, '900'));
  // Expect: { width: ~580, height: ~240, ... }
"
```

---

## Step 2: Create SVG Builder

**File:** `backend/src/utils/svgBuilder.ts` (new)

```typescript
interface TextBlock {
  text: string;
  role: 'promo' | 'headline' | 'subheadline' | 'body' | 'offer' | 'fineprint';
  fontSize: number;        // AI's initial suggestion
  fontWeight: string;
  color: string;
  strokeColor?: string;
  strokeWidth?: number;
}

interface LayoutIntent {
  blocks: TextBlock[];
  composition: string;          // e.g. "text-left character-right stacked"
  textZone: { x: number; y: number; maxWidth: number; maxHeight: number };
  canvasSize: { w: number; h: number };
}

// Core function:
buildSVG(intent: LayoutIntent): string
```

**What it does:**

1. For each block, call `measureText()` to get actual width
2. If width > zone.maxWidth → call `autoFitFontSize()` to shrink, or `wrapText()` to split lines
3. Stack blocks vertically with appropriate gaps (role-based: promo gets more space above)
4. Validate all blocks fit within textZone bounds
5. Generate native SVG string with:
   - `<text>` elements at measured coordinates
   - `<tspan>` for wrapped lines
   - `font-family="Kanit"`, proper `fill`, `stroke`, `paint-order`
   - `<defs>` with `<feDropShadow>` filters
6. Return clean SVG string (no clipPath needed — everything measured to fit)

**Verify:**

```bash
npx ts-node -e "
  import { buildSVG } from './src/utils/svgBuilder';
  const svg = buildSVG({ blocks: [...], textZone: {...}, ... });
  fs.writeFileSync('/tmp/test-overlay.svg', svg);
  // Open in browser → text should be perfectly within zone
"
```

---

## Step 3: Refactor AI Output → Layout Intent JSON

**File:** `backend/src/services/vertex.service.ts`  
**Method:** New `suggestLayoutIntent()` (replaces `suggestLayoutSVG()`)

**AI now outputs (JSON, NOT SVG):**

```json
{
  "blocks": [
    { "text": "2 ต่อ", "role": "promo", "fontSize": 200, "fontWeight": "900", "color": "#FFD700" },
    { "text": "ชวนลูกค้าแอป SCB EASY และ Robinhood มาสนุก", "role": "headline", "fontSize": 50, "fontWeight": "700", "color": "#FFFFFF" },
    { "text": "รับฟรี*", "role": "offer", "fontSize": 40, "fontWeight": "700", "color": "#FFD700" },
    { "text": "บัตรขึ้นชิงช้าสวรรค์", "role": "body", "fontSize": 38, "fontWeight": "400", "color": "#FFFFFF" },
    { "text": "SAMYAN MITRTOWN", "role": "body", "fontSize": 36, "fontWeight": "400", "color": "#FFFFFF" },
    { "text": "เงื่อนไขเป็นไปตามที่ธนาคารกำหนด", "role": "fineprint", "fontSize": 14, "fontWeight": "400", "color": "rgba(255,255,255,0.8)" }
  ],
  "composition": "character-right promotional-number-left stacked-text",
  "background_description": "...",
  "campaign_vibe": "...",
  "no_go_zones": [...],
  "components": [...]
}
```

**Key change in prompt:**

- Remove ALL SVG-specific instructions (translate, tspan, clipPath, etc.)
- Tell AI: "You are an art director. Choose text content, hierarchy, colors, and approximate font sizes. The server will handle exact pixel placement."
- AI still sees the image + text zone → can make informed creative decisions
- AI should NOT try to calculate positions — just `role` + `fontSize` suggestion
- Keep `planLayoutStrategy()` as-is (it's good)

**Verify:** AI response is valid JSON with `blocks` array → parseable → no SVG in output

---

## Step 4: Wire Into Controller (createCampaign)

**File:** `backend/src/controllers/image.controller.ts`  
**Target:** `createCampaign()` function, SVG pipeline section

**Changes:**

```
BEFORE:
  Pass 2 → suggestLayoutSVG() → raw SVG string → _enforceZoneBounds() → _injectZoneClip()

AFTER:
  Pass 2 → suggestLayoutIntent() → JSON intent
         → buildSVG(intent)      → measured SVG string (no clip needed)
```

Specific changes:

1. Replace `suggestLayoutSVG()` call with `suggestLayoutIntent()`
2. Replace `_enforceZoneBounds()` + `_injectZoneClip()` with `buildSVG()`
3. SSE event `iteration_start` sends intent JSON for frontend live preview
4. SSE event `iteration_end` sends built SVG string

**Refinement loop changes:**

- `refineLayoutSVG()` → new `refineLayoutIntent()` that takes critique feedback + current intent JSON → returns updated intent JSON
- After each refine, call `buildSVG()` again with new intent

**Verify:** Run full pipeline → SVG text stays within bounds, no clipping artifacts

---

## Step 5: Fix Preview for Critique Loop

**File:** `backend/src/services/vertex.service.ts`  
**Method:** `generateLayoutPreview()`

**Problem:** Critique AI doesn't see SVG text on the preview image (sees only bounding boxes)

**Fix:** Now that we have measured SVG from `buildSVG()`:

1. Use `sharp` to composite SVG text onto the base image
2. Or: render SVG text to PNG using `@napi-rs/canvas` `drawText()` calls (same measurements)
3. Send the composited image to critique → critique AI sees actual text

**Verify:** Critique AI response mentions actual text content ("2 ต่อ"), not "no text visible"

---

## Step 6: Clean Up Legacy Code

**Files:** `vertex.service.ts`, `image.controller.ts`

Remove or deprecate:

- `suggestLayoutSVG()` → replace with `suggestLayoutIntent()`
- `refineLayoutSVG()` → replace with `refineLayoutIntent()`
- `_enforceZoneBounds()` → no longer needed (buildSVG handles bounds)
- `_injectZoneClip()` → no longer needed (no clip path)
- `parseSVGOverlayToApproxSuggestions()` → no longer needed (we have structured JSON)
- `enforceDesignRules()` hardcoded regex → move to measurement-based validation

Keep:

- `planLayoutStrategy()` — still useful as Step 0
- `critiqueLayout()` — still works (receives preview image)
- `exportSVG()` — still works for font embedding / text-to-paths
- `suggestLayoutHTML()` / `refineLayoutHTML()` — keep as fallback

**Verify:** `npm run build` — zero TypeScript errors, no broken imports

---

## Step 7: End-to-End Verification

Run the full pipeline with the same SCB ad brief:

| Check                     | Expected                                         |
| ------------------------- | ------------------------------------------------ |
| "2 ต่อ" fits in zone      | font auto-sized to fit maxWidth, no cropping     |
| Headline wraps correctly  | "ชวนลูกค้าแอป SCB EASY" / "และ Robinhood มาสนุก" |
| No text-component overlap | text stays in textZone, components in their zone |
| No canvas overflow        | all elements within safe zone margins            |
| Critique sees text        | critique feedback references actual text content |
| SVG opens in Illustrator  | `<text>` elements editable, Kanit font applied   |
| Iteration improves        | each refine iteration improves quality           |

---

## Effort Estimate

| Step                   | Effort   | Dependencies                  |
| ---------------------- | -------- | ----------------------------- |
| 1. textMeasure.ts      | ~2h      | Kanit font files + canvas lib |
| 2. svgBuilder.ts       | ~3h      | Step 1                        |
| 3. suggestLayoutIntent | ~2h      | Prompt rewrite                |
| 4. Controller wiring   | ~2h      | Steps 1-3                     |
| 5. Preview fix         | ~1h      | Step 2                        |
| 6. Cleanup             | ~1h      | Steps 1-5                     |
| 7. Verification        | ~1h      | All steps                     |
| **Total**              | **~12h** |                               |

---

## Font Setup Prerequisite

Before Step 1, need Kanit font files in `backend/assets/fonts/`:

- `Kanit-Regular.ttf` (weight 400)
- `Kanit-Bold.ttf` (weight 700)
- `Kanit-Black.ttf` (weight 900)

Download from Google Fonts or copy from existing `assets/` if already present.

---

## Risk Mitigation

| Risk                                       | Mitigation                                                                   |
| ------------------------------------------ | ---------------------------------------------------------------------------- |
| `@napi-rs/canvas` install issues on Mac    | Fallback: `canvas` (node-canvas) or `opentype.js` for measurement            |
| AI outputs unexpected JSON format          | Strict Zod/TypeScript schema validation on intent                            |
| Measured width differs from Illustrator    | Use same TTF font file → metrics should match closely                        |
| Multi-line Thai wrap breaks at wrong point | Use ICU-based word segmentation (Intl.Segmenter) or simple space-based split |

---

**APPROVE this plan?**  
After approval, run `/superpowers-execute-plan` to begin implementation.
