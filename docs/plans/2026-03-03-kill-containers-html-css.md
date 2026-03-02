# Plan: Kill Visual Containers + HTML/CSS Output Migration

**Date:** 2026-03-03  
**Author:** Superpowers Plan Gate  
**Status:** AWAITING APPROVAL

---

## Problem Statement

จากภาพ screenshot ที่เห็น:

1. **Dark solid block** ทึบๆ สีดำ semi-transparent ปกคลุม headline สองบรรทัด ("ชวนลูกค้าแอป SCB EASY" / "และ Robinhood มาสนุก") — ดูหนักมาก ไม่ professional
2. **Blue pill oval** รอบ "รับฟรี" — ดูนักเรียนประถมมาก ไม่ใช่ SCB style

สาเหตุทางเทคนิค:

- `vertex.service.ts` มี "CONTRAST SHIELD IS NON-NEGOTIABLE" บังคับ AI ใส่ `visual_container: solid_block / pill`
- `AIRefinementPreview.vue` `getContainerStyle()` render เป็น dark rgba box จริงๆ
- `refineLayout` prompt มีข้อ 5: "IMPROVE contrast shields: if text lacks visual_container, ADD one" — ทำให้ refinement loop ยิ่งเพิ่ม containers

---

## Acceptance Criteria

### Task A (Kill Visual Containers)

- [ ] Canvas ไม่มี dark box / pill / ribbon ล้อมรอบข้อความใดๆ อีกต่อไป
- [ ] Text contrast ยังดีอยู่ — ใช้ text-stroke + multi-layer text-shadow แทน
- [ ] Build ผ่าน zero TypeScript errors
- [ ] refineLayout loop ยังทำงานได้ปกติ (เพิ่ม positions ได้, แต่ไม่เพิ่ม visual_container)

### Task B (HTML/CSS Output)

- [ ] AI generate `html_overlay` string แทน `textLayers` JSON array
- [ ] Live canvas แสดง HTML text overlay แทน individual positioned divs
- [ ] `cqw` units ทำให้ font scale proportionally กับ canvas size
- [ ] critiqueLayout ยังทำงานได้ (render PNG → critique → loop)
- [ ] refineLayoutHTML แก้ HTML string ตาม critique feedback
- [ ] components (die-cut PNGs) ยังแสดงปกติ (ไม่เปลี่ยน)
- [ ] `done` SSE event ส่ง `html_overlay` แทน `textLayers`
- [ ] LayerEditor.vue แสดง HTML overlay ถ้ามี html_overlay ใน campaignData

---

## Architecture Overview (Before vs After)

### Before (Current JSON mode)

```
AI → JSON { textLayers: [{part, position:{top,left,width,height}, style:{...}, visual_container}] }
         ↓
Frontend → liveTextLayers.forEach → <div :style="getTextStyle(t)"><span :style="getContainerStyle(t)">{{ t.part }}</span></div>
```

### After (HTML mode, Task B)

```
AI → HTML string { html_overlay: "<div style='position:absolute...'>...</div>" }
         ↓
Frontend → <div v-html="liveHtmlOverlay" class="html-overlay-layer" />
```

**Key insight:** `<div class="canvas-content">` already has `container-type: inline-size` (confirmed in AIRefinementPreview.vue line 619). This means `cqw` units work out of the box. `16cqw` = 16% of container width = exactly what "font_size 160 out of 1000" meant.

---

## Task A: Kill visual_container System

**Estimated time:** 30-45 minutes  
**Files changed:** 3

---

### A1: vertex.service.ts — Clean up suggestCampaignLayout prompt

**Lines to change:** ~784-821 (DESIGN TRICKS + DESIGNER MINDSET section)

**Find and REMOVE these entire blocks:**

```
BLOCK 1: "CONTRAST SHIELD (CRITICAL)" (lines 784-789)
BLOCK 2: "SHIELD TYPE GUIDE" (lines 791-796)
BLOCK 3: In DESIGNER MINDSET: "CONTRAST SHIELD IS NON-NEGOTIABLE" line (line 819)
```

**Replace BLOCK 1+2+3 with:**

```typescript
      - **STROKE + SHADOW (MANDATORY — NO EXCEPTIONS)**:
        Every text element MUST have BOTH:
        * Stroke: "stroke_hex": "#000000" (dark) OR "#FFFFFF" (white, opposite of text color), "stroke_width": 4-6
        * Shadow: "shadow": "strong" for headlines on busy backgrounds, "subtle" for text on solid areas

        This is how real Thai ads create contrast without ugly boxes.
        NEVER use visual_container. Always use stroke + shadow.

      - **TEXT GRADIENT**: For promotional numbers (e.g., "50%", "2 ต่อ"), use text_gradient to pop.
        Example: "text_gradient": ["#FFD700", "#FF8C00"] for gold/orange.
```

**Change in JSON schema** (line ~741):

```typescript
// BEFORE:
"visual_container": "none | ribbon | pill | solid_block | gradient_overlay | glassmorphism",

// AFTER:
"visual_container": "none",
```

**Reasoning:** Task A removes the field from the schema entirely → AI stops trying to use it.

---

### A2: vertex.service.ts — Clean up refineLayout prompt

**Find line 1381:**

```
5. IMPROVE contrast shields: if text is on a photo background and lacks a visual_container, ADD one (ribbon, pill, or solid_block)
```

**Replace with:**

```
5. IMPROVE text visibility: if text is on a photo background, INCREASE stroke_width to 5-6 and set shadow to "strong". Do NOT use visual_container (always leave as "none").
```

**Find line 1379:**

```
3. Keep the same text content — you may freely change: positions, font_size_normalized, colors, stroke styles, visual_container, and composition grouping
```

**Replace with:**

```
3. Keep the same text content — you may freely change: positions, font_size_normalized, colors, stroke styles, and composition grouping. Keep visual_container as "none" always.
```

---

### A3: image.controller.ts — Force visual_container: "none" in post-processor

**Find the Kanit normalize pass** (currently lines 1181-1192):

```typescript
// Safety net: force Kanit + enforce contrast on every text suggestion
if (textSuggestions.length > 0) {
  textSuggestions = textSuggestions.map((s: any) => ({
    ...s,
    style: {
      ...s.style,
      font_family: "Kanit",
      color_hex: enforceContrast(s.style?.color_hex, s.position),
    },
  }));
  // Visual Quality Gate: ensure promo numbers are visually dominant
  textSuggestions = enforceDesignRules(textSuggestions);
}
```

**Replace with:**

```typescript
// Safety net: force Kanit + strip containers + enforce contrast
if (textSuggestions.length > 0) {
  textSuggestions = textSuggestions.map((s: any) => ({
    ...s,
    visual_container: "none", // containers removed — stroke+shadow handles contrast
    style: {
      ...s.style,
      font_family: "Kanit",
      color_hex: enforceContrast(s.style?.color_hex, s.position),
      // Ensure stroke exists for all non-fineprint text (fallback if AI forgot)
      stroke_hex:
        s.style?.stroke_hex ||
        (s.hierarchy === "FinePrint" ? undefined : "#000000"),
      stroke_width:
        s.style?.stroke_width ?? (s.hierarchy === "FinePrint" ? undefined : 4),
      shadow:
        s.style?.shadow || (s.hierarchy === "FinePrint" ? "none" : "strong"),
    },
  }));
  // Visual Quality Gate: ensure promo numbers are visually dominant
  textSuggestions = enforceDesignRules(textSuggestions);
}
```

**Why:** Even if AI ignores prompt instructions, post-processor guarantees no container reaches frontend.

---

### A4: AIRefinementPreview.vue — Neuter getContainerStyle()

**Find `getContainerStyle()` function (lines 255-273):**

```typescript
const getContainerStyle = (suggestion: any): Record<string, string> => {
  const container = suggestion.visual_container || "none";
  if (container === "none") return {};
  // ... dark rgba map ...
  return { backgroundColor: bg, ... };
};
```

**Replace with:**

```typescript
// visual_container system removed — stroke+shadow handles contrast
const getContainerStyle = (_suggestion: any): Record<string, string> => ({});
```

**Also in template (line 73): change:**

```html
<span :style="getContainerStyle(t)">{{ t.part }}</span>
```

**to:**

```html
{{ t.part }}
```

(Remove the `<span>` wrapper entirely — it only existed for container styling)

---

### A5: LayerEditor.vue — Neuter getEditorContainerStyle()

**Find `getEditorContainerStyle()` (around lines 196-213):**

```typescript
const getEditorContainerStyle = (layer: any): Record<string, string> => {
  const container = layer.visual_container || "none";
  if (container === "none") return {};
  // ... dark rgba map ...
};
```

**Replace with:**

```typescript
// visual_container system removed — containers stripped at source
const getEditorContainerStyle = (_layer: any): Record<string, string> => ({});
```

---

### A: Verification

```bash
cd /Users/chulin/gen-image-layer-separator/backend && npm run build
```

→ Zero TypeScript errors

**Manual test:** Generate a campaign → canvas should show NO dark boxes. Text should have stroke/shadow outlines instead.

**Commit:** `fix: remove visual_container shield system — stroke+shadow only for contrast`

---

---

## Task B: HTML/CSS Output Migration

**Estimated time:** 4-6 hours  
**Files changed:** 5  
**New methods:** 2 (`suggestLayoutHTML`, `refineLayoutHTML`)

---

## B: Architecture Deep Dive

### B0: CSS Units Mapping

Old JSON coordinate system → New CSS units:

| Old                                       | New                 | Calculation          |
| ----------------------------------------- | ------------------- | -------------------- |
| `position.top: 550` (0-1000)              | `top: 55%`          | `value / 10 + "%"`   |
| `position.left: 50` (0-1000)              | `left: 5%`          | `value / 10 + "%"`   |
| `font_size_normalized: 160` (0-200 scale) | `font-size: 16cqw`  | `value / 10 + "cqw"` |
| `font_size_normalized: 40`                | `font-size: 4cqw`   |                      |
| `font_size_normalized: 12`                | `font-size: 1.2cqw` |                      |

**Why cqw?** `canvas-content` has `container-type: inline-size` already (AIRefinementPreview.vue line 619). `1cqw = 1%` of container width. At 600px wide, `16cqw = 96px` font — perfect for headlines.

### B1: HTML Overlay Structure

AI generates a single `html_overlay` string. Structure rules:

```html
<!-- Root: no position, no events -->
<div style="position:absolute;inset:0;pointer-events:none;overflow:hidden">
  <!-- TEXT GROUP: promotional number + label stacked together -->
  <div
    style="position:absolute; top:52%; left:5%; z-index:5; display:flex; flex-direction:column; gap:0.2cqw"
  >
    <!-- Dominant promo number -->
    <span
      style="
      font-family:'Kanit',sans-serif;
      font-size:16cqw;
      font-weight:900;
      color:#FFD700;
      line-height:1;
      letter-spacing:-0.05em;
      text-shadow: 2px 2px 0 #000, -2px -2px 0 #000, 2px -2px 0 #000, -2px 2px 0 #000,
                   0 4px 12px rgba(0,0,0,0.8);
      -webkit-text-stroke: 2px rgba(0,0,0,0.6);
    "
      >2 ต่อ</span
    >

    <!-- Headline below -->
    <span
      style="
      font-family:'Kanit',sans-serif;
      font-size:3.8cqw;
      font-weight:700;
      color:#FFFFFF;
      line-height:1.2;
      text-shadow: 1px 1px 0 #000, -1px -1px 0 #000, 0 2px 8px rgba(0,0,0,0.7);
      -webkit-text-stroke: 1px rgba(0,0,0,0.5);
    "
      >รับฟรี บัตรขึ้นชิงช้าสวรรค์</span
    >
  </div>

  <!-- SEPARATE GROUP: small print -->
  <div style="position:absolute; bottom:1.5%; left:2%; z-index:5">
    <span
      style="
      font-family:'Kanit',sans-serif;
      font-size:1.2cqw;
      font-weight:400;
      color:rgba(255,255,255,0.8);
    "
      >เงื่อนไขเป็นไปตามที่ธนาคารกำหนด</span
    >
  </div>
</div>
```

**No dark boxes. No pills. Only text-shadow + optional -webkit-text-stroke.**

---

### B2: New vertex.service.ts method: `suggestLayoutHTML()`

**Location:** Add before `refineLayout()` method (~line 1338)

**Signature:**

```typescript
async suggestLayoutHTML(
  imageBuffer: Buffer,
  mimeType: string,
  targetText: string,
  layoutHint?: {
    layout_concept: string;
    dominant_element: string;
    text_hierarchy: string[];
    composition_notes: string;
  },
  fixedComponentPositions?: Array<{
    label: string; top: number; left: number; width: number; height: number;
  }>,
  artDirectorTextZone?: { top: number; left: number; width: number; height: number },
): Promise<{
  html_overlay: string;     // Complete HTML fragment string
  background_description: string;
  campaign_vibe: string;
  no_go_zones: any[];       // Still JSON — used for critiqueLayout context
  components: any[];        // Still JSON — die-cut PNGs need separate handling
}>
```

**Prompt template** for `suggestLayoutHTML`:

```
You are a senior Thai advertising art director generating HTML/CSS for a mobile ad canvas.

AD BRIEF:
"""
${targetText}
"""

${layoutHint ? `
ART DIRECTOR STRATEGY (FOLLOW EXACTLY):
- Concept: ${layoutHint.layout_concept}
- Dominant element: "${layoutHint.dominant_element}"
- Text hierarchy: ${layoutHint.text_hierarchy.join(" › ")}
- Notes: ${layoutHint.composition_notes}
` : ""}

${fixedComponentPositions?.length ? `
COMPONENT POSITIONS (already placed — avoid heavily overlapping their upper bodies):
${fixedComponentPositions.map(c =>
  `- "${c.label}": left=${c.left/10}% to ${(c.left+c.width)/10}%, top=${c.top/10}% to ${(c.top+c.height)/10}%`
).join("\n")}
` : ""}

${artDirectorTextZone ? `
TEXT ZONE (place most text here):
left: ${artDirectorTextZone.left/10}% to ${(artDirectorTextZone.left+artDirectorTextZone.width)/10}%
top:  ${artDirectorTextZone.top/10}%  to ${(artDirectorTextZone.top+artDirectorTextZone.height)/10}%
` : ""}

═══════════════════════════════
CANVAS COORDINATE SYSTEM
═══════════════════════════════
- Container is position:relative with container-type:inline-size
- Use position:absolute with % for top/left
- Use cqw (container query width) for font sizes:
    * Promotional numbers (offer, %, price): 12-18cqw (this makes them HUGE and dominant)
    * Headline text: 3.5-5.5cqw
    * Body / sub-headline: 2.5-3.5cqw
    * Fine print / legal: 1.0-1.5cqw (intentionally tiny)

═══════════════════════════════
CONTRAST RULES (MANDATORY)
═══════════════════════════════
NEVER use background-color on text elements (no dark boxes, no pills).
Use these instead:
1. text-shadow (multi-layer for thick outline effect):
   - Strong: "2px 2px 0 #000, -2px -2px 0 #000, 2px -2px 0 #000, -2px 2px 0 #000, 0 4px 12px rgba(0,0,0,0.8)"
   - Subtle: "1px 1px 3px rgba(0,0,0,0.7)"
2. -webkit-text-stroke for thick colored outlines (works in all modern browsers):
   - "2px rgba(0,0,0,0.6)" for dark outline on light/gradient text
   - "2px rgba(255,255,255,0.8)" for white outline on dark text

═══════════════════════════════
LAYOUT RULES
═══════════════════════════════
1. Promotional numbers MUST be in their own <span> at 12-18cqw — DOMINANT
2. Related text (number + label) MUST be in a single flex-column div (grouped together)
3. Fine print goes at bottom:1.5%, font-size: 1.0-1.2cqw
4. Use flexbox gap (gap: 0.3cqw) between grouped elements — NOT manual top positioning
5. All positioning: top/left in % (NOT px or vw)
6. font-family: ALWAYS 'Kanit', sans-serif — no other fonts
7. Keep text clearly within: left:3% to right:3% safe zone (use max-width if needed)
8. z-index: 5 for text groups (components render at z:15 above text)
9. DEEP CONTRAST: If text zone is a PHOTO area (not solid color) — add multi-layer text-shadow. Always.
10. NO color black on black, NO white on white — check the image before choosing color

═══════════════════════════════
WHAT TO RETURN
═══════════════════════════════
Return ONLY this JSON (no markdown, no explanation):
{
  "background_description": "Scene description without overlaid elements",
  "campaign_vibe": "Energetic | Bold | Luxury | Playful | etc",
  "no_go_zones": [
    {
      "label": "Woman's face",
      "priority": "HIGH",
      "area": { "top": 50, "left": 400, "width": 200, "height": 200 }
    }
  ],
  "html_overlay": "<div style='position:absolute;inset:0;pointer-events:none;overflow:hidden'>... YOUR HTML HERE ...</div>",
  "components": [
    {
      "label": "Thai mascot",
      "description": "...",
      "position": { "top": 600, "left": 600, "width": 350, "height": 400, "rotation": 0 },
      "suggested_position": { "top": 100, "left": 500, "width": 450, "height": 850, "rotation": 0, "rationale": "..." },
      "z_index": 15,
      "interaction_zone": { "enabled": true, "overlap_top": 200, "overlap_left": 500, "overlap_width": 200, "overlap_height": 500 }
    }
  ]
}

CRITICAL: The "html_overlay" value MUST be a valid HTML string (all attributes in single quotes inside the JSON double-quote string, OR properly escaped). The entire string goes inside a JSON string field.

EXAMPLE of correctly formatted html_overlay:
"html_overlay": "<div style='position:absolute;inset:0;pointer-events:none'><div style='position:absolute;top:52%;left:5%;z-index:5;display:flex;flex-direction:column;gap:0.3cqw'><span style='font-family:Kanit,sans-serif;font-size:16cqw;font-weight:900;color:#FFD700;text-shadow:2px 2px 0 #000,-2px -2px 0 #000,0 4px 12px rgba(0,0,0,0.8)'>2 ต่อ</span><span style='font-family:Kanit,sans-serif;font-size:3.5cqw;font-weight:700;color:#fff;text-shadow:1px 1px 3px rgba(0,0,0,0.7)'>รับฟรี บัตรขึ้นชิงช้าสวรรค์</span></div></div>"
```

**JSON Parsing** — HTML inside JSON string uses single-quote attributes, which is valid HTML but unusual. Handle by:

```typescript
// After JSON.parse, sanitize html_overlay:
// 1. DOMPurify (frontend) strips dangerous tags
// 2. Backend: basic tag whitelist check before sending
const ALLOWED_TAGS = /^(div|span|p|br)$/;
```

**Full method structure in vertex.service.ts:**

````typescript
async suggestLayoutHTML(
  imageBuffer: Buffer,
  mimeType: string,
  targetText: string,
  layoutHint?: LayoutHint,
  fixedComponentPositions?: ComponentPosition[],
  artDirectorTextZone?: TextZone,
): Promise<LayoutHTMLResult> {
  // 1. Resize for API
  const { processingBuffer, processingMime } = await this.resizeForProcessing(imageBuffer, mimeType);

  const model = process.env.GEMINI_MODEL_ENDPOINT_2 || process.env.GEMINI_MODEL_ENDPOINT || "gemini-2.0-flash-exp";

  // 2. Build prompt (see above)
  const prompt = buildHTMLLayoutPrompt(targetText, layoutHint, fixedComponentPositions, artDirectorTextZone);

  // 3. Call AI
  const response = await this.withRetry(() =>
    this.client.models.generateContent({
      model,
      contents: [{
        role: "user",
        parts: [
          { inlineData: { data: processingBuffer.toString("base64"), mimeType: processingMime } },
          { text: prompt },
        ],
      }],
      config: { maxOutputTokens: 8192, temperature: 0.9 },
    }),
  );

  // 4. Parse JSON
  const raw = (response.text || "").trim().replace(/```json|```/g, "").trim();
  let parsed: any;
  try {
    parsed = JSON.parse(raw);
  } catch {
    // Attempt cleanup
    const cleaned = raw.replace(/\\'/g, "'").replace(/\\([^"\\\/bfnrtu])/g, "$1");
    parsed = JSON.parse(cleaned);
  }

  // 5. Validate html_overlay exists
  if (!parsed.html_overlay || typeof parsed.html_overlay !== "string") {
    throw new Error("[suggestLayoutHTML] AI returned no html_overlay");
  }

  // 6. Sanitize: only allow safe HTML tags in overlay (backend basic check)
  // Full DOMPurify runs on frontend
  const overlay = parsed.html_overlay;
  if (/<script|<iframe|javascript:/i.test(overlay)) {
    throw new Error("[suggestLayoutHTML] html_overlay contains disallowed content");
  }

  console.log(`[HTML] Generated overlay (${overlay.length} chars). Vibe: ${parsed.campaign_vibe}`);
  console.log(`[HTML] Components: ${parsed.components?.length || 0}, no-go zones: ${parsed.no_go_zones?.length || 0}`);

  return parsed;
}
````

---

### B3: New vertex.service.ts method: `refineLayoutHTML()`

**Purpose:** Takes current HTML overlay + critique feedback → returns improved HTML overlay.

**Signature:**

```typescript
async refineLayoutHTML(
  imageBuffer: Buffer,
  mimeType: string,
  targetText: string,
  currentHtmlOverlay: string,
  critique: { status: string; feedback: string; actionable_steps: string[] },
  previewBuffer?: Buffer,
  previousComponents?: any[],
): Promise<{
  html_overlay: string;
  components?: any[];
}>
```

**Prompt:**

```
You are fixing an HTML/CSS ad layout based on an art director's critique.

You can see TWO images:
- IMAGE 1: The original reference background
- IMAGE 2: The current preview (shows current text + components — what needs fixing)

ORIGINAL BRIEF: "${targetText}"

CURRENT HTML OVERLAY (what you must improve):
${currentHtmlOverlay}

ART DIRECTOR CRITIQUE:
- Status: ${critique.status}
- Feedback: ${critique.feedback}
- Actionable steps: ${JSON.stringify(critique.actionable_steps)}

CURRENT COMPONENT POSITIONS:
${JSON.stringify(previousComponents, null, 2)}

YOUR TASK:
1. Address ALL actionable steps from the critique
2. Return an IMPROVED version of the HTML overlay
3. Keep the same text content — only change: positioning, font-size, color, text-shadow, font-weight, letter-spacing
4. NEVER add background-color to text elements (no dark boxes, no pills)
5. Use text-shadow + -webkit-text-stroke for contrast
6. If critique mentions text covering face — move that text group to a different absolute position
7. If critique mentions text too small — increase the cqw value
8. If critique mentions text too scattered — wrap related text in a flex-column div
9. You MAY also adjust component positions for better harmony

Return ONLY this JSON (no markdown):
{
  "html_overlay": "YOUR_IMPROVED_HTML_STRING",
  "components": [...same structure as before, with adjusted positions if needed...]
}
```

---

### B4: image.controller.ts — Wire HTML Pipeline

**Change Pass 2 from JSON to HTML:**

Find the current Pass 2 block in `createCampaign` handler. Replace:

```typescript
// OLD Pass 2:
const textAnalysis = await vertexService.suggestCampaignLayout(
  imageBuffer,
  mimeType,
  targetText,
  "text",
  [],
  [],
  fixedPositions,
  artDirectorTextZone || undefined,
  layoutHint,
);
textSuggestions = textAnalysis.suggestions || [];
analysis.suggestions = textSuggestions;
```

**With:**

```typescript
// NEW Pass 2 — HTML/CSS output:
const htmlAnalysis = await vertexService.suggestLayoutHTML(
  imageBuffer,
  mimeType,
  targetText,
  layoutHint,
  fixedPositions,
  artDirectorTextZone || undefined,
);

// Store HTML overlay and keep backward-compatible fields
htmlOverlay = htmlAnalysis.html_overlay; // new field
analysis.html_overlay = htmlOverlay;
analysis.background_description = htmlAnalysis.background_description;
analysis.campaign_vibe = htmlAnalysis.campaign_vibe;
analysis.no_go_zones = htmlAnalysis.no_go_zones || [];

// components still JSON (die-cut PNGs)
componentSuggestions = htmlAnalysis.components || [];

// Backward compat: textSuggestions kept empty (not used in HTML mode)
textSuggestions = [];
```

**New state variable** at top of handler:

```typescript
let htmlOverlay: string = "";
```

**Update initial `iteration_end` SSE event:**

```typescript
// OLD:
sendSSE("iteration_end", {
  iteration: 0,
  message: "Initial layout mapped to canvas.",
  textCount: textSuggestions.length,
  componentCount: visualComponents.length,
  textLayers: textSuggestions,
  components: componentSuggestions,
  visualComponents,
});

// NEW:
sendSSE("iteration_end", {
  iteration: 0,
  message: "Initial layout mapped to canvas.",
  html_overlay: htmlOverlay,
  componentCount: visualComponents.length,
  components: componentSuggestions,
  visualComponents,
});
```

**Update refinement loop — replace `refineLayout` call with `refineLayoutHTML`:**

```typescript
// OLD refine step:
const refinedAnalysis = await vertexService.refineLayout(
  imageBuffer,
  mimeType,
  targetText,
  analysis,
  critique,
  previewBuffer,
);
textSuggestions = enforceDesignRules(refinedAnalysis.suggestions);

// NEW refine step:
const refinedResult = await vertexService.refineLayoutHTML(
  imageBuffer,
  mimeType,
  targetText,
  htmlOverlay, // current HTML
  critique, // AI critique
  previewBuffer, // preview PNG so AI can SEE problems
  componentSuggestions, // current component positions
);
if (refinedResult.html_overlay && refinedResult.html_overlay.length > 100) {
  htmlOverlay = refinedResult.html_overlay;
  analysis.html_overlay = htmlOverlay;
} else {
  console.warn("[Refine] html_overlay too short — keeping previous");
}
if (refinedResult.components?.length) {
  componentSuggestions = refinedResult.components;
  analysis.components = refinedResult.components;
}
```

**Update iteration_end after refinement:**

```typescript
// OLD:
sendSSE("iteration_end", {
  textLayers: textSuggestions,
  components: componentSuggestions,
  visualComponents,
  ...
});

// NEW:
sendSSE("iteration_end", {
  html_overlay: htmlOverlay,
  components: componentSuggestions,
  visualComponents,
  ...
});
```

**Update done SSE event:**

```typescript
// OLD:
sendSSE("done", {
  success: true,
  data: {
    referenceImage: `/uploads/${refFilename}`,
    generatedBackgroundImageUrl,
    textLayers: textSuggestions,
    visualComponents,
    ...
  },
});

// NEW:
sendSSE("done", {
  success: true,
  data: {
    referenceImage: `/uploads/${refFilename}`,
    generatedBackgroundImageUrl,
    html_overlay: htmlOverlay,     // NEW
    textLayers: [],                 // backward compat: empty
    visualComponents,
    ...
  },
});
```

**Update generateLayoutPreview** — this renders a PNG for AI critique. It currently draws SVG text boxes. In HTML mode, we need to keep rendering the AI preview PNG. Two options:

**Option 1 (Simple):** Keep `generateLayoutPreview()` unchanged — instead of passing `textSuggestions`, parse the `html_overlay` back into approximate bounding boxes for preview rendering.

**Option 2 (Better):** Send `html_overlay` to frontend via a new SSE event, let frontend render it to a canvas PNG and send back.

**Recommendation: Option 1 for now** — add a simple HTML→bounding box approximation:

```typescript
// In image.controller.ts, before critiqueLayout call:
// Parse html_overlay to extract approximate text positions for preview rendering
const approxTextSuggestions = parseHTMLOverlayToApproxSuggestions(htmlOverlay);
previewBuffer = await vertexService.generateLayoutPreview(
  imageBuffer,
  approxTextSuggestions,
  visualComponents,
  analysis.no_go_zones,
);
```

**`parseHTMLOverlayToApproxSuggestions()` helper:**

```typescript
// Rough approximation — extracts top/left % from inline styles in html_overlay
// Good enough for critiqueLayout preview (which just needs rough red boxes)
function parseHTMLOverlayToApproxSuggestions(html: string): any[] {
  const suggestions: any[] = [];
  // Match position:absolute;top:XX%;left:XX% divs with text content
  const divRe =
    /style=['"][^'"]*position:\s*absolute[^'"]*top:\s*([\d.]+)%[^'"]*left:\s*([\d.]+)%[^'"]*['"][^>]*>([\s\S]*?)<\/div>/g;
  let match;
  while ((match = divRe.exec(html)) !== null) {
    const top = parseFloat(match[1]) * 10; // % → 0-1000
    const left = parseFloat(match[2]) * 10;
    const textContent = match[3].replace(/<[^>]+>/g, "").trim();
    if (textContent) {
      suggestions.push({
        part: textContent.substring(0, 40),
        position: { top, left, width: 300, height: 100 },
        style: { font_size_normalized: 60, color_hex: "#FFFFFF" },
        hierarchy: "Headline",
      });
    }
  }
  return suggestions;
}
```

---

### B5: AIRefinementPreview.vue — HTML Overlay Renderer

**Replace liveTextLayers with liveHtmlOverlay:**

```typescript
// OLD state:
const liveTextLayers = ref<any[]>([]);

// NEW state:
const liveHtmlOverlay = ref<string>("");
const liveTextLayers = ref<any[]>([]); // Keep for backward compat / fallback
```

**Update `handleSSEEvent` for `iteration_end`:**

```typescript
case "iteration_end": {
  // HTML mode: use html_overlay if present
  if (data.html_overlay && typeof data.html_overlay === "string") {
    liveHtmlOverlay.value = data.html_overlay;
    // Clear old JSON layers
    liveTextLayers.value = [];
  } else if (data.textLayers) {
    // Fallback: old JSON layer mode
    const components = data.visualComponents || data.components || [];
    const rawTextLayers = (data.textLayers || []).map((t: any) => ({ ...t, z_index: t.z_index ?? 20 }));
    applyInteractionZoneDepth(rawTextLayers, components);
    liveTextLayers.value = rawTextLayers;
    liveHtmlOverlay.value = "";
  }
  // Components always JSON
  if (data.visualComponents?.length) {
    liveComponents.value = data.visualComponents;
  } else if (data.components) {
    liveComponents.value = data.components;
  }
  break;
}
```

**Update `done` event handler:**

```typescript
case "done":
  statusText.value = "Design Approved";
  isComplete.value = true;
  addMessage("Layout finalized successfully", "success");
  if (data.data?.html_overlay) {
    liveHtmlOverlay.value = data.data.html_overlay;
    liveTextLayers.value = [];
    liveComponents.value = data.data.visualComponents || data.data.components || [];
  } else if (data.data?.textLayers) {
    // Fallback: JSON mode
    const components = data.data.visualComponents || data.data.components || [];
    const rawTextLayers = (data.data.textLayers || []).map((t: any) => ({ ...t, z_index: t.z_index ?? 20 }));
    applyInteractionZoneDepth(rawTextLayers, components);
    liveTextLayers.value = rawTextLayers;
    liveComponents.value = components;
  }
  setTimeout(() => { emit("complete", data.data); }, 1000);
  break;
```

**Update template — add HTML overlay render:**

```html
<!-- canvas-content area: -->
<div class="canvas-content">
  <img
    v-if="currentPreviewUrl"
    :src="currentPreviewUrl"
    class="design-preview"
  />
  <div v-else class="empty-canvas">
    <div class="loader-ring"></div>
    <span>INITIALIZING AI CREATIVE SUITE...</span>
  </div>

  <template v-if="currentPreviewUrl">
    <!-- NEW: HTML overlay mode (Task B) -->
    <div
      v-if="liveHtmlOverlay"
      v-html="sanitizedHtmlOverlay"
      class="html-overlay-layer"
    />

    <!-- FALLBACK: Old JSON text overlay mode -->
    <template v-else>
      <div
        v-for="(t, idx) in liveTextLayers"
        :key="'lt' + idx"
        class="live-text-overlay"
        :style="getTextStyle(t, showDebugBoxes)"
      >
        {{ t.part }}
      </div>
    </template>

    <!-- Component overlays — always rendered the same way -->
    <img
      v-for="(c, idx) in liveComponents"
      :key="'lc' + idx"
      :src="'http://localhost:5001' + c.imageUrl"
      class="live-component-overlay"
      :style="getComponentStyle(c, showDebugBoxes)"
    />
  </template>
</div>
```

**Add `sanitizedHtmlOverlay` computed (DOMPurify):**

```typescript
import DOMPurify from "dompurify";

const sanitizedHtmlOverlay = computed(() => {
  if (!liveHtmlOverlay.value) return "";
  // Allow only safe HTML + inline styles (no scripts, no iframes)
  return DOMPurify.sanitize(liveHtmlOverlay.value, {
    ALLOWED_TAGS: ["div", "span", "p", "br"],
    ALLOWED_ATTR: ["style", "class"],
  });
});
```

**Add CSS:**

```css
.html-overlay-layer {
  position: absolute;
  inset: 0;
  pointer-events: none;
  overflow: hidden;
  z-index: 10;
  /* Kanit font preloaded via @import in style block */
}
```

**Install DOMPurify:**

```bash
cd /Users/chulin/gen-image-layer-separator/frontend && npm install dompurify @types/dompurify
```

---

### B6: LayerEditor.vue — HTML Overlay Support

The LayerEditor receives `campaignData` via props (from `done` SSE event).

**Update the `watch` for `campaignData`:**

```typescript
watch(
  () => props.campaignData,
  async (data) => {
    if (!data) return;

    // Load background (unchanged)
    // ...

    // HTML overlay mode
    if (data.html_overlay) {
      htmlOverlay.value = data.html_overlay;
      htmlMode.value = true;
      // Still load component image layers for editing
      const imageLayers: any[] = [];
      if (data.visualComponents?.length) {
        data.visualComponents.forEach((comp: any) => {
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
        });
      }
      layers.value = imageLayers; // Only image layers; text is in HTML
      return; // Skip JSON text layer creation
    }

    // Old JSON mode (fallback)
    // ... existing code ...
  },
  { immediate: true },
);
```

**Add new state to LayerEditor:**

```typescript
const htmlOverlay = ref<string>("");
const htmlMode = ref<boolean>(false);
```

**Update template in LayerEditor to show HTML overlay:**

```html
<!-- In the canvas area: -->
<div class="canvas-content" ref="canvasContainer" ...>
  <img v-if="bgPreviewUrl" :src="bgPreviewUrl" class="bg-img" />

  <!-- HTML overlay mode (Task B) -->
  <div
    v-if="htmlMode && htmlOverlay"
    v-html="sanitizedHtmlOverlay"
    class="html-overlay-layer"
    style="position:absolute;inset:0;pointer-events:none;overflow:hidden"
  />

  <!-- Image/component layers — always rendered (draggable) -->
  <template v-for="(layer, idx) in layers" :key="layer.id">
    <img
      v-if="layer.type === 'image'"
      :src="layer.imageUrl"
      class="layer-element"
      :style="getImageLayerStyle(layer)"
      @mousedown="startDrag($event, idx)"
    />
    <!-- Text layers only shown in non-HTML mode -->
    <div
      v-else-if="!htmlMode && layer.type === 'text'"
      class="layer-element text-layer"
      ...
    />
  </template>
</div>
```

---

### B7: Types cleanup (optional but clean)

Add to a new `backend/src/types/layout.types.ts`:

```typescript
export interface LayoutHint {
  layout_concept: string;
  dominant_element: string;
  text_hierarchy: string[];
  composition_notes: string;
}

export interface ComponentPosition {
  label: string;
  top: number;
  left: number;
  width: number;
  height: number;
}

export interface TextZone {
  top: number;
  left: number;
  width: number;
  height: number;
}

export interface LayoutHTMLResult {
  html_overlay: string;
  background_description: string;
  campaign_vibe: string;
  no_go_zones: NoGoZone[];
  components: ComponentSuggestion[];
}

export interface NoGoZone {
  label: string;
  priority: "HIGH" | "MEDIUM" | "LOW";
  area: { top: number; left: number; width: number; height: number };
  reason?: string;
}
```

---

## Full Sequence of SSE Events (After Task B)

```
progress        → "AI is planning layout strategy..."
progress        → "🎨 Layout strategy: 'hero-right text-left'"
progress        → "AI generating HTML layout..."
iteration_end   → { iteration: 0, html_overlay: "<div...>", visualComponents: [...] }
                  (canvas immediately shows HTML text + component images)
iteration_start → { iteration: 1, maxIterations: 3 }
debug_preview   → (optional — still renders a PNG for internal critique)
critique_complete → { status: "FAIL", feedback: "...", confidence: 0.6 }
refining        → "Refining HTML layout from feedback..."
iteration_end   → { iteration: 1, html_overlay: "<div ... improved ...>", ... }
critique_complete → { status: "PASS", confidence: 0.91 }
done            → { data: { html_overlay: "...", visualComponents: [...], ... } }
```

---

## Risk Analysis

| Risk                                                           | Probability | Impact | Mitigation                                                                                                   |
| -------------------------------------------------------------- | ----------- | ------ | ------------------------------------------------------------------------------------------------------------ |
| AI generates malformed HTML (unclosed tags, bad JSON escaping) | HIGH        | Medium | JSON cleanup + DOMPurify sanitization + length validation                                                    |
| html_overlay string too long for JSON transport                | Low         | Low    | maxOutputTokens: 8192 enough for ~150 lines of HTML                                                          |
| critiqueLayout preview PNG wrong (uses approx extraction)      | Medium      | Low    | Preview just needs rough regions for critique quality; exact position less critical                          |
| refineLayoutHTML ignores previous HTML structure               | Medium      | Medium | Prompt includes full currentHtmlOverlay for context; AI can see both old HTML + preview PNG                  |
| Frontend DOMPurify strips valid CSS                            | Low         | Medium | Test with real output; DOMPurify config allows style attribute                                               |
| Layer editor drag breaks in HTML mode                          | Low         | Low    | HTML mode only shows image layers as draggable; text editing not available in this mode (clear UI indicator) |
| Kanit font not loaded in html_overlay div                      | Very Low    | Medium | Kanit already imported via @import in canvas-content parent scope                                            |

---

## File Change Summary

| File                                              | Task | Change Type                                          |
| ------------------------------------------------- | ---- | ---------------------------------------------------- |
| `backend/src/services/vertex.service.ts`          | A    | Remove CONTRAST SHIELD prompt blocks                 |
| `backend/src/services/vertex.service.ts`          | A    | Fix refineLayout prompt (remove add-shields rule)    |
| `backend/src/services/vertex.service.ts`          | B    | Add `suggestLayoutHTML()` method                     |
| `backend/src/services/vertex.service.ts`          | B    | Add `refineLayoutHTML()` method                      |
| `backend/src/controllers/image.controller.ts`     | A    | Force `visual_container: "none"` in post-processor   |
| `backend/src/controllers/image.controller.ts`     | B    | Wire Pass 2 → `suggestLayoutHTML()`                  |
| `backend/src/controllers/image.controller.ts`     | B    | Replace `refineLayout` → `refineLayoutHTML` in loop  |
| `backend/src/controllers/image.controller.ts`     | B    | Add `parseHTMLOverlayToApproxSuggestions()` helper   |
| `backend/src/controllers/image.controller.ts`     | B    | Update all SSE events: `textLayers` → `html_overlay` |
| `frontend/src/components/AIRefinementPreview.vue` | A    | Neuter `getContainerStyle()`                         |
| `frontend/src/components/AIRefinementPreview.vue` | A    | Remove `<span>` wrapper for container                |
| `frontend/src/components/AIRefinementPreview.vue` | B    | Add `liveHtmlOverlay` state + SSE handlers           |
| `frontend/src/components/AIRefinementPreview.vue` | B    | Add `sanitizedHtmlOverlay` computed (DOMPurify)      |
| `frontend/src/components/AIRefinementPreview.vue` | B    | Update template: `v-html` overlay + fallback         |
| `frontend/src/components/LayerEditor.vue`         | A    | Neuter `getEditorContainerStyle()`                   |
| `frontend/src/components/LayerEditor.vue`         | B    | Add `htmlMode` + `htmlOverlay` state                 |
| `frontend/src/components/LayerEditor.vue`         | B    | Update template for HTML overlay display             |
| `frontend/package.json`                           | B    | Add `dompurify @types/dompurify`                     |

---

## Commit Plan

```
Task A:
  commit 1: fix: remove visual_container shield system — stroke+shadow only for contrast

Task B:
  commit 2: feat(vertex): add suggestLayoutHTML and refineLayoutHTML methods
  commit 3: feat(controller): wire HTML/CSS pipeline — Pass 2 and refinement loop
  commit 4: feat(frontend): HTML overlay renderer in AIRefinementPreview
  commit 5: feat(frontend): HTML overlay mode in LayerEditor
  commit 6: docs: update understanding.md and progress.md for HTML/CSS migration
```

---

## Verification Checklist

### After Task A:

| Check                      | Expected                                              |
| -------------------------- | ----------------------------------------------------- |
| `npm run build`            | ✅ Zero errors                                        |
| Generate campaign → canvas | ❌ No dark boxes or pills                             |
| Generate campaign → canvas | ✅ Text visible via stroke/shadow                     |
| Backend logs               | `visual_container: "none"` stripped in post-processor |

### After Task B:

| Check                            | Expected                                                |
| -------------------------------- | ------------------------------------------------------- |
| `npm run build`                  | ✅ Zero errors                                          |
| `cd frontend && npm install`     | DOMPurify installed                                     |
| `cd frontend && npm run build`   | ✅ Zero errors                                          |
| Generate campaign → backend log  | `[HTML] Generated overlay (XXXX chars)` appears         |
| Generate campaign → canvas       | HTML div overlay visible, NOT individual JSON text divs |
| Promo number "2 ต่อ"             | ~16cqw = dominant, huge on canvas                       |
| Fine print                       | ~1.2cqw = tiny, at bottom                               |
| Refinement loop                  | `[HTML] Refining HTML overlay from critique...` in logs |
| `done` event in browser DevTools | `data.html_overlay` string present                      |
| LayerEditor after finalize       | HTML overlay shown, component images still draggable    |

---

## Notes for Implementation

### On JSON string escaping in html_overlay

AI will write HTML with inline styles. The tricky part: inside a JSON string, you cannot have unescaped double-quotes. The convention we use:

- HTML attributes use **single quotes** (valid HTML, not valid XHTML, but fine for browsers)
- Example: `style='position:absolute'` not `style="position:absolute"`
- AI is explicitly instructed to use single quotes in the prompt example

Fallback cleanup:

```typescript
// If AI used double quotes inside JSON string (causes parse failure):
const repaired = raw.replace(
  /"html_overlay":\s*"([\s\S]*?)"(?=,|\s*})/g,
  (_, content) => {
    const fixed = content.replace(/(?<!\\)"/g, "'"); // replace unescaped " with '
    return `"html_overlay": "${fixed}"`;
  },
);
```

### On DOMPurify in Vue 3

```typescript
// Import at top of AIRefinementPreview.vue
import createDOMPurify from "dompurify";
const DOMPurify = createDOMPurify(window);
```

### On cqw font scaling

`canvas-content` has `container-type: inline-size` confirmed at AIRefinementPreview.vue line 619. This means cqw works immediately. No changes needed to CSS.

At 600px canvas width:

- `16cqw = 96px` — great for promo numbers
- `4cqw = 24px` — good headline size
- `1.2cqw = 7.2px` — tiny fine print

This scales automatically as the canvas resizes. Much better than fixed px or vw units.

---

**APPROVE this plan to begin execution with /superpowers-execute-plan**
