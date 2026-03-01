# Two-Pass Art Director Composition + Preview/Editor Size Fix

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Replace single-pass layout analysis with a two-pass art director flow (components placed dramatically first, text fitted around them second), and fix the font-size/component-size mismatch between the preview canvas and the editor canvas.

**Architecture:**
- Pass 1: `suggestCampaignLayout(mode="only_bg_comp")` with new art director prompt rules → component positions + `composition_text_zone`
- Pass 2: After die-cut (so we have accurate bboxes), `suggestCampaignLayout(mode="text", fixedComponentPositions, textZone)` → text fitting around fixed components
- Frontend: both preview and editor use `font_size_normalized * 0.1 cqw` for text, with `container-type: inline-size` on their canvas containers. Image layers in editor get `padding: 0` override.

**Tech Stack:** TypeScript, NestJS/Express backend, Vue 3 frontend, CSS container queries (`cqw`)

---

## Bug Reference: Size Mismatch

**Preview (`AIRefinementPreview.vue`):**
- Text: `fontSize: font_size_normalized * 0.4 + "px"` ← too small
- Components: `width: pos.width / 10 + "%"` positioned on `.canvas-content`

**Editor (`LayerEditor.vue`):**
- Text: `fontSize: font_size_normalized + "px"` ← raw value (too large)
- Components: `width: layer.w + "%"` inside `.text-layer` which has `padding: 2px 4px` ← shrinks image

**Fix:** Use `cqw` CSS container query units in both so font size = `font_size_normalized * 0.1` percent of canvas width, always consistent.

---

## Task 1: Art Director Placement Prompt (backend)

**Files:**
- Modify: `backend/src/services/vertex.service.ts` — `suggestCampaignLayout()` method

Find the prompt section that handles `mode === "only_bg_comp"` (around the `isCompOnly` block). Replace its component composition task description with the art director rules below. Also add `text_zone` and `composition_vibe` to the JSON output schema.

**Step 1: Locate the only_bg_comp mode block**

In `suggestCampaignLayout`, the current component task for `only_bg_comp` reads:
```
1. COMPONENT EXTRACTION (MAIN TASK): ...
2. SKIP TEXT TASKS: ...
```
Find this in the `isCompOnly ? \`...\` : \`...\`` ternary (around line 417).

**Step 2: Replace only_bg_comp task with art director version**

Replace the `isCompOnly` prompt block (the part that says "1. COMPONENT EXTRACTION"):

```
      1. ART DIRECTOR COMPONENT PLACEMENT:
         You are an award-winning Thai advertising art director (SCB EASY, Grab, True style).
         Your job: compose the components on the canvas like a high-budget poster shoot.
         Rules:
         - CHARACTERS / PERSONS (any component matching keywords: person, woman, man, boy, girl, mascot, character, figure):
           * Scale to fill 70-90% of canvas HEIGHT → suggested_position.height = 700 to 900
           * Anchor to BOTTOM edge → suggested_position.top = 1000 - height (feet at canvas bottom)
           * Choose LEFT or RIGHT side based on subject's gaze direction:
             - Subject faces/looks RIGHT → place on LEFT side (left ≈ 0 to 100)
             - Subject faces/looks LEFT → place on RIGHT side (left ≈ 1000 - width)
             - Subject faces camera → place on RIGHT side by default
           * BLEED: left edge ≤ 50 if left-anchored, or right edge ≥ 950 if right-anchored
         - MASCOTS / SECONDARY ELEMENTS: bottom-corner, suggested_position.height = 300-450
         - LOGOS / BADGES / RIBBONS: keep near their detected position, scale up 120%

         After placing ALL components, calculate the horizontal text zone (the open space):
         * If character is on LEFT (left < 400): text_zone = { top: 0, left: character_right + 20, width: 1000 - character_right - 20, height: 1000 }
         * If character is on RIGHT (left > 400): text_zone = { top: 0, left: 30, width: character_left - 50, height: 1000 }

      2. SKIP TEXT TASKS: Do NOT analyze or suggest text layouts for this request.
```

**Step 3: Add `text_zone` and `composition_vibe` to the JSON output schema**

In the JSON schema section of the prompt (around the big `Return the result as a STRICT JSON object:` block), add two fields at the top level:

```json
"composition_text_zone": { "top": 0, "left": 0, "width": 400, "height": 1000, "rationale": "Character anchored bottom-right, left column is open" },
"composition_vibe": "energetic | luxury | playful | bold",
```

Add these to the schema string so the AI knows to return them.

**Step 4: Add `fixedComponentPositions` and `textZone` parameters**

Change the method signature:
```typescript
async suggestCampaignLayout(
  imageBuffer: Buffer,
  mimeType: string,
  targetText: string,
  mode: string = "full",
  noGoZones: any[] = [],
  fixedComponentPositions?: Array<{ label: string; top: number; left: number; width: number; height: number }>,
  textZone?: { top: number; left: number; width: number; height: number },
)
```

**Step 5: Add fixed-component context to the text placement prompt**

Inside `suggestCampaignLayout`, before building `safeZoneInstruction`, add a block:

```typescript
let fixedComponentNote = "";
if (fixedComponentPositions && fixedComponentPositions.length > 0) {
  const compList = fixedComponentPositions
    .map(c => `  - "${c.label}": occupies left=${c.left} to ${c.left + c.width}, top=${c.top} to ${c.top + c.height}`)
    .join("\n");
  const zone = textZone ? `left=${textZone.left}, width=${textZone.width}` : "left side of canvas";
  fixedComponentNote = `
══════════════════════════════════════
COMPONENT POSITIONS ARE FIXED (art director pre-placed):
${compList}

TEXT ZONE (all text MUST stay within this area):
  ${zone}

COMPOSITION RULES FOR TEXT:
  - Do NOT place text outside the TEXT ZONE
  - Pull text toward the component's nearest edge — text should relate to the character's action/gaze direction
  - If character is on RIGHT → text should right-align toward the character (right-justify or center)
  - If character is on LEFT → text should left-align from the left of the text zone
══════════════════════════════════════
  `;
}
```

Then inject `fixedComponentNote` into the main prompt string near the top (after the AD BRIEF section).

**Step 6: Commit**
```bash
git add backend/src/services/vertex.service.ts
git commit -m "feat: art director placement rules + text_zone output + fixedComponentPositions param"
```

---

## Task 2: Wire Two-Pass Flow in createCampaign (backend)

**Files:**
- Modify: `backend/src/controllers/image.controller.ts` — `createCampaign` handler

**Step 1: Understand current single-pass call (line ~627)**

Currently:
```typescript
const analysis = await vertexService.suggestCampaignLayout(
  imageBuffer, mimeType, targetText, mode || "full", parsedNoGoZones,
);
let textSuggestions = analysis.suggestions || [];
let componentSuggestions = analysis.components || [];
```

This is the ONLY layout call. Die-cut happens AFTER this.

**Step 2: Split into two passes**

Replace the single `suggestCampaignLayout` call with this two-pass structure:

```typescript
// ── PASS 1: Art Director Component Placement ──────────────────────────
sendSSE("progress", {
  step: "initial_analysis",
  message: "AI art director is composing component placement...",
});

const componentAnalysis = await vertexService.suggestCampaignLayout(
  imageBuffer,
  mimeType,
  targetText,
  "only_bg_comp",   // components only — no text yet
  parsedNoGoZones,
);
let componentSuggestions = componentAnalysis.components || [];
const artDirectorTextZone = componentAnalysis.composition_text_zone || null;

// (keep all existing dedup/filter code unchanged — it operates on componentSuggestions)
```

Then, AFTER the die-cut block (after `safeZonePlacementDone = true`), add Pass 2:

```typescript
// ── PASS 2: Text Layout Around Fixed Components ───────────────────────
let textSuggestions: any[] = [];
if (mode !== "only_bg_comp") {
  sendSSE("progress", {
    step: "text_layout",
    message: "AI is fitting text around the composed layout...",
  });

  // Use die-cut stroke bboxes as safeZones if available, else use artDirectorTextZone
  const textNoGoZones = strokeBboxes.length > 0
    ? strokeBboxes.map(b => ({
        label: b.label,
        area: { top: b.top, left: b.left, width: b.width, height: b.height },
      }))
    : parsedNoGoZones;

  const fixedPositions = visualComponents.map(c => ({
    label: c.label,
    top: c.position.top || 0,
    left: c.position.left || 0,
    width: c.position.width || 200,
    height: c.position.height || 200,
  }));

  const textAnalysis = await vertexService.suggestCampaignLayout(
    imageBuffer,
    mimeType,
    targetText,
    "text",            // text only
    textNoGoZones,
    fixedPositions,    // tell AI where components are
    artDirectorTextZone || undefined,
  );
  textSuggestions = textAnalysis.suggestions || [];
}
```

**Step 3: Remove now-redundant code**

Remove the existing block that strips text for `only_bg_comp` mode (around line 638-644) — this is now handled by always using `"only_bg_comp"` for Pass 1.

Remove or update the existing `sendSSE("progress", { step: "initial_analysis_complete" ... })` to fire after Pass 2.

**Step 4: Keep `strokeBboxes` in scope**

The variable `strokeBboxes` is currently declared inside the `if (componentSuggestions.length > 0)` block. Hoist it to be accessible for Pass 2:

```typescript
// Before the Pass 1 block, declare:
let strokeBboxes: Array<{ label: string; top: number; left: number; width: number; height: number }> = [];
```

Then inside the die-cut block, remove the `const strokeBboxes` declaration (it's now `let` above).

**Step 5: Apply existing post-processing to Pass 2 textSuggestions**

Move the contrast enforcement + text clamping code (lines ~646-713) to run AFTER Pass 2 (after `textSuggestions` is set from the text analysis). It currently runs after the single-pass call — just ensure it still runs in the right place.

**Step 6: Commit**
```bash
git add backend/src/controllers/image.controller.ts
git commit -m "feat: two-pass layout — components first (art director), text second (around fixed components)"
```

---

## Task 3: Fix Text Size Mismatch — Preview (frontend)

**Files:**
- Modify: `frontend/src/components/AIRefinementPreview.vue`

**Root cause:** `getTextStyle()` returns `fontSize: font_size_normalized * 0.4 + "px"`. The `* 0.4` was a manual calibration that doesn't match the editor.

**Step 1: Add `container-type` to `.canvas-content`**

In the `<style>` section, find `.canvas-content` and add `container-type: inline-size`:
```css
.canvas-content {
  width: 100%;
  height: 100%;
  min-height: 400px;
  position: relative;
  overflow: hidden;
  container-type: inline-size;   /* ← ADD THIS */
}
```

**Step 2: Change font size formula to `cqw`**

In `getTextStyle()` (around line 285), change:
```typescript
// BEFORE:
fontSize: Math.max(8, (style.font_size_normalized || 16) * 0.4) + "px",

// AFTER:
fontSize: (style.font_size_normalized || 16) * 0.1 + "cqw",
```

This makes font size = `font_size_normalized * 0.1`% of the canvas container's width. For `font_size_normalized = 80` → `8cqw` → 8% of canvas width.

**Step 3: Commit**
```bash
git add frontend/src/components/AIRefinementPreview.vue
git commit -m "fix: preview text size uses cqw (container-relative) to match editor proportions"
```

---

## Task 4: Fix Text Size Mismatch — Editor (frontend)

**Files:**
- Modify: `frontend/src/components/LayerEditor.vue`

**Root cause:** Editor uses `fontSize: layer.style.font_size_normalized + 'px'` (raw, not scaled to canvas size).

**Step 1: Add `container-type` to `.canvas`**

In the `<style>` section, find `.canvas` and add `container-type: inline-size`:
```css
.canvas {
  position: relative;
  width: 100%;
  line-height: 0;
  cursor: crosshair;
  container-type: inline-size;   /* ← ADD THIS */
}
```

**Step 2: Change font size formula to `cqw`**

In the template (around line 877), change the text layer style binding:
```typescript
// BEFORE:
fontSize: layer.style.font_size_normalized + 'px',

// AFTER:
fontSize: layer.style.font_size_normalized * 0.1 + 'cqw',
```

**Step 3: Fix component image padding**

The `.text-layer` CSS has `padding: 2px 4px` which slightly shrinks component images. For image layers, override to `padding: 0`:

In the image layer style binding (around line 864), add `padding: '0'`:
```typescript
layer.type === 'image'
  ? {
      top: layer.y + '%',
      left: layer.x + '%',
      width: layer.w + '%',
      height: layer.h + '%',
      transform: `rotate(${layer.rotation || 0}deg)`,
      zIndex: layer.z_index,
      padding: '0',            /* ← ADD THIS */
    }
```

**Step 4: Commit**
```bash
git add frontend/src/components/LayerEditor.vue
git commit -m "fix: editor text size uses cqw to match preview; remove padding from image layers"
```

---

## Task 5: End-to-End Verification

**Step 1: Start backend**
```bash
cd backend && npm run dev
```
Expected: server starts on port 5001, RMBG model warms up.

**Step 2: Start frontend**
```bash
cd frontend && npm run dev
```
Expected: Vite serves on port 5173.

**Step 3: Test two-pass flow**
- Upload an image with a character + text brief
- Watch SSE logs for:
  - `"AI art director is composing component placement..."`
  - `"AI is fitting text around the composed layout..."`
- Check backend console for `[Compose] "..." repositioned →` with dramatic positions (height ~700-900)

**Step 4: Verify size consistency**
- After pipeline completes, observe the preview canvas
- Switch to Editor tab
- Verify text appears at the same proportional size in both views (not 2.5× difference as before)
- Verify components appear at the same proportional size in both views

**Step 5: Commit if all looks good**
```bash
git add -A
git commit -m "feat: two-pass art director composition with consistent preview/editor sizing"
```
