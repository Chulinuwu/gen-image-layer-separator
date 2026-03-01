# Finish: Inpaint Pipeline Debug + 3 Iterations

## Summary of Changes

### Backend (`vertex.service.ts`)

- `inpaintBackground()` now accepts optional `onMaskReady` callback
- Invoked with 25%-downscaled mask base64 before calling Imagen API

### Backend (`image.controller.ts`)

- Inpainting now runs **3 passes** (was 1)
- Each pass feeds the previous result as input (chained refinement)
- Emits `inpaint_mask` SSE on pass 1 (mask stays constant)
- Emits `inpaint_iteration` SSE after each pass with `previewUrl` and `elapsedSeconds`

### Frontend (`AIRefinementPreview.vue`)

- New SSE handlers: `inpaint_mask` → filmstrip; `inpaint_iteration` → canvas + filmstrip
- **Pipeline Filmstrip**: horizontal thumbnail strip in sidebar showing Mask → Iter1 → Iter2 → Iter3, clickable to jump to that step on canvas
- **Bbox Debug Overlay**: colored border boxes on canvas (blue=text, orange=component)
- **Toggle Button**: "BBOX ON/OFF" in top-right of canvas (default: ON)

## Verification Commands

| Command                          | Result       |
| -------------------------------- | ------------ |
| `cd backend && npx tsc --noEmit` | ✅ Clean     |
| `git log --oneline -3`           | ✅ Committed |

## Manual Validation Steps

1. Upload an image and click "Create Campaign Layers"
2. Watch the Sidebar — SESSION LOG should show: "Inpaint mask preview ready", "Pass 1/3 done in Xs", "Pass 2/3...", "Pass 3/3..."
3. Canvas should update after each inpaint pass (showing progressive cleanup)
4. PIPELINE STEPS filmstrip should populate: Mask → Inpaint 1/3 → Inpaint 2/3 → Inpaint 3/3 → ...
5. After layout is done, blue/orange bboxes appear on canvas — click "BBOX ON/OFF" to toggle
6. Click any filmstrip frame to jump to that step's image on canvas

## Follow-ups

- If 3 iterations are too slow (~60-90s), expose `INPAINT_ITERS` as env var or allow user to set iteration count in UI
- May add "Original" as the first filmstrip frame for comparison
- Consider adding iteration comparison view (side-by-side iter1 vs iter3)
