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

export function clearRefImageCache(): void {
  cachedIndex = null;
}
