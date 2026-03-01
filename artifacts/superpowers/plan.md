# Plan: Inpaint Pipeline Debug Live Preview + 3 Iterations

## Goal

1. Run inpainting **3 iterations** (currently 1) so each pass cleans up leftover artifacts from the previous
2. Add a **step-by-step live preview pipeline** in the left canvas showing:
   - 📸 Original image → 🎭 Mask preview → 🖼 Inpaint iter 1/2/3 → 📦 Component layout with **colored stroke bbox overlays**

## Assumptions

- Backend SSE infrastructure exists (`sendSSE(event, data)` in `image.controller.ts`)
- Frontend `AIRefinementPreview.vue` handles SSE events in `handleSSEEvent()`
- The main canvas (`currentPreviewUrl`) shows the live image state
- `inpaintBackground()` in `vertex.service.ts` generates the mask internally and returns `{ buffer }`
- Stroke overlay = colored bounding-box rectangles drawn on top of the canvas image for each text layer + component

## Plan

### Step 1 — Backend: Emit mask preview as SSE (before calling Imagen)

**Files:** `backend/src/services/vertex.service.ts`  
**Change:**

- In `inpaintBackground()`, after generating `bwMaskBuffer`, call a callback/return the mask buffer so the controller can emit it
- Add optional `onMaskReady?: (maskBase64: string) => void` param to `inpaintBackground()`
- Controller passes a callback that does `sendSSE("inpaint_mask", { imageBase64: maskBase64 })`  
  **Verify:** `tsc --noEmit` clean; SSE log shows `inpaint_mask` event

---

### Step 2 — Backend: 3 inpaint iterations with per-iter SSE

**Files:** `backend/src/controllers/image.controller.ts`  
**Change:**

- Wrap the single `inpaintBackground()` call in a `for (let iter = 1; iter <= 3; iter++)` loop
- Each iteration: use the **same original RMBG mask** (`fullImageAlphaMask`) but the **result of the previous iteration** as the new `imageBuffer` (so each pass builds on the last)
- After each call: save the buffer to disk as `bg-inpaint-iter${iter}-${ts}.png` and emit:
  ```
  sendSSE("inpaint_iteration", { iteration: iter, totalIterations: 3, previewUrl: "/uploads/..." })
  ```
- After the loop: `generatedBackgroundImageUrl` = last successful iteration result
- Still emit `background_ready` at the end (no change to downstream pipeline)  
  **Verify:** `tsc --noEmit`; 3 `inpaint_iteration` events visible in browser console

---

### Step 3 — Frontend: Handle new SSE events in AIRefinementPreview.vue

**Files:** `frontend/src/components/AIRefinementPreview.vue`  
**Change:**

- In `handleSSEEvent()`, add two cases:

  ```
  case "inpaint_mask":
    // Show mask as a semi-transparent overlay OR as a separate pipeline step card
    pipelineSteps.value.push({ label: "Mask", src: `data:image/png;base64,${data.imageBase64}` })

  case "inpaint_iteration":
    // Update canvas to show latest inpaint result + update sidebar step counter
    currentPreviewUrl.value = `http://localhost:5001${data.previewUrl}`
    pipelineSteps.value.push({ label: `Inpaint ${data.iteration}/${data.totalIterations}`, src: currentPreviewUrl.value })
  ```

- Add `pipelineSteps = ref<Array<{label, src}>>([])` reactive state
- Add a **"PIPELINE STEPS" horizontal filmstrip** in the sidebar below the SESSION LOG — shows small thumbnails of each step: Original → Mask → Iter1 → Iter2 → Iter3  
  **Verify:** During generation, filmstrip populates left-to-right in real-time

---

### Step 4 — Frontend: Stroke bbox overlay in canvas (debug mode)

**Files:** `frontend/src/components/AIRefinementPreview.vue`  
**Change:**

- Add `showDebugBoxes = ref(true)` toggle (small button in top-right of canvas)
- In the canvas overlay template, render colored `<div>` borders for each text layer and component:
  ```html
  <!-- Debug bbox strokes -->
  <div
    v-if="showDebugBoxes"
    v-for="(t, i) in liveTextLayers"
    class="debug-bbox text-bbox"
    :style="getBboxStyle(t.position, '#3B82F6')"
  />
  <div
    v-if="showDebugBoxes"
    v-for="(c, i) in liveComponents"
    class="debug-bbox comp-bbox"
    :style="getBboxStyle(c.position, '#F59E0B')"
  />
  ```
- `getBboxStyle(pos, color)`: returns `{ position:'absolute', top, left, width, height, border: '2px solid {color}', boxSizing:'border-box', pointerEvents:'none', zIndex:30 }`
- Blue = text layers, Orange = components
- Add `.debug-bbox` CSS with `border` only (transparent fill) so it doesn't block the image  
  **Verify:** After layout loads, colored boxes appear on canvas; toggle button hides them

---

## Risks & Mitigations

| Risk                                                      | Mitigation                                                      |
| --------------------------------------------------------- | --------------------------------------------------------------- |
| Iter2/3 may produce worse results if first pass was clean | Log each iter result; keep best result if later passes degrade  |
| Large mask base64 in SSE may be slow                      | Downscale mask to 25% before sending for preview                |
| 3× Imagen calls = 3× cost & latency (~30–60s total)       | Display elapsed time per iter in SSE log                        |
| Canvas overlay z-index conflicts                          | Use `zIndex: 30` for debug bboxes, `zIndex: 20` for text layers |

## Rollback Plan

- Step 1-2 (backend): `git revert` the controller commit; inpainting reverts to single iteration
- Step 3-4 (frontend): All behind `showDebugBoxes` toggle and new `pipelineSteps` state — no breaking changes to existing SSE handlers

---

**Approve this plan? Reply APPROVED if it looks good.**
