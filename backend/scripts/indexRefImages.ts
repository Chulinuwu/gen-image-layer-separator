/**
 * indexRefImages.ts
 *
 * Indexes reference advertisement images for similarity search.
 * For each image: describe via Gemini vision → embed description via text-embedding-004.
 * Saves results to backend/assets/ref_images/embeddings.json
 *
 * Usage:
 *   cd backend && npx ts-node scripts/indexRefImages.ts
 */

import "dotenv/config";
import * as fs from "fs";
import * as path from "path";
import { GoogleGenAI } from "@google/genai";

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------

const REF_DIR = path.resolve(__dirname, "..", "assets", "ref_images");
const INDEX_PATH = path.join(REF_DIR, "embeddings.json");
const IMAGE_EXTENSIONS = new Set([".jpg", ".jpeg", ".png", ".webp"]);

const VISION_MODEL =
  process.env.GEMINI_TEXT_ENDPOINT || "gemini-2.5-flash";
const EMBEDDING_MODEL = "gemini-embedding-001";

const DESCRIBE_PROMPT =
  "Describe this advertisement image for similarity matching. " +
  "Cover layout composition, color palette, visual style, product type, mood. " +
  "2-3 sentences max.";

const MAX_RETRIES = 5;
const BASE_DELAY_MS = 2000;

// ---------------------------------------------------------------------------
// GoogleGenAI client (same credential pattern as vertex.service.ts)
// ---------------------------------------------------------------------------

function buildClient(): GoogleGenAI {
  const projectId = process.env.GOOGLE_SERVICE_ACCOUNT_PROJECT_ID;
  const location = process.env.GOOGLE_CLOUD_LOCATION || "global";

  const credentials = {
    type: process.env.GOOGLE_SERVICE_ACCOUNT_TYPE || "service_account",
    project_id: process.env.GOOGLE_SERVICE_ACCOUNT_PROJECT_ID,
    private_key_id: process.env.GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY_ID,
    private_key: process.env.GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY?.replace(
      /\\n/g,
      "\n",
    ),
    client_email: process.env.GOOGLE_SERVICE_ACCOUNT_CLIENT_EMAIL,
    client_id: process.env.GOOGLE_SERVICE_ACCOUNT_CLIENT_ID,
    auth_uri: "https://accounts.google.com/o/oauth2/auth",
    token_uri: "https://oauth2.googleapis.com/token",
    auth_provider_x509_cert_url:
      "https://www.googleapis.com/oauth2/v1/certs",
    client_x509_cert_url: `https://www.googleapis.com/robot/v1/metadata/x509/${encodeURIComponent(
      process.env.GOOGLE_SERVICE_ACCOUNT_CLIENT_EMAIL || "",
    )}`,
    universe_domain: "googleapis.com",
  };

  if (!credentials.client_email || !credentials.private_key) {
    throw new Error(
      "Missing required Google Cloud credentials. Check your .env file.",
    );
  }

  return new GoogleGenAI({
    vertexai: true,
    project: projectId!,
    location,
    googleAuthOptions: { credentials },
  } as any);
}

// ---------------------------------------------------------------------------
// Retry helper (handles 429 / timeout)
// ---------------------------------------------------------------------------

async function withRetry<T>(
  fn: () => Promise<T>,
  label: string,
): Promise<T> {
  for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
    try {
      return await fn();
    } catch (err: any) {
      const status = err?.status ?? err?.response?.status;
      const isRetryable =
        status === 429 ||
        err?.code === "UND_ERR_HEADERS_TIMEOUT" ||
        /timeout|resource exhausted|too many requests/i.test(
          err?.message ?? "",
        );

      if (!isRetryable || attempt === MAX_RETRIES) {
        throw err;
      }

      const delay = BASE_DELAY_MS * Math.pow(2, attempt - 1);
      console.warn(
        `⚠️  ${label}: retryable error (attempt ${attempt}/${MAX_RETRIES}), waiting ${delay}ms...`,
      );
      await sleep(delay);
    }
  }
  throw new Error("Unreachable");
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// ---------------------------------------------------------------------------
// Core: describe + embed one image
// ---------------------------------------------------------------------------

interface IndexEntry {
  filename: string;
  description: string;
  embedding: number[];
}

async function describeImage(
  client: GoogleGenAI,
  imagePath: string,
): Promise<string> {
  const imageBytes = fs.readFileSync(imagePath);
  const ext = path.extname(imagePath).toLowerCase();
  const mimeMap: Record<string, string> = {
    ".jpg": "image/jpeg",
    ".jpeg": "image/jpeg",
    ".png": "image/png",
    ".webp": "image/webp",
  };
  const mimeType = mimeMap[ext] || "image/jpeg";
  const base64 = imageBytes.toString("base64");

  const response = await withRetry(
    () =>
      client.models.generateContent({
        model: VISION_MODEL,
        contents: [
          {
            role: "user",
            parts: [
              { inlineData: { mimeType, data: base64 } },
              { text: DESCRIBE_PROMPT },
            ],
          },
        ],
      }),
    `describe ${path.basename(imagePath)}`,
  );

  const text =
    response?.candidates?.[0]?.content?.parts?.[0]?.text ?? "";
  if (!text) {
    throw new Error(`Empty description for ${path.basename(imagePath)}`);
  }
  return text.trim();
}

async function embedDescription(
  client: GoogleGenAI,
  description: string,
): Promise<number[]> {
  const resp = await withRetry(
    () =>
      client.models.embedContent({
        model: EMBEDDING_MODEL,
        contents: description,
        config: { taskType: "RETRIEVAL_DOCUMENT" as any, outputDimensionality: 1536 },
      }),
    "embed",
  );

  // The SDK returns embedding values — use defensive access
  const values =
    (resp as any).embeddings?.[0]?.values ?? (resp as any).embedding?.values;
  if (!values || !Array.isArray(values)) {
    throw new Error(
      "Failed to extract embedding values from response: " +
        JSON.stringify(resp).slice(0, 300),
    );
  }
  return values;
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main(): Promise<void> {
  console.log("🔍 Reference image indexer starting...\n");

  // Ensure ref_images directory exists
  if (!fs.existsSync(REF_DIR)) {
    fs.mkdirSync(REF_DIR, { recursive: true });
    console.log(`Created directory: ${REF_DIR}`);
  }

  // List image files
  const allFiles = fs.readdirSync(REF_DIR).filter((f) => {
    const ext = path.extname(f).toLowerCase();
    return IMAGE_EXTENSIONS.has(ext);
  });

  if (allFiles.length === 0) {
    console.log(
      `No image files found in ${REF_DIR}. Add .jpg/.png/.webp files and re-run.`,
    );
    return;
  }

  console.log(`Found ${allFiles.length} image(s) in ${REF_DIR}`);

  // Load existing index for incremental support
  let existingIndex: IndexEntry[] = [];
  if (fs.existsSync(INDEX_PATH)) {
    try {
      existingIndex = JSON.parse(fs.readFileSync(INDEX_PATH, "utf-8"));
      console.log(
        `Loaded existing index with ${existingIndex.length} entries`,
      );
    } catch {
      console.warn("⚠️  Could not parse existing index, starting fresh.");
      existingIndex = [];
    }
  }

  const indexedFilenames = new Set(existingIndex.map((e) => e.filename));
  const newFiles = allFiles.filter((f) => !indexedFilenames.has(f));

  if (newFiles.length === 0) {
    console.log("✅ All images already indexed. Nothing to do.");
    return;
  }

  console.log(`${newFiles.length} new image(s) to index.\n`);

  const client = buildClient();
  const newEntries: IndexEntry[] = [];

  for (let i = 0; i < newFiles.length; i++) {
    const filename = newFiles[i];
    const imagePath = path.join(REF_DIR, filename);
    const progress = `[${i + 1}/${newFiles.length}]`;

    try {
      console.log(`${progress} Describing: ${filename}`);
      const description = await describeImage(client, imagePath);
      console.log(`  → "${description.slice(0, 100)}..."`);

      console.log(`${progress} Embedding: ${filename}`);
      const embedding = await embedDescription(client, description);
      console.log(`  → ${embedding.length}-dim vector`);

      newEntries.push({ filename, description, embedding });

      // Save every 10 images to avoid losing progress on crash
      if (newEntries.length % 10 === 0) {
        const checkpoint = [...existingIndex, ...newEntries];
        fs.writeFileSync(INDEX_PATH, JSON.stringify(checkpoint, null, 2), "utf-8");
        console.log(`  💾 Checkpoint saved (${checkpoint.length} total entries)`);
      }

      // Small delay between images to avoid rate limits
      if (i < newFiles.length - 1) {
        await sleep(500);
      }
    } catch (err: any) {
      console.error(`❌ Failed to index ${filename}: ${err.message}`);
      // Continue with remaining files
    }
  }

  // Final save
  const finalIndex = [...existingIndex, ...newEntries];
  fs.writeFileSync(INDEX_PATH, JSON.stringify(finalIndex, null, 2), "utf-8");

  console.log(
    `\n✅ Done. Indexed ${newEntries.length} new image(s). Total: ${finalIndex.length} entries.`,
  );
  console.log(`   Saved to: ${INDEX_PATH}`);
}

main().catch((err) => {
  console.error("Fatal error:", err);
  process.exit(1);
});
