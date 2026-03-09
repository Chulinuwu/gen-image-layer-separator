# Plan - Remove Export Button

## Goal

Remove the "Export SVG" button and "Export mode" dropdown from the `AIRefinementPreview.vue` component to simplify the UI as requested by the user.

## Constraints

- Keep the "FINALIZE DESIGN" button functional.
- Clean up all unused code related to the export feature.

## Brainstorming

- **Option 1**: Just comment out the HTML. (Messy, leaves dead code).
- **Option 2**: Remove HTML, script, and styles. (Cleanest, best for maintainability).
- **Recommendation**: Option 2.

## Step-by-Step Plan

### 1. Modify `frontend/src/components/AIRefinementPreview.vue`

- **Template**: Remove lines 200-218 (The export panel).
- **Script**: Remove lines 339-371 (Export state and function).
- **Style**: Remove lines 1296-1335 (Export panel styles).

### 2. Verification

- Check for any remaining references to `exportMode`, `isExporting`, or `exportSVGFile`.
- Ensure the template still compiles.

## Acceptance Criteria

- [ ] Export SVG button is removed from UI.
- [ ] Export mode dropdown is removed from UI.
- [ ] "FINALIZE DESIGN" button remains visible when `isComplete` is true.
- [ ] Code is clean of unused export logic.
