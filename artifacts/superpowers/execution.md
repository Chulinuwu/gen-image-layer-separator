# Execution Log — Kanit Font System (Options A + B)

## Step 1 — Backend: FONT SELECTION RULES → Kanit only

**Files:** `backend/src/services/vertex.service.ts`

- Replaced 5-font options (Mitr, Sriracha, Inter, Playfair Display, Kanit) with hard Kanit mandate
- Added font_weight targets per hierarchy: headline=800, body=600, badge=700, fineprint=400, number=900
- Verification: `tsc --noEmit` → clean ✅

## Step 2 — Backend: Kanit normalize in controller post-processing

**Files:** `backend/src/controllers/image.controller.ts`

- Added normalize pass after TextClamp block: forces `font_family: "Kanit"` on every text suggestion
- 100% safety net regardless of AI output
- Verification: `tsc --noEmit` → clean ✅

## Step 3 — Frontend: Add Kanit to Google Fonts import

**Files:** `frontend/src/components/AIRefinementPreview.vue`

- Added `Kanit:wght@400;600;700;800;900` to @import URL
- Verification: Font visible in DevTools Network tab ✅ (Vite HMR)

## Step 4 — Frontend: Rewrite getTextStyle() with Thai Typography Tokens

**Files:** `frontend/src/components/AIRefinementPreview.vue`

- Added KANIT_TOKENS map: headlines 800/-0.5px/1.1, body 600/0px/1.4, badge 700/1px/1.2, fineprint 400/0px/1.3, number 900/-1px/1.0
- fontFamily: always "'Kanit', sans-serif" — ignores AI-provided font_family
- fontWeight: derived from hierarchy token (not AI suggestion)
- Auto-shadow for headlines without explicit stroke: `0 1px 6px rgba(0,0,0,0.6)`
- fineprint opacity: 0.85
- Fixed TS lint: `tokens` possibly undefined → `(?? KANIT_TOKENS["body"])!`
- Verification: Vite compilation clean, Kanit renders in canvas ✅
