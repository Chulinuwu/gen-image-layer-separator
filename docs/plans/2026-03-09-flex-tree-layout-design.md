# Flex-Tree Layout Engine Design

**Goal:** Replace coordinate-based AI layout with flex-tree system — AI thinks in layout terms, code computes geometry, output is a single editable SVG.

## Architecture

```
AI (Gemini)          →  Flex Tree JSON
Flex Tree JSON       →  Layout Engine (backend)  →  Bounding Boxes
Bounding Boxes       →  SVG Builder (backend)    →  Single SVG (BG + components + text)
Single SVG           →  Frontend (view / edit / AI refine / export)
```

## AI Output Format (Flex Tree JSON)

AI outputs layout using CSS flex-like concepts. No coordinates — just direction, sizing %, and content assignment.

```json
{
  "direction": "row",
  "children": [
    {
      "id": "text-column",
      "width": "55%",
      "direction": "column",
      "children": [
        { "id": "promo", "type": "text", "text": "2 ต่อ", "height": "40%", "style": { "fontSize": "large", "fontWeight": "900", "color": "#FFD700" } },
        { "id": "headline", "type": "text", "text": "ชวนลูกค้า...", "height": "20%", "style": { "fontSize": "medium", "color": "#FFFFFF" } },
        { "id": "offer", "type": "text", "text": "รับฟรี*", "height": "15%", "style": { "fontSize": "medium", "color": "#FF0000" } },
        { "id": "fineprint", "type": "text", "text": "เงื่อนไข...", "height": "10%", "style": { "fontSize": "small", "color": "#CCCCCC" } }
      ]
    },
    {
      "id": "component-column",
      "width": "45%",
      "direction": "column",
      "children": [
        { "id": "woman", "type": "component", "label": "Woman holding phone", "height": "70%" },
        { "id": "mascot", "type": "component", "label": "Thai boy mascot", "height": "30%" }
      ]
    }
  ]
}
```

## Layout Engine (`flexLayout.ts` — new file)

- Input: flex tree JSON + canvas size (e.g. 1024x1024)
- Recursive computation: each node gets `{x, y, w, h}` from parent bounds + direction + % sizing
- Gap/padding configurable per node
- Output: flat array of `{ id, type, x, y, w, h, style?, label? }`
- No overlap by design — every element lives in the flow

## SVG Builder (modify `svgBuilder.ts`)

- Input: bounding boxes + canvas size + image URLs
- Builds single SVG containing:
  - `<image>` for BG (full canvas)
  - `<image>` for component die-cuts (positioned by bounding box)
  - `<text>` for text blocks (measured with opentype.js, auto-fit within box)
- Every element gets `id` + `data-role` attributes for frontend editing
- `viewBox="0 0 1024 1024"`

## Frontend

- **View**: display SVG via `v-html` (same as current)
- **Edit**: click element → select by `id` → drag/move/resize/edit text
- **AI Refine**: send current flex tree + critique back to AI → AI outputs new flex tree
- **Export**: download SVG file directly (complete composition)
- Preview + Editor use the SAME SVG → no more sync issues

## What Gets Removed

- `planLayoutStrategy()` coordinate output → replaced by flex tree
- `computeSafeZones()` → unnecessary (flex can't overlap)
- `normalizedToPixelsClamped()` → layout engine handles this
- Separate component overlay layer in frontend → lives in SVG now
- `interaction_zone` → stays disabled
