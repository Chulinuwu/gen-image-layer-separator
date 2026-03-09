# No-Overlap Layout Rules Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Prevent ALL visual elements (components, text, SVG) from overlapping each other by improving AI prompts and adding validation logging.

**Architecture:** Fix the AI prompt in `planLayoutStrategy()` to explicitly forbid component-to-component overlap. Add pre-computed overlap diagnostics to the prompt so the AI can see the problem. Remove `interaction_zone` (intentional overlap) temporarily. Add post-plan validation that logs overlap warnings for debugging.

**Tech Stack:** TypeScript, Vertex AI Gemini prompts, opentype.js text measurement

---

### Task 1: Add Component-to-Component Overlap Rules to `planLayoutStrategy` Prompt

**Files:**
- Modify: `backend/src/services/vertex.service.ts:334-377` (the prompt string in `planLayoutStrategy`)

**Step 1: Add overlap diagnostics to `componentPositionsBlock`**

In `vertex.service.ts` around line 330, modify the `componentPositionsBlock` builder to also compute and report any current overlaps between components:

```typescript
const componentPositionsBlock = componentPositions?.length
  ? `\nCURRENT COMPONENT POSITIONS (normalized 0-1000 coordinates):\n${componentPositions.map(c => `- ${c.label}: top=${c.top}, left=${c.left}, width=${c.width}, height=${c.height} (covers x:${c.left}-${c.left + c.width}, y:${c.top}-${c.top + c.height})`).join('\n')}`
  : '';

// Compute overlap warnings to include in prompt
let overlapWarnings = '';
if (componentPositions && componentPositions.length > 1) {
  const warnings: string[] = [];
  for (let i = 0; i < componentPositions.length; i++) {
    for (let j = i + 1; j < componentPositions.length; j++) {
      const a = componentPositions[i];
      const b = componentPositions[j];
      const overlapX = Math.max(0, Math.min(a.left + a.width, b.left + b.width) - Math.max(a.left, b.left));
      const overlapY = Math.max(0, Math.min(a.top + a.height, b.top + b.height) - Math.max(a.top, b.top));
      if (overlapX > 0 && overlapY > 0) {
        const overlapArea = overlapX * overlapY;
        warnings.push(`⚠️ "${a.label}" and "${b.label}" OVERLAP by ${overlapArea} sq units (${overlapX}w × ${overlapY}h). You MUST move them apart.`);
      }
    }
  }
  if (warnings.length > 0) {
    overlapWarnings = `\n\n🚨 OVERLAP DETECTED IN CURRENT POSITIONS:\n${warnings.join('\n')}\nYou MUST fix these overlaps in your component_layout output.\n`;
  }
}
```

Then include `${overlapWarnings}` in the prompt after `${componentPositionsBlock}`.

**Step 2: Add explicit no-overlap rules to the RULES section**

Replace the existing rules block (lines 366-377) with:

```
RULES FOR text_zone + component_layout:
1. text_zone and component_layout rectangles MUST NOT OVERLAP — leave at least 30 units gap
2. component_layout items MUST NOT OVERLAP EACH OTHER — leave at least 30 units gap between any two components
3. All elements must be within 50-950 range (safe zone margins)
4. Components should be on one side, text on the opposite side or in a clear gap
5. text_zone must be large enough for readable text: at least 250 wide AND 300 tall
6. If components are spread across both sides, stack text above or below them
7. EVERY element on canvas must be clearly readable — no element should obscure another
```

**Step 3: Run backend to verify no syntax errors**

Run: `cd /Users/chulin/gen-image-layer-separator/backend && npx tsc --noEmit`
Expected: No errors

**Step 4: Commit**

```bash
git add backend/src/services/vertex.service.ts
git commit -m "feat: add component-to-component no-overlap rules to planLayoutStrategy prompt"
```

---

### Task 2: Add Post-Plan Overlap Validation Logging

**Files:**
- Modify: `backend/src/controllers/image.controller.ts:1266-1287` (after plan is applied)

**Step 1: Add overlap validation after component positions are applied**

After the plan's component positions are applied (around line 1287), add validation that logs overlap warnings:

```typescript
// After line 1287 (after componentSuggestions update)

// Validate: check for remaining overlaps after plan
if (visualComponents.length > 1) {
  for (let i = 0; i < visualComponents.length; i++) {
    for (let j = i + 1; j < visualComponents.length; j++) {
      const a = visualComponents[i].position;
      const b = visualComponents[j].position;
      const overlapX = Math.max(0, Math.min(a.left + a.width, b.left + b.width) - Math.max(a.left, b.left));
      const overlapY = Math.max(0, Math.min(a.top + a.height, b.top + b.height) - Math.max(a.top, b.top));
      if (overlapX > 0 && overlapY > 0) {
        console.warn(`[Plan] ⚠️ OVERLAP REMAINS: "${visualComponents[i].label}" and "${visualComponents[j].label}" overlap by ${overlapX}w × ${overlapY}h after plan`);
      }
    }
  }
}

// Also validate text_zone vs components
if (layoutHint.text_zone) {
  const tz = layoutHint.text_zone;
  for (const comp of visualComponents) {
    const cp = comp.position;
    const overlapX = Math.max(0, Math.min(tz.left + tz.width, cp.left + cp.width) - Math.max(tz.left, cp.left));
    const overlapY = Math.max(0, Math.min(tz.top + tz.height, cp.top + cp.height) - Math.max(tz.top, cp.top));
    if (overlapX > 0 && overlapY > 0) {
      console.warn(`[Plan] ⚠️ TEXT-COMPONENT OVERLAP: text_zone overlaps "${comp.label}" by ${overlapX}w × ${overlapY}h`);
    }
  }
}
```

**Step 2: Run backend type-check**

Run: `cd /Users/chulin/gen-image-layer-separator/backend && npx tsc --noEmit`
Expected: No errors

**Step 3: Commit**

```bash
git add backend/src/controllers/image.controller.ts
git commit -m "feat: add post-plan overlap validation logging"
```

---

### Task 3: Disable `interaction_zone` Temporarily

**Files:**
- Modify: `backend/src/services/vertex.service.ts` (multiple prompt locations)
- Modify: `frontend/src/components/AIRefinementPreview.vue:433-468` (`applyInteractionZoneDepth`)
- Modify: `frontend/src/components/LayerEditor.vue:189-215` (interaction zone depth logic)

**Step 1: Neutralize interaction_zone in frontend preview**

In `AIRefinementPreview.vue`, make `applyInteractionZoneDepth` a no-op:

```typescript
function applyInteractionZoneDepth(
  rawTextLayers: any[],
  components: any[],
): void {
  // Temporarily disabled — system not ready for intentional overlap
  return;
}
```

**Step 2: Neutralize interaction_zone in frontend editor**

In `LayerEditor.vue`, skip the character depth interaction block (around line 189-215). Wrap with early return:

```typescript
// Character depth interaction: DISABLED — no intentional overlap for now
// const characterLayers = imageLayers.filter(...)
// if (characterLayers.length > 0) { ... }
```

Comment out the entire block from `const characterLayers = imageLayers.filter(` through the closing `}` of the `if (characterLayers.length > 0)` block.

**Step 3: In vertex.service.ts prompts, add "interaction_zone.enabled must always be false"**

Find all prompt locations that mention `interaction_zone` and add a note that it must be disabled. Search for `interaction_zone.enabled = true` in prompt strings and change to `false`.

Key locations (from grep results):
- Line ~700: `Set interaction_zone.enabled = true` → change to `false`
- Line ~838: example JSON with `"enabled": true` → `false`
- Line ~1798: instruction about interaction_zone → add "DISABLED: always set enabled=false"
- Line ~3357-3359: z_index rules mentioning interaction_zone → set enabled=false

**Step 4: Run backend type-check**

Run: `cd /Users/chulin/gen-image-layer-separator/backend && npx tsc --noEmit`
Expected: No errors

**Step 5: Commit**

```bash
git add backend/src/services/vertex.service.ts frontend/src/components/AIRefinementPreview.vue frontend/src/components/LayerEditor.vue
git commit -m "feat: disable interaction_zone — no intentional overlap until system is ready"
```

---

### Task 4: Log Overlap Diagnostics to ai-trace.md

**Files:**
- Modify: `backend/src/controllers/image.controller.ts` (after Task 2's validation code)

**Step 1: Add traceAI call for overlap validation results**

After the overlap validation from Task 2, log results to ai-trace:

```typescript
// After the overlap validation loops from Task 2
const overlapResults: string[] = [];
// (reuse the overlap detection from Task 2, collect into overlapResults array)

if (overlapResults.length > 0) {
  logEvent("Post-Plan Overlap Check", `⚠️ ${overlapResults.length} overlaps detected:\n${overlapResults.join('\n')}`);
} else {
  logEvent("Post-Plan Overlap Check", "✅ No overlaps detected — all elements have clear space");
}
```

Ensure `logEvent` is imported from `../utils/ai-logger`.

**Step 2: Run backend type-check**

Run: `cd /Users/chulin/gen-image-layer-separator/backend && npx tsc --noEmit`
Expected: No errors

**Step 3: Commit**

```bash
git add backend/src/controllers/image.controller.ts
git commit -m "feat: log overlap diagnostics to ai-trace.md"
```

---

### Task 5: End-to-End Verification

**Step 1: Start backend**

Run: `cd /Users/chulin/gen-image-layer-separator/backend && npm run dev`

**Step 2: Start frontend**

Run: `cd /Users/chulin/gen-image-layer-separator/frontend && npm run dev`

**Step 3: Run a campaign creation and check logs**

1. Upload an image with multiple components (woman + mascot)
2. Check backend console for:
   - `[Plan] ⚠️ OVERLAP DETECTED IN CURRENT POSITIONS:` (should show in prompt)
   - `[Plan] Moving ...` (AI should reposition components)
   - No `[Plan] ⚠️ OVERLAP REMAINS:` after plan (if AI follows rules)
3. Check ai-trace.md for overlap diagnostic entry
4. Check preview canvas — components should not overlap
5. Check editor canvas — should match preview exactly

**Step 4: Final commit if any adjustments needed**

```bash
git add -A
git commit -m "fix: adjust overlap rules based on e2e test"
```
