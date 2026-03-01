# Execution Log

## Step 1 — Extract runRMBGAndGetBboxes() utility method
**Files:** `backend/src/services/vertex.service.ts`
- Added new public method `runRMBGAndGetBboxes(imageBuffer)` before `generateDiecutComponents()`
- Uses `_removeBgFullImage()` then union-find connected-component labeling on RGBA pixels
- Returns `{ maskedBuffer, bboxes[] }` with up to 5 bbox sorted by pixel count, normalized 0–1000
**Verify:** `npx tsc --noEmit` → ✅ PASS

## Step 2 — Reorder pipeline: RMBG before suggestCampaignLayout
**Files:** `backend/src/controllers/image.controller.ts`
- Replaced "Step 1: AI suggest" block with "Step 1A: RMBG + Step 1B: AI suggest"
- RMBG bboxes converted to no_go_zones with area field and prepended to parsedNoGoZones
- `precomputedMaskedBuffer` stored for reuse
- SSE event changed from `initial_analysis` to `rmbg_analysis` → `initial_analysis`
**Verify:** `npx tsc --noEmit` → ✅ PASS

## Step 3 — Add computeSafeZones() helper + inject into prompt
**Files:** `backend/src/services/vertex.service.ts`
- Added private `computeSafeZones(noGoZones[])` using column-sweep approach (LEFT/CENTER/RIGHT/BOTTOM candidates)
- Returns safe rectangles with min 150px width/height, trimmed to avoid no-go zone overlap
- `safeZoneInstruction` injected into `suggestCampaignLayout` prompt as "GUARANTEED SAFE TEXT ZONES"
- SPATIAL ANALYSIS task updated to reference the pre-computed safe zones instead of guessing
**Verify:** `npx tsc --noEmit` → ✅ PASS (logged [SafeZones] block in prompt)

## Step 4 — Pass cached maskedBuffer into generateDiecutComponents (skip re-RMBG)
**Files:** `backend/src/services/vertex.service.ts`, `backend/src/controllers/image.controller.ts`
- Added `precomputedMaskedBuffer?: Buffer | null` param to `generateDiecutComponents()`
- If provided → use directly (no `_removeBgFullImage()` call), log "[Diecut] Using pre-computed RMBG mask"
- Controller passes `precomputedMaskedBuffer` from Step 1A
**Verify:** Logs show `[Diecut] Using pre-computed RMBG mask` not `[Diecut] Running RMBG on full source image`

## Step 5 — Remove Gemini generateImage() fallback from inpaintBackground
**Files:** `backend/src/controllers/image.controller.ts`
- Deleted 35-line fallback block calling `vertexService.generateImage()` with prompt
- If Imagen returns null → SSE `inpaint_skipped` event, canvas uses original image as BG
- No more grid-artifact-producing Gemini text-to-image fallback
**Verify:** `[Build-Up] Using fallback prompt-based background removal...` never in logs

## Step 6 — Reduce MAX_ITERATIONS to 3 + pre-loop geometric check
**Files:** `backend/src/controllers/image.controller.ts`
- `MAX_ITERATIONS` reduced from 10 → 3
- Added pre-loop geometric check against `allNoGoZones` (analysis zones + parsedNoGoZones/RMBG bboxes)
- If no overlaps → sends `critique_complete PASS` SSE, sets `lastCritique.status = PASS`, skips loop
- Loop condition updated: `currentIteration === 0 ? preCheckOverlapFound : lastCritique.status !== "PASS"`
**Verify:** Clean image → `[OVERLAP CHECK] ✅ Initial layout is clean — skipping refinement loop`

## Step 7 — Update model priority for new Gemini image models
**Files:** `backend/src/services/vertex.service.ts` — `generateImage()`
- Priority: `GEMINI_IMAGE_ENDPOINT` (gemini-3.1-flash-image-preview) → `GEMINI_IMAGE_ENDPOINT_2` (gemini-3-pro-image-preview) → `GEMINI_IMAGE_ENDPOINT_3` → fallback "gemini-2.5-flash-image"
- Fallback chain updated to cascade through all 3 model endpoints
- Pro model gets `imageSize: "2K"` by default; other models keep "1K"
**Verify:** `npx tsc --noEmit` → ✅ PASS

## Step 8 — TypeScript type check (all files)
**Command:** `cd backend && npx tsc --noEmit`
**Result:** ✅ PASS — No errors
