# Plan: Composition Upgrade — Finish Bugs + DesignAsCode-Inspired Architecture

> **Status:** Tasks 1-3 of dynamic-composition.md committed (commits 086e5d1 → 4ada6de).
> This plan picks up from Task 4 + adds new architectural improvements inspired by DesignAsCode paper.

**Goal:** Fix remaining bugs, then upgrade composition quality by:

1. Adding a **Semantic Plan Phase** before layout generation (DesignAsCode "Plan" step)
2. Improving the **Reflection loop** to be genuinely vision-driven (already partial from Task 3)
3. Adding a **Visual Quality Gate** — post-render checklist that auto-fixes common SCB ad patterns

---

## Context: Where We Are

### Completed (from dynamic-composition.md)

- ✅ Pass 2 no-go zones removed → AI composes freely, character depth handles visual separation
- ✅ AIRefinementPreview applies `interaction_zone` z-index (text behind character is visible in preview)
- ✅ Refinement loop: `critiqueLayout` runs every iteration (no code auto-fail), `refineLayout` prompt allows aesthetic improvements

### Remaining Bugs (Task 4 from dynamic-composition.md)

- 🔴 In-loop zone format bug: flat `{top, left, width, height}` zones silently skipped (causes incorrect overlap reporting)

### Problems Still Causing Bad Output (Diagnosed from DesignAsCode paper comparison)

- 🟠 No planning phase — AI improvises layout in one shot → inconsistent hierarchy
- 🟠 Prompt overload — suggestCampaignLayout does too much at once (plan + text coordinates + component placement + color + shields)
- 🟠 Refinement loop can still spin without meaningful improvement (no "confidence score" gate)
- 🟠 Visual containers: backend emits `visual_container` but frontend renders very basic shapes only

---

## Task 1: Fix Zone Format Bug (Carry-over from Task 4)

**File:** `backend/src/controllers/image.controller.ts`  
**Why:** In the while loop, the overlap checker does `if (!zone.area) continue` → skips all flat-format zones. With Task 3 making critiqueLayout the sole judge, this bug only affects informational overlap context — but it still sends wrong info to AI.

**Find block (around line 1380-1410):**

```typescript
if (!zone.area) continue;
const zTop = zone.area.top;
const zLeft = zone.area.left;
const zW = zone.area.width;
const zH = zone.area.height;
```

**Replace with:**

```typescript
const zTop = zone.area?.top ?? zone.top ?? 0;
const zLeft = zone.area?.left ?? zone.left ?? 0;
const zW = zone.area?.width ?? zone.width ?? 0;
const zH = zone.area?.height ?? zone.height ?? 0;
if (zW === 0 && zH === 0) continue; // skip degenerate zones
```

**Verify:** `cd backend && npm run build 2>&1 | tail -5` → zero errors.

**Commit:** `fix: in-loop zone check handles both flat and nested coordinate formats`

---

## Task 2: Semantic Plan Phase (DesignAsCode "Plan" step)

**Why this matters:** DesignAsCode proved empirically that a dedicated Plan step before Implementation significantly improves layout quality. Currently our AI improvises everything in one giant prompt call to `suggestCampaignLayout`. By splitting "what should the layout look like?" from "give me coordinates", the AI can focus and the layout becomes more intentional.

**New function in `vertex.service.ts`:**

```typescript
// NEW: Step 0 — Layout Strategy Planner
// Thinks about composition before committing to coordinates.
async planLayoutStrategy(
  imageBuffer: Buffer,
  mimeType: string,
  targetText: string,
  componentDescriptions: string[], // labels from analyzeComponents
): Promise<{
  layout_concept: string;       // e.g. "hero-right-text-left"
  dominant_element: string;     // e.g. "offer number 2"
  text_hierarchy: string[];     // ordered: ["2 ต่อ", "SCB EASY", "รับฟรี บัตร..."]
  composition_notes: string;    // e.g. "number should bleed into character zone"
  recommended_text_zone: "left" | "right" | "bottom" | "full";
}>
```

**Prompt for planLayoutStrategy:**

```
You are a senior Thai advertising Art Director at a top agency.

Given this campaign image and text brief, output a LAYOUT STRATEGY only.
Do NOT write coordinates. Think like a designer brainstorming a layout.

IMAGE: [image]
TEXT BRIEF: ${targetText}
VISUAL COMPONENTS AVAILABLE: ${componentDescriptions.join(", ")}

Respond in JSON with this exact schema:
{
  "layout_concept": "one phrase describing the composition approach (e.g. 'character right, stacked text left')",
  "dominant_element": "the single most visually important text/number that must dominate (e.g. '2 ต่อ')",
  "text_hierarchy": ["ordered list of text parts from most to least important"],
  "composition_notes": "key design decisions (e.g. 'number bleeds into character lower body, headline above it')",
  "recommended_text_zone": "left | right | bottom | full"
}

SCB ad style rules:
- Promotional numbers (e.g. 2, 50%) → MUST be the dominant element (font_size 150-200)
- Character always right side or center → text left
- Text groups as a lock-up (number + label stacked, not scattered)
```

**Wire into controller:**  
In `image.controller.ts`, before the Pass 2 `suggestCampaignLayout` call, add:

```typescript
// Step 0: Layout strategy planning (DesignAsCode-inspired Plan phase)
const layoutStrategy = await vertexService.planLayoutStrategy(
  imageBuffer,
  mimeType,
  targetText,
  visualComponents.map((c) => c.label),
);
logger.info("[Plan] Strategy:", layoutStrategy.layout_concept);
```

Then append strategy to `suggestCampaignLayout` call as an extra system note in the prompt (pass as new optional arg `layoutHint`):

```typescript
// In vertex.service.ts suggestCampaignLayout, add new optional param:
layoutHint?: { layout_concept: string; dominant_element: string; text_hierarchy: string[]; composition_notes: string }

// Add to prompt preamble:
${layoutHint ? `
LAYOUT STRATEGY (decided by Art Director):
- Concept: ${layoutHint.layout_concept}
- Dominant element: ${layoutHint.dominant_element}
- Text priority order: ${layoutHint.text_hierarchy.join(" > ")}
- Notes: ${layoutHint.composition_notes}
Follow this strategy exactly when placing elements.
` : ''}
```

**Verify:** `npm run build` clean → test generation → check `[Plan] Strategy:` log appears.

**Commit:** `feat: layout strategy planning phase (DesignAsCode Plan step)`

---

## Task 3: Visual Quality Gate (Post-render auto-fix)

**Why:** Even after good layout, common SCB ad patterns still break silently:

1. Promotional number isn't clearly dominant (font_size < 100 even though it should be 150+)
2. Headline group is scattered (3 separate boxes when they should be stacked)
3. Text in lower purple zone has dark color (contrast bug misses edge cases)

**Add `enforceDesignRules()` in `image.controller.ts`** after text suggestions normalize pass:

```typescript
// Visual Quality Gate — post-AI rule enforcement for common SCB patterns
function enforceDesignRules(suggestions: any[]): any[] {
  // Rule 1: Find the promotional number (short text, digits/symbols/Thai numbers)
  // and boost its font_size to at least 140 if it isn't already dominant
  const isPromoNumber = (s: any) =>
    /^[\d๐-๙%+×ต่อ\s]{1,6}$/.test(s.part?.trim() || "");
  const promoItems = suggestions.filter(isPromoNumber);
  const maxFontSize = Math.max(
    ...suggestions.map((s) => s.font_size_normalized || 0),
  );

  return suggestions.map((s) => {
    if (isPromoNumber(s) && (s.font_size_normalized || 0) < maxFontSize * 0.8) {
      logger.info(
        `[QualityGate] Boosting promo number "${s.part}" font ${s.font_size_normalized} → 160`,
      );
      return { ...s, font_size_normalized: 160 };
    }
    return s;
  });
}
```

Apply after existing Kanit normalize pass:

```typescript
textSuggestions = enforceDesignRules(textSuggestions);
```

Also apply in `refineLayout` post-processing (so refinements don't shrink the promo number).

**Verify:** Log `[QualityGate]` should appear if promo number detected. Font size visually dominant in canvas.

**Commit:** `feat: visual quality gate — auto-boost promotional number dominance`

---

## Task 4: Reflection Loop Confidence Gate

**Why:** The refinement loop currently runs up to MAX_ITERATIONS even if compositions are OK after iteration 1. Conversely, it may PASS prematurely if critiqueLayout sees no obvious issues but the overall composition is still weak.

**Add `confidence_score` to critiqueLayout response:**

In `vertex.service.ts` `critiqueLayout` prompt, add to JSON schema:

```json
{
  "status": "PASS | FAIL",
  "confidence": 0.0-1.0,  // NEW: 0.9+ = high confidence, PASS immediately; <0.5 = needs refine
  "feedback": "...",
  "actionable_steps": [...]
}
```

In `image.controller.ts` while loop condition, change early-exit condition:

```typescript
// Break loop early if AI has high confidence
if (critique.status === "PASS" && (critique.confidence ?? 0.5) >= 0.85) {
  logger.info(
    "[Compose] High confidence PASS — stopping at iteration",
    currentIteration,
  );
  break;
}
```

**Verify:** Log shows confidence score; loop exits early on strong layouts.

**Commit:** `feat: critique confidence gate — exits refinement loop on high-confidence PASS`

---

## Task 5: Update progress.md and understanding.md

After all tasks pass:

1. Update `progress.md` with current session work
2. Update `understanding.md` to reflect new Plan Phase in the pipeline diagram

---

## Verification Summary

| Task                     | Command                        | Expected                                                                          |
| ------------------------ | ------------------------------ | --------------------------------------------------------------------------------- |
| Task 1 (zone bug)        | `cd backend && npm run build`  | ✅ Zero errors                                                                    |
| Task 2 (plan phase)      | Generate campaign → check logs | `[Plan] Strategy: hero-right-text-left` appears                                   |
| Task 3 (quality gate)    | Generate with promo number     | `[QualityGate] Boosting promo number` in logs                                     |
| Task 4 (confidence gate) | Generate clean layout          | `[Compose] High confidence PASS` in logs                                          |
| Full e2e                 | Upload SCB ad image            | "2 ต่อ" visually dominant, character in front, layout not overlapping chaotically |

---

## Risk Log

| Risk                                                        | Mitigation                                                 |
| ----------------------------------------------------------- | ---------------------------------------------------------- |
| Plan Phase adds 1 extra API call (latency ~3s)              | Only runs in build-up mode; shows SSE progress message     |
| planLayoutStrategy JSON parse fails                         | Wrap in try/catch → fallback to no-hint (current behavior) |
| QualityGate regex misidentifies Thai words as promo numbers | Conservative regex; logs every boost; can tune             |
| confidence_score ignored by old critiqueLayout responses    | Default to 0.5 if field missing (safe middle ground)       |

---

**Approve this plan? Reply APPROVED to begin execution.**
