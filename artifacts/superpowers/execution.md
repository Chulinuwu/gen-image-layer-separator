# Execution Log

## Step 1 — Backend: onMaskReady callback in inpaintBackground

**Files:** `backend/src/services/vertex.service.ts`

- Added optional `onMaskReady?: (maskBase64: string) => void` param
- After generating `bwMaskBuffer`, downscale mask to 25% with sharp and invoke callback
- Verification: `tsc --noEmit` → clean ✅

## Step 2 — Backend: 3 inpaint iterations loop

**Files:** `backend/src/controllers/image.controller.ts`

- Replaced single `inpaintBackground()` call with `for (iter=1..3)` loop
- Each iter feeds previous result as `currentSource` (iterative refinement)
- Emits `inpaint_mask` SSE on iter 1 (mask doesn't change between iters)
- Emits `inpaint_iteration` SSE after each iter with `{ iteration, totalIterations, previewUrl, elapsedSeconds }`
- Breaks loop early if Imagen returns null (preserves last good result)
- Verification: `tsc --noEmit` → clean ✅

## Steps 3 & 4 — Frontend: SSE handlers + filmstrip + bbox overlay

**Files:** `frontend/src/components/AIRefinementPreview.vue`

- Added `pipelineSteps` ref (Array of `{label, src, elapsed}`)
- Added `showDebugBoxes` ref (default: true)
- Added `getBboxStyle(pos, color)` helper returning border-only absolute box style
- `connectSSE()` now resets `pipelineSteps` on each new run
- `handleSSEEvent()` handles `inpaint_mask` and `inpaint_iteration` events
- Template: debug bbox overlays (blue=text, orange=component) behind toggle button
- Template: pipeline filmstrip in sidebar below SESSION LOG — clickable frames jump to that step's image
- CSS: `.debug-bbox`, `.debug-toggle-btn`, `.pipeline-strip`, `.filmstrip`, `.film-frame`, `.film-thumb`, `.film-label`, `.film-elapsed`
- Verification: `tsc --noEmit` (backend) → clean ✅; Vite HMR active for frontend
