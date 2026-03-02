# Dynamic Composition — Depth Layering + Aesthetic Refinement Loop

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Make the composition feel like a real Thai ad — character in front of text (3D depth), text allowed to overlap character intentionally, refinement loop acts as aesthetic art director not overlap-fixer.

**Architecture:**
- Pass 2 stops treating character bbox as "forbidden zone" — instead AI composes freely around known component positions
- `AIRefinementPreview.vue` applies `interaction_zone` z-index logic (same as LayerEditor already does) so preview matches editor
- Critique/refine loop pivots: geometric overlap no longer auto-fails, `critiqueLayout` becomes the only judge (full vision check, both images, no `styleOnly` shortcut bypass)
- `refineLayout` prompt gains explicit permission to adjust font sizes, colors, and z-index hints — not just move boxes

**Tech Stack:** TypeScript/NestJS backend, Vue 3 frontend, CSS `z-index`

---

## Context: What's Wrong Now

### Problem 1 — Pass 2 over-constrains text placement
`textNoGoZones = strokeBboxes` is passed as `externalNoGoZones` (arg 5) to `suggestCampaignLayout`. The prompt turns these into `🚫 STRICT FORBIDDEN ZONES` — the AI places ALL text in the safe left column only. Result: flat, boring layout. Nothing dynamic.

**The fix:** Pass 2 should NOT pass `textNoGoZones` as forbidden zones. The AI already knows where components are via `fixedComponentNote` (arg 7). The character will render on top via `interaction_zone` — so text overlapping the character is fine and intentional.

### Problem 2 — AIRefinementPreview ignores interaction_zone
`getTextStyle()` hardcodes `zIndex: 20` for ALL text (line 312 in `AIRefinementPreview.vue`). Components use `c.z_index || 10`. So in the live preview: text is ALWAYS on top of characters — the depth effect that LayerEditor correctly applies is invisible during the refinement loop. The AI sees a broken preview and tries to "fix" non-existent overlap.

**The fix:** Apply the same `interaction_zone` logic from LayerEditor to AIRefinementPreview before rendering.

### Problem 3 — Refinement loop is an overlap-fixer, not an art director
Current flow:
```
code geometric check → overlap? → auto-FAIL → refineLayout moves text → repeat
```
`critiqueLayout` is ONLY called with `styleOnly=true` when code finds NO overlap (meaning positions are already perfect). This means the AI art director critique never actually evaluates whether the composition looks GOOD — it only runs after all positional fixes are done, as a final style check.

**The fix:** Remove the code auto-fail. Let `critiqueLayout` (with BOTH images visible) be the only judge every iteration. It can see whether text overlapping a character looks intentionally designed or accidentally bad. `refineLayout` gets richer instructions: it can improve font sizes, visual hierarchy, shield types — not just move boxes.

### Bug — In-loop geometric check silently skips flat-format zones
`computeTextBBox()` inner loop does `if (!zone.area) continue` — this silently skips zones that use flat `{top, left, width, height}` format (from `parsedNoGoZones`). The pre-check handles both formats. The inner loop doesn't.

---

## Task 1: Pass 2 — Remove Forbidden Zone Constraint

**Files:**
- Modify: `backend/src/controllers/image.controller.ts` (lines 1064-1103)

**Background:** The Pass 2 call currently passes `textNoGoZones` as `externalNoGoZones` (arg 5), which becomes `🚫 STRICT FORBIDDEN ZONES` in the AI prompt. We want to pass an empty array instead, letting the AI compose freely. The `fixedComponentNote` (from `fixedPositions` at arg 7) already tells the AI exactly where components are positioned.

We also need to update the `fixedComponentNote` prompt in `vertex.service.ts` to change the wording from "TEXT ZONE (ALL text MUST stay within this area)" to something that allows overlap with the character.

### Step 1: Pass empty noGoZones in Pass 2

In `image.controller.ts`, find the Pass 2 `suggestCampaignLayout` call (around line 1093):

```typescript
const textAnalysis = await vertexService.suggestCampaignLayout(
  imageBuffer,
  mimeType,
  targetText,
  "text",
  textNoGoZones,                    // 5: externalNoGoZones
  [],                               // 6: safeZones (empty)
  fixedPositions,                   // 7: fixedComponentPositions
  artDirectorTextZone || undefined, // 8: textZone
);
```

Change arg 5 from `textNoGoZones` to `[]`:

```typescript
const textAnalysis = await vertexService.suggestCampaignLayout(
  imageBuffer,
  mimeType,
  targetText,
  "text",
  [],                               // 5: no forbidden zones — character depth handles layering
  [],                               // 6: safeZones (empty)
  fixedPositions,                   // 7: fixedComponentPositions
  artDirectorTextZone || undefined, // 8: textZone
);
```

### Step 2: Update fixedComponentNote in vertex.service.ts to allow intentional overlap

In `vertex.service.ts`, find the `fixedComponentNote` block (around line 403):

```
TEXT ZONE (ALL text MUST stay within this area):
  ${zoneDesc}

COMPOSITION RULES FOR TEXT:
  - Place ALL text elements within the TEXT ZONE boundaries
  - Pull text toward the component's nearest edge — text should relate to the character's action/gaze
  - If character is on RIGHT → text should right-align or center toward the character
  - If character is on LEFT → text should left-align from the left of the text zone
```

Replace with:

```
COMPOSITION GUIDANCE (text zone — where most text should be):
  ${zoneDesc}

COMPOSITION RULES FOR TEXT:
  - Place MOST text within the TEXT ZONE (the open space beside the character)
  - INTENTIONAL OVERLAP IS ALLOWED: Text elements can partially overlap the character area for a dynamic, layered 3D effect — the character will render IN FRONT of the text (higher z-index)
  - Pull text TOWARD the character — text should reach toward the character's body/gaze, not float away from it
  - If character is on RIGHT → text leans right, hugging the character's left edge
  - If character is on LEFT → text leans left, hugging the character's right edge
  - PROMOTIONAL NUMBERS (e.g. "2 ต่อ", "50%") may overlap the character's lower body (legs/waist) — this creates the "character standing on the offer" SCB effect
```

### Step 3: Verify backend builds

```bash
cd /Users/chulin/gen-image-layer-separator/backend && npm run build 2>&1 | tail -5
```
Expected: zero errors.

### Step 4: Commit

```bash
cd /Users/chulin/gen-image-layer-separator
git add backend/src/controllers/image.controller.ts backend/src/services/vertex.service.ts
git commit -m "feat: Pass 2 allows intentional overlap — character depth replaces forbidden zones"
```

---

## Task 2: AIRefinementPreview — Apply interaction_zone Z-Index

**Files:**
- Modify: `frontend/src/components/AIRefinementPreview.vue`

**Background:** `getTextStyle()` hardcodes `zIndex: 20` for all text (line 312). `getComponentStyle()` uses `c.z_index || 10` (line 331). So text is always above characters in preview. LayerEditor already has correct interaction_zone logic (lines 128-148 of LayerEditor.vue) — copy the same approach here.

### Step 1: Change text zIndex in getTextStyle to use layer z_index

In `getTextStyle()` (around line 312), find:
```typescript
zIndex: 20,
```

Replace with:
```typescript
zIndex: suggestion.z_index ?? 20,
```

(Text suggestions currently don't carry a `z_index` field — they'll fall back to 20. But after Step 2 computes dynamic z-index, we'll pass it in.)

### Step 2: Add interaction_zone depth computation in the SSE handler

In the SSE `iteration_end` handler (around where `liveTextLayers.value = data.textLayers` is set), add depth-layering logic BEFORE assigning to `liveTextLayers`:

Find the handler that sets `liveTextLayers`. It will look like:
```typescript
liveTextLayers.value = data.textLayers;
liveComponents.value = data.visualComponents || data.components || [];
```

Replace with:
```typescript
const components = data.visualComponents || data.components || [];
const rawTextLayers = (data.textLayers || []).map((t: any) => ({ ...t, z_index: t.z_index ?? 20 }));

// Apply interaction_zone depth: text overlapping character's interaction_zone goes behind character
const charLayers = components.filter((c: any) => c.interaction_zone?.enabled);
rawTextLayers.forEach((tl: any) => {
  const tLeft = (tl.position?.left || 0) / 10;
  const tTop = (tl.position?.top || 0) / 10;
  const tRight = tLeft + (tl.position?.width || 0) / 10;
  const tBottom = tTop + (tl.position?.height || 0) / 10;
  for (const cl of charLayers) {
    const iz = cl.interaction_zone;
    const izLeft = iz.overlap_left / 10;
    const izTop = iz.overlap_top / 10;
    const izRight = (iz.overlap_left + iz.overlap_width) / 10;
    const izBottom = (iz.overlap_top + iz.overlap_height) / 10;
    const overlaps = !(tRight <= izLeft || tLeft >= izRight || tBottom <= izTop || tTop >= izBottom);
    if (overlaps) {
      tl.z_index = Math.min(tl.z_index, (cl.z_index || 15) - 5);
    }
  }
});

liveTextLayers.value = rawTextLayers;
liveComponents.value = components;
```

Also apply the same logic in the `done` SSE handler if `liveTextLayers` is set there too.

### Step 3: Verify frontend builds

```bash
cd /Users/chulin/gen-image-layer-separator/frontend && npm run build 2>&1 | tail -5
```
Expected: zero errors.

### Step 4: Commit

```bash
cd /Users/chulin/gen-image-layer-separator
git add frontend/src/components/AIRefinementPreview.vue
git commit -m "feat: preview applies interaction_zone depth — character renders in front of overlapping text"
```

---

## Task 3: Refinement Loop — Aesthetic Art Director Mode

**Files:**
- Modify: `backend/src/controllers/image.controller.ts` (lines 1194-1603)
- Modify: `backend/src/services/vertex.service.ts` — `refineLayout` prompt (lines 1186-1303)

**Background:** Currently the loop auto-fails on code-detected overlap, never letting the art director evaluate the composition. With dynamic overlap now intentional, we need to change the loop so `critiqueLayout` is always called (not bypassed) and `refineLayout` has permission to improve aesthetics beyond just repositioning.

### Step 1: Remove code auto-fail bypass in the refinement loop

In `image.controller.ts`, find the section inside the while loop that does the geometric check and auto-fails (around lines 1427-1510):

```typescript
if (overlapFound) {
  // No code-detected overlap — safe zones handle positions, only check style
  critique = { status: "FAIL", feedback: `CODE-DETECTED OVERLAP: ...`, actionable_steps: overlapDetails };
} else {
  critique = await vertexService.critiqueLayout(
    imageBuffer, previewBuffer, mimeType, targetText,
    true, // styleOnly
  );
}
```

Replace this entire if/else with a single `critiqueLayout` call — always use AI vision, never auto-fail:

```typescript
// Always use AI art director critique — no code auto-fail
// (intentional overlap with character is valid in depth-layered composition)
critique = await vertexService.critiqueLayout(
  imageBuffer,
  previewBuffer,
  mimeType,
  targetText,
  false, // full critique — positions + style + composition quality
);
```

Also remove the `preCheckOverlapFound` pre-check block (lines ~1219-1343) that bypasses the loop entirely on first-pass overlap — since we want the loop to run and evaluate composition quality, not skip on geometric overlap. Simplify the pre-check to: always run the loop for at least 1 iteration.

Replace the while loop condition so it always runs at least once:
```typescript
// Always run at least 1 critique iteration for aesthetic quality
const shouldSkipIteration = mode === "only_bg_comp";
// Remove preCheckOverlapFound condition — run iteration 0 unconditionally
```

Change the while condition from:
```typescript
while (
  currentIteration < MAX_ITERATIONS &&
  !shouldSkipIteration &&
  (currentIteration === 0
    ? preCheckOverlapFound
    : lastCritique.status !== "PASS")
)
```

To:
```typescript
while (
  currentIteration < MAX_ITERATIONS &&
  !shouldSkipIteration &&
  (currentIteration === 0 || lastCritique.status !== "PASS")
)
```

### Step 2: Update critiqueLayout prompt for dynamic composition awareness

In `vertex.service.ts`, find the `critiqueLayout` prompt (around line 996). In the position checks section that mentions overlap, add:

Find the block that says "TEXT-ON-PERSON OVERLAP" (around line 1005) and add a context note before it:

```
DEPTH LAYERING CONTEXT:
Some text intentionally overlaps the character for a 3D "poster" effect (character renders in front of text).
This is GOOD DESIGN — do NOT flag it as an error if the text appears behind the character.
Only flag text-on-person as BAD if the text is clearly ON TOP of the character's face or body, obscuring them.
```

### Step 3: Expand refineLayout prompt to allow aesthetic improvements

In `vertex.service.ts`, find the `refineLayout` CRITICAL RULES section (around line 1224):

```
CRITICAL RULES FOR REFINEMENT:
1. Fix ALL issues mentioned in the critique's actionable_steps
2. NO text may overlap with any person, mascot, or character in the image
   - Look at IMAGE 2: if text is on top of a person's body, MOVE IT AWAY
   - Even if there's a colored banner behind the person, the person is IN FRONT
3. Keep the same text content — only change positions, sizes, colors, and styles
```

Replace with:

```
CRITICAL RULES FOR REFINEMENT:
1. Address ALL feedback from the critique's actionable_steps
2. DEPTH LAYERING: Text may intentionally overlap the character — the character renders IN FRONT (higher z-index). This is the SCB "character standing on the offer" effect. Do NOT move text just because it overlaps a character's lower body. DO move text if it covers the character's face.
3. Keep the same text content — you may freely change: positions, font_size_normalized, colors, stroke styles, visual_container, and composition grouping
4. IMPROVE visual hierarchy aggressively: if the offer number (e.g. "2 ต่อ") is not clearly the dominant element, INCREASE its font_size_normalized to 180-200
5. IMPROVE contrast shields: if text is on a photo background and lacks a visual_container, ADD one (ribbon, pill, or solid_block)
6. GROUPING: if related text elements are scattered, pull them together (within 30 units of each other)
```

### Step 4: Verify backend builds

```bash
cd /Users/chulin/gen-image-layer-separator/backend && npm run build 2>&1 | tail -5
```
Expected: zero errors.

### Step 5: Commit

```bash
cd /Users/chulin/gen-image-layer-separator
git add backend/src/controllers/image.controller.ts backend/src/services/vertex.service.ts
git commit -m "feat: refinement loop as aesthetic art director — no code auto-fail, full AI critique every iteration"
```

---

## Task 4: Fix In-Loop Zone Format Bug

**Files:**
- Modify: `backend/src/controllers/image.controller.ts` (the inner `computeTextBBox` loop, around lines 1427-1452)

**Background:** The in-loop geometric check does `if (!zone.area) continue` which silently skips flat-format zones (`{top, left, width, height}` without `area` wrapper). The pre-check handles both formats. The inner check needs to match.

**Note:** With Task 3 removing the code auto-fail, this check is now only used for informational overlap reporting (passed to `critiqueLayout` as context), not to trigger auto-FAIL. But it should still work correctly.

### Step 1: Find the inner loop zone access

Find inside the while loop where `computeTextBBox` or the overlap check reads `zone.area.top` etc. Look for:
```typescript
if (!zone.area) continue;
const zTop = zone.area.top;
const zLeft = zone.area.left;
```

### Step 2: Update to handle both flat and nested formats

Replace:
```typescript
if (!zone.area) continue;
const zTop = zone.area.top;
const zLeft = zone.area.left;
const zW = zone.area.width;
const zH = zone.area.height;
```

With:
```typescript
const zTop = zone.area?.top ?? zone.top ?? 0;
const zLeft = zone.area?.left ?? zone.left ?? 0;
const zW = zone.area?.width ?? zone.width ?? 0;
const zH = zone.area?.height ?? zone.height ?? 0;
if (zW === 0 && zH === 0) continue; // skip zones with no meaningful area
```

### Step 3: Verify backend builds

```bash
cd /Users/chulin/gen-image-layer-separator/backend && npm run build 2>&1 | tail -5
```
Expected: zero errors.

### Step 4: Commit

```bash
cd /Users/chulin/gen-image-layer-separator
git add backend/src/controllers/image.controller.ts
git commit -m "fix: in-loop zone check handles both flat and nested coordinate formats"
```

---

## Task 5: End-to-End Verification

**Step 1: Start backend and frontend**
```bash
cd /Users/chulin/gen-image-layer-separator/backend && npm run dev &
cd /Users/chulin/gen-image-layer-separator/frontend && npm run dev
```

**Step 2: Test with SCB-style ad**

Upload an image with a person/character + text brief like:
```
"ชวนลูกค้าแอป SCB EASY และ Robinhood มาสนุก 2 ต่อ รับพอยต์ บัตรขึ้นชิงช้าสวรรค์"
```

**Step 3: Observe in live preview**

- "2 ต่อ" should appear large, near the character's lower body (intentional overlap)
- Character renders IN FRONT of "2 ต่อ" text (z-index depth visible)
- Text on photo background should have shields (ribbon/pill)
- Refinement loop should run `critiqueLayout` (check backend logs for "[GenAI] Critiquing layout...")
- `critiqueLayout` should see the depth-layered preview and NOT flag character overlap as an error

**Step 4: Check backend logs for these signs of success**
```
[GenAI] Critiquing layout...           ← AI critique runs (not skipped)
[Compose] "woman" repositioned →       ← art director placement worked
[GenAI] Got 3+ text suggestions:       ← "2 ต่อ" as one item
  [0] "2 ต่อ..." → size:180            ← large offer lock-up
```

**Step 5: Commit if all looks good**
```bash
git add -A && git commit -m "feat: dynamic depth composition — character in front, aesthetic refinement loop"
```
