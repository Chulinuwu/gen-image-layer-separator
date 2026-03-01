# Plan: Reduce API Calls + Single-Pass Layout Quality

## Goal
Refactor the `createCampaign` pipeline to produce a good layout on the first pass by running RMBG before layout suggestion, and reduce total image-model API calls from 5–25 down to 2–4.

## Assumptions
- RMBG 2.0 (local, free) already runs in `generateDiecutComponents()` and returns `maskedFullImageBuffer` + tight BFS bounding boxes.
- `suggestCampaignLayout()` currently receives only rough AI-guessed bboxes, not pixel-accurate ones from RMBG.
- `MAX_ITERATIONS = 10` is too many. Geometric overlap check already works in code.
- Inpaint fallback to Gemini `generateImage()` should be removed (produces grid artifacts).
- SSE stream structure must remain unchanged.

## Plan

### Step 1 — Extract RMBG + BFS bbox into a standalone utility method
**Files:** `backend/src/services/vertex.service.ts`
**Change:**
Extract RMBG + flood-fill BFS into new public method:
`runRMBGAndGetBboxes(imageBuffer: Buffer): Promise<{ maskedBuffer: Buffer | null; bboxes: Array<{ label: string; top: number; left: number; width: number; height: number }> }>`
Run RMBG once on full image, compute tight bounding rectangle from flood-fill visited pixels (top-N connected components by pixel count). Return masked buffer AND bboxes array.
**Verify:** `npx tsc --noEmit`

---

### Step 2 — Reorder pipeline: RMBG runs BEFORE suggestCampaignLayout
**Files:** `backend/src/controllers/image.controller.ts`
**Change:**
1. Remove suggestCampaignLayout from Step 1
2. NEW Step 1A: call `vertexService.runRMBGAndGetBboxes(imageBuffer)` → get `{ maskedBuffer, bboxes }`
3. NEW Step 1B: Convert bboxes to no_go_zones format, merge with existing parsedNoGoZones
4. NEW Step 1C: Call `suggestCampaignLayout()` with merged no_go_zones containing RMBG-accurate bboxes
5. Pass maskedBuffer forward into `generateDiecutComponents()` to skip re-running RMBG
**Verify:** `npx tsc --noEmit` + check logs for `[Pipeline] RMBG bboxes: [...]`

---

### Step 3 — Add computeSafeZones() helper and pass to suggestCampaignLayout prompt
**Files:** `backend/src/services/vertex.service.ts`
**Change:**
Add private `computeSafeZones(imgW, imgH, noGoZones): SafeRect[]` — column/row sweep to find available rectangles (min width 150 in 0–1000 scale). Update suggestCampaignLayout prompt with `GUARANTEED SAFE TEXT ZONES` block listing computed rects explicitly.
**Verify:** Check prompt logs show Safe Zones block

---

### Step 4 — Pass cached maskedBuffer into generateDiecutComponents to skip re-RMBG
**Files:** `backend/src/services/vertex.service.ts`, `backend/src/controllers/image.controller.ts`
**Change:**
Add optional param `precomputedMaskedBuffer?: Buffer` to `generateDiecutComponents()`. If provided, skip `_removeBgFullImage()` entirely. Pass maskedBuffer from Step 2 in controller.
**Verify:** Logs show `[Diecut] Using pre-computed RMBG mask` NOT `[Diecut] Running RMBG on full source image`

---

### Step 5 — Remove Gemini fallback from inpaintBackground
**Files:** `backend/src/controllers/image.controller.ts`
**Change:**
Delete the fallback block calling `vertexService.generateImage()` with text prompt. If inpaintBackground returns null → send SSE `inpaint_failed` and continue without generated background (canvas uses original image).
**Verify:** Confirm `[Build-Up] Using fallback prompt-based background removal...` never appears in logs

---

### Step 6 — Reduce MAX_ITERATIONS to 3; gate AI critique behind geometric check
**Files:** `backend/src/controllers/image.controller.ts`
**Change:**
- Change `MAX_ITERATIONS` from 10 to 3
- Run geometric overlap check BEFORE the loop on the initial layout
- If geometric check PASSES → skip loop entirely (0 AI critique/refine calls)
- Only enter loop if initial check FAILS
**Verify:** Clean image → logs show `[OVERLAP CHECK] 0 overlaps. Skipping refinement loop.`

---

### Step 7 — Update model priority for new Gemini image models
**Files:** `backend/src/services/vertex.service.ts` — `generateImage()` method
**Change:**
Update priority chain: `GEMINI_IMAGE_ENDPOINT` (gemini-3.1-flash-image-preview) → `GEMINI_IMAGE_ENDPOINT_2` (gemini-3-pro-image-preview) → `GEMINI_IMAGE_ENDPOINT_3` → fallback.
Add `imageConfig: { aspectRatio, imageSize: "2K" }` for Pro model.
**Verify:** `npx tsc --noEmit` + logs show correct model name

---

### Step 8 — TypeScript type check + end-to-end smoke test
**Files:** All modified files (verify only)
**Change:** None
**Verify:**
```
npx tsc --noEmit
# Expected log sequence:
#   [Pipeline] RMBG ran — N bboxes extracted
#   [Pipeline] Safe zones computed: LEFT(0-310), RIGHT(710-1000)
#   [GenAI] Suggesting layout with model: ...
#   [Diecut] Using pre-computed RMBG mask (skipping re-run)
#   [Inpaint] Calling Imagen editImage...
#   [OVERLAP CHECK] 0 overlaps. Skipping refinement.
#   [SSE] done
```

---

## Risks & mitigations
| Risk | Mitigation |
|---|---|
| RMBG bbox scale mismatch | Normalize all bboxes to 0–1000 before inserting into prompt |
| computeSafeZones returns tiny slivers | Min width/height threshold (150 in 0–1000) |
| No BG if Imagen fails (no fallback) | Canvas uses original image — better UX than grid artifact |
| Geometric passes but visual contrast still bad | Keep at most 1 critique round for color/contrast |

## Rollback plan
All changes in `vertex.service.ts` and `image.controller.ts`. Revert with `git checkout backend/src/` if pipeline breaks. RMBG fallback inside `generateDiecutComponents()` is preserved internally.
