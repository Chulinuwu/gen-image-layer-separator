# Progress Tracking

## 2026-03-03 (Session 2 — Kill Containers + HTML/CSS Migration)

### Tasks Completed

- **Task A (Kill visual_container):** Removed entire "CONTRAST SHIELD" system from prompts and frontend renderers. Text contrast now handled purely by `stroke_hex + stroke_width + shadow`. Post-processor auto-fills these if AI omits them. Commits: `50b2841`.
- **Task B (HTML/CSS Output):** AI now generates `html_overlay` string (complete HTML fragment with `%` positions and `cqw` font sizes) instead of JSON `textLayers`. `suggestLayoutHTML()` + `refineLayoutHTML()` added to `vertex.service.ts`. Controller wired for HTML mode. Frontend `AIRefinementPreview.vue` + `LayerEditor.vue` updated with DOMPurify `v-html` rendering. Commits: `eb8fac9`, `a3e7d24`.

### State (Where we left off)

- Backend: `npm run dev` running. HTML pipeline live.
- Frontend: `npm run dev` running. HTML overlay renders via `v-html`.
- All builds passing (zero TypeScript errors).

### Tech Debt

- **[HIGH]** `critiqueLayout` preview PNG has no text boxes in HTML mode — need `parseHTMLOverlayToApproxSuggestions()` helper to restore critique quality.
- **[MED]** `refineLayout()` (legacy JSON method) in vertex.service.ts should be tagged `@deprecated` or removed.
- **[LOW]** `htmlMode` ref in LayerEditor.vue is redundant — template uses `sanitizedEditorHtmlOverlay` directly.
- **[LOW]** Test `-webkit-text-stroke` survival through DOMPurify in production browser.

---

## 2026-03-03 (Session 1 — Composition Upgrade + DesignAsCode)

### Tasks Completed

- **Task 1 (Bug Fix):** In-loop zone format bug fixed — overlap checker now handles both flat `{top, left, width, height}` and nested `{area:{...}}` zone formats. Commit: `9897ba6`.
- **Task 2 (DesignAsCode Plan Phase):** Added `planLayoutStrategy()` as a dedicated Step 0 before `suggestCampaignLayout`. AI brainstorms layout concept + dominant element before committing to pixel coordinates. Mirrors DesignAsCode paper's Plan→Implement→Reflect pipeline. Commit: `522c91d`.
- **Task 3 (Visual Quality Gate):** Added `enforceDesignRules()` helper that auto-boosts promotional numbers (e.g. "2 ต่อ") to dominant font size (160) when AI under-sizes them. Applied both on initial layout and after each refinement iteration. Commit: `bbc0145`.
- **Task 4 (Confidence Gate):** `critiqueLayout` now returns a `confidence` field (0.0–1.0). Controller logs confidence every iteration and exits the loop early when AI is ≥85% confident. Commit: `c3354a5`.

### Previous Session (2026-03-02 Dynamic Composition)

- ✅ Pass 2 forbidden zones removed (Tasks 1-2 from dynamic-composition.md)
- ✅ `interaction_zone` z-index applied in AIRefinementPreview (Task 2)
- ✅ Refinement loop = aesthetic art director critiques every iteration (Task 3)

### Current State

- **Pipeline:** Plan → Layout (text+components) → Quality Gate → Refinement Loop (Critique→Refine) → Confidence Gate → Canvas render
- **DesignAsCode-inspired:** Plan Phase separates "what" from "where" — AI brainstorms strategy, then commits to coordinates
- **Depth layering:** Character renders in front of text via `interaction_zone` z-index — visible in both editor and AI preview
- **Quality enforcement:** `enforceDesignRules` and `enforceContrast` run after every AI text pass

### Tech Debt / Next Steps

- **Plan Phase latency:** adds ~3s extra. Consider caching strategy if same brief re-used within session.
- **QualityGate regex:** promo regex is conservative — tune if it misses edge cases like "3× คืน" or "½ ราคา".
- **Confidence threshold:** currently 0.85 → both PASS paths break. Could differentiate high vs low confidence in future to allow 1 more polish iteration on low-confidence PASS.
- **frontend:** `confidence` field now emitted in `critique_complete` SSE event — could display it in the UI progress indicator.
- **HTML/CSS renderer:** longer-term, consider switching from JSON coords to HTML/CSS output (full DesignAsCode approach) for native layout engine benefits.
