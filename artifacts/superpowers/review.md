# Review: Kill Containers + HTML/CSS Migration

**Date:** 2026-03-03  
**Reviewer:** Superpowers Review Pass

---

## Blocker

None.

---

## Major

### M1: `critiqueLayout` still uses text bounding boxes for preview PNG

`critiqueLayout` in `vertex.service.ts` calls `generateLayoutPreview()` which draws text bounding boxes onto the preview image. In HTML mode, `textSuggestions` is now empty — so the preview PNG passed to critique will show only components, no text outlines.

**Impact:** AI critique cannot "see" the text positions → feedback will be less precise (it critiques based on the raw background image, not the text overlay).

**Recommended fix (next session):** Parse `html_overlay` string to extract approximate bounding boxes and pass them to `generateLayoutPreview()`. A regex over `position:absolute;top:XX%;left:XX%` divs would suffice for rough critique boxes.

**Workaround right now:** `critiqueLayout` still receives the original photo + describes text from the html_overlay in its `previousAnalysis` context. Critique quality will be reduced but still functional.

---

## Minor

### m1: enforceDesignRules still runs on empty textSuggestions

In `image.controller.ts` at line ~1213, `enforceDesignRules(textSuggestions)` is called. In HTML mode `textSuggestions` is always `[]` so this is a no-op. Safe but dead code.

### m2: Legacy `refineLayout` method kept in vertex.service.ts

`refineLayout()` (JSON mode) is kept for fallback reference. It's no longer called from the pipeline. Should be tagged with `@deprecated` or removed in a future cleanup PR.

### m3: `parseHTMLOverlayToApproxSuggestions` helper not yet implemented

The plan called for a helper to parse html_overlay into approximate JSON suggestions for the preview renderer. This was deferred (see M1 above). The system works but critique preview is degraded.

### m4: DOMPurify strips `-webkit-text-stroke`

DOMPurify with `ALLOWED_ATTR: ["style"]` does allow inline styles, but some browser environments may strip `-webkit-text-stroke` from sanitized HTML. This is a minor visual regression risk.
**Workaround:** `-webkit-text-stroke` is included in the AI prompt example but text-shadow alone also provides contrast.

---

## Nit

### n1: `htmlMode.value` state in LayerEditor is tracked but only used for console.log

The `htmlMode` flag is set but the template condition uses `sanitizedEditorHtmlOverlay` directly (which is falsy when no overlay). The `htmlMode` ref is redundant — can remove in future cleanup.

### n2: Empty blank lines in vertex.service.ts

Around the `refineLayout` signature there are extra blank lines from the edit. No functional impact.

---

## Summary

| Severity | Count | Status                                                                   |
| -------- | ----- | ------------------------------------------------------------------------ |
| Blocker  | 0     | ✅ Clear                                                                 |
| Major    | 1     | ⚠️ Critique preview degraded in HTML mode — functional workaround exists |
| Minor    | 4     | 📋 Noted for next session                                                |
| Nit      | 2     | 📋 Noted for future cleanup                                              |

**Overall: SHIP — system is functional with one known degradation in critique preview quality.**

---

## Follow-up Tasks (Next Session)

1. **[HIGH]** Implement `parseHTMLOverlayToApproxSuggestions()` to restore critique preview quality
2. **[MED]** Tag `refineLayout()` as `@deprecated` or remove
3. **[MED]** Test `-webkit-text-stroke` survival through DOMPurify in various browsers
4. **[LOW]** Remove redundant `htmlMode` ref in LayerEditor
5. **[LOW]** Clean up extra blank lines in vertex.service.ts around refineLayout signature
