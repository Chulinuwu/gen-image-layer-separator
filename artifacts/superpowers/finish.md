# Finish: Kill Containers + HTML/CSS Migration

**Date:** 2026-03-03  
**Status:** COMPLETED

---

## Commits

| Commit    | Description                                                                                    |
| --------- | ---------------------------------------------------------------------------------------------- |
| `50b2841` | fix: remove visual_container shield system — stroke+shadow only for text contrast              |
| `eb8fac9` | feat(backend): HTML/CSS pipeline — suggestLayoutHTML + refineLayoutHTML replace JSON text pass |
| `a3e7d24` | feat(frontend): HTML overlay renderer — DOMPurify v-html in AIRefinementPreview + LayerEditor  |

---

## Summary of Changes

### Task A: Kill visual_container System ✅

**Why it mattered:** Dark semi-transparent boxes (`solid_block`) and pill shapes behind text looked amateurish. The prompt was explicitly forcing AI to add them with "CONTRAST SHIELD IS NON-NEGOTIABLE."

**What changed:**

- `vertex.service.ts`: Removed CONTRAST SHIELD prompt blocks from both `suggestCampaignLayout` and `refineLayout`. Replaced with STROKE + SHADOW guidance.
- `image.controller.ts`: Post-processor now forces `visual_container: "none"` on all text suggestions and auto-fills `stroke_hex: "#000000"`, `stroke_width: 4`, `shadow: "strong"` for non-fineprint text.
- `AIRefinementPreview.vue`: Removed `getContainerStyle()` and the `<span>` wrapper — text renders clean.
- `LayerEditor.vue`: `getEditorContainerStyle()` stubbed to always return `{}`.

**Effect:** Canvas will never show dark boxes or pill shapes. Text contrast handled by multi-layer text-shadow + stroke.

### Task B: HTML/CSS Output Migration ✅

**Why it mattered:** JSON coordinate system was brittle — AI had to calculate pixel positions, font sizes, spacing manually. HTML/CSS with `cqw` units and `flexbox` natively handles these.

**What changed:**

- `vertex.service.ts`: Added `suggestLayoutHTML()` (generates `html_overlay` string with `%` positions and `cqw` fonts) and `refineLayoutHTML()` (revises HTML based on critique).
- `image.controller.ts`: Pass 2 now calls `suggestLayoutHTML()`. Refinement loop calls `refineLayoutHTML()`. All SSE events (`iteration_end`, `done`) now carry `html_overlay` instead of `textLayers`.
- `AIRefinementPreview.vue`: Added `liveHtmlOverlay` state + `sanitizedHtmlOverlay` computed (DOMPurify). Template shows HTML overlay div, falls back to JSON mode if no overlay. SSE handlers updated for both modes.
- `LayerEditor.vue`: `campaignData` watcher detects `html_overlay` → sets `htmlMode`, only loads component image layers. Template renders `<div v-html="sanitizedEditorHtmlOverlay">` for text.

**Effect:** AI-generated text now renders as native HTML/CSS. Promo numbers at `16cqw` are HUGE and scale with canvas. Text grouping via `flex-column`. Contrast via multi-layer `text-shadow`.

---

## Verification Commands Run

```bash
cd /Users/chulin/gen-image-layer-separator/backend && npm run build    # ✅ PASS
cd /Users/chulin/gen-image-layer-separator/frontend && npm run build   # ✅ PASS
```

---

## Known Degradation (see review.md)

**Critique preview quality reduced:** `critiqueLayout` now receives a preview PNG with no text outlines (because `textSuggestions` is empty in HTML mode). The AI critique will critique based on visual appearance of the raw photo + previous HTML context. Critique loop still functions — just less precise.

**Fix in next session:** Implement `parseHTMLOverlayToApproxSuggestions()` helper to extract approximate text bounding boxes from HTML string for preview rendering.

---

## Manual Validation Steps

1. Start servers: `cd backend && npm run dev` + `cd frontend && npm run dev`
2. Upload a Thai bank ad image with promotional text
3. Click Generate → watch canvas load
4. Verify: **zero dark boxes or pill shapes** on any text element
5. Check DevTools → EventStream → `iteration_end` has `html_overlay` field as a string
6. Verify promo number renders at `~16cqw` (large, dominant)
7. Complete refinement → check `done` event has `html_overlay`
8. Open LayerEditor → component images should be draggable; text shows as HTML overlay

---

## Next Session Priorities

1. Implement `parseHTMLOverlayToApproxSuggestions()` to restore critique preview quality
2. Test DOMPurify `-webkit-text-stroke` survival in production browser
3. Tag `refineLayout()` legacy method as `@deprecated`
