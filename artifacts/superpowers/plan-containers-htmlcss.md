# Plan: Kill Visual Containers + HTML/CSS Output Migration

**Date:** 2026-03-03  
**Goal:**

1. (Task A – Quick Win) Remove visual_container shield system entirely
2. (Task B – Architecture) Migrate AI output from JSON coordinates → HTML/CSS overlay string

---

## Context

From screenshot: dark semi-transparent rectangles behind headlines and blue pill around "รับฟรี"
look ugly and amateurish. These come from:

- Backend prompt: "CONTRAST SHIELD IS NON-NEGOTIABLE" forces `visual_container: solid_block / pill`
- Frontend renders them as dark rgba boxes via `getContainerStyle()` / `getEditorContainerStyle()`

---

## Task A: Kill Visual Container System

**Scope:** 3 file changes — fast.

### A1: Strip from prompt (vertex.service.ts)

1. Remove "CONTRAST SHIELD (CRITICAL)" + "SHIELD TYPE GUIDE" + "STROKE/OUTLINE" block from `suggestCampaignLayout` prompt
2. In `refineLayout` prompt: remove rule 5 that says "IMPROVE contrast shields: if text lacks visual_container, ADD one"
3. Replace `"visual_container": "none | ribbon | pill | solid_block | gradient_overlay | glassmorphism"` in JSON schema with `"visual_container": "none"` (always none)
4. Update DESIGNER MINDSET section: replace "CONTRAST SHIELD IS NON-NEGOTIABLE" with stroke+shadow guidance

### A2: Strip from post-processor (image.controller.ts)

In the Kanit normalize pass, force `visual_container: "none"` on all suggestions:

```typescript
textSuggestions = textSuggestions.map((s: any) => ({
  ...s,
  visual_container: "none", // Containers removed — stroke+shadow handles contrast
  style: { ...s.style, font_family: "Kanit", color_hex: enforceContrast(...) },
}));
```

### A3: Strip renderer (AIRefinementPreview.vue + LayerEditor.vue)

Remove `getContainerStyle()` and `getEditorContainerStyle()` functions (or make them always return `{}`).
In template: remove `<span :style="getContainerStyle(t)">` wrapper → replace with plain `{{ t.part }}`.

**Verify:** Generate → No dark boxes visible. Text only has stroke/shadow for contrast.  
**Commit:** `fix: remove visual_container system — stroke+shadow only for text contrast`

---

## Task B: HTML/CSS Output Migration

**Philosophy:** Instead of AI returning `{position: {top, left, width, height}, style: {...}}`,
AI returns a complete HTML fragment string. Frontend drops it into a positioned container div.

### B0: How it works

**Before (JSON mode):**

```json
"suggestions": [
  {"part": "2 ต่อ", "position": {"top": 550, "left": 50}, "style": {"font_size_normalized": 160}},
  {"part": "รับฟรี บัตร...", "position": {"top": 700, "left": 50}, "style": {"font_size_normalized": 40}}
]
```

**After (HTML mode):**

```json
"html_overlay": "<div style='position:absolute;top:55%;left:5%;z-index:5'><div style='font-family:Kanit;font-size:16cqw;font-weight:900;color:#FFD700;text-shadow:0 2px 8px rgba(0,0,0,0.6)'>2 ต่อ</div><div style='font-size:4cqw;color:#fff;font-weight:700'>รับฟรี บัตรขึ้นชิงช้าสวรรค์</div></div>"
```

Frontend canvas becomes:

```html
<div
  class="canvas-content"
  style="position:relative; container-type:inline-size"
>
  <img :src="bgUrl" style="width:100%" />
  <!-- AI generated overlay: absolute positioned, no pointer events -->
  <div v-if="htmlOverlay" v-html="htmlOverlay" class="html-overlay-layer" />
  <!-- Component PNGs still rendered as absolute img tags -->
  <img v-for="c in components" :style="getComponentStyle(c)" />
</div>
```

### B1: New vertex.service.ts method `suggestLayoutHTML()`

New method alongside existing `suggestCampaignLayout()`. Generates HTML/CSS overlay:

- Uses `cqw` (container query width) units for responsive font sizes
- Components still described as JSON (die-cut PNGs need separate handling)
- AI outputs one `html_overlay` string + `components` array (unchanged)

**HTML generation rules in prompt:**

```
COORDINATE SYSTEM: Use percentage units (top/left as % of container size).
FONT SIZES: Use cqw units (container query width). 1 cqw = 1% of container width.
  - Promotional numbers: 12-18cqw (huge, dominant)
  - Headlines: 4-6cqw
  - Body text: 2.5-3.5cqw
  - Fine print: 1.2-1.6cqw
CONTRAST: Use text-shadow not background boxes. Example:
  text-shadow: 0 2px 8px rgba(0,0,0,0.8), 0 0 20px rgba(0,0,0,0.4)
Z-INDEX: Set on outermost text group div. Components will render above at z:15.
ALL positions: position:absolute on each text group div.
FONT FAMILY: Always 'Kanit', sans-serif.
FLEX GROUPING: Related text (number + label) should be in a wrapping flex-column div.
```

### B2: Controller changes

- In `image.controller.ts`, Pass 2 calls `suggestLayoutHTML()` instead of `suggestCampaignLayout(mode:"text")`
- SSE event `iteration_end` sends `html_overlay: string` instead of `textLayers: any[]`
- `refineLayoutHTML()` method takes the current HTML string + critique feedback → returns revised HTML

### B3: Frontend changes

**AIRefinementPreview.vue:**

- Replace `liveTextLayers` state with `liveHtmlOverlay: ref<string>("")`
- Remove `getTextStyle()`, `getContainerStyle()` functions
- Replace live text loop template with:
  ```html
  <div
    v-if="liveHtmlOverlay"
    v-html="liveHtmlOverlay"
    class="html-overlay-layer"
  />
  ```
- Add CSS: `.html-overlay-layer { position:absolute; inset:0; pointer-events:none; z-index:10; }`

**LayerEditor.vue:**

- Keep existing layer system (still needed for manual editing)
- Add HTML preview mode: when `campaignData.html_overlay` is present, render as div instead of layer list
- Edit mode: user can still switch to layer editor for manual tweaks

### B4: critiqueLayout stays the same

`critiqueLayout` receives a rendered PNG screenshot (already works), so it doesn't need to know about HTML vs JSON.
`refineLayoutHTML()` is the only new method needed for the refine step.

---

## Sequencing

| Task                  | Effort | Can Ship Independently? |
| --------------------- | ------ | ----------------------- |
| A: Kill containers    | ~30min | ✅ YES — ship today     |
| B: HTML/CSS migration | ~4-6h  | ✅ YES — separate PR    |

**Recommended order:** A first (immediate quality improvement), B next (architecture upgrade).

---

## Verification

| Step                             | Expected                                                                               |
| -------------------------------- | -------------------------------------------------------------------------------------- |
| After A: Generate → check canvas | No dark boxes, only stroke/shadow on text                                              |
| After B: Generate → check canvas | Text rendered as HTML div with CSS, not canvas overlay                                 |
| After B: Refinement loop         | `critique_complete` → `refineLayoutHTML` → updated HTML string in next `iteration_end` |

---

**APPROVE this plan? (Task A only, or A + B)**
