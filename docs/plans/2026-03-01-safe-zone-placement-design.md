# Safe Zone Placement Design
**Date:** 2026-03-01
**Status:** Approved
**Problem:** Text placement is bad from the first round AND gets worse with each refinement loop iteration.

---

## Root Cause Analysis

The current pipeline asks AI (Gemini) to do **spatial reasoning** — placing text by reading coordinates in a prompt and avoiding no-go zones listed as text. This is unreliable because:

1. **AI ignores coordinate warnings** in long prompts with competing instructions
2. **Refinement loop degrades quality** — AI rewrites entire layout instead of surgical fixes
3. **Thai text bbox approximation is wrong** — `longestLine * fontSize * 0.55` doesn't account for Thai/multi-byte characters
4. **Safe regions are estimated, not computed** — rough column heuristic (LEFT/CENTER/RIGHT) doesn't reflect actual component positions

---

## Goal

> "It should place well from the first round if the workflow is designed well enough." — Goal.md

The workflow should guarantee good first-round placement by giving AI **pre-computed safe zones** (what it CAN use) rather than asking it to avoid obstacles on its own.

---

## Design: Hybrid Safe Zone Placement

### Role Split

| Decision | Who | How |
|---|---|---|
| Text content, font, size, color, shadow | AI (Gemini) | Read text brief, apply hierarchy rules |
| Placement preferences (top-left, bottom-center, etc.) | AI (Gemini) | Soft hints about composition |
| Actual coordinates | **Code (new)** | Computed from safe zones derived from component strokes |
| Overlap validation | **Code** | Deterministic, 100% reliable |
| Style-only refinement | AI (Gemini, optional, 1 pass) | Contrast, shadow, color — NOT position |

---

## Pipeline Phases

### Phase 1: RMBG Scan (unchanged)
- `runRMBGAndGetBboxes()` runs RMBG-2.0 locally
- Generates full-image alpha mask + initial subject bbox
- No changes needed

### Phase 2: Die-Cut Component Extraction (unchanged)
- `generateDiecutComponents()` extracts per-component transparent PNGs via BFS flood-fill
- No changes needed

### Phase 3: Stroke Bbox Extraction (NEW)
**Function:** `extractComponentStrokeBboxes(components: DiecutComponent[])`
**Input:** Array of die-cut transparent PNG buffers + their normalized positions
**Process:**
1. For each component PNG, scan its alpha channel using Sharp
2. Find tight bbox: `minX, maxX, minY, maxY` of pixels where `alpha > 30`
3. Convert pixel coords to normalized 0-1000 scale
4. Add padding margin: `30 normalized units` (~3%) around tight bbox
5. Return per-component stroke bboxes (much more precise than rough subject detection)

**Why this is better than current RMBG bbox:**
- Current: one bbox for the entire foreground scene
- New: individual bbox per extracted component, with pixel-precise boundaries

### Phase 4: Safe Zone Computation (NEW)
**Function:** `computeSafeZones(canvasW: 1000, canvasH: 1000, noGoZones: BBox[])`
**Input:** All component stroke bboxes
**Algorithm:**
1. Start with full canvas `[{top:0, left:0, width:1000, height:1000}]`
2. For each no-go bbox, subtract from available space:
   - Split into up to 4 sub-rectangles: TOP, BOTTOM, LEFT-SIDE, RIGHT-SIDE of the obstacle
   - Keep only rectangles with area > `150 * 50` (minimum viable text slot)
3. For each already-placed text bbox (during multi-element placement): subtract it too
4. Sort remaining rectangles by area descending
5. Return ordered list of safe zones with labels (derived from position in canvas)

**Output example:**
```typescript
[
  { top: 50, left: 50, width: 300, height: 900, label: "left-column", area: 270000 },
  { top: 50, left: 700, width: 250, height: 400, label: "top-right", area: 100000 },
  { top: 600, left: 400, width: 500, height: 350, label: "bottom-center", area: 175000 },
]
```

### Phase 5: AI Layout Placement (simplified)
**Function:** `suggestCampaignLayout()` — modified
**Changes:**
- **Remove:** Grid overlay generation, safe-column heuristic, coordinate generation
- **Add:** Pass safe zones list to AI as available placement slots
- **AI task:** For each text element → pick best-fit safe zone + compute position within it + styling

**AI receives:**
- The reference image (for visual context)
- `available_zones`: List of safe rectangles computed by code
- Text brief

**AI returns:**
- `suggestions`: Text content + style + `preferred_zone_label` (which zone it chose)
- No raw coordinates — those are computed by code from zone + text size

### Phase 6: Code Coordinate Assignment (NEW)
**Function:** `assignTextToZones(suggestions, safeZones)`
**Process:**
1. For each text suggestion, match its `preferred_zone_label` to a safe zone
2. Compute actual coordinates within that zone:
   - Compute `textWidth = longestLine * fontSize * characterAspectRatio` (corrected for Thai)
   - Compute `textHeight = numLines * fontSize * lineHeight`
   - Position text centered within chosen zone, respecting 5% margin
3. Subtract placed text bbox from available zones (prevents text-on-text overlap)
4. Return complete text layer with verified coordinates

**Thai character correction:**
Thai characters are typically ~0.9× width of latin characters. Use `0.6` multiplier instead of `0.55` as conservative estimate.

### Phase 7: Code Validation (simplified)
- Same deterministic overlap check as current
- If AI slightly drifted outside zone: clamp coordinates automatically (no AI call)
- Major violation (shouldn't happen): 1 surgical reposition of that specific element

### Phase 8: Style-Only Review (optional, 1 pass)
- AI reviews: does text read well against this background?
- AI may suggest: color change, shadow adjustment, stroke addition
- AI may NOT change position coordinates
- Saves 2-3 unnecessary AI calls vs current 3-iteration loop

### Phase 9: Background Inpainting (unchanged)
- `inpaintBackground()` uses Imagen 3.0 `EDIT_MODE_INPAINT_REMOVAL`
- No changes needed

---

## Frontend Canvas (unchanged)
`LayerEditor.vue` already:
- Receives `campaignData.textLayers` and `visualComponents`
- Converts 0-1000 normalized coords to CSS `%` via `/10`
- Renders as absolute-positioned DOM elements
- Handles drag-and-drop for manual editing

**Output format stays identical** — no frontend changes required.

---

## What Gets Removed

| Removed | Reason |
|---|---|
| Grid overlay SVG on image | Safe zones replace this |
| Safe-column heuristic (LEFT/CENTER/RIGHT) | Safe zones replace this |
| `refineLayout()` function | Causes degradation, surgical correction replaces it |
| `critiqueLayout()` position review | Code validation replaces this |
| `generateLayoutPreview()` for position critique | No longer needed for loop |
| 3-iteration refinement loop | Replaced by 1-pass style review |

---

## Tech Stack Validation

| Component | Usage | Status |
|---|---|---|
| `@imgly/background-removal-node` | `segmentForeground()` for masks | ✅ Unchanged |
| `imagen-3.0-capability-001` | `EDIT_MODE_INPAINT_REMOVAL` | ✅ Unchanged |
| Gemini Flash/Pro | Simplified layout (style + zone preference) + 1-pass style review | ✅ Reduced load |
| Sharp.js | Alpha channel scanning for stroke bboxes | ✅ Already used, extend usage |
| Vue 3 LayerEditor | Receives same data format | ✅ Unchanged |

---

## Success Criteria

1. First-round text placement does NOT overlap any extracted die-cut component
2. Refinement passes (if run) do not make layout worse
3. Frontend canvas displays layers correctly and is editable
4. Pipeline completes within similar time as current (removing 2-3 AI critique calls saves ~10-15s)
