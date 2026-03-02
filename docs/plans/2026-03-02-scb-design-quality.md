# SCB Design Quality — Composition & Contrast Improvements

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Bring generated ad quality closer to professional SCB/Thai bank ad standards by enforcing text lock-ups, contrast shields, character breathing room, and character-in-front-of-text z-index layering.

**Architecture:** All changes are pure prompt engineering (vertex.service.ts) + JSON schema additions + frontend rendering (LayerEditor.vue, AIRefinementPreview.vue). No new API calls or services needed. Backend enforces structure in prompts; frontend renders newly returned fields.

**Tech Stack:** TypeScript/NestJS backend, Vue 3 frontend, CSS (background/border-radius for shields)

---

## Context: What the Review Found

From `Review-e2e.md` (Gemini's Senior Designer audit comparing our output to real SCB ads):

| Issue | Our System | SCB Standard |
|---|---|---|
| Text grouping | "2" and "ต่อ" float apart | Single graphic lock-up unit |
| Contrast | White text on busy BG, no shield | Ribbon, pill, or overlay behind every text block |
| Breathing room | Character "choked" to edge | Safe negative space around character |
| Character depth | All layers same z-index | Character pops IN FRONT of some text/graphics |

---

## Task 1: Text Lock-up Rules — Grouping Numbers + Units

**Files:**
- Modify: `backend/src/services/vertex.service.ts` (line ~487, inside the non-`isCompOnly` task block)

**Background:** The text task prompt currently says "Group related text visually close together" (line 492) — too vague. The AI splits "2" and "ต่อ" into separate suggestion items with large gaps.

**Step 1: Locate the text tasks section**

In `suggestCampaignLayout`, find (line ~487):
```
2. TEXT EXTRACTION & SMART LINE BREAKING:
   - Read the AD BRIEF.
   - Split long sentences into multiple visual lines to fit the Safe Zone.
   - YOU MUST RETURN AT LEAST ONE TEXT SUGGESTION.
```

**Step 2: Replace task 2 with the enhanced version**

Replace the entire "2. TEXT EXTRACTION & SMART LINE BREAKING" block with:

```
2. TEXT EXTRACTION & SMART LINE BREAKING:
   - Read the AD BRIEF and identify distinct text elements.
   - YOU MUST RETURN AT LEAST ONE TEXT SUGGESTION.

   ⚠️ LOCK-UP RULE (CRITICAL — CARDINAL SIN if violated):
   Numbers and their unit MUST be a single graphic lock-up:
     - "2 ต่อ", "50%", "1.5%" → treat as ONE element, same position block.
     - Do NOT create separate suggestion items for the number and the unit.
     - Place them in a SINGLE suggestion with "part": "2 ต่อ" (or "50%"), with font_size_normalized ≥ 150.
     - Only split into two items if they are visually on DIFFERENT lines AND have very different font sizes.

   Promotion Offer Hierarchy:
     - If the AD BRIEF contains a number/offer (e.g., "2 ต่อ", "50% off"):
       * Make it the LARGEST element on screen (font_size_normalized: 150-200)
       * Position it in the CENTER of the text zone
       * All other text (headline, body) is SECONDARY and smaller
```

**Step 3: Also strengthen task 3 (Design Polishing)**

Find task 3 (line ~492):
```
3. DESIGN POLISHING:
   - Group related text visually close together.
   - Push text block inwards towards subjects to avoid awkward floating gaps.
```

Replace with:
```
3. DESIGN POLISHING:
   - Related text (same semantic group) MUST be within 30 units of each other (0-1000 scale).
   - Push text block inwards towards subjects — text should "reach toward" the character.
   - NEVER leave a gap larger than 200 units between logically related text elements.
```

**Step 4: Verify backend starts without error**

```bash
cd backend && npm run dev
```
Expected: Server starts on port 5001, no TypeScript errors.

**Step 5: Commit**

```bash
git add backend/src/services/vertex.service.ts
git commit -m "feat: text lock-up rules — number+unit as single graphic unit"
```

---

## Task 2: Mandatory Contrast Shield — Visual Container Enforcement

**Files:**
- Modify: `backend/src/services/vertex.service.ts` (line ~601, DESIGN TRICKS section AND JSON schema)

**Background:** `visual_container` field exists in the prompt's schema comment (line 621) but:
1. The AI treats it as optional (uses vague "suggest" language)
2. The JSON schema example doesn't include `visual_container` as a proper field
3. The frontend renders NOTHING for `visual_container`

This task fixes the backend prompt to make shields mandatory. Task 3 adds frontend rendering.

**Step 1: Add `visual_container` to the JSON schema for suggestions**

Find the suggestions schema (line ~544):
```json
"suggestions": [
  {
    "part": "The exact text (e.g. 'SUMMER SALE')",
    ...
    "hierarchy": "Headline | Body | FinePrint"
  }
],
```

Add `visual_container` field BEFORE `"hierarchy"`:
```json
"visual_container": "none | ribbon | pill | solid_block | gradient_overlay | glassmorphism",
```

So the schema becomes:
```json
"suggestions": [
  {
    "part": "The exact text (e.g. 'SUMMER SALE')",
    "preferred_zone": "...",
    "position": { "top": 0, "left": 0, "width": 0, "height": 0, "rotation": 0, "explanation": "..." },
    "style": { ... },
    "visual_container": "none | ribbon | pill | solid_block | gradient_overlay | glassmorphism",
    "design_notes": "...",
    "hierarchy": "Headline | Body | FinePrint"
  }
],
```

**Step 2: Replace DESIGN TRICKS section with mandatory shield rules**

Find (line ~601):
```
✓ DESIGN TRICKS (COMMERCIAL GRADE):
- **STROKE/OUTLINE**: For main HEADLINES on busy backgrounds, ADD A STROKE (e.g., white stroke on orange text).
  Set "stroke_hex": "#FFFFFF", "stroke_width": 3.
- **GRADIENTS**: For "Promotional Numbers" (e.g., "50%", "2 ต่อ"), use gradients to make them pop.
```

Replace with:
```
✓ DESIGN TRICKS (COMMERCIAL GRADE — MANDATORY, NOT OPTIONAL):
- **CONTRAST SHIELD (CRITICAL)**:
  * If text is placed on a background with buildings, people, water, patterns, or ANY high-detail area:
    → You MUST set "visual_container" to "ribbon", "pill", "solid_block", or "gradient_overlay"
    → NEVER place bare white text on a high-frequency/textured background. This is "Grade 2 student" work.
  * Only use "none" when text is on a plain solid-color area with strong contrast.
  * SCB standard: Every important text block has a "shield" (solid color plate or ribbon behind it).

- **SHIELD TYPE GUIDE**:
  * "ribbon": Banner/stripe across full width behind text. Use for headlines on photo backgrounds.
  * "pill": Rounded rectangle tightly around the text. Use for badges, CTAs, price tags.
  * "solid_block": Rectangle behind a group of text. Use for text zones on photo backgrounds.
  * "gradient_overlay": Semi-transparent gradient fade. Use when preserving BG visibility matters.
  * "glassmorphism": Frosted glass. Use for premium/luxury vibes.

- **STROKE/OUTLINE**: For headlines NOT using a shield, ALWAYS add stroke.
  Set "stroke_hex": "#FFFFFF", "stroke_width": 4-6.

- **GRADIENTS**: For "Promotional Numbers" (e.g., "50%", "2 ต่อ"), use text_gradient to make them pop.
  Example: "text_gradient": ["#FFD700", "#FF8C00"] for gold/orange.
```

**Step 3: Also add shield enforcement to DESIGNER MINDSET**

Find (line ~619):
```
DESIGNER MINDSET (ANTI-BORING RULES):
- FILL THE SPACE: ...
- USE GRAPHIC CONTAINERS: Suggest visual elements like 'yellow_tag', 'red_ribbon', 'glassmorphism_card', or 'neon_banner' in 'visual_container' property to anchor the text.
```

Replace the USE GRAPHIC CONTAINERS line with:
```
- CONTRAST SHIELD IS NON-NEGOTIABLE: Before finalizing any text suggestion, ask yourself: "Is this text readable if the background has patterns, faces, or buildings?" If the answer is "maybe not" → add a visual_container. When in doubt, add the shield.
```

**Step 4: Verify backend starts without error**

```bash
cd backend && npm run dev
```
Expected: Server starts on port 5001, no TypeScript errors.

**Step 5: Commit**

```bash
git add backend/src/services/vertex.service.ts
git commit -m "feat: mandatory contrast shield — visual_container required for text on busy backgrounds"
```

---

## Task 3: Render visual_container in Frontend

**Files:**
- Modify: `frontend/src/components/AIRefinementPreview.vue` (getTextStyle function, line ~255)
- Modify: `frontend/src/components/LayerEditor.vue` (text layer style binding, line ~874)

**Background:** `visual_container` returned by AI is currently ignored in both preview and editor. Need to add CSS background/padding to the text container div based on the value.

**Step 1: Add container background helper in AIRefinementPreview.vue**

In `<script setup>`, find `getTextStyle()` (line ~255). ABOVE `getTextStyle`, add a new helper function:

```typescript
const getContainerStyle = (suggestion: any) => {
  const container = suggestion.visual_container || "none";
  const color = suggestion.style?.color_hex || "#FFFFFF";

  // Derive shield color: complement of text color
  const shieldColorMap: Record<string, string> = {
    ribbon:            "rgba(0,0,0,0.65)",
    pill:              "rgba(0,0,0,0.72)",
    solid_block:       "rgba(20,20,40,0.80)",
    gradient_overlay:  "linear-gradient(to right, rgba(0,0,0,0.75), rgba(0,0,0,0))",
    glassmorphism:     "rgba(255,255,255,0.15)",
    none:              "transparent",
  };

  const shieldColor = shieldColorMap[container] ?? "transparent";

  if (container === "none") return {};

  const isGradient = container === "gradient_overlay";
  return {
    background: isGradient ? shieldColor : undefined,
    backgroundColor: !isGradient ? shieldColor : undefined,
    backdropFilter: container === "glassmorphism" ? "blur(8px)" : undefined,
    borderRadius: container === "pill" ? "999px" : container === "glassmorphism" ? "12px" : "4px",
    padding: container === "ribbon" ? "4px 16px" : "4px 10px",
    display: "inline-block",
  };
};
```

**Step 2: Apply `getContainerStyle` to the text element wrapper in AIRefinementPreview.vue**

Find the template section that renders text suggestions. Look for `v-for` over `liveTextLayers` (around line 70-100 in the template). The text div currently uses only `getTextStyle(s)`. Change to also apply container style:

Find:
```html
<div
  v-for="s in liveTextLayers"
  :key="s.part"
  :style="getTextStyle(s)"
>
  {{ s.part }}
</div>
```

Replace with:
```html
<div
  v-for="s in liveTextLayers"
  :key="s.part"
  :style="getTextStyle(s)"
>
  <span :style="getContainerStyle(s)">{{ s.part }}</span>
</div>
```

(If the template structure is different, find the element that renders `s.part` and wrap the text in `<span :style="getContainerStyle(s)">`)

**Step 3: Add `visual_container` to the layer data model in LayerEditor.vue**

In `buildCampaignLayers` (line ~108), add `visual_container` to each text layer:

Find:
```typescript
textLayers.push({
  type: "text",
  content: t.part,
  style: t.style || {},
  id: imageLayers.length + textLayers.length,
  x: t.position.left / 10,
  y: t.position.top / 10,
  w: t.position.width / 10,
  h: t.position.height / 10,
  rotation: t.position.rotation || 0,
  z_index: t.z_index || 10,
});
```

Add `visual_container`:
```typescript
textLayers.push({
  type: "text",
  content: t.part,
  style: t.style || {},
  visual_container: t.visual_container || "none",
  id: imageLayers.length + textLayers.length,
  x: t.position.left / 10,
  y: t.position.top / 10,
  w: t.position.width / 10,
  h: t.position.height / 10,
  rotation: t.position.rotation || 0,
  z_index: t.z_index || 10,
});
```

**Step 4: Render `visual_container` in LayerEditor.vue text layer**

In the template (line ~900), find the text layer's `<span class="editable-text">` and wrap it:

Find:
```html
<!-- Text layer -->
<span
  v-else
  :ref="..."
  contenteditable="true"
  @input="updateText(idx, $event)"
  @focus="selectAll(idx)"
  @blur="onBlurText"
  class="editable-text"
></span>
```

Replace with:
```html
<!-- Text layer -->
<span
  v-else
  :ref="..."
  contenteditable="true"
  @input="updateText(idx, $event)"
  @focus="selectAll(idx)"
  @blur="onBlurText"
  class="editable-text"
  :style="getEditorContainerStyle(layer)"
></span>
```

And add `getEditorContainerStyle` to `<script setup>` (add near other style helper functions):

```typescript
const getEditorContainerStyle = (layer: any) => {
  const container = layer.visual_container || "none";
  if (container === "none") return {};
  const shieldColorMap: Record<string, string> = {
    ribbon:           "rgba(0,0,0,0.65)",
    pill:             "rgba(0,0,0,0.72)",
    solid_block:      "rgba(20,20,40,0.80)",
    gradient_overlay: "rgba(0,0,0,0.75)",
    glassmorphism:    "rgba(255,255,255,0.15)",
  };
  return {
    backgroundColor: shieldColorMap[container] ?? "transparent",
    backdropFilter: container === "glassmorphism" ? "blur(8px)" : undefined,
    borderRadius: container === "pill" ? "999px" : container === "glassmorphism" ? "12px" : "4px",
    padding: container === "ribbon" ? "4px 16px" : "4px 8px",
  };
};
```

**Step 5: Verify frontend compiles**

```bash
cd frontend && npm run build 2>&1 | tail -20
```
Expected: Build succeeds, no TypeScript errors.

**Step 6: Commit**

```bash
git add frontend/src/components/AIRefinementPreview.vue frontend/src/components/LayerEditor.vue
git commit -m "feat: render visual_container shield (ribbon/pill/solid_block) behind text layers"
```

---

## Task 4: Character Breathing Room in Art Director Prompt

**Files:**
- Modify: `backend/src/services/vertex.service.ts` (line ~450, inside `isCompOnly` block — character placement rules)

**Background:** Characters are being "choked" against edges. The art director rules say `left ≤ 50` (bleed) but don't account for the non-bleed side needing breathing room.

**Step 1: Locate the character placement rules**

In the `isCompOnly` prompt block (line ~450):
```
- BLEED to edge: if left-anchored → left ≤ 50. If right-anchored → (left + width) ≥ 950
- Width: typically 350-500 for full-body characters
```

**Step 2: Add breathing room rules**

Replace those two lines with:
```
- BLEED to edge: if left-anchored → left ≤ 50. If right-anchored → (left + width) ≥ 950
- NON-BLEED side MUST have breathing room ≥ 30 units:
  * Left-anchored character (left ≤ 50): right edge = left + width. Keep (right edge) ≤ 550 so text zone has 450+ units of open space.
  * Right-anchored character: keep left ≥ 420 so text zone has 390+ units of open space.
- TOP breathing room: suggested_position.top MUST be ≥ 30 (character head must not touch canvas top).
- Width: 350-500 for full-body characters (preserve some width for the text zone)
```

**Step 3: Verify backend starts without error**

```bash
cd backend && npm run dev
```
Expected: Server starts on port 5001, no TypeScript errors.

**Step 4: Commit**

```bash
git add backend/src/services/vertex.service.ts
git commit -m "feat: character breathing room — non-bleed side and top margin in art director rules"
```

---

## Task 5: Character-in-Front-of-Text Z-Index (Depth Interaction)

**Files:**
- Modify: `backend/src/services/vertex.service.ts` (isCompOnly task block, line ~460 — add `interaction_zone` to component output schema AND JSON schema for components)
- Modify: `backend/src/controllers/image.controller.ts` (line ~882-888, visualComponents mapping — use `interaction_zone` to set z_index above some text layers)

**Background:** In SCB ads, the character/model appears IN FRONT of some text/graphics creating a 3D premium feel. Currently all components have `z_index: 1` and all text has `z_index: 10`, so text always appears above characters. We need:
- Character z_index = 15 (above most text)
- Text that should be BEHIND the character gets z_index = 5

**Step 1: Add `interaction_zone` to component JSON schema**

Find the components schema (line ~570):
```json
"components": [
  {
    "label": "Short label (e.g. 'Thai boy mascot')",
    "description": "...",
    "position": { ... },
    "suggested_position": { "top": 0, "left": 0, "width": 0, "height": 0, "rotation": 0, "rationale": "..." },
    "z_index": 1
  }
]
```

Add `interaction_zone` and update `z_index` description:
```json
"components": [
  {
    "label": "Short label (e.g. 'Thai boy mascot')",
    "description": "...",
    "position": { ... },
    "suggested_position": {
      "top": 0, "left": 0, "width": 0, "height": 0, "rotation": 0,
      "rationale": "e.g. Moved right to free left column for text."
    },
    "z_index": 15,
    "interaction_zone": {
      "enabled": true,
      "description": "Area where character overlaps text for 3D depth effect",
      "overlap_top": 200,
      "overlap_left": 350,
      "overlap_width": 300,
      "overlap_height": 400
    }
  }
]
```

**Step 2: Add `interaction_zone` instruction to the art director prompt**

In the `isCompOnly` task block, after the `MASCOTS / SECONDARY ELEMENTS` line (line ~460), add:

```
DEPTH INTERACTION (creates premium 3D feel — SCB standard):
- For PRIMARY characters/models: set z_index = 15 (character appears IN FRONT of text)
- Compute the interaction_zone: the area where the character's body overlaps the text zone
  * overlap_top = character top + 100 (skip head area)
  * overlap_left = character.left (start of character)
  * overlap_width = min(200, character.width / 2) (only partial overlap)
  * overlap_height = character.height - 200 (body only, not head)
- This interaction_zone tells the frontend: "text in this area should render BEHIND the character"
- For MASCOTS / SECONDARY elements: z_index = 10 (same level as text, no depth trick needed)
- For LOGOS / BADGES: z_index = 20 (always on top)
```

**Step 3: Apply `interaction_zone` in the controller**

In `image.controller.ts`, find the `visualComponents` mapping (line ~862):
```typescript
visualComponents = diecutResults.map(
  (res: { label: string; buffer: Buffer }, idx: number) => {
    ...
    return {
      label: res.label,
      imageUrl: `/uploads/${fn}`,
      position: pos,
      z_index: matched?.z_index || 1,
    };
  },
);
```

Replace `z_index: matched?.z_index || 1` with `z_index: matched?.z_index || 15` AND pass through `interaction_zone`:
```typescript
return {
  label: res.label,
  imageUrl: `/uploads/${fn}`,
  position: pos,
  z_index: matched?.z_index || 15,
  interaction_zone: matched?.interaction_zone || null,
};
```

**Step 4: Store `interaction_zone` in LayerEditor layer model**

In `LayerEditor.vue`, `buildCampaignLayers` (line ~92):
```typescript
imageLayers.push({
  type: "image",
  label: comp.label,
  imageUrl: `http://localhost:5001${comp.imageUrl}`,
  id: imageLayers.length,
  x: comp.position.left / 10,
  y: comp.position.top / 10,
  w: comp.position.width / 10,
  h: comp.position.height / 10,
  rotation: comp.position.rotation || 0,
  z_index: comp.z_index || 15,
  interaction_zone: comp.interaction_zone || null,
});
```

**Step 5: Apply interaction_zone to text z_index in LayerEditor.vue**

After both `imageLayers` and `textLayers` are built (line ~126, before `layers.value = [...]`), add:

```typescript
// Apply character depth interaction — text that overlaps character's interaction_zone gets z_index below character
const characterLayers = imageLayers.filter(l => l.interaction_zone?.enabled);
if (characterLayers.length > 0) {
  textLayers.forEach(tl => {
    const tLeft = tl.x;
    const tTop = tl.y;
    const tRight = tl.x + tl.w;
    const tBottom = tl.y + tl.h;
    for (const cl of characterLayers) {
      const iz = cl.interaction_zone;
      // Convert interaction_zone from 0-1000 to 0-100 (percentage)
      const izLeft = iz.overlap_left / 10;
      const izTop = iz.overlap_top / 10;
      const izRight = (iz.overlap_left + iz.overlap_width) / 10;
      const izBottom = (iz.overlap_top + iz.overlap_height) / 10;
      const overlaps = !(tRight <= izLeft || tLeft >= izRight || tBottom <= izTop || tTop >= izBottom);
      if (overlaps) {
        tl.z_index = Math.min(tl.z_index, cl.z_index - 5); // push text behind character
      }
    }
  });
}
```

**Step 6: Verify frontend compiles**

```bash
cd frontend && npm run build 2>&1 | tail -20
```
Expected: Build succeeds, no TypeScript errors.

**Step 7: Commit**

```bash
git add backend/src/services/vertex.service.ts backend/src/controllers/image.controller.ts frontend/src/components/LayerEditor.vue
git commit -m "feat: character z-index depth interaction — character renders in front of overlapping text"
```

---

## Task 6: End-to-End Verification

**Step 1: Start backend**
```bash
cd backend && npm run dev
```
Expected: Server starts on port 5001, no errors.

**Step 2: Start frontend**
```bash
cd frontend && npm run dev
```
Expected: Vite serves on port 5173.

**Step 3: Test with SCB-style input**

Upload an image with a Thai bank ad character + text brief like:
```
"กู้ง่าย ดอกเบี้ยต่ำ 2% ต่อปี เงินเดือน 15,000 ก็กู้ได้"
```

**Step 4: Verify pass by pass**

Backend logs should show:
- `[GenAI] Got X text suggestions:` — check that "2%" or offer number appears as ONE item, NOT split
- `visual_container:` for text items should be "ribbon", "pill", or "solid_block" (NOT "none" on busy backgrounds)
- `[Compose] "character" repositioned → {...}` with `z_index: 15`

**Step 5: Check visual quality in preview**

- Text shield/ribbon visually visible behind text
- Character appears in front of some text (lower z-index text goes behind character)
- Offer number ("2%") is the largest element
- No bare white text floating on busy building/water backgrounds

**Step 6: Commit if all passes**
```bash
git add -A
git commit -m "feat: SCB design quality — lock-ups, contrast shields, character depth"
```
