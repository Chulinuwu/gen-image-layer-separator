# SVG Layout System Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Replace HTML/CSS overlay generation with native SVG so layouts can be exported to Illustrator, Figma, and Photoshop as editable files.

**Architecture:** LLM generates SVG using a "box-model" mental model (`<g transform>` = container, `<rect>` = background, `<tspan dy>` = line stacking). Canvas uses absolute pixel coordinates from the image dimensions. Frontend renders the SVG inline; a new `/export-svg` endpoint post-processes for embed-fonts or convert-to-paths export modes.

**Tech Stack:** Node.js/Express/TypeScript (backend), Vue 3 (frontend), sharp (image metadata), `@fontsource/kanit` (font files for embedding), `opentype.js` (text-to-paths conversion), DOMPurify with SVG profile (sanitization)

---

### Task 1: Install font and path-conversion dependencies

**Files:**
- Modify: `backend/package.json`

**Step 1: Install packages**

```bash
cd backend
npm install @fontsource/kanit opentype.js
npm install --save-dev @types/opentype.js
```

**Step 2: Verify font file exists**

```bash
ls node_modules/@fontsource/kanit/files/ | grep -E "kanit-thai-700|kanit-thai-400" | head -5
```

Expected: shows `.woff2` or `.ttf` files.

**Step 3: Commit**

```bash
git add backend/package.json backend/package-lock.json
git commit -m "feat: add @fontsource/kanit and opentype.js for SVG font embedding and path conversion"
```

---

### Task 2: Add `parseSVGResponse()` to vertex.service.ts

**Files:**
- Modify: `backend/src/services/vertex.service.ts` after line 1476 (after `parseHTMLResponse`)

**Step 1: Add the method** — insert after the closing `}` of `parseHTMLResponse` (line 1476):

```typescript
  /**
   * Extractor helper: parses AI response containing <META> and <SVG_OVERLAY> tags.
   * SVG equivalent of parseHTMLResponse — looks for <SVG_OVERLAY> instead of <HTML_OVERLAY>.
   */
  private parseSVGResponse(raw: string): any {
    let meta = {};
    let svgContent = "";

    const metaMatch = raw.match(/<META>([\s\S]*?)<\/META>/i);
    const svgMatch = raw.match(/<SVG_OVERLAY>([\s\S]*?)<\/SVG_OVERLAY>/i);

    if (metaMatch || svgMatch) {
      if (metaMatch) {
        const metaStr = metaMatch[1].trim();
        try {
          meta = JSON.parse(metaStr);
        } catch {
          console.warn("[parseSVGResponse] META JSON parse failed, attempting repair");
          const repaired =
            metaStr.replace(/,\s*$/, "") +
            "}".repeat(
              Math.max(
                0,
                (metaStr.match(/{/g) || []).length -
                  (metaStr.match(/}/g) || []).length,
              ),
            );
          const cleaned = repaired
            .replace(/\\'/g, "'")
            .replace(/\\([^"\\\/bfnrtu])/g, "$1")
            .replace(/[\x00-\x1F\x7F]/g, " ");
          try {
            meta = JSON.parse(cleaned);
          } catch (e) {
            console.error("[parseSVGResponse] META JSON repair failed", e);
          }
        }
      }
      if (svgMatch) {
        svgContent = svgMatch[1].trim();
      }
      return { ...meta, svg_overlay: svgContent };
    }

    // Fallback: no delimiters found
    console.warn("[parseSVGResponse] <SVG_OVERLAY> tag missing in response");
    return { svg_overlay: "" };
  }
```

**Step 2: Build to verify no TypeScript errors**

```bash
cd backend && npm run build 2>&1 | tail -5
```

Expected: `Found 0 errors.`

**Step 3: Commit**

```bash
git add backend/src/services/vertex.service.ts
git commit -m "feat: add parseSVGResponse helper to vertex.service"
```

---

### Task 3: Add `suggestLayoutSVG()` to vertex.service.ts

**Files:**
- Modify: `backend/src/services/vertex.service.ts` — add after `suggestLayoutHTML()` (after line 1731)

**Step 1: Add the method**

```typescript
  /**
   * SVG layout generation — AI outputs svg_overlay string.
   * Uses absolute px coordinates based on actual canvas size.
   * Box-model mental model: <g transform> = container, <rect> = background, <tspan dy> = line stack.
   */
  async suggestLayoutSVG(
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
      label: string;
      top: number;
      left: number;
      width: number;
      height: number;
    }>,
    artDirectorTextZone?: {
      top: number;
      left: number;
      width: number;
      height: number;
    },
  ): Promise<{
    svg_overlay: string;
    background_description: string;
    campaign_vibe: string;
    no_go_zones: any[];
    components: any[];
  }> {
    // Resize for AI processing
    let processingBuffer = imageBuffer;
    let processingMime = mimeType;
    let canvasWidth = 1080;
    let canvasHeight = 1080;
    try {
      const meta = await sharp(imageBuffer).metadata();
      canvasWidth = meta.width || 1080;
      canvasHeight = meta.height || 1080;
      processingBuffer = await sharp(imageBuffer)
        .resize(Math.min(1500, canvasWidth))
        .jpeg({ quality: 90 })
        .toBuffer();
      processingMime = "image/jpeg";
    } catch (_e) {
      /* use original */
    }

    const model =
      process.env.GEMINI_MODEL_ENDPOINT_2 ||
      process.env.GEMINI_MODEL_ENDPOINT ||
      "gemini-2.0-flash-exp";

    const safeX = Math.round(canvasWidth * 0.05);
    const safeY = Math.round(canvasHeight * 0.05);
    const maxX = Math.round(canvasWidth * 0.95);
    const maxY = Math.round(canvasHeight * 0.95);
    const maxTextWidth = Math.round(canvasWidth * 0.45);

    const strategyBlock =
      layoutHint && layoutHint.layout_concept !== "default"
        ? `
ART DIRECTOR STRATEGY (FOLLOW EXACTLY):
- Concept: ${layoutHint.layout_concept}
- Dominant element (MUST be largest): "${layoutHint.dominant_element}"
- Text priority order: ${layoutHint.text_hierarchy.join(" › ")}
- Notes: ${layoutHint.composition_notes}
`
        : "";

    const componentsBlock = fixedComponentPositions?.length
      ? `
COMPONENT POSITIONS (placed — design text around them naturally):
${fixedComponentPositions
  .map(
    (c) =>
      `- "${c.label}": x=${Math.round((c.left / 1000) * canvasWidth)}px to ${Math.round(((c.left + c.width) / 1000) * canvasWidth)}px, y=${Math.round((c.top / 1000) * canvasHeight)}px to ${Math.round(((c.top + c.height) / 1000) * canvasHeight)}px`,
  )
  .join("\n")}
`
      : "";

    const textZoneBlock = artDirectorTextZone
      ? `
TEXT ZONE (place most text here):
  x-range: ${Math.round((artDirectorTextZone.left / 1000) * canvasWidth)}px to ${Math.round(((artDirectorTextZone.left + artDirectorTextZone.width) / 1000) * canvasWidth)}px
  y-range: ${Math.round((artDirectorTextZone.top / 1000) * canvasHeight)}px to ${Math.round(((artDirectorTextZone.top + artDirectorTextZone.height) / 1000) * canvasHeight)}px
`
      : "";

    const prompt = `You are a senior Thai advertising art director generating SVG for a campaign ad canvas.

AD BRIEF:
"""
${targetText}
"""
${strategyBlock}${componentsBlock}${textZoneBlock}
═══════════════════════════════════════
CANVAS
═══════════════════════════════════════
Size: ${canvasWidth}×${canvasHeight}px — use ABSOLUTE px coordinates, NOT percentages.
Safe zone: min x=${safeX}px, min y=${safeY}px, max x=${maxX}px, max y=${maxY}px

═══════════════════════════════════════
SVG BOX MODEL — THINK IN HTML, WRITE AS SVG
═══════════════════════════════════════
• "position:absolute; left:X; top:Y"  →  <g transform="translate(X, Y)">
• "background: rgba(0,0,0,0.55); border-radius:8px"  →  <rect x="0" y="0" width="W" height="H" rx="8" fill="rgba(0,0,0,0.55)"/>
• "padding: 16px"  →  x="16" on the <text> inside the <g>
• "font-size: 120px; font-weight:900"  →  font-size="120" font-weight="900" on <text>
• "line-height: 1.35 + next line"  →  <tspan x="PAD" dy="1.35em">next line</tspan>
• "text-shadow"  →  filter="url(#fN)" referencing a <feDropShadow> in <defs>
• "-webkit-text-stroke: 4px black"  →  stroke="rgba(0,0,0,0.5)" stroke-width="8" paint-order="stroke fill"

═══════════════════════════════════════
FONT SIZES (${canvasWidth}px canvas)
═══════════════════════════════════════
- Promotional numbers (offer, %, ×, price): ${Math.round(canvasWidth * 0.12)}-${Math.round(canvasWidth * 0.18)}px  ← HUGE and dominant
- Headline / sub-headline: ${Math.round(canvasWidth * 0.035)}-${Math.round(canvasWidth * 0.055)}px
- Body text: ${Math.round(canvasWidth * 0.025)}-${Math.round(canvasWidth * 0.035)}px
- Fine print / legal: ${Math.round(canvasWidth * 0.01)}-${Math.round(canvasWidth * 0.015)}px

═══════════════════════════════════════
LAYOUT RULES
═══════════════════════════════════════
1. Group related text in ONE <g> block (number + label + subtitle = 1 group, NOT scattered)
2. Promotional number MUST be dominant: first <tspan>, largest font size
3. Fine print: translate(${safeX}, ${maxY - Math.round(canvasHeight * 0.02)}) — tiny, bottom edge
4. font-family: ALWAYS "Kanit, sans-serif" — no exceptions
5. Text group max width: ~${maxTextWidth}px — use this to avoid overflow
6. Color: white (#fff) on dark areas, golden (#FFD700) for promo numbers
7. line-height equivalent: dy="1.0em" for promo numbers, dy="1.25em" for headlines, dy="1.4em" for body

═══════════════════════════════════════
CONTRAST — MANDATORY
═══════════════════════════════════════
- On photo backgrounds: use feDropShadow filter + stroke on text
- Big promo text: stroke-width="8", fill="#FFD700" or "#fff"
- Use <rect> background ONLY for true contrast shields (where text is totally unreadable otherwise)
- shadow filter x="-20%" y="-20%" width="140%" height="140%" to avoid clipping

═══════════════════════════════════════
COMPONENT PLACEMENT RULES (JSON in META, NOT in SVG)
═══════════════════════════════════════
1. ANCHOR to one side: component should sit left OR right, freeing the other half for text
2. 5% SAFE ZONE: top≥50, left≥50, (left+width)≤950, (top+height)≤950 (normalized 0-1000)
3. Do NOT center components — centered blocks text space
4. Scale component to fill 40-60% of canvas height for visual impact
5. z_index: 15 for components

═══════════════════════════════════════
RETURN FORMAT
═══════════════════════════════════════
Return TWO parts using XML delimiters <META> and <SVG_OVERLAY>. Do NOT nest SVG inside JSON.

<META>
{
  "background_description": "Scene description",
  "campaign_vibe": "Energetic | Bold | Luxury | Playful",
  "no_go_zones": [
    { "label": "face", "priority": "HIGH", "area": { "top": 50, "left": 400, "width": 200, "height": 200 }, "reason": "face" }
  ],
  "components": [
    {
      "label": "mascot",
      "description": "description",
      "position": { "top": 100, "left": 500, "width": 450, "height": 850, "rotation": 0 },
      "suggested_position": { "top": 100, "left": 500, "width": 450, "height": 850, "rotation": 0, "rationale": "..." },
      "z_index": 15,
      "interaction_zone": { "enabled": true, "overlap_top": 200, "overlap_left": 500, "overlap_width": 200, "overlap_height": 500 }
    }
  ]
}
</META>
<SVG_OVERLAY>
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${canvasWidth} ${canvasHeight}" width="${canvasWidth}" height="${canvasHeight}">
  <defs>
    <filter id="f0" x="-20%" y="-20%" width="140%" height="140%">
      <feDropShadow dx="2" dy="3" stdDeviation="5" flood-color="#000000" flood-opacity="0.8"/>
    </filter>
  </defs>
  <g id="text-overlay">
    <g id="block-0" transform="translate(X, Y)">
      <text x="0" y="BASELINE" font-family="Kanit, sans-serif" font-size="FS" font-weight="700" fill="#FFFFFF" stroke="rgba(0,0,0,0.5)" stroke-width="8" paint-order="stroke fill" filter="url(#f0)">
        <tspan x="0" dy="0">text line 1</tspan>
        <tspan x="0" dy="1.25em" font-size="FS2" font-weight="400">text line 2</tspan>
      </text>
    </g>
  </g>
</svg>
</SVG_OVERLAY>

Example for "2 ต่อ รับฟรี บัตรขึ้นชิงช้าสวรรค์" on a ${canvasWidth}×${canvasHeight} canvas:
<SVG_OVERLAY>
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${canvasWidth} ${canvasHeight}" width="${canvasWidth}" height="${canvasHeight}">
  <defs>
    <filter id="f0" x="-20%" y="-20%" width="140%" height="140%">
      <feDropShadow dx="3" dy="3" stdDeviation="6" flood-color="#000000" flood-opacity="0.85"/>
    </filter>
  </defs>
  <g id="text-overlay">
    <g id="block-0" transform="translate(${safeX + 10}, ${Math.round(canvasHeight * 0.52)})">
      <text x="0" y="${Math.round(canvasWidth * 0.16)}" font-family="Kanit, sans-serif" font-size="${Math.round(canvasWidth * 0.16)}" font-weight="900" fill="#FFD700" stroke="rgba(0,0,0,0.45)" stroke-width="10" paint-order="stroke fill" filter="url(#f0)" letter-spacing="-3">
        <tspan x="0" dy="0">2 ต่อ</tspan>
        <tspan x="0" dy="1.1em" font-size="${Math.round(canvasWidth * 0.04)}" font-weight="700" fill="#FFFFFF" stroke-width="4">รับฟรี บัตรขึ้นชิงช้าสวรรค์</tspan>
      </text>
    </g>
    <g id="block-fine" transform="translate(${safeX}, ${maxY - 10})">
      <text x="0" y="0" font-family="Kanit, sans-serif" font-size="${Math.round(canvasWidth * 0.012)}" font-weight="400" fill="rgba(255,255,255,0.8)">เงื่อนไขเป็นไปตามที่ธนาคารกำหนด</text>
    </g>
  </g>
</svg>
</SVG_OVERLAY>`;

    const svgConfig: any = {
      maxOutputTokens: 8192,
      temperature: 0.9,
      topP: 0.95,
      safetySettings: [
        { category: "HARM_CATEGORY_HATE_SPEECH", threshold: "OFF" },
        { category: "HARM_CATEGORY_DANGEROUS_CONTENT", threshold: "OFF" },
        { category: "HARM_CATEGORY_SEXUALLY_EXPLICIT", threshold: "OFF" },
        { category: "HARM_CATEGORY_HARASSMENT", threshold: "OFF" },
      ],
    };

    const response = await this.withRetry(() =>
      this.client.models.generateContent({
        model,
        contents: [
          {
            role: "user",
            parts: [
              { inlineData: { data: processingBuffer.toString("base64"), mimeType: processingMime } },
              { text: prompt },
            ],
          },
        ],
        config: svgConfig,
      }),
    );

    const raw = response.text || "";
    let parsed: any;
    try {
      parsed = this.parseSVGResponse(raw);
    } catch (err) {
      console.error("[suggestLayoutSVG] Failed to parse response.", err);
      parsed = { svg_overlay: "" };
    }

    if (!parsed.svg_overlay || typeof parsed.svg_overlay !== "string" || parsed.svg_overlay.length < 50) {
      throw new Error("[suggestLayoutSVG] AI returned empty or invalid svg_overlay");
    }
    if (/<script|<iframe|javascript:/i.test(parsed.svg_overlay)) {
      throw new Error("[suggestLayoutSVG] svg_overlay contains disallowed content");
    }

    console.log(
      `[SVG] Overlay generated (${parsed.svg_overlay.length} chars). Vibe: "${parsed.campaign_vibe}". Components: ${parsed.components?.length || 0}`,
    );
    return parsed;
  }
```

**Step 2: Build to verify**

```bash
cd backend && npm run build 2>&1 | tail -5
```

Expected: `Found 0 errors.`

**Step 3: Commit**

```bash
git add backend/src/services/vertex.service.ts
git commit -m "feat: add suggestLayoutSVG() — SVG layout generation with box-model mental model"
```

---

### Task 4: Add `refineLayoutSVG()` to vertex.service.ts

**Files:**
- Modify: `backend/src/services/vertex.service.ts` — add after `refineLayoutHTML()` (after line 1867)

**Step 1: Add the method**

```typescript
  /**
   * SVG equivalent of refineLayoutHTML — refines SVG overlay based on critique.
   */
  async refineLayoutSVG(
    imageBuffer: Buffer,
    mimeType: string,
    targetText: string,
    currentSvgOverlay: string,
    critique: { status: string; feedback: string; actionable_steps: string[] },
    previewBuffer?: Buffer,
    previousComponents?: any[],
  ): Promise<{ svg_overlay: string; components?: any[] }> {
    const model =
      process.env.GEMINI_MODEL_ENDPOINT_2 ||
      process.env.GEMINI_MODEL_ENDPOINT ||
      "gemini-2.0-flash-exp";

    // Extract canvas size from current SVG viewBox
    const vbMatch = currentSvgOverlay.match(/viewBox="0 0 (\d+) (\d+)"/);
    const canvasWidth = vbMatch ? parseInt(vbMatch[1]) : 1080;
    const canvasHeight = vbMatch ? parseInt(vbMatch[2]) : 1080;

    const prompt = `You are fixing an SVG ad layout based on an art director's critique.

You can see TWO images:
- IMAGE 1: The original reference background
- IMAGE 2: The current preview (current text + components — what needs fixing)

ORIGINAL BRIEF: "${targetText}"

CURRENT SVG OVERLAY (what you must improve):
${currentSvgOverlay}

ART DIRECTOR CRITIQUE:
Status: ${critique.status}
Feedback: ${critique.feedback}
Actionable steps: ${JSON.stringify(critique.actionable_steps, null, 2)}

CURRENT COMPONENT POSITIONS (normalized 0-1000):
${JSON.stringify(previousComponents || [], null, 2)}

═══════════════════════════════════════
YOUR TASK — SVG TEXT FIXES
═══════════════════════════════════════
1. Address ALL actionable steps from the critique
2. Return an IMPROVED SVG overlay — keep same text content, freely change:
   translate(X,Y), font-size, fill, stroke, stroke-width, filter, font-weight, dy spacing
3. Canvas: ${canvasWidth}×${canvasHeight}px — use absolute px coordinates
4. Safe zone: x≥${Math.round(canvasWidth * 0.05)}px, y≥${Math.round(canvasHeight * 0.05)}px, x≤${Math.round(canvasWidth * 0.95)}px, y≤${Math.round(canvasHeight * 0.95)}px
5. font-family: ALWAYS "Kanit, sans-serif"
6. If text covers a face → move translate(X,Y) away from face area
7. If text too small → increase font-size
8. If text scattered → merge into one <g> with <tspan dy> stacking

═══════════════════════════════════════
YOUR TASK — COMPONENT FIXES
═══════════════════════════════════════
Return corrected positions in the "components" array (normalized 0-1000):
- top≥50, left≥50, (left+width)≤950, (top+height)≤950

═══════════════════════════════════════
RETURN FORMAT
═══════════════════════════════════════
<META>
{
  "components": [
    {
      "label": "name",
      "position": { "top": N, "left": N, "width": N, "height": N, "rotation": 0 },
      "suggested_position": { "top": N, "left": N, "width": N, "height": N, "rotation": 0, "rationale": "..." },
      "z_index": 15,
      "interaction_zone": { "enabled": true, "overlap_top": N, "overlap_left": N, "overlap_width": N, "overlap_height": N }
    }
  ]
}
</META>
<SVG_OVERLAY>
YOUR_IMPROVED_SVG_HERE
</SVG_OVERLAY>`;

    const parts: any[] = [
      { inlineData: { data: imageBuffer.toString("base64"), mimeType } },
    ];
    if (previewBuffer) {
      parts.push({ inlineData: { data: previewBuffer.toString("base64"), mimeType: "image/png" } });
    }
    parts.push({ text: prompt });

    const result = await this.withRetry(() =>
      this.client.models.generateContent({
        model,
        contents: [{ role: "user", parts }],
        config: { maxOutputTokens: 8192, temperature: 0.8 },
      }),
    );

    const raw = result.text || "";
    let parsed: any;
    try {
      parsed = this.parseSVGResponse(raw);
    } catch (parseErr) {
      console.error("[refineLayoutSVG] Failed to parse response:", parseErr);
      parsed = { svg_overlay: "" };
    }

    if (!parsed.svg_overlay || parsed.svg_overlay.length < 50) {
      throw new Error("[refineLayoutSVG] AI returned empty svg_overlay");
    }
    if (/<script|<iframe|javascript:/i.test(parsed.svg_overlay)) {
      throw new Error("[refineLayoutSVG] svg_overlay contains disallowed content");
    }

    console.log(`[SVG] Refined overlay (${parsed.svg_overlay.length} chars)`);
    return parsed;
  }
```

**Step 2: Build**

```bash
cd backend && npm run build 2>&1 | tail -5
```

Expected: `Found 0 errors.`

**Step 3: Commit**

```bash
git add backend/src/services/vertex.service.ts
git commit -m "feat: add refineLayoutSVG() — SVG-aware critique refinement"
```

---

### Task 5: Add `exportSVG()` to vertex.service.ts

**Files:**
- Modify: `backend/src/services/vertex.service.ts` — add after `refineLayoutSVG()`

**Step 1: Add the method**

```typescript
  /**
   * Post-process SVG overlay for export.
   * mode='embed-fonts': inject @font-face base64 into <defs>
   * mode='paths': convert <text> elements to <path> elements (requires opentype.js)
   *
   * @param svgOverlay     The raw SVG string (overlay only — no background)
   * @param backgroundBuffer  If provided, embeds background as <image> layer (full-composition mode)
   * @param mode           'embed-fonts' | 'paths'
   */
  async exportSVG(
    svgOverlay: string,
    backgroundBuffer: Buffer | null,
    mode: "embed-fonts" | "paths",
  ): Promise<string> {
    // 1. Extract viewBox dimensions from the SVG
    const vbMatch = svgOverlay.match(/viewBox="0 0 (\d+) (\d+)"/);
    const w = vbMatch ? parseInt(vbMatch[1]) : 1080;
    const h = vbMatch ? parseInt(vbMatch[2]) : 1080;

    // 2. Optionally inject background image as first layer
    let bgLayer = "";
    if (backgroundBuffer) {
      const bgBase64 = backgroundBuffer.toString("base64");
      bgLayer = `<image id="background" href="data:image/jpeg;base64,${bgBase64}" x="0" y="0" width="${w}" height="${h}" preserveAspectRatio="xMidYMid slice"/>`;
    }

    // 3. Handle font embedding or path conversion
    if (mode === "embed-fonts") {
      // Read Kanit font files and base64-encode them
      const fontDir = path.join(
        __dirname,
        "../../node_modules/@fontsource/kanit/files",
      );
      let fontDefs = "";
      const variants: Array<{ weight: string; style: string; file: string }> = [
        { weight: "400", style: "normal", file: "kanit-thai-400-normal.woff2" },
        { weight: "700", style: "normal", file: "kanit-thai-700-normal.woff2" },
        { weight: "900", style: "normal", file: "kanit-thai-900-normal.woff2" },
      ];
      for (const v of variants) {
        const fontPath = path.join(fontDir, v.file);
        if (fs.existsSync(fontPath)) {
          const fontBase64 = fs.readFileSync(fontPath).toString("base64");
          fontDefs += `@font-face{font-family:'Kanit';font-weight:${v.weight};font-style:${v.style};src:url('data:font/woff2;base64,${fontBase64}') format('woff2');}`;
        }
      }
      // Inject font defs into <defs> block (or create one)
      const result = svgOverlay.replace(
        /<defs>([\s\S]*?)<\/defs>/,
        `<defs><style>${fontDefs}</style>$1</defs>`,
      );
      // If no <defs> exists, add one
      const withFonts = result.includes("<defs>")
        ? result
        : svgOverlay.replace(/<svg([^>]*)>/, `<svg$1><defs><style>${fontDefs}</style></defs>`);

      // Inject background layer if present
      return withFonts.replace(
        /(<svg[^>]*>)/,
        `$1${bgLayer}`,
      );
    }

    if (mode === "paths") {
      // Use opentype.js to convert text to paths
      const opentype = await import("opentype.js");
      const fontDir = path.join(
        __dirname,
        "../../node_modules/@fontsource/kanit/files",
      );

      // Load font variants
      const fontCache: Record<string, any> = {};
      const loadFont = async (weight: string) => {
        if (fontCache[weight]) return fontCache[weight];
        // opentype.js needs TTF — @fontsource ships woff2 only, fall back to system
        // Try to find a local TTF or skip gracefully
        const candidates = [
          path.join(fontDir, `kanit-thai-${weight}-normal.ttf`),
          `/usr/share/fonts/truetype/noto/NotoSansThai-Regular.ttf`,
        ];
        for (const p of candidates) {
          if (fs.existsSync(p)) {
            fontCache[weight] = await opentype.load(p);
            return fontCache[weight];
          }
        }
        return null;
      };

      // Simple regex-based text node extraction and path conversion
      // This replaces each <text>...</text> block with <g> containing <path> elements
      const converted = await this._convertSVGTextToPaths(svgOverlay, loadFont);
      return converted.replace(/(<svg[^>]*>)/, `$1${bgLayer}`);
    }

    return svgOverlay;
  }

  /**
   * Internal: convert SVG <text>/<tspan> elements to <path> elements using opentype.js.
   * Handles translate() transforms and dy line offsets.
   */
  private async _convertSVGTextToPaths(
    svg: string,
    loadFont: (weight: string) => Promise<any>,
  ): Promise<string> {
    // Parse all <g id="block-*"> groups containing <text>
    // For each text node, compute absolute position and convert to path
    // This is a simplified version — handles common cases
    let result = svg;

    const groupRegex = /<g[^>]*transform="translate\(([^)]+)\)"[^>]*>([\s\S]*?)<\/g>/g;
    let match;

    while ((match = groupRegex.exec(svg)) !== null) {
      const [fullGroup, translateStr, groupContent] = match;
      const [tx, ty] = translateStr.split(",").map((v) => parseFloat(v.trim()));

      const textRegex = /<text([^>]*)>([\s\S]*?)<\/text>/g;
      let textMatch;
      let newGroupContent = groupContent;

      while ((textMatch = textRegex.exec(groupContent)) !== null) {
        const [fullText, textAttrs, textContent] = textMatch;

        // Extract base text attributes
        const getAttr = (attr: string, fallback: string) => {
          const m = textAttrs.match(new RegExp(`${attr}="([^"]+)"`));
          return m ? m[1] : fallback;
        };

        const baseX = parseFloat(getAttr("x", "0"));
        const baseY = parseFloat(getAttr("y", "0"));
        const baseFontSize = parseFloat(getAttr("font-size", "36"));
        const baseFontWeight = getAttr("font-weight", "400");
        const baseFill = getAttr("fill", "#000000");
        const filter = getAttr("filter", "");
        const filterAttr = filter ? ` filter="${filter}"` : "";

        // Load appropriate font
        const font = await loadFont(baseFontWeight);
        if (!font) continue; // skip if font unavailable

        // Process tspan elements
        const tspanRegex = /<tspan([^>]*)>([^<]*)<\/tspan>/g;
        let tspanMatch;
        let currentY = ty + baseY;
        let pathElements = "";

        while ((tspanMatch = tspanRegex.exec(textContent)) !== null) {
          const [, tspanAttrs, text] = tspanMatch;
          const tGetAttr = (attr: string, fallback: string) => {
            const m = tspanAttrs.match(new RegExp(`${attr}="([^"]+)"`));
            return m ? m[1] : fallback;
          };

          const tFontSize = parseFloat(tGetAttr("font-size", String(baseFontSize)));
          const tFill = tGetAttr("fill", baseFill);
          const dy = tGetAttr("dy", "0");

          // Advance Y by dy
          if (dy !== "0") {
            const dyMatch = dy.match(/([\d.]+)em/);
            if (dyMatch) {
              currentY += parseFloat(dyMatch[1]) * tFontSize;
            } else {
              currentY += parseFloat(dy);
            }
          }

          // Convert text to path
          const tspanX = parseFloat(tGetAttr("x", String(baseX)));
          try {
            const pathData = font
              .getPath(text, tx + tspanX, currentY, tFontSize)
              .toPathData(2);
            pathElements += `<path d="${pathData}" fill="${tFill}"${filterAttr}/>`;
          } catch (_e) {
            // fallback: keep as text if conversion fails
            pathElements += `<text x="${tx + tspanX}" y="${currentY}" font-size="${tFontSize}" fill="${tFill}">${text}</text>`;
          }
        }

        if (pathElements) {
          newGroupContent = newGroupContent.replace(fullText, `<g>${pathElements}</g>`);
        }
      }

      if (newGroupContent !== groupContent) {
        result = result.replace(fullGroup, fullGroup.replace(groupContent, newGroupContent));
      }
    }

    return result;
  }
```

**Step 2: Build**

```bash
cd backend && npm run build 2>&1 | tail -5
```

Expected: `Found 0 errors.`

**Step 3: Commit**

```bash
git add backend/src/services/vertex.service.ts
git commit -m "feat: add exportSVG() — embed-fonts and text-to-paths export modes"
```

---

### Task 6: Add `exportSvg` controller + route

**Files:**
- Modify: `backend/src/controllers/image.controller.ts` — add `exportSvg` function at end of file
- Modify: `backend/src/routes/image.routes.ts` — add route

**Step 1: Add controller to `image.controller.ts`** (at the end, before final closing brace if any)

```typescript
/**
 * POST /api/image/export-svg
 * Post-process SVG overlay for download.
 * Body: { svgString: string, mode: 'embed-fonts' | 'paths', includeBackground?: boolean }
 * File: background (optional, multipart)
 */
export const exportSvg = async (req: Request, res: Response) => {
  try {
    const { svgString, mode = "embed-fonts", includeBackground = false } = req.body;

    if (!svgString || typeof svgString !== "string") {
      res.status(400).json({ error: "svgString is required" });
      return;
    }
    if (mode !== "embed-fonts" && mode !== "paths") {
      res.status(400).json({ error: "mode must be 'embed-fonts' or 'paths'" });
      return;
    }

    // Optional background image
    let backgroundBuffer: Buffer | null = null;
    const bgFile = (req as any).file;
    if (includeBackground === "true" || includeBackground === true) {
      if (bgFile) {
        backgroundBuffer = fs.readFileSync(bgFile.path);
      }
    }

    const processedSvg = await vertexService.exportSVG(
      svgString,
      backgroundBuffer,
      mode as "embed-fonts" | "paths",
    );

    res.setHeader("Content-Type", "image/svg+xml");
    res.setHeader(
      "Content-Disposition",
      `attachment; filename="ad-layout-${mode}.svg"`,
    );
    res.send(processedSvg);
  } catch (err: any) {
    console.error("[exportSvg] Error:", err);
    res.status(500).json({ error: err.message || "SVG export failed" });
  }
};
```

**Step 2: Add route to `image.routes.ts`**

Add to imports at top:
```typescript
import {
  processImage,
  generateAndSeprate,
  suggestCampaign,
  renderCampaign,
  createCampaign,
  exportSvg,          // <-- add this
} from "../controllers/image.controller";
```

Add route before `export default router`:
```typescript
// SVG export endpoint
router.post("/export-svg", upload.single("background"), exportSvg);
```

**Step 3: Build**

```bash
cd backend && npm run build 2>&1 | tail -5
```

Expected: `Found 0 errors.`

**Step 4: Commit**

```bash
git add backend/src/controllers/image.controller.ts backend/src/routes/image.routes.ts
git commit -m "feat: add POST /api/image/export-svg endpoint"
```

---

### Task 7: Update `image.controller.ts` pipeline — HTML → SVG

**Files:**
- Modify: `backend/src/controllers/image.controller.ts`

This task swaps out all HTML overlay references in the `createCampaign` pipeline.

**Step 1: Rename `htmlOverlay` variable and add `parseSVGOverlayToApproxSuggestions`**

Find (line ~642):
```typescript
    // HTML/CSS overlay string — populated by suggestLayoutHTML in Pass 2
    let htmlOverlay: string = "";
```
Replace with:
```typescript
    // SVG overlay string — populated by suggestLayoutSVG in Pass 2
    let svgOverlay: string = "";
```

**Step 2: Replace `parseHTMLOverlayToApproxSuggestions` with SVG version**

Find the function at line ~711:
```typescript
  const parseHTMLOverlayToApproxSuggestions = (html: string): any[] => {
```

Replace the entire function with:
```typescript
  /**
   * Parse svg_overlay string → approximate JSON text suggestions for preview rendering.
   * Extracts translate(x,y) + font-size from <g transform> + <text> elements.
   */
  const parseSVGOverlayToApproxSuggestions = (svg: string): any[] => {
    const results: any[] = [];
    // Match <g id="block-N" transform="translate(X, Y)"> blocks
    const groupRegex = /<g[^>]*transform="translate\(\s*([\d.]+)[,\s]+([\d.]+)\s*\)"[^>]*>([\s\S]*?)<\/g>/g;
    let gm;
    while ((gm = groupRegex.exec(svg)) !== null) {
      const [, txStr, tyStr, groupContent] = gm;
      const tx = parseFloat(txStr);
      const ty = parseFloat(tyStr);
      // Find the <text> element inside
      const textMatch = groupContent.match(/<text[^>]*font-size="([\d.]+)"[^>]*>([\s\S]*?)<\/text>/);
      if (!textMatch) continue;
      const fontSize = parseFloat(textMatch[1]);
      // Extract all tspan text
      const textContent = (textMatch[2].match(/<tspan[^>]*>([^<]*)<\/tspan>/g) || [])
        .map((t: string) => t.replace(/<[^>]+>/g, ""))
        .join(" ")
        .trim();
      if (!textContent) continue;
      // Estimate bbox: assume ~0.6 * fontSize width per char, height = fontSize * 1.5
      const estimatedWidth = Math.min(textContent.length * fontSize * 0.6, 500);
      const estimatedHeight = fontSize * 1.5;
      // Convert px to normalized 0-1000 (assume 1080px canvas)
      const vbMatch = svg.match(/viewBox="0 0 (\d+) (\d+)"/);
      const cw = vbMatch ? parseInt(vbMatch[1]) : 1080;
      const ch = vbMatch ? parseInt(vbMatch[2]) : 1080;
      results.push({
        content: textContent,
        position: {
          top: Math.round((ty / ch) * 1000),
          left: Math.round((tx / cw) * 1000),
          width: Math.round((estimatedWidth / cw) * 1000),
          height: Math.round((estimatedHeight / ch) * 1000),
        },
        style: { font_size_normalized: fontSize, color_hex: "#FFFFFF" },
      });
    }
    console.log(`[SVG→Preview] Extracted ${results.length} approx text boxes from svg_overlay`);
    return results;
  };
```

**Step 3: Update call sites** — Find and replace all occurrences:

| Find | Replace |
|---|---|
| `suggestLayoutHTML(` | `suggestLayoutSVG(` |
| `refineLayoutHTML(` | `refineLayoutSVG(` |
| `htmlAnalysis.html_overlay` | `htmlAnalysis.svg_overlay` |
| `htmlOverlay = htmlAnalysis.html_overlay` | `svgOverlay = htmlAnalysis.svg_overlay` |
| `analysis.html_overlay = htmlOverlay` | `analysis.svg_overlay = svgOverlay` |
| `html_overlay: htmlOverlay` | `svg_overlay: svgOverlay` (in SSE events) |
| `parseHTMLOverlayToApproxSuggestions(htmlOverlay)` | `parseSVGOverlayToApproxSuggestions(svgOverlay)` |
| `refinedResult.html_overlay` | `refinedResult.svg_overlay` |
| `html_overlay: htmlOverlay,  // HTML/CSS overlay — main output` | `svg_overlay: svgOverlay,  // SVG overlay — main output` |
| `"AI is generating HTML/CSS layout..."` | `"AI is generating SVG layout..."` |
| `"HTML layout ready.` | `"SVG layout ready.` |
| `"HTML layout refined` | `"SVG layout refined` |
| `"HTML mode: parse` | `"SVG mode: parse` |
| `let htmlOverlay: string = ""` | `let svgOverlay: string = ""` |

**Step 4: Build and check for remaining html_overlay references**

```bash
cd backend && npm run build 2>&1 | tail -10
grep -n "html_overlay\|htmlOverlay\|suggestLayoutHTML\|refineLayoutHTML\|parseHTMLOverlay" src/controllers/image.controller.ts
```

Expected: build passes, grep shows only comments (if any) — no active references.

**Step 5: Commit**

```bash
git add backend/src/controllers/image.controller.ts
git commit -m "refactor: swap HTML overlay for SVG overlay throughout createCampaign pipeline"
```

---

### Task 8: Update `AIRefinementPreview.vue` — render SVG, add export UI

**Files:**
- Modify: `frontend/src/components/AIRefinementPreview.vue`

**Step 1: Rename refs and update DOMPurify**

Find (line ~254):
```typescript
// HTML overlay mode (Task B) — AI returns HTML/CSS string instead of JSON text layers
const liveHtmlOverlay = ref<string>("");
const sanitizedHtmlOverlay = computed(() => {
  if (!liveHtmlOverlay.value) return "";
  // Allow only safe HTML tags + inline styles (no scripts, no iframes)
  return DOMPurify.sanitize(liveHtmlOverlay.value, {
    ALLOWED_TAGS: ["div", "span", "p", "br"],
    ALLOWED_ATTR: ["style", "class"],
  });
});
```

Replace with:
```typescript
// SVG overlay mode — AI returns SVG string instead of HTML/CSS
const liveSvgOverlay = ref<string>("");
const sanitizedSvgOverlay = computed(() => {
  if (!liveSvgOverlay.value) return "";
  return DOMPurify.sanitize(liveSvgOverlay.value, {
    USE_PROFILES: { svg: true, svgFilters: true },
    ADD_TAGS: ["svg", "g", "text", "tspan", "rect", "defs", "filter",
               "feDropShadow", "image", "style"],
    ADD_ATTR: ["viewBox", "xmlns", "transform", "font-family", "font-size",
               "font-weight", "fill", "stroke", "stroke-width", "paint-order",
               "filter", "dy", "dx", "x", "y", "rx", "ry", "width", "height",
               "flood-color", "flood-opacity", "stdDeviation", "in",
               "preserveAspectRatio", "id", "letter-spacing"],
  });
});
```

**Step 2: Add export state variables** (after `sanitizedSvgOverlay`):

```typescript
// SVG export state
const exportMode = ref<"embed-fonts" | "paths">("embed-fonts");
const isExporting = ref(false);
const showExportMenu = ref(false);
```

**Step 3: Add export function** (after `sanitizedSvgOverlay` and export state):

```typescript
const exportSVGFile = async (includeBackground: boolean) => {
  if (!liveSvgOverlay.value) return;
  isExporting.value = true;
  showExportMenu.value = false;
  try {
    const res = await fetch("http://localhost:5001/api/image/export-svg", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        svgString: liveSvgOverlay.value,
        mode: exportMode.value,
        includeBackground: false, // background embed handled separately for now
      }),
    });
    if (!res.ok) throw new Error(await res.text());
    const blob = await res.blob();
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `ad-layout-${exportMode.value}.svg`;
    a.click();
    URL.revokeObjectURL(url);
  } catch (err) {
    console.error("[SVG Export]", err);
  } finally {
    isExporting.value = false;
  }
};
```

**Step 4: Update template** — find the HTML overlay div:

```html
<!-- HTML overlay mode (Task B) — AI-generated CSS positioned text -->
<div
  v-if="sanitizedHtmlOverlay"
  v-html="sanitizedHtmlOverlay"
  class="html-overlay-layer"
/>
```

Replace with:
```html
<!-- SVG overlay — AI-generated SVG positioned text -->
<div
  v-if="sanitizedSvgOverlay"
  v-html="sanitizedSvgOverlay"
  class="svg-overlay-layer"
/>
```

**Step 5: Update the conditional in template** — find:
```html
<template v-if="currentPreviewUrl && !sanitizedHtmlOverlay">
```
Replace with:
```html
<template v-if="currentPreviewUrl && !sanitizedSvgOverlay">
```

**Step 6: Add export button in template** — find a good place near the bottom of the control panel (look for the existing buttons area) and add:

```html
<!-- SVG Export -->
<div v-if="liveSvgOverlay" class="export-svg-panel">
  <div class="export-mode-row">
    <label>Export mode:</label>
    <select v-model="exportMode">
      <option value="embed-fonts">Embed Fonts (editable text)</option>
      <option value="paths">Convert to Paths (max fidelity)</option>
    </select>
  </div>
  <button
    class="btn btn-export"
    :disabled="isExporting"
    @click="exportSVGFile(false)"
  >
    {{ isExporting ? "Exporting..." : "Export SVG" }}
  </button>
</div>
```

**Step 7: Update the CSS class** — find `.html-overlay-layer` (line ~675):
```css
.html-overlay-layer {
  position: absolute;
  inset: 0;
  ...
}
```
Rename to:
```css
.svg-overlay-layer {
  position: absolute;
  inset: 0;
  pointer-events: none;
  overflow: hidden;
}
```

**Step 8: Update SSE event handlers** — find all references to `liveHtmlOverlay` and `html_overlay` in the script section and update:

| Find | Replace |
|---|---|
| `liveHtmlOverlay.value = ""` | `liveSvgOverlay.value = ""` |
| `liveHtmlOverlay.value = data.data.html_overlay` | `liveSvgOverlay.value = data.data.svg_overlay` |
| `data.data?.html_overlay` | `data.data?.svg_overlay` |
| `liveHtmlOverlay.value = data.html_overlay` | `liveSvgOverlay.value = data.svg_overlay` |
| `data.html_overlay` (in conditionals) | `data.svg_overlay` |
| `liveHtmlOverlay.value = ""` in fallback | `liveSvgOverlay.value = ""` |

**Step 9: Add export panel styles**

```css
.export-svg-panel {
  display: flex;
  flex-direction: column;
  gap: 8px;
  margin-top: 12px;
  padding: 12px;
  background: rgba(255,255,255,0.05);
  border-radius: 8px;
}
.export-mode-row {
  display: flex;
  align-items: center;
  gap: 8px;
}
.export-mode-row select {
  flex: 1;
  padding: 4px 8px;
  border-radius: 4px;
  background: #1a1a2e;
  color: #fff;
  border: 1px solid rgba(255,255,255,0.2);
}
.btn-export {
  background: #6c63ff;
  color: white;
  border: none;
  padding: 8px 16px;
  border-radius: 6px;
  cursor: pointer;
  font-weight: 600;
}
.btn-export:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}
```

**Step 10: Build frontend**

```bash
cd frontend && npm run build 2>&1 | tail -10
```

Expected: no errors.

**Step 11: Commit**

```bash
git add frontend/src/components/AIRefinementPreview.vue
git commit -m "feat: update AIRefinementPreview to render SVG overlay and add SVG export UI"
```

---

### Task 9: End-to-end verification

**Step 1: Start backend and frontend**

```bash
# Terminal 1
cd backend && npm run dev

# Terminal 2
cd frontend && npm run dev
```

**Step 2: Test SVG generation**
1. Open `http://localhost:5173`
2. Go to Campaign tab
3. Upload a reference image, enter a brief, click Generate
4. Watch SSE stream — should see `[SVG] Overlay generated` in backend logs
5. Frontend should render SVG overlay on top of the preview image

**Step 3: Test export**
1. After generation completes, click "Export SVG" with "Embed Fonts" mode
2. Verify `.svg` file downloads
3. Open in Illustrator or Figma — verify text is editable and in correct position
4. Repeat with "Convert to Paths" mode

**Step 4: Check for regressions**
1. Existing Layer Editor (Tab 3) still works
2. Background generation (Tab 1) still works
3. No console errors in browser

**Step 5: Commit if any final fixes needed, then tag**

```bash
git add -A
git commit -m "fix: post-integration fixes for SVG overlay system"
```

---

## Notes

- **`@fontsource/kanit`** ships `.woff2` files. The `embed-fonts` mode uses these directly (all modern browsers + Illustrator/Figma support woff2). The `paths` mode looks for `.ttf` — if unavailable it falls back gracefully (text stays as `<text>` elements).
- **Thai text in SVG**: works correctly as long as `font-family="Kanit, sans-serif"` is set and the font is available (embedded or system). No special handling needed — SVG is Unicode-native.
- **DOMPurify SVG profile**: `USE_PROFILES: { svg: true, svgFilters: true }` allows all standard SVG elements including `<filter>` and `<feDropShadow>`. The extra `ADD_ATTR` ensures none of our key attributes get stripped.
- **Backward compat**: The old `html_overlay` key in SSE events is renamed to `svg_overlay`. If any other component reads `html_overlay` from SSE, it will silently get empty string — check `LayerEditor.vue` and `CampaignLayout.vue` for any such reads.
