# SVG Layout System — Design Doc
**Date:** 2026-03-04
**Status:** Approved

---

## Problem

The current system has the LLM generate HTML/CSS (`position:absolute` divs) for text placement. This produces high-quality layouts but cannot be exported to design tools like Illustrator, Figma, or Photoshop.

**Key history:** Switching from JSON coordinates → HTML/CSS dramatically improved LLM layout quality. This design must preserve that quality while adding a proper export path.

---

## Goal

Replace HTML/CSS layout generation with **native SVG** that:
1. LLM generates with a "box-model" mental model (same cognitive ease as HTML/CSS)
2. Exports as a valid, layered SVG file openable in Illustrator, Figma, and Photoshop
3. Supports two export modes: **embed fonts** (editable text) or **convert to paths** (perfect fidelity)
4. Works as both a transparent overlay SVG and a full-composition SVG (with background embedded)

---

## SVG Structure

The LLM generates an SVG string inside `<SVG_OVERLAY>` delimited tags (same `<META>/<SVG_OVERLAY>` pattern as current `<META>/<HTML_OVERLAY>`).

```svg
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1080 1080" width="1080" height="1080">
  <defs>
    <!-- Reusable shadow filters -->
    <filter id="f0">
      <feDropShadow dx="2" dy="2" stdDeviation="4" flood-color="#000" flood-opacity="0.75"/>
    </filter>
    <!-- Font embed (embed-fonts mode only) -->
    <style>@font-face { font-family: 'Prompt'; src: url('data:font/ttf;base64,...') }</style>
  </defs>

  <!-- LAYER 1: Background image (full-composition mode only) -->
  <image id="background" href="data:image/jpeg;base64,..." x="0" y="0" width="1080" height="1080"/>

  <!-- LAYER 2: Components (die-cuts, mascots) — JSON-driven, placed by backend -->
  <g id="components">
    <image id="comp-0" href="..." x="200" y="300" width="400" height="500"/>
  </g>

  <!-- LAYER 3: Text overlay — LLM-generated -->
  <g id="text-overlay">
    <g id="block-0" transform="translate(54, 108)">
      <!-- Optional contrast shield (background rect) -->
      <rect x="0" y="0" width="480" height="90" rx="8" fill="rgba(0,0,0,0.55)"/>
      <!-- Text with padding offset inside the group -->
      <text x="20" y="44"
            font-family="Prompt, Noto Sans Thai, sans-serif"
            font-size="36" font-weight="700" fill="#FFFFFF"
            filter="url(#f0)">
        <tspan x="20" dy="0">ลด 50% ทุกเมนู</tspan>
        <tspan x="20" dy="1.35em" font-size="22" font-weight="400">วันนี้ถึง 31 มี.ค. เท่านั้น</tspan>
      </text>
    </g>
  </g>
</svg>
```

### LLM Mental Model Mapping

| HTML/CSS concept | SVG equivalent |
|---|---|
| `position:absolute; left:50px; top:100px` | `<g transform="translate(50,100)">` |
| `background: rgba(0,0,0,0.5); border-radius:8px` | `<rect fill="rgba(0,0,0,0.5)" rx="8"/>` |
| `padding: 20px` | offset `x="20"` on `<text>` inside `<g>` |
| `font-size: 36px; font-weight: 700` | attributes on `<text>` |
| `line-height: 1.35` | `<tspan dy="1.35em">` |
| `text-shadow` | `<filter id="fx"><feDropShadow/></filter>` |
| `-webkit-text-stroke` | `stroke="black" stroke-width="2"` on `<text>` |

---

## Backend Changes

### `vertex.service.ts`
- **Replace** `suggestLayoutHTML()` → `suggestLayoutSVG()` — new prompt uses SVG box-model mental model, returns `<META>...<SVG_OVERLAY>...`
- **Replace** `refineLayoutHTML()` → `refineLayoutSVG()` — same pattern
- **Replace** `parseHTMLResponse()` → `parseSVGResponse()` — same delimiter logic, looks for `<SVG_OVERLAY>` tag
- **Add** `exportSVG(svgString, mode: 'embed-fonts' | 'paths'): Promise<string>` — post-processes SVG for export
- **Add** font files to `backend/assets/fonts/` (Prompt TTF, Noto Sans Thai TTF)

### `image.controller.ts`
- Update pipeline calls: `suggestLayoutHTML` → `suggestLayoutSVG`, `refineLayoutHTML` → `refineLayoutSVG`
- **Add** endpoint `POST /api/image/export-svg` — accepts `{ svgString, mode, includeBackground }`, returns processed SVG file

---

## Frontend Changes

### `AIRefinementPreview.vue`
- Replace `<div v-html="sanitizedHtmlOverlay">` with `<div v-html="sanitizedSvgOverlay">`
- Update DOMPurify allowlist to include SVG tags: `svg, g, text, tspan, rect, image, defs, filter, feDropShadow, style`
- Rename `liveHtmlOverlay` → `liveSvgOverlay`
- Add **Export SVG** button with dropdown: "Embed Fonts" / "Convert to Paths" → calls `/api/image/export-svg`

### `LayerEditor.vue`
- Add **Export SVG** button in toolbar (same dropdown)

---

## Export Modes

| Mode | Use case | Text editable? | Font required on target? |
|---|---|---|---|
| `embed-fonts` | Illustrator, Figma editing | Yes | No (embedded) |
| `paths` | Photoshop, maximum fidelity | No | No |

### Full-composition vs Overlay
- **Overlay mode** — SVG contains only `<g id="text-overlay">` + `<g id="components">`, transparent background. Use with background as a separate layer in Illustrator/Figma.
- **Full-composition mode** — adds `<image id="background" ...>` with base64-encoded background. Single self-contained file.

---

## Tool Compatibility

| Tool | SVG support | Notes |
|---|---|---|
| **Illustrator** | ✅ Full | `<g>` → groups, `<text>` editable, filters render |
| **Figma** | ✅ Full | `<g>` → frames, `<text>` editable, import via drag-drop |
| **Photoshop** | ⚠️ Rasterized | Opens as flat image; use via Smart Object for vector; or use overlay mode + import separately |

---

## Out of Scope (this iteration)
- PNG layer-by-layer export for Photoshop (separate task)
- SVG animation
- Variable fonts
