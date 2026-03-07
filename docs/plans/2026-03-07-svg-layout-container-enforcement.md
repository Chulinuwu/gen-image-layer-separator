# SVG Layout Container Enforcement Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Ensure SVG text overlays never overflow the canvas or component zones, for any input image, using a 3-layer enforcement system.

**Architecture:** Layer 1 fixes the zone computation algorithm (bug + width accuracy). Layer 2 adds font-size scaling so LLM picks sizes that fit the zone. Layer 3 adds `<clipPath>` as an unconditional visual safety net — even if the LLM ignores all constraints, nothing can visually overflow.

**Tech Stack:** TypeScript, `vertex.service.ts`, SVG clipPath, regex-based SVG post-processing.

---

## Current State & Known Bugs

Before starting, understand what exists and what is broken:

- `computedTextZone` in `vertex.service.ts` ~line 1901 — computes left/right text zone from component positions
- `_enforceZoneBounds` ~line 2400 — clamps `translate(X,Y)` values post-parse
- **Bug 1** (line 1916): `Math.min(leftEdge + 20, 600)` caps `zone.left` at 600 even when components extend beyond that → zone overlaps components
- **Bug 2**: `_enforceZoneBounds` clamps starting position but not text rendering width → long text at large font still overflows right edge visually
- **Bug 3**: No visual clip — if LLM produces coordinates that slip through enforcement, text overflows canvas

---

## Task 1: Fix computedTextZone — Remove Wrong Cap & Compute Actual Free Width

**Files:**
- Modify: `backend/src/services/vertex.service.ts` ~line 1911–1917

**What to do:**

Find and replace the `computedTextZone` IIFE (the `if (leftCov <= rightCov)` block). The current right-side branch incorrectly caps `zone.left` at 600 normalized. The fix computes the actual free width from the clear edge to the canvas boundary.

**Replace** the entire IIFE body with:

```typescript
const computedTextZone = (() => {
  if (!fixedComponentPositions?.length) return null;

  const leftCov = fixedComponentPositions.reduce((acc, c) => {
    const overlap = Math.max(0, Math.min(c.left + c.width, 500) - Math.max(c.left, 0));
    return acc + overlap * c.height;
  }, 0);
  const rightCov = fixedComponentPositions.reduce((acc, c) => {
    const overlap = Math.max(0, Math.min(c.left + c.width, 1000) - Math.max(c.left, 500));
    return acc + overlap * c.height;
  }, 0);

  const INSET = 30; // normalized padding from component edge and canvas edge

  if (leftCov <= rightCov) {
    // Left side freer — find the leftmost component edge as the right boundary
    const rightEdge = Math.min(...fixedComponentPositions.map((c) => c.left), 950);
    const zoneWidth = Math.max(rightEdge - 50 - INSET, 250); // 50 = left inset
    return { top: 50, left: 50, width: zoneWidth, height: 900 };
  } else {
    // Right side freer — find the rightmost component edge as the left boundary
    const leftEdge = Math.max(...fixedComponentPositions.map((c) => c.left + c.width), 50);
    const zoneLeft = Math.min(leftEdge + INSET, 950 - 200); // guarantee at least 200 wide
    const zoneWidth = 950 - zoneLeft; // to canvas right edge
    return { top: 50, left: zoneLeft, width: zoneWidth, height: 900 };
  }
})();
```

**Why this matters:** For the current screenshot (woman left ~430, mascot right ~780), old code gave `zone.left=600` (overlapping mascot at 780). New code gives `zone.left = 780+30 = 810`, `zone.width = 950-810 = 140` — which is very narrow. This might cause a fallback to squeeze text into a tight space, but at least it won't overlap the component.

**Verify manually:** Add a `console.log('[Zone]', JSON.stringify(computedTextZone))` line after the IIFE, restart backend, trigger a campaign generation, check logs. Zone left should be past all component right edges.

**Remove the console.log after verifying.**

**Commit:**
```bash
git add backend/src/services/vertex.service.ts
git commit -m "fix: computedTextZone — remove wrong 600-cap, compute actual free width past component edges"
```

---

## Task 2: Scale Max Font Sizes to Zone Width in Prompt

**Files:**
- Modify: `backend/src/services/vertex.service.ts` — the `FONT SIZES` section in the prompt string (~line 2010)

**What to do:**

The LLM picks font sizes relative to `canvasWidth` (1080px), but the text zone might only be 400px wide. A 130px font in a 400px zone = text overflows after ~3 chars.

Find the `FONT SIZES` block in the prompt template:

```
═══════════════════════════════════════
FONT SIZES (${canvasWidth}px canvas)
═══════════════════════════════════════
- Promotional numbers...
```

**Replace** with:

```typescript
═══════════════════════════════════════
FONT SIZES — scaled to text zone width (${maxTextWidth}px available)
═══════════════════════════════════════
- Promotional numbers (offer, %, ×, price): ${Math.round(maxTextWidth * 0.30)}-${Math.round(maxTextWidth * 0.45)}px  ← HUGE and dominant
- Headline / sub-headline: ${Math.round(maxTextWidth * 0.08)}-${Math.round(maxTextWidth * 0.12)}px
- Body text: ${Math.round(maxTextWidth * 0.06)}-${Math.round(maxTextWidth * 0.08)}px
- Fine print / legal: ${Math.round(maxTextWidth * 0.025)}-${Math.round(maxTextWidth * 0.035)}px
Max text block width: ${maxTextWidth}px — stay within this width, wrap if needed.
```

Note: `maxTextWidth` is already computed as `textZonePx ? Math.round(textZonePx.w * 0.9) : Math.round(canvasWidth * 0.45)` — it represents 90% of zone width.

**Why this matters:** If zone.w = 400px, maxTextWidth = 360px. Promo font = 360×0.35 = 126px. A 3-char Thai word "2 ต่อ" at 126px ≈ 380px wide — fits. The old system used canvasWidth=1080, so promo = 130-194px — always too large for a half-canvas zone.

**Commit:**
```bash
git add backend/src/services/vertex.service.ts
git commit -m "fix: scale SVG font size recommendations to text zone width, not full canvas width"
```

---

## Task 3: Add clipPath Safety Net (Unconditional Visual Clip)

**Files:**
- Modify: `backend/src/services/vertex.service.ts` — `_enforceZoneBounds` method and its call site

**What to do:**

After all prompting and translate clamping, inject a `<clipPath>` into the returned SVG that wraps the text-overlay group. This is the **final hard boundary** — regardless of what the LLM generates, nothing outside the zone will be visible.

**Step 1:** Add a new private method `_injectZoneClip` after `_enforceZoneBounds`:

```typescript
/**
 * Inject a <clipPath> into the SVG so the text-overlay group is visually
 * bounded to the text zone. This is the last line of defense — translate
 * clamping handles positioning, this handles text-width overflow.
 */
private _injectZoneClip(
  svg: string,
  zone: { x: number; y: number; w: number; h: number },
): string {
  const clipId = "tz-clip";
  const clipRect = `<clipPath id="${clipId}"><rect x="${zone.x}" y="${zone.y}" width="${zone.w}" height="${zone.h}"/></clipPath>`;

  // 1. Inject clipRect into existing <defs> (or create one)
  let result: string;
  if (/<defs[^>]*>/.test(svg)) {
    result = svg.replace(/(<defs[^>]*>)/, `$1${clipRect}`);
  } else {
    result = svg.replace(/(<svg[^>]*>)/, `$1<defs>${clipRect}</defs>`);
  }

  // 2. Apply clip-path to <g id="text-overlay"> (add or replace existing)
  result = result.replace(
    /<g\s+id="text-overlay"([^>]*)>/,
    (_, attrs) => {
      const cleaned = attrs.replace(/\s*clip-path="[^"]*"/, "");
      return `<g id="text-overlay"${cleaned} clip-path="url(#${clipId})">`;
    },
  );

  return result;
}
```

**Step 2:** In the call site (after `_enforceZoneBounds`), add the clip injection:

```typescript
// Post-process: clamp any out-of-zone translate(X,Y) values back into the text zone.
if (textZonePx) {
  parsed.svg_overlay = this._enforceZoneBounds(parsed.svg_overlay, textZonePx);
  parsed.svg_overlay = this._injectZoneClip(parsed.svg_overlay, textZonePx);
}
```

**Why this is different from what the user rejected earlier:** The user previously said "it shouldn't happen at all". That was when clipPath was the ONLY mechanism. Now it's the third layer — prompting + clamping already ensure good placement. The clipPath only fires for edge cases (extremely long words, LLM anomaly). It's invisible when everything works correctly.

**Commit:**
```bash
git add backend/src/services/vertex.service.ts
git commit -m "feat: add clipPath safety net on text-overlay zone — prevents any visual overflow"
```

---

## Task 4: Handle Narrow Zone Gracefully (Zone Width < 250px)

**Files:**
- Modify: `backend/src/services/vertex.service.ts` — `computedTextZone` and prompt

**Context:** After Task 1, scenarios with components on both sides (woman left, mascot right) might produce a very narrow zone (e.g., 140px normalized = 151px canvas). A 151px zone cannot fit meaningful text. The system should detect this and fall back to a "no zone" mode (full canvas, with forbidden zones).

**Step 1:** After `computedTextZone` computation, add a minimum width guard:

```typescript
const effectiveTextZone = (() => {
  const zone = artDirectorTextZone || computedTextZone;
  if (!zone) return null;
  // Zone too narrow to be useful — fall back to full canvas with forbidden zones
  if (zone.width < 250) {
    console.warn(`[Zone] Computed zone width=${zone.width} too narrow — falling back to full canvas mode`);
    return null;
  }
  return zone;
})();
```

Replace the current `const effectiveTextZone = artDirectorTextZone || computedTextZone;` with the above.

**Step 2:** When `effectiveTextZone` is null (full canvas fallback), restore `componentsBlock` (show forbidden zones):

The current code already does:
```typescript
const componentsBlock =
  !textZonePx && fixedComponentPositions?.length
    ? `FORBIDDEN TEXT ZONES...`
    : "";
```

This already handles it — when `textZonePx` is null, forbidden zones are shown. No change needed here.

**Commit:**
```bash
git add backend/src/services/vertex.service.ts
git commit -m "fix: fall back to full-canvas mode when computed text zone is too narrow (<250 normalized)"
```

---

## Task 5: Verify End-to-End

**Step 1:** Restart backend
```bash
cd backend && npm run dev
```

**Step 2:** Test with the SCB EASY / Robinhood scenario (woman left, mascot right). Watch backend logs for:
```
[Zone] Computed zone: { left: 810, width: 140, height: 900 }  ← too narrow
[Zone] Computed zone width=140 too narrow — falling back to full canvas mode
```
OR if components are more to one side:
```
[Zone] Computed zone: { left: 54, width: 380, height: 900 }
[SVG] Zone enforce: translate(200,750) → (54,542) zone=[54-434,54-1026]
```

**Step 3:** Confirm in the frontend:
- [ ] No text outside canvas bounds (right edge or bottom edge)
- [ ] No text overlapping component images
- [ ] Font sizes look proportional to the zone width (not giant)
- [ ] clipPath doesn't produce visible hard cut-off lines on properly placed text

**Step 4:** Test a different image (component centered, or component at top) to verify dynamic behavior.

---

## Summary of Changes

| Layer | Mechanism | Handles |
|-------|-----------|---------|
| 1. Zone computation | `computedTextZone` fix | Correct zone that doesn't overlap components |
| 2. Font scaling | Prompt `maxTextWidth` | LLM picks sizes that fit zone width |
| 3. Translate clamping | `_enforceZoneBounds` | Starting position within zone |
| 4. Visual clip | `_injectZoneClip` + `<clipPath>` | Any remaining text-width overflow |
| 5. Narrow zone guard | `effectiveTextZone` width check | Degenerate cases (components both sides) |
