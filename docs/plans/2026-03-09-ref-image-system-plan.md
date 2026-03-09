# Reference Image System Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Let the AI see 3 similar reference ads when generating layouts, producing creative context-aware compositions instead of rigid grid splits.

**Architecture:** One-time indexing script describes each reference image via Gemini, then embeds the description with `text-embedding-004`. At runtime, the user's BG image is described + embedded, cosine similarity finds top-3 matches, and those 3 reference images are sent inline to the flex layout prompt. The prompt is also improved to encourage background-aware, whitespace-friendly layouts.

**Tech Stack:** Gemini `text-embedding-004` for embeddings, Gemini vision for image description, Sharp for image processing, existing GoogleGenAI client.

**Note:** Gemini embedding API only supports text — NOT images. So we describe images first, then embed the descriptions.

---

### Task 1: Create Reference Image Indexing Script

**Files:**
- Create: `backend/scripts/indexRefImages.ts`

**Step 1: Implement the indexing script**

This script reads all images from `backend/assets/ref_images/`, asks Gemini to describe each one (layout, colors, composition, ad style), then embeds each description with `text-embedding-004`, and saves the result.

```typescript
import fs from "fs";
import path from "path";
import { GoogleGenAI } from "@google/genai";
import dotenv from "dotenv";

dotenv.config({ path: path.join(__dirname, "../.env") });

const REF_DIR = path.join(__dirname, "../assets/ref_images");
const INDEX_FILE = path.join(REF_DIR, "embeddings.json");

// Reuse the same credential-building logic from vertex.service.ts
function buildClient(): GoogleGenAI {
  const projectId = process.env.GOOGLE_SERVICE_ACCOUNT_PROJECT_ID;
  const location = process.env.GOOGLE_CLOUD_LOCATION || "global";
  const credentials = {
    type: process.env.GOOGLE_SERVICE_ACCOUNT_TYPE || "service_account",
    project_id: projectId,
    private_key_id: process.env.GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY_ID,
    private_key: (process.env.GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY || "").replace(/\\n/g, "\n"),
    client_email: process.env.GOOGLE_SERVICE_ACCOUNT_CLIENT_EMAIL,
    client_id: process.env.GOOGLE_SERVICE_ACCOUNT_CLIENT_ID,
  };
  return new GoogleGenAI({
    vertexai: true,
    project: projectId!,
    location,
    googleAuthOptions: { credentials },
    httpOptions: { timeout: 120000 },
  } as any);
}

interface RefEntry {
  filename: string;
  description: string;
  embedding: number[];
}

async function describeImage(client: GoogleGenAI, imgBuffer: Buffer, mime: string): Promise<string> {
  const resp = await client.models.generateContent({
    model: "gemini-2.5-flash",
    contents: [{
      role: "user",
      parts: [
        { inlineData: { mimeType: mime, data: imgBuffer.toString("base64") } },
        { text: `Describe this advertisement image for similarity matching. Include:
1. Layout composition (where is text, where are images/people, whitespace areas)
2. Color palette (dominant colors, accent colors)
3. Visual style (modern, traditional, playful, premium, etc.)
4. Type of product/service being advertised
5. Overall mood/vibe
Be concise — 2-3 sentences max.` },
      ],
    }],
    config: { temperature: 0.3 },
  });
  return resp.text?.trim() || "";
}

async function embedText(client: GoogleGenAI, text: string): Promise<number[]> {
  const resp = await client.models.embedContent({
    model: "text-embedding-004",
    contents: text,
    config: { taskType: "RETRIEVAL_DOCUMENT" },
  });
  return resp.embeddings?.[0]?.values || [];
}

async function main() {
  const client = buildClient();
  const files = fs.readdirSync(REF_DIR).filter(f =>
    /\.(jpg|jpeg|png|webp)$/i.test(f)
  );

  console.log(`Found ${files.length} reference images in ${REF_DIR}`);

  const entries: RefEntry[] = [];
  // Load existing index for incremental updates
  let existing: RefEntry[] = [];
  if (fs.existsSync(INDEX_FILE)) {
    existing = JSON.parse(fs.readFileSync(INDEX_FILE, "utf-8"));
  }
  const existingMap = new Map(existing.map(e => [e.filename, e]));

  for (let i = 0; i < files.length; i++) {
    const filename = files[i];

    // Skip if already indexed
    if (existingMap.has(filename)) {
      console.log(`[${i + 1}/${files.length}] SKIP (already indexed): ${filename}`);
      entries.push(existingMap.get(filename)!);
      continue;
    }

    console.log(`[${i + 1}/${files.length}] Processing: ${filename}`);
    const imgPath = path.join(REF_DIR, filename);
    const imgBuffer = fs.readFileSync(imgPath);
    const ext = path.extname(filename).toLowerCase();
    const mime = ext === ".png" ? "image/png" : ext === ".webp" ? "image/webp" : "image/jpeg";

    try {
      const description = await describeImage(client, imgBuffer, mime);
      console.log(`  Description: ${description.substring(0, 100)}...`);

      const embedding = await embedText(client, description);
      console.log(`  Embedding: ${embedding.length} dimensions`);

      entries.push({ filename, description, embedding });

      // Rate limiting — avoid 429
      await new Promise(r => setTimeout(r, 1000));
    } catch (err: any) {
      console.error(`  ERROR: ${err.message}`);
      // On rate limit, wait longer and retry
      if (err.message?.includes("429")) {
        console.log("  Rate limited, waiting 30s...");
        await new Promise(r => setTimeout(r, 30000));
        i--; // retry this file
      }
    }
  }

  fs.writeFileSync(INDEX_FILE, JSON.stringify(entries, null, 2));
  console.log(`\nDone! Indexed ${entries.length} images → ${INDEX_FILE}`);
}

main().catch(console.error);
```

**Step 2: Run type-check**

Run: `cd /Users/chulin/gen-image-layer-separator/backend && npx tsc --noEmit`
Expected: No errors (the script uses separate imports, not the service class)

**Step 3: Commit**

```bash
git add backend/scripts/indexRefImages.ts
git commit -m "feat: add reference image indexing script (Gemini describe + embed)"
```

---

### Task 2: Create Reference Image Search Utility

**Files:**
- Create: `backend/src/utils/refImageSearch.ts`

**Step 1: Implement the search utility**

```typescript
import fs from "fs";
import path from "path";

const REF_DIR = path.join(__dirname, "../../assets/ref_images");
const INDEX_FILE = path.join(REF_DIR, "embeddings.json");

interface RefEntry {
  filename: string;
  description: string;
  embedding: number[];
}

let cachedIndex: RefEntry[] | null = null;

function loadIndex(): RefEntry[] {
  if (cachedIndex) return cachedIndex;
  if (!fs.existsSync(INDEX_FILE)) return [];
  cachedIndex = JSON.parse(fs.readFileSync(INDEX_FILE, "utf-8"));
  return cachedIndex!;
}

function cosineSimilarity(a: number[], b: number[]): number {
  if (a.length !== b.length || a.length === 0) return 0;
  let dot = 0, magA = 0, magB = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    magA += a[i] * a[i];
    magB += b[i] * b[i];
  }
  const denom = Math.sqrt(magA) * Math.sqrt(magB);
  return denom === 0 ? 0 : dot / denom;
}

/**
 * Find top-K reference images most similar to the query embedding.
 * Returns array of { filename, description, score } sorted by similarity.
 */
export function findSimilarRefs(
  queryEmbedding: number[],
  topK: number = 3,
): Array<{ filename: string; description: string; score: number; filepath: string }> {
  const index = loadIndex();
  if (index.length === 0) return [];

  const scored = index.map(entry => ({
    filename: entry.filename,
    description: entry.description,
    score: cosineSimilarity(queryEmbedding, entry.embedding),
    filepath: path.join(REF_DIR, entry.filename),
  }));

  scored.sort((a, b) => b.score - a.score);
  return scored.slice(0, topK);
}

/** Reset cache (for testing or when index is updated) */
export function clearRefImageCache(): void {
  cachedIndex = null;
}
```

**Step 2: Run type-check**

Run: `cd /Users/chulin/gen-image-layer-separator/backend && npx tsc --noEmit`
Expected: No errors

**Step 3: Commit**

```bash
git add backend/src/utils/refImageSearch.ts
git commit -m "feat: add refImageSearch utility — cosine similarity over embeddings index"
```

---

### Task 3: Add `describeAndEmbed()` Method to AIService

**Files:**
- Modify: `backend/src/services/vertex.service.ts`

**Step 1: Add method to AIService class**

Add a method that describes an image and embeds the description. This is used at runtime to embed the user's BG image for similarity search.

```typescript
/**
 * Describe an image briefly, then embed the description for similarity search.
 * Returns { description, embedding }.
 */
async describeAndEmbed(
  imageBuffer: Buffer,
  mimeType: string,
): Promise<{ description: string; embedding: number[] }> {
  // Resize for efficiency
  let processingBuffer = imageBuffer;
  let processingMime = mimeType;
  try {
    const meta = await sharp(imageBuffer).metadata();
    const origW = meta.width || 1024;
    const targetW = Math.min(800, origW);
    if (targetW < origW) {
      processingBuffer = await sharp(imageBuffer)
        .resize({ width: targetW })
        .jpeg({ quality: 80 })
        .toBuffer();
      processingMime = "image/jpeg";
    }
  } catch {}

  const model = process.env.GEMINI_TEXT_ENDPOINT || "gemini-2.5-flash";

  // Describe
  const descResp = await this.client.models.generateContent({
    model,
    contents: [{
      role: "user",
      parts: [
        { inlineData: { mimeType: processingMime, data: processingBuffer.toString("base64") } },
        { text: "Describe this image for ad-layout similarity matching in 2-3 sentences. Cover: layout areas (open space, busy areas), dominant colors, visual style, mood." },
      ],
    }],
    config: { temperature: 0.3 },
  });
  const description = descResp.text?.trim() || "Generic advertisement background";

  // Embed
  const embedResp = await this.client.models.embedContent({
    model: "text-embedding-004",
    contents: description,
    config: { taskType: "RETRIEVAL_QUERY" as any },
  });
  const embedding = (embedResp as any).embeddings?.[0]?.values || [];

  return { description, embedding };
}
```

**Step 2: Run type-check**

Run: `cd /Users/chulin/gen-image-layer-separator/backend && npx tsc --noEmit`
Expected: No errors

**Step 3: Commit**

```bash
git add backend/src/services/vertex.service.ts
git commit -m "feat: add describeAndEmbed() — describe image + embed for similarity search"
```

---

### Task 4: Wire Reference Images into `suggestFlexLayout()`

**Files:**
- Modify: `backend/src/services/vertex.service.ts` (the `suggestFlexLayout` method)

**Step 1: Accept optional reference images parameter**

Add an optional `refImages` parameter to `suggestFlexLayout`:

```typescript
async suggestFlexLayout(
  imageBuffer: Buffer,
  mimeType: string,
  targetText: string,
  componentLabels: string[],
  canvasSize: { w: number; h: number },
  refImages?: Buffer[],  // ← NEW: up to 3 reference ad images
): Promise<{ flexTree: FlexNode; campaign_vibe: string; background_description: string }>
```

**Step 2: Add reference images to the AI prompt parts**

In the `contents` array, before the text prompt, add each reference image as an inline part:

```typescript
const parts: any[] = [];

// Reference images first (if any)
if (refImages && refImages.length > 0) {
  for (const ref of refImages) {
    parts.push({
      inlineData: { mimeType: "image/jpeg", data: ref.toString("base64") },
    });
  }
}

// Background image
parts.push({
  inlineData: { mimeType: processingMime, data: processingBuffer.toString("base64") },
});

// Text prompt
parts.push({ text: prompt });
```

**Step 3: Update the prompt text**

Add at the beginning of the prompt, before the layout rules:

```
REFERENCE ADVERTISEMENTS:
The first ${refImages?.length || 0} images are examples of well-designed advertisement layouts.
Study their composition, spacing, visual hierarchy, and use of whitespace.
Use them as INSPIRATION — do not copy them exactly, but learn from their design principles.

THE LAST IMAGE is the actual background for this campaign. Analyze it carefully:
- Where are the open/calm areas? (good for text)
- Where are the busy/detailed areas? (avoid placing text there)
- What are the dominant colors? (choose contrasting text colors)
- Layout does NOT need to fill the entire canvas — whitespace is valuable design space.
```

**Step 4: Run type-check**

Run: `cd /Users/chulin/gen-image-layer-separator/backend && npx tsc --noEmit`
Expected: No errors

**Step 5: Commit**

```bash
git add backend/src/services/vertex.service.ts
git commit -m "feat: wire reference images into suggestFlexLayout prompt"
```

---

### Task 5: Wire Into `createCampaign` Controller

**Files:**
- Modify: `backend/src/controllers/image.controller.ts`

**Step 1: Add imports and reference image lookup**

At the top of the file add:
```typescript
import { findSimilarRefs } from '../utils/refImageSearch';
```

In `createCampaign()`, before the `suggestFlexLayout` call (around line 1574), add:

```typescript
// Find similar reference ads
let refImageBuffers: Buffer[] = [];
try {
  const { embedding } = await vertexService.describeAndEmbed(imageBuffer, mimeType);
  const refs = findSimilarRefs(embedding, 3);
  if (refs.length > 0) {
    console.log(`[Pass2] Found ${refs.length} reference ads: ${refs.map(r => `${r.filename} (${r.score.toFixed(3)})`).join(', ')}`);
    refImageBuffers = refs.map(r => fs.readFileSync(r.filepath));
    sendSSE("debug", {
      step: "ref_images",
      message: `Found ${refs.length} similar reference ads`,
      refs: refs.map(r => ({ filename: r.filename, score: r.score.toFixed(3), description: r.description })),
    });
  }
} catch (err: any) {
  console.warn(`[Pass2] Reference image search failed: ${err.message}`);
}
```

**Step 2: Pass reference images to suggestFlexLayout**

Change the `suggestFlexLayout` call to include `refImageBuffers`:

```typescript
const flexResult = await vertexService.suggestFlexLayout(
  imageBuffer,
  mimeType,
  targetText,
  componentLabels,
  { w: canvasW, h: canvasH },
  refImageBuffers,  // ← NEW
);
```

**Step 3: Run type-check**

Run: `cd /Users/chulin/gen-image-layer-separator/backend && npx tsc --noEmit`
Expected: No errors

**Step 4: Commit**

```bash
git add backend/src/controllers/image.controller.ts
git commit -m "feat: lookup similar reference ads and pass to flex layout AI"
```

---

### Task 6: Improve Prompt for Background-Aware Layout

**Files:**
- Modify: `backend/src/services/vertex.service.ts` (the layout rules section of `suggestFlexLayout`)

**Step 1: Replace the CREATIVE LAYOUT GUIDANCE section**

Find the current rules in the `suggestFlexLayout` prompt and update:

```
BACKGROUND-AWARE DESIGN:
6. FIRST analyze the background image — find open/calm areas vs busy/detailed areas.
7. Place text in CALM areas (solid colors, gradients, sky, plain surfaces) where it's most readable.
8. Avoid placing text over busy areas (buildings, faces, detailed textures) unless using strong strokeColor.
9. Layout does NOT need to fill the entire canvas. Leave empty areas where the background is beautiful.
10. Vary proportions creatively: 65/35, 70/30, or asymmetric. NEVER do a boring 50/50 split.
11. Sibling percentages do NOT need to sum to 100%. Unused space = whitespace = good design.
12. Use padding (20-60) on ROOT and containers. Use gap (16-40) between siblings.
13. Think like a magazine designer: hero element large, supporting text compact, background breathes.
14. If reference images are provided, draw INSPIRATION from their composition and spacing style.
```

**Step 2: Run type-check**

Run: `cd /Users/chulin/gen-image-layer-separator/backend && npx tsc --noEmit`
Expected: No errors

**Step 3: Commit**

```bash
git add backend/src/services/vertex.service.ts
git commit -m "feat: improve layout prompt for background-aware whitespace-friendly design"
```

---

### Task 7: End-to-End Test

**Step 1: Add reference images**

Place at least 3-5 sample reference ad images in `backend/assets/ref_images/`.

**Step 2: Run indexing script**

Run: `cd /Users/chulin/gen-image-layer-separator/backend && npx ts-node scripts/indexRefImages.ts`
Expected: Each image described + embedded, `embeddings.json` created.

**Step 3: Start backend + frontend**

Run: `cd /Users/chulin/gen-image-layer-separator/backend && npm run dev`
Run: `cd /Users/chulin/gen-image-layer-separator/frontend && npm run dev`

**Step 4: Create a campaign and verify**

1. Upload an image with components
2. Check backend console for:
   - `[Pass2] Found 3 reference ads: filename.jpg (0.85), ...`
   - `[Pass2] Flex tree JSON:` — should show layout with padding/gap
3. Check preview — layout should be more creative with whitespace
4. Toggle BBOX ON — boxes should not fill entire canvas

**Step 5: Commit any adjustments**

```bash
git add -A
git commit -m "fix: adjust ref image system based on e2e test"
```
