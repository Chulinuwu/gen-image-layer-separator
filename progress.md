# Progress Log — gen-image-layer-separator

## 2026-02-25 Session

### Summary

Replaced AI Image Generation for die-cut components with Hybrid Crop+ML approach to reduce Vertex AI API calls significantly.

### Major Changes

#### 1. Hybrid Die-cut System (`vertex.service.ts`)

**Before:** For each component → 1 AI Image Gen call (expensive, slow, 3s delay between)
**After:** Crop from original image → ML background removal → die-cut (0 AI calls for most components)

- Added `_cropAndDiecut()` private method: Sharp crop + `@imgly/background-removal-node` (BRIAAI RMBG-1.4 model)
- Updated `generateDiecutComponents()` to use hybrid logic:
  - **PRIMARY:** Crop + ML (uses real pixels, style-accurate, no AI needed)
  - **FALLBACK:** AI Gen (only when position data is missing/invalid)
- Added 3% bounding box padding to handle AI position inaccuracy

#### 2. Type Declaration for @imgly (`src/types/imgly-background-removal-node.d.ts`)

- Created local `.d.ts` because `moduleResolution: "node"` doesn't auto-resolve `exports` map
- `skipLibCheck: true` already set — no build issues

### State

- `tsc --noEmit` passes cleanly ✅
- Server starts OK but has a `sharp` version conflict warning (two sharp instances loaded)
- **Needs end-to-end test** with a real image to verify crop+ML quality

### Tech Debt

- **Sharp conflict:** `@imgly/background-removal-node` bundles its own `sharp`. If this causes crashes in production, consider switching to `rembg` (Python subprocess) or using `@imgly/background-removal` browser-side instead.
- Refinement loop `MAX_ITERATIONS = 10` is still high — planned reduction to 3 with smarter auto-fix.

### Summary

Refactored the `createCampaign` pipeline flow and fixed multiple Canvas bugs. Followed by addressing API rate-limits and initial layout display issues.

### Major Changes

#### 1. Pipeline Flow Reorder (backend `image.controller.ts`)

**Before:** Analyze → Refinement (text only) → Inpaint BG → Die-cut → Return
**After:** Analyze → (Dedup props) → Inpaint BG → Die-cut → Refinement (text + components) → Return

- BG inpaint and die-cut generation now run **sequentially** to reduce Vertex AI 429 Rate Limit errors.
- Refinement loop now adjusts **both** text AND component positions.
- After refinement, updated component positions are synced back to `visualComponents`.

#### 2. Prop Dedup Filter Fixed

- Previously, character elements (like "Smiling Woman with Phone") were accidentally pruned because they contained a prop keyword ("Phone").
- Fixed logic to only strip components that contain a prop keyword BUT DO NOT contain a character keyword.

#### 3. Live Canvas Preview (frontend `AIRefinementPreview.vue`)

- Initial layout is now explicitly sent to the canvas (via `iteration_end` iteration: 0) _before_ the refinement loop starts, ensuring visual feedback immediately after die-cut/bg generation.
- **SSE Events Segregated**:
  - `background_ready` sets the clean inpainted BG on the canvas.
  - `debug_preview` simply logs the debug imagery (text/boxes overlaid), preventing the debug image from overriding the clean canvas.

#### 4. Display Bug Fixes (frontend)

- **State reset on new run:** `liveTextLayers`, `liveComponents`, `analysis` all cleared.
- **Text overlays hidden during loading:** Only shown after `currentPreviewUrl` is set.
- **Canvas aspect ratio:** Added `width: 100%; height: auto;` rather than `object-fit: contain` so that normalized CSS `%` positions perfectly align with the image.

### State

All changes compile cleanly (tsc --noEmit passes). Ready for end-to-end testing.

### Tech Debt

- Text overlay positioning is still somewhat approximate depending on complex styles.
- If 429 API errors persist on the Die-cut step (which fires parallel tasks internally), we may need to implement a sequential queue inside `vertex.service.ts` component loop.
