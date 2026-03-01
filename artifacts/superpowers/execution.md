# Execution Log — Smart Layout Composition (A+B+C)

## Step 1+4 — Option A1 + Option C: AI Prompt (vertex.service.ts)

**Files:** `backend/src/services/vertex.service.ts`

- Changed COMPONENT LIST → COMPONENT COMPOSITION: AI now knows components are die-cut PNGs that CAN be repositioned
- Added `suggested_position` field to component JSON schema with rationale
- Added composition rules: person → upper-right, mascot → bottom-right, leave left for text
- Added `safeZoneInstruction` font_size hints per zone area (sqrt/10 heuristic)
- Added global FONT SIZE RULE: large zone → headline ≥ 80, medium ≥ 50, small ≥ 30
- Verification: `tsc --noEmit` → clean ✅

## Step 2 — Option A2: Controller uses suggested_position (image.controller.ts)

**Files:** `backend/src/controllers/image.controller.ts`

- Added `suggested_position?: any` to rawComponents type
- Both diecut map locations (simple pipeline ~230, build-up pipeline ~890) now use:
  `matched?.suggested_position || matched?.position || default`
- Added console.log `[Compose]` when repositioning applies
- Verification: `tsc --noEmit` → clean ✅

## Step 3 — Option B: Contrast enforcement (image.controller.ts)

**Files:** `backend/src/controllers/image.controller.ts`

- Added `enforceContrast(colorHex, pos)` using ITU-R BT.601 luminance formula
- Heuristic: if `pos.top > 450` (lower half → dark bg) AND luminance < 100 → swap to #FFFFFF
- Applied in Kanit normalize pass alongside font_family enforcement
- Logs every color swap as `[Contrast] "old" → "new"`
- Verification: `tsc --noEmit` → clean ✅
