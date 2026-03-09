# Reference Image System + Smart Layout Design

**Goal:** Let the AI see 3 similar reference ads when generating layouts, so it produces creative, context-aware compositions instead of rigid grid splits.

## Architecture

```
Indexing (one-time):
  [500 ref images] → Gemini embedding-001 → embeddings.json

Runtime:
  [User's BG image] → Gemini embedding-001 → cosine similarity with index → Top-3 refs
  Top-3 refs + BG + campaign text → suggestFlexLayout() prompt → Flex Tree JSON
```

## Part 1: Reference Image Indexing & Retrieval

### Index Script (`scripts/indexRefImages.ts`)
- Reads all images from `backend/assets/ref_images/`
- Embeds each with Gemini `embedding-001` (image embedding)
- Saves `backend/assets/ref_images/embeddings.json`: `[{ filename, embedding: number[] }]`
- Run manually: `npx ts-node scripts/indexRefImages.ts`
- Re-run when new images are added

### Query Utility (`backend/src/utils/refImageSearch.ts`)
- `findSimilarRefs(imageBuffer: Buffer, topK: number): Promise<string[]>`
- Embeds the input image via Gemini `embedding-001`
- Loads `embeddings.json`, computes cosine similarity, returns top-K filenames
- Returns absolute paths to the image files

### Integration
- Called in `createCampaign()` controller before `suggestFlexLayout()`
- Top-3 reference images passed as additional inline images in the AI prompt

## Part 2: Smarter Layout Prompt

### Prompt Changes in `suggestFlexLayout()`
- Add 3 reference images as inline image parts with instruction: "These are examples of well-designed advertisement layouts. Use them as inspiration for composition, spacing, and visual hierarchy."
- Add background analysis instruction: "First, analyze the background image — identify open areas, dominant colors, busy vs. calm zones. Place text in the most readable areas."
- Reinforce: "Layout does NOT need to fill the entire canvas. Whitespace is a design element. Leave breathing room."
- Remove rigid column split guidance

### Fallback (noted for future)
If prompt-only approach doesn't produce good enough results, add a separate background analysis step (Option B) that pre-computes safe zones and color palette before the flex tree generation.

## Tech Stack
- Gemini `embedding-001` via existing GoogleGenAI client
- No new dependencies needed
- Index stored as flat JSON file (500 entries ~2MB)
