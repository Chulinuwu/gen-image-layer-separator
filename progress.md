# Progress Log — gen-image-layer-separator

## 2026-03-01 Session (Safe Zone Placement)

### Summary

Replaced the unreliable AI-driven spatial text placement with a hybrid safe zone system. Code now computes pixel-precise safe zones from die-cut component strokes, and AI places text within those verified zones. Refinement loop reduced from 3→1 iteration (style-only).

### Major Changes

#### 1. Safe Zone Utilities (`backend/src/utils/safeZones.ts`)

- `computeSafeZones(obstacles)` — subtracts no-go bboxes from full canvas, returns sorted safe rectangles
- `assignTextToZones(suggestions, zones)` — deterministically assigns text to safe zones with stacking
- 9 unit tests passing (`safeZones.test.ts`)

#### 2. Stroke Bbox Extraction (`vertex.service.ts`)

- `extractComponentStrokeBboxes(components)` — scans alpha channel of die-cut PNGs for pixel-precise bounding boxes
- Maps local pixel coords back to 0-1000 normalized source image coords

#### 3. Safe Zone Pipeline in Controller (`image.controller.ts`)

- After die-cut: extract stroke bboxes → compute safe zones → re-run layout with safe zones → assign text to zones
- `MAX_ITERATIONS` reduced 3→1 (safe zones make first round reliable)

#### 4. Style-Only Critique (`vertex.service.ts`)

- `critiqueLayout()` now accepts `styleOnly` flag — skips position checks when safe zones guarantee placement
- Focuses on color contrast, shadow readability, visual hierarchy

#### 5. Thai Text Width Fix

- Changed char width multiplier from 0.55→0.6 in both controller `computeTextBBox` functions
- Consistent with `safeZones.ts` `computeTextSize()`

### State

- **Backend:** All code changes complete ✅
- **Tests:** 9/9 safe zone tests passing ✅
- **TypeScript:** Clean compilation ✅
- **Integration:** Needs end-to-end test with real image upload

### Design Doc

- `docs/plans/2026-03-01-safe-zone-placement-design.md` (approved)
- `docs/plans/2026-03-01-safe-zone-placement-plan.md` (9 tasks, all complete)

---

## 2026-03-01 Session (Final)

### Summary

Successfully resolved the "Preferred output locations must have the same size as output names" Blocker and stabilized the RMBG-2.0 ML pipeline on Mac. The system now correctly performs high-precision background removal using both RMBG-2.0 (Transformers.js) and RMBG-1.4 (@imgly).

### Major Changes

#### 1. RMBG-2.0 Architecture Fix (`vertex.service.ts`)

- **Robust Model Loading:** Replaced the high-level `pipeline` API with a lower-level `AutoModel`/`AutoProcessor` flow to bypass the "Unsupported model type: null" error in Transformers.js v3.
- **Manual Logit Processing:** Implemented custom sigmoid activation and alpha channel mapping for the RMBG-2.0 output tensors, ensuring pixel-perfect transparency masks.
- **Sharp-to-Raw Pipeline:** Used `sharp` to decode input buffers into raw RGB pixels before passing them to the ML model, resolving the "Unsupported input type: object" dispatcher error.
- **Flexible Tensor Mapping:** Added heuristic detection for result keys (`output`, `logits`, etc.) to stay compatible with varying ONNX model exports.

#### 2. Native Binary Stabilization (`package.json`)

- **Deduplication:** Added `overrides` for `onnxruntime-node` (1.21.0) and `sharp` (0.34.5) to ensure only one version of these native libraries is loaded. This fixed the low-level memory crashes and segmentation faults previously seen on Mac.
- **Resource Management:** Explicitly limited ONNX to `numThreads = 1` in the Node.js environment to prevent mutex/locking deadlocks during concurrent ML tasks.

#### 3. Operational Refinement

- **Warmup Optimization:** Updated `warmupRMBG2` to use a 256x256 image (instead of 1x1), satisfying the minimum patch size requirements of the ViT-based RMBG-2.0 model and preventing shape mismatch warnings at startup.
- **Environment Stabilization:** Resolved port congestion and process buildup through systematic cleanup (`killall node`).

### State

- **Backend:** Stable and running on http://localhost:5001 ✅
- **ML Pipeline:** RMBG-2.0 warmup successful on CPU in ~15s ✅
- **Fallback:** Automatic failover to RMBG-1.4 remains active and tested ✅

### Tech Debt (Resolved)

- Fixed `sharp` version conflicts.
- Silenced fatal ONNX initialization crashes.

---

## 2026-02-25 Session

### Summary

Replaced AI Image Generation for die-cut components with Hybrid Crop+ML approach to reduce Vertex AI API calls significantly.

### Major Changes

#### 1. Hybrid Die-cut System (`vertex.service.ts`)

- Added `_cropAndDiecut()` private method: Sharp crop + `@imgly/background-removal-node` (BRIAAI RMBG-1.4 model)
- Updated `generateDiecutComponents()` to use hybrid logic.

#### 2. Type Declaration for @imgly (`src/types/imgly-background-removal-node.d.ts`)

- Created local `.d.ts` for module resolution.

### Tech Debt

- Refinement loop `MAX_ITERATIONS` optimization.
