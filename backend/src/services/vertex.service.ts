/**
 * AI Service using @google/genai SDK (Vertex AI mode)
 * Billing goes to GCP Vertex AI
 *
 * Key: location must be "global" for Gemini 3 preview models
 */

import { GoogleGenAI } from "@google/genai";
import { removeBackground } from "@imgly/background-removal-node";
import sharp from "sharp";
import fs from "fs";
import path from "path";
import os from "os";
import dotenv from "dotenv";
import { traceAI } from "../utils/ai-logger";
import { FlexNode } from "../utils/flexLayout";

// RMBG-2.0 model singleton — loaded once, reused across all calls
// Using @huggingface/transformers which runs ONNX models locally (no API call)
let _rmbg2Model: any = null;
let _rmbg2Processor: any = null;
let _rmbg2Loading: Promise<void> | null = null;

dotenv.config();

let genAIInstance: GoogleGenAI | null = null;

/**
 * Get or create Google GenAI client singleton (Vertex AI mode)
 */
function getGenAIClient(): GoogleGenAI {
  if (genAIInstance) {
    return genAIInstance;
  }

  const projectId = process.env.GOOGLE_SERVICE_ACCOUNT_PROJECT_ID;
  // Gemini 3 requires location="global" (not us-central1)
  const location = process.env.GOOGLE_CLOUD_LOCATION || "global";

  // Build credentials from environment variables
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
    auth_provider_x509_cert_url: "https://www.googleapis.com/oauth2/v1/certs",
    client_x509_cert_url: `https://www.googleapis.com/robot/v1/metadata/x509/${encodeURIComponent(
      process.env.GOOGLE_SERVICE_ACCOUNT_CLIENT_EMAIL || "",
    )}`,
    universe_domain: "googleapis.com",
  };

  if (!credentials.client_email || !credentials.private_key) {
    throw new Error("Missing required Google Cloud credentials for Vertex AI.");
  }

  // Create GoogleGenAI client in Vertex AI mode
  genAIInstance = new GoogleGenAI({
    vertexai: true,
    project: projectId!,
    location,
    googleAuthOptions: {
      credentials,
    },
    // @ts-ignore - increase timeout for slow image generation
    httpOptions: { timeout: 300000 },
  } as any);

  console.log(
    `✅ Google GenAI client initialized (Vertex AI mode, location=${location})`,
  );
  return genAIInstance;
}

/**
 * AI Service class
 */
export class AIService {
  private client: GoogleGenAI;

  constructor() {
    this.client = getGenAIClient();
  }

  /**
   * Helper for exponential backoff retry on 429 or Timeout
   */
  private async withRetry<T>(
    operation: () => Promise<T>,
    retries = 3,
    delay = 2000,
  ): Promise<T> {
    try {
      return await operation();
    } catch (error: any) {
      const isRateLimit =
        error.status === 429 ||
        error.message?.includes("429") ||
        error.message?.includes("Resource exhausted");

      const isTimeout =
        error.message?.includes("UND_ERR_HEADERS_TIMEOUT") ||
        error.code === "UND_ERR_HEADERS_TIMEOUT" ||
        error.message?.includes("ETIMEDOUT");

      if ((isRateLimit || isTimeout) && retries > 0) {
        const reason = isRateLimit
          ? "Resource exhausted (429)"
          : "Header Timeout (UND_ERR_HEADERS_TIMEOUT)";
        console.warn(
          `⚠️ [GenAI] ${reason}. Retrying in ${delay}ms... (${retries} retries left)`,
        );
        await new Promise((res) => setTimeout(res, delay));
        return this.withRetry(operation, retries - 1, delay * 2);
      }
      throw error;
    }
  }

  /**
   * Generates an image based on prompt and optional reference images
   */
  async generateImage(params: {
    prompt: string;
    aspect_ratio?: string;
    resolution?: string;
    inputImages?: Array<{ buffer: Buffer; mimeType: string }>;
    model?: string;
  }) {
    // Primary: User provided -> Configured secondary (Flash) -> Configured primary (Pro) -> Default
    const primaryModel =
      params.model ||
      process.env.GEMINI_IMAGE_ENDPOINT_2 ||
      process.env.GEMINI_IMAGE_ENDPOINT ||
      "gemini-2.5-flash-image";

    // Fallback: Use original primary if flash fails
    const fallbackModel =
      primaryModel === process.env.GEMINI_IMAGE_ENDPOINT_2
        ? process.env.GEMINI_IMAGE_ENDPOINT
        : undefined;

    const executeGen = async (targetModel: string) => {
      const parts: any[] = [];
      if (params.inputImages) {
        params.inputImages.forEach((img) => {
          parts.push({
            inlineData: {
              data: img.buffer.toString("base64"),
              mimeType: img.mimeType,
            },
          });
        });
      }

      const cleanPrompt = `IMPORTANT: Do NOT include any text, typography, letters, words, numbers, logos with text, watermarks, or any written content in the generated image. The image must be completely free of any text elements. Only generate visual/graphical elements.\n\n${params.prompt}`;
      parts.push({ text: cleanPrompt });

      console.log(`[GenAI] Generating image with model: ${targetModel}`);

      const config: any = {
        temperature: 1,
        topP: 0.95,
        responseModalities: ["TEXT", "IMAGE"],
        imageConfig: {
          aspectRatio: params.aspect_ratio || "1:1",
          imageSize: params.resolution || "1K",
        },
        safetySettings: [
          { category: "HARM_CATEGORY_HATE_SPEECH", threshold: "OFF" },
          { category: "HARM_CATEGORY_DANGEROUS_CONTENT", threshold: "OFF" },
          { category: "HARM_CATEGORY_SEXUALLY_EXPLICIT", threshold: "OFF" },
          { category: "HARM_CATEGORY_HARASSMENT", threshold: "OFF" },
        ],
      };

      const streamingResp = await this.withRetry(() =>
        this.client.models.generateContentStream({
          model: targetModel,
          contents: [{ role: "user", parts }],
          config,
        }),
      );

      let generatedImageBuffer: Buffer | null = null;
      let responseText = "";

      for await (const chunk of streamingResp) {
        if (chunk.text) {
          responseText += chunk.text;
        }
        if (chunk.candidates?.[0]?.content?.parts) {
          for (const part of chunk.candidates[0].content.parts) {
            if (part.inlineData?.data) {
              generatedImageBuffer = Buffer.from(
                part.inlineData.data as string,
                "base64",
              );
            }
          }
        }
      }

      return {
        buffer: generatedImageBuffer,
        text: responseText,
        prompt: params.prompt,
      };
    };

    try {
      return await executeGen(primaryModel);
    } catch (error: any) {
      if (fallbackModel && primaryModel !== fallbackModel) {
        console.warn(
          `⚠️ [GenAI] Primary model ${primaryModel} failed. Attempting fallback to ${fallbackModel}...`,
        );
        return await executeGen(fallbackModel);
      }
      throw error;
    }
  }

  /**
   * Renders the final campaign image by combining the original image with the suggested text layout
   */
  async renderCampaignImage(
    imageBuffer: Buffer,
    mimeType: string,
    suggestions: any[],
    backgroundBuffer?: Buffer,
  ) {
    const textDescriptions = suggestions
      .map(
        (s: any, i: number) =>
          `LINE ${i + 1}: "${s.part}"
       - Style: ${s.style.font_family}, ${s.style.font_weight}, Color ${s.style.color_hex}
       - Container: ${s.visual_container || "none"}
       - Size: ${s.style.font_size_normalized} (relative scale)
       - Position: ${s.position.explanation || `top:${s.position.top}, left:${s.position.left}`}`,
      )
      .join("\n");

    // We provide TWO images as reference:
    // 1. The original composite (as style/design guide)
    // 2. The clean background (as the base to avoid text ghosting)
    const inputImages = [
      { buffer: imageBuffer, mimeType }, // Design Ref
    ];

    if (backgroundBuffer) {
      inputImages.push({ buffer: backgroundBuffer, mimeType }); // Canvas Base
    }

    const baseImageInstruction = backgroundBuffer
      ? "USE THE SECOND IMAGE AS YOUR CLEAN BACKGROUND CANVAS. Do NOT leave any ghosting of original text."
      : "Use the provided image as background.";

    const prompt = `
      Create a high-quality, professional advertisement.
      REFERENCE IMAGE 1: Desired layout, quality, and graphic style.
      ${backgroundBuffer ? "REFERENCE IMAGE 2: Clean background canvas to work on." : ""}
      
      TASK:
      1. ${baseImageInstruction}
      2. There are EXACTLY ${suggestions.length} text elements. Each one MUST appear on its OWN VISUAL LINE at its own Y-position:
      ${textDescriptions}
      
      CRITICAL DESIGN INSTRUCTIONS:
      - Each LINE above is a SEPARATE visual line. Do NOT combine any two LINEs into one horizontal string.
      - MATCH THE TEXT LAYOUT from Reference Image 1 exactly.
      - If a 'Container' like 'yellow_ribbon' or 'red_banner' is mentioned, RECREATE that graphic element professionally.
      - REPLICATE the professional graphic design environment from Reference 1 (icons, stickers, badges).
      - Text must be crisp, perfectly spelled, and high-contrast.
      - Final result must look like a single, cohesive, high-end production.
    `;

    return this.generateImage({
      prompt,
      inputImages,
    });
  }

  /**
   * Step 0: Layout Strategy Planner (DesignAsCode-inspired Plan phase)
   * Thinks about composition BEFORE committing to pixel coordinates.
   * Separates "what should the layout look like?" from "give me coordinates".
   * @deprecated Replaced by flex tree layout system
   */
  async planLayoutStrategy(
    imageBuffer: Buffer,
    mimeType: string,
    targetText: string,
    componentLabels: string[],
    componentPositions?: Array<{ label: string; top: number; left: number; width: number; height: number }>,
  ): Promise<{
    layout_concept: string;
    dominant_element: string;
    text_hierarchy: string[];
    composition_notes: string;
    recommended_text_zone: "left" | "right" | "bottom" | "full";
    text_zone?: { top: number; left: number; width: number; height: number };
    component_layout?: Array<{ label: string; top: number; left: number; width: number; height: number }>;
  }> {
    let processingBuffer = imageBuffer;
    let processingMime = mimeType;
    try {
      processingBuffer = await sharp(imageBuffer)
        .resize(800)
        .jpeg({ quality: 80 })
        .toBuffer();
      processingMime = "image/jpeg";
    } catch (_) {}

    const model =
      process.env.GEMINI_MODEL_ENDPOINT_2 ||
      process.env.GEMINI_MODEL_ENDPOINT ||
      "gemini-2.0-flash-exp";

    const componentsAvailable =
      componentLabels.length > 0
        ? componentLabels.join(", ")
        : "none detected yet";

    const componentPositionsBlock = componentPositions?.length
      ? `\nCURRENT COMPONENT POSITIONS (normalized 0-1000 coordinates):\n${componentPositions.map(c => `- ${c.label}: top=${c.top}, left=${c.left}, width=${c.width}, height=${c.height} (covers x:${c.left}-${c.left + c.width}, y:${c.top}-${c.top + c.height})`).join('\n')}`
      : '';

    // Dynamically estimate text space requirements from content
    const textLines = targetText.split('\n').filter((l: string) => l.trim().length > 0);
    const hasPromoNumber = /\d/.test(targetText); // contains a number → needs large promo space
    // Estimate: promo ~150 units, each other line ~50-60 units, gaps ~20 per line
    const estimatedPromoHeight = hasPromoNumber ? 180 : 0;
    const estimatedOtherLinesHeight = (textLines.length - (hasPromoNumber ? 1 : 0)) * 65;
    const estimatedTextHeight = Math.round(estimatedPromoHeight + estimatedOtherLinesHeight + 40); // +40 for padding
    const totalComponentArea = (componentPositions || []).reduce((sum, c) => sum + c.width * c.height, 0);
    const canvasArea = 1000 * 1000; // normalized space
    const componentAreaPercent = Math.round((totalComponentArea / canvasArea) * 100);

    const textSpaceBlock = `
TEXT SPACE ANALYSIS (computed from content):
- Text items: ${textLines.length} lines
- Contains promotional number: ${hasPromoNumber ? 'YES — needs large font space' : 'NO'}
- Estimated minimum text zone height needed: ~${estimatedTextHeight} units (out of 1000)
- Component area used: ${componentAreaPercent}% of canvas
- IMPORTANT: If components use too much space, SHRINK components to make room for text. Text is the primary message.`;

    // Compute overlap warnings to include in prompt
    let overlapWarnings = '';
    if (componentPositions && componentPositions.length > 1) {
      const warnings: string[] = [];
      for (let i = 0; i < componentPositions.length; i++) {
        for (let j = i + 1; j < componentPositions.length; j++) {
          const a = componentPositions[i];
          const b = componentPositions[j];
          const overlapX = Math.max(0, Math.min(a.left + a.width, b.left + b.width) - Math.max(a.left, b.left));
          const overlapY = Math.max(0, Math.min(a.top + a.height, b.top + b.height) - Math.max(a.top, b.top));
          if (overlapX > 0 && overlapY > 0) {
            const overlapArea = overlapX * overlapY;
            warnings.push(`⚠️ "${a.label}" and "${b.label}" OVERLAP by ${overlapArea} sq units (${overlapX}w × ${overlapY}h). You MUST move them apart.`);
          }
        }
      }
      if (warnings.length > 0) {
        overlapWarnings = `\n\n🚨 OVERLAP DETECTED IN CURRENT POSITIONS:\n${warnings.join('\n')}\nYou MUST fix these overlaps in your component_layout output.\n`;
      }
    }

    const prompt = `You are a senior Thai advertising Art Director at a top Bangkok agency (SCB, Grab, PTT style).

Look at this campaign image and text brief. Output a UNIFIED LAYOUT STRATEGY in JSON only.

CRITICAL: You must plan WHERE COMPONENTS GO and WHERE TEXT GOES **together** as ONE layout.
Components and text MUST NOT overlap. Think of the canvas as a grid — assign clear regions.
${componentPositionsBlock}${overlapWarnings}${textSpaceBlock}

TEXT BRIEF:
"""
${targetText}
"""

VISUAL COMPONENTS AVAILABLE: ${componentsAvailable}

Respond with ONLY this JSON (no markdown fences, no explanation).
CRITICAL: text_zone and component_layout are the MOST IMPORTANT fields — output them FIRST.

{
  "layout_concept": "one short phrase, e.g. 'hero-right text-left stacked'",
  "dominant_element": "the SINGLE most visually important text/number, e.g. '2 ต่อ'",
  "text_zone": {
    "top": <number 0-1000>, "left": <number 0-1000>, "width": <number 0-1000>, "height": <number 0-1000>
  },
  "component_layout": [
    { "label": "<component name>", "top": <0-1000>, "left": <0-1000>, "width": <0-1000>, "height": <0-1000> }
  ],
  "recommended_text_zone": "left | right | bottom | full",
  "composition_notes": "1-2 sentence design decision",
  "text_hierarchy": ["ordered text parts from most to least visually important"]
}

RULES FOR text_zone + component_layout:
1. text_zone and component_layout rectangles MUST NOT OVERLAP — leave at least 30 units gap
2. component_layout items MUST NOT OVERLAP EACH OTHER — leave at least 30 units gap between any two components
3. All elements must be within 50-950 range (safe zone margins)
4. Components should be on one side, text on the opposite side or in a clear gap
5. text_zone must be large enough for ALL text to fit at readable sizes — see TEXT SPACE ANALYSIS above for the estimated height needed. Shrink components if necessary to make room.
6. If components are spread across both sides, stack text above or below them
7. EVERY element on canvas must be clearly readable — no element should obscure another

SCB ad style rules:
- Promotional numbers (e.g. 2, 50%, 1.5×) → ALWAYS the dominant element, huge font
- Character/person → right or center; text → opposite side
- Text lock-up: related items (number + unit) = one visual block
- Fine print → tiny, bottom edge`;

    try {
      console.log("[Plan] Requesting layout strategy from AI...");
      console.log(`[AI-TRACE] [Plan] Prompt:\n${prompt}`);
      const response = await this.withRetry(() =>
        this.client.models.generateContent({
          model,
          contents: [
            {
              role: "user",
              parts: [
                {
                  inlineData: {
                    data: processingBuffer.toString("base64"),
                    mimeType: processingMime,
                  },
                },
                { text: prompt },
              ],
            },
          ],
          config: { temperature: 0.7 },
        }),
      );

      const raw = (response.text || "").trim();
      traceAI("Plan Strategy", prompt, raw);
      console.log(`[Plan] Raw response length: ${raw.length} chars. Contains text_zone: ${raw.includes('"text_zone"')}. Contains component_layout: ${raw.includes('"component_layout"')}`);
      const rawCleaned = raw.replace(/```json|```/g, "").trim();

      // Attempt parse with truncation repair (AI sometimes cuts off mid-JSON)
      let strategy: any = null;
      try {
        strategy = JSON.parse(rawCleaned || "{}");
      } catch {
        // Try to close truncated JSON by appending missing braces/brackets
        const repaired =
          rawCleaned.replace(/,\s*$/, "") + // trailing comma
          "}".repeat(
            (rawCleaned.match(/{/g) || []).length - (rawCleaned.match(/}/g) || []).length,
          ) +
          "]".repeat(
            (rawCleaned.match(/\[/g) || []).length - (rawCleaned.match(/]/g) || []).length,
          );
        try {
          strategy = JSON.parse(repaired);
          console.log("[Plan] JSON repaired successfully");
        } catch {
          console.warn(
            "[Plan] JSON repair failed — using structure extraction",
          );
          // Extract fields from raw string as last resort
          strategy = {};
          const conceptMatch = rawCleaned.match(/"layout_concept"\s*:\s*"([^"]+)"/);
          const domMatch = rawCleaned.match(/"dominant_element"\s*:\s*"([^"]+)"/);
          const notesMatch = rawCleaned.match(/"composition_notes"\s*:\s*"([^"]+)"/);
          if (conceptMatch) strategy.layout_concept = conceptMatch[1];
          if (domMatch) strategy.dominant_element = domMatch[1];
          if (notesMatch) strategy.composition_notes = notesMatch[1];
        }
      }

      // Ensure all required fields have valid values
      const result: any = {
        layout_concept: strategy?.layout_concept || "default",
        dominant_element: strategy?.dominant_element || "",
        text_hierarchy: Array.isArray(strategy?.text_hierarchy)
          ? strategy.text_hierarchy
          : [],
        composition_notes: strategy?.composition_notes || "",
        recommended_text_zone: strategy?.recommended_text_zone || "left",
      };

      // Extract the critical unified layout fields
      if (strategy?.text_zone && typeof strategy.text_zone === "object") {
        result.text_zone = strategy.text_zone;
        console.log(`[Plan] ✅ text_zone extracted: ${JSON.stringify(result.text_zone)}`);
      } else {
        console.warn(`[Plan] ⚠️ text_zone NOT found in plan response — falling back to computed zone`);
      }
      if (Array.isArray(strategy?.component_layout) && strategy.component_layout.length > 0) {
        result.component_layout = strategy.component_layout;
        console.log(`[Plan] ✅ component_layout extracted: ${strategy.component_layout.length} components`);
      } else {
        console.warn(`[Plan] ⚠️ component_layout NOT found in plan response`);
      }

      console.log(
        `[Plan] Strategy: "${result.layout_concept}" | dominant: "${result.dominant_element}"`,
      );
      return result;
    } catch (err) {
      // Non-fatal: fallback to no strategy hint (current behavior preserved)
      console.warn(
        "[Plan] Strategy planning failed — proceeding without hint:",
        err,
      );
      return {
        layout_concept: "default",
        dominant_element: "",
        text_hierarchy: [],
        composition_notes: "",
        recommended_text_zone: "left",
      };
    }
  }

  /**
   * Suggests BOTH text placement AND visual components for a campaign
   * Returns text suggestions + component descriptions for die-cut generation
   */
  async suggestCampaignLayout(
    imageBuffer: Buffer,
    mimeType: string,
    targetText: string,
    mode: string = "full",
    externalNoGoZones: any[] = [],
    safeZones: Array<{
      top: number;
      left: number;
      width: number;
      height: number;
      area: number;
      label: string;
    }> = [],
    fixedComponentPositions?: Array<{
      label: string;
      top: number;
      left: number;
      width: number;
      height: number;
    }>,
    textZone?: { top: number; left: number; width: number; height: number },
    layoutHint?: {
      layout_concept: string;
      dominant_element: string;
      text_hierarchy: string[];
      composition_notes: string;
    },
  ) {
    // 1. Resize for faster analysis & stay within model limits
    let processingBuffer = imageBuffer;
    let processingMime = mimeType;
    try {
      const meta = await sharp(imageBuffer).metadata();
      const w = meta.width || 800;
      const h = meta.height || 600;

      // Resize for faster analysis
      processingBuffer = await sharp(imageBuffer)
        .resize(Math.min(w, 1500))
        .jpeg({ quality: 90 })
        .toBuffer();
      processingMime = "image/jpeg";
    } catch (e) {
      console.warn("[GenAI] Resize failed, using original:", e);
    }

    // 2. Select Model: Prefer configured endpoints
    const model =
      process.env.GEMINI_MODEL_ENDPOINT_2 ||
      process.env.GEMINI_MODEL_ENDPOINT ||
      "gemini-2.0-flash-exp";
    // User prefers 2.0 Flash/2.5 Flash. Respecting env variables strictly.

    // Construct external No-Go Zone instructions
    let noGoInstruction = "";
    if (externalNoGoZones && externalNoGoZones.length > 0) {
      const zoneList = externalNoGoZones
        .map((z, i) => {
          const label = z.label || `Zone ${i + 1}`;
          // Ensure we have 0-1000 coordinates
          const top = Math.round(z.top || z.y || 0);
          const left = Math.round(z.left || z.x || 0);
          const width = Math.round(z.width || z.w || 100);
          const height = Math.round(z.height || z.h || 100);
          return `- ${label}: [top:${top}, left:${left}, width:${width}, height:${height}]`;
        })
        .join("\n");

      noGoInstruction = `
      ═══════════════════════════════════════
      🚫 STRICT FORBIDDEN ZONES (PRE-DETECTED):
      The following areas contain critical objects. DO NOT PLACE ANY TEXT HERE:
      ${zoneList}
      
      If a text placement overlaps with these coordinates, IT IS WRONG. MOVE IT.
      ═══════════════════════════════════════
      `;
    }

    // Build safe zone instruction — if provided, override spatial reasoning with computed zones
    let safeZoneInstruction = "";
    if (safeZones && safeZones.length > 0) {
      const zoneList = safeZones
        .slice(0, 6)
        .map((z, i) => {
          // Heuristic: sqrt(area)/10 → recommended minimum font_size for headline in this zone
          const minFont = Math.max(40, Math.round(Math.sqrt(z.area) / 10));
          return `  Zone ${i + 1} [${z.label || `zone-${i + 1}`}]: top=${z.top}, left=${z.left}, width=${z.width}, height=${z.height} (area=${z.area}) → headline font_size ≥ ${minFont}`;
        })
        .join("\n");
      safeZoneInstruction = `
      ═══════════════════════════════════════
      ✅ VERIFIED SAFE PLACEMENT ZONES:
      The following zones are mathematically verified to be free of all subjects and components.
      Place ALL text elements within one of these zones. Do NOT place text outside these zones.

${zoneList}

      For each text suggestion, set "preferred_zone" to the label of the zone you chose (e.g. "top-left").
      Your position coordinates MUST fall within that zone's boundaries.

      📐 FONT SIZE RULE — SCALE TEXT TO OWN THE SPACE:
      - Large zones (area > 50000) → headline MUST be font_size ≥ 80. Do NOT use small fonts in big empty zones.
      - Medium zones (area 20000-50000) → headline ≥ 50.
      - Small zones (area < 20000) → headline ≥ 30.
      - NEVER use font_size < 20 for Headline or Body text. Only FinePrint can be below 20.
      ═══════════════════════════════════════
      `;
    }

    const isCompOnly = mode === "only_bg_comp";

    let fixedComponentNote = "";
    if (fixedComponentPositions && fixedComponentPositions.length > 0) {
      const compList = fixedComponentPositions
        .map(
          (c) =>
            `  - "${c.label}": occupies left=${c.left} to ${c.left + c.width}, top=${c.top} to ${c.top + c.height}`,
        )
        .join("\n");
      const zoneDesc = textZone
        ? `top=${textZone.top}, left=${textZone.left}, width=${textZone.width}, height=${textZone.height} (x-range: ${textZone.left} to ${textZone.left + textZone.width}, y-range: ${textZone.top} to ${textZone.top + textZone.height})`
        : "the open area not occupied by components";
      fixedComponentNote = `
══════════════════════════════════════
COMPONENT POSITIONS ARE FIXED (pre-placed by art director — do NOT suggest moving them):
${compList}

COMPOSITION GUIDANCE (text zone — where most text should be):
  ${zoneDesc}

COMPOSITION RULES FOR TEXT:
  - Place MOST text within the TEXT ZONE (the open space beside the character)
  - INTENTIONAL OVERLAP IS ALLOWED: Text elements can partially overlap the character area for a dynamic, layered 3D effect — the character will render IN FRONT of the text (higher z-index)
  - Pull text TOWARD the character — text should reach toward the character's body/gaze, not float away from it
  - If character is on RIGHT → text leans right, hugging the character's left edge
  - If character is on LEFT → text leans left, hugging the character's right edge
  - PROMOTIONAL NUMBERS (e.g. "2 ต่อ", "50%") may overlap the character's lower body (legs/waist) — this creates the "character standing on the offer" SCB effect
══════════════════════════════════════
`;
    }

    const prompt = `
      Act as a professional graphic designer. 
      Use 0-1000 normalized coordinates (0 = top/left edge, 1000 = bottom/right edge).
      
      AD BRIEF / TEXT (Reference only for context):
      """
      ${targetText}
      """

      ${fixedComponentNote}
      ${safeZoneInstruction || noGoInstruction}

${
  layoutHint && layoutHint.layout_concept !== "default"
    ? `
      ╔══════════════════════════════════════════╗
      ║  ART DIRECTOR STRATEGY (FOLLOW EXACTLY)  ║
      ╚══════════════════════════════════════════╝
      Concept: ${layoutHint.layout_concept}
      Dominant element (MUST be largest on screen): "${layoutHint.dominant_element}"
      Text priority order: ${layoutHint.text_hierarchy.join(" › ")}
      Design notes: ${layoutHint.composition_notes}
      ────────────────────────────────────────────
      Follow this strategy. Do NOT deviate from the dominant element or priority order.
`
    : ""
}

      ═══════════════════════════════════════
      TASK 0: PRECISION OBJECT DETECTION
      ═══════════════════════════════════════
      1. Pinpoint ALL distinct people and characters in the image as separate subjects.
      2. For EACH subject, create EXACTLY ONE tight full-body bounding box — do NOT split one person/character into multiple boxes (no separate "head", "upper body", "legs" boxes).
      3. Use the 0-1000 coordinate scale to specify coordinates accurately.
      4. Do NOT guess. Use the visible image to estimate positions.

      ═══════════════════════════════════════
      
      TASKS:
      ${
        isCompOnly
          ? `
      1. ART DIRECTOR COMPONENT PLACEMENT:
         You are an award-winning Thai advertising art director (SCB EASY, Grab, True style).
         Your job: compose the components on the canvas like a high-budget poster shoot.

         CHARACTERS / PERSONS (label contains: person, woman, man, boy, girl, mascot, character, figure, human):
         - Scale to FILL 70-90% of canvas HEIGHT → suggested_position.height MUST be 700 to 900
         - Anchor to BOTTOM edge → suggested_position.top = 1000 - height (feet at canvas bottom, e.g. top=100 if height=900)
         - Choose LEFT or RIGHT side based on subject's gaze direction:
           * Subject faces/looks RIGHT → place on LEFT side (left = 0 to 100)
           * Subject faces/looks LEFT → place on RIGHT side (left = 1000 - width)
           * Subject faces camera directly → default to RIGHT side
         - BLEED to edge: if left-anchored → left ≤ 50. If right-anchored → (left + width) ≥ 950
         - NON-BLEED side MUST have breathing room ≥ 30 units:
           * Left-anchored character (left ≤ 50): keep (left + width) ≤ 550 so text zone has 450+ units of open space.
           * Right-anchored character: keep left ≥ 420 so text zone has 390+ units of open space.
         - TOP breathing room: suggested_position.top MUST be ≥ 30 (character head must not touch canvas top).
         - Width: 350-500 for full-body characters (preserve width for the text zone)

         MASCOTS / SECONDARY ELEMENTS: bottom-corner placement, height = 300-450
         DEPTH INTERACTION (creates premium 3D feel — SCB standard):
         - PRIMARY characters/models: set z_index = 15 (character appears IN FRONT of text)
         - Compute interaction_zone: area where character body overlaps the text zone
           * overlap_top = suggested_position.top + 100 (skip head, start at shoulder level)
           * overlap_left = suggested_position.left
           * overlap_width = min(200, suggested_position.width / 2)
           * overlap_height = suggested_position.height - 200
           * Set interaction_zone.enabled = false (DISABLED — no intentional overlap until system is ready)
         - MASCOTS / SECONDARY elements: z_index = 10 (same level as text)
         - LOGOS / BADGES: z_index = 20 (always on top)
         LOGOS / BADGES / RIBBONS: keep near detected position, scale width/height up by 20%

         After placing ALL components, compute composition_text_zone as the open horizontal space for text:
         - Compute character_right = suggested_position.left + suggested_position.width
         - Compute character_left = suggested_position.left
         - If main character is LEFT-anchored (suggested_position.left < 400):
           Set composition_text_zone.left = character_right + 20
           Set composition_text_zone.width = 1000 - character_right - 50
           Set composition_text_zone.top = 0, composition_text_zone.height = 1000
         - If main character is RIGHT-anchored (suggested_position.left >= 400):
           Set composition_text_zone.left = 30
           Set composition_text_zone.width = character_left - 50
           Set composition_text_zone.top = 0, composition_text_zone.height = 1000

      2. SKIP TEXT TASKS: Do NOT analyze or suggest text layouts for this request.
      `
          : `
      1. PLACEMENT STRATEGY:
         ${
           safeZones.length > 0
             ? `Place text within the VERIFIED SAFE ZONES listed above. Use "preferred_zone" to indicate which zone each text element belongs in.`
             : `- Divide the image into 3 vertical columns: LEFT (0-333), CENTER (334-666), RIGHT (667-1000).
         - Identify which column is EMPTY/SAFE.
         - **RULE: PLACE 90% OF TEXT IN THE 'SAFE COLUMN' ONLY.**`
         }

      2. TEXT EXTRACTION & SMART LINE BREAKING:
         - Read the AD BRIEF and identify distinct text elements.
         - YOU MUST RETURN AT LEAST ONE TEXT SUGGESTION.

         ⚠️ LOCK-UP RULE (CRITICAL — CARDINAL SIN if violated):
         Numbers and their unit MUST be a single graphic lock-up:
           - "2 ต่อ", "50%", "1.5%" → treat as ONE element, same position block.
           - Do NOT create separate suggestion items for the number and the unit.
           - Place them in a SINGLE suggestion with the combined text (e.g. "part": "2 ต่อ" or "part": "50%"), with font_size_normalized ≥ 150.
           - Only split into two items if the number and unit are on separate visual rows AND the font size ratio between them is 2× or greater (e.g. huge "2" with tiny "ต่อ" subscript).

         For non-numeric text (headlines, body copy): split into multiple visual lines to fit the text zone width.

         ⚠️ PROMOTION OFFER HIERARCHY (CRITICAL):
           - If the AD BRIEF contains a number/offer (e.g., "2 ต่อ", "50% off", "1.5% ต่อปี"):
             * Make it the LARGEST element on screen (font_size_normalized: 150-200)
             * Position it in the CENTER of the text zone
             * All other text (headline, body) is SECONDARY and smaller

      3. DESIGN POLISHING:
         - Related text (same semantic group) MUST be within 30 units of each other (0-1000 scale).
         - Push text block inwards towards subjects — text should "reach toward" the character.
         - NEVER leave a gap larger than 200 units between logically related text elements.
      `
      }
      
      ${
        mode === "full" || mode === "text"
          ? `4. COMPONENT COMPOSITION (Active Design Decision):
         These components will be die-cut PNGs that CAN be repositioned anywhere on the canvas.
         ✅ INCLUDE: Ribbons, banners, price badges, mascots, characters, stickers, person cutouts, product images, logos, icons.
         ❌ STRICTLY EXCLUDE: Decorative background textures, geometric patterns (hexagons, diamonds, etc.), gradient overlays, or any element that IS the background.
         For EACH component:
           - Detect its current position in the image (for die-cutting accuracy)
           - ALSO recommend a 'suggested_position' where it SHOULD GO for best overall composition
           - Composition rules for suggested_position:
             * Primary person/character → upper-center or right, tall (height 500-800)
             * Mascot / secondary → bottom-right corner
             * Decorative badges/ribbons → overlay on text zone for emphasis
             * Leave the LEFT column (left 0-400) primarily for text`
          : `4. COMPONENT COMPOSITION (Active Design Decision):
         These components will be die-cut PNGs that CAN be repositioned anywhere on the canvas.
         ✅ INCLUDE: Ribbons, banners, price badges, mascots, characters, stickers, person cutouts, product images, logos, icons.
         ❌ STRICTLY EXCLUDE: Decorative background textures, geometric patterns (hexagons, diamonds, etc.), gradient overlays, or any element that IS the background.
         For EACH component, detect position + recommend 'suggested_position' for best composition.`
      }
      
      Return the result as a STRICT JSON object:
      {
        "background_description": "Describe the background scene (without any overlaid elements)",
        "campaign_vibe": "Energetic, Minimalist, Luxury, etc.",
        "composition_text_zone": { "top": 0, "left": 0, "width": 400, "height": 1000, "rationale": "Character anchored bottom-right, left column 0-400 is open for text" },
        "composition_vibe": "Overall visual energy of the composition (e.g. 'energetic', 'bold', 'luxury', 'playful', 'calm')",
        "spatial_analysis": {
             "safe_zone": "LEFT | CENTER | RIGHT | TOP",
             "blocked_zones": ["CENTER (Woman)", "RIGHT (Mascot)"],
             "strategy": "Align all text to the LEFT column on the purple background"
        },
        "no_go_zones": [
          {
            "priority": "HIGH (Face/Identity) | MEDIUM (Product/Hands) | LOW (Secondary Body/Background)",
            "label": "Face of the woman",
            "area": { "top": 50, "left": 400, "width": 200, "height": 200 },
            "reason": "Highest priority, DO NOT OVERLAP."
          },
          {
            "priority": "LOW",
            "label": "Shoulder/Arms",
            "area": { "top": 250, "left": 300, "width": 400, "height": 300 },
            "reason": "Less critical, slight overlap OK for layout flow."
          }
        ],
        "suggestions": [
          {
            "part": "The exact text (e.g. 'SUMMER SALE')",
            "preferred_zone": "REQUIRED when safe zones are provided — use the zone label (e.g. 'top-left', 'bottom-center')",
            "position": {
              "top": 0, "left": 0, "width": 0, "height": 0, "rotation": 0,
              "explanation": "Normalized coordinates 0-1000. Rotation in degrees (0 for normal, 90 for vertical)."
            },
             "style": {
              "font_family": "Choose from: 'Kanit', 'Mitr', 'Sriracha', 'Inter', 'Playfair Display', 'Roboto Mono'",
              "font_weight": "normal | bold",
              "font_style": "normal | italic",
              "color_hex": "#FFFFFF",
              "text_gradient": "[Optional] Array of 2 colors for gradient e.g. ['#FF512F', '#DD2476']",
              "stroke_hex": "[Optional] Use #FFFFFF (White) for most cases. AVOID #000000 (Black) on dark backgrounds as it looks messy.",
              "stroke_width": "[Optional] Numeric scale 0-10. For high visibility, use 4-6 (No 'px' unit).",
              "font_size_normalized": "Relative size (e.g. 10 to 200; promotional numbers and offer lock-ups: 150-200)",
              "text_align": "left | center | right",
              "letter_spacing": "Numeric tracking (e.g. 0, -1)",
              "line_height": "Default 1.2",
              "shadow": "none | subtle | strong | outline"
            },
            "design_notes": "CRITICAL: Maintain a 'Safety Margin' of at least 5-8% from ALL edges (0-1000 scale, so avoid left < 50, right > 950, top < 50, bottom > 950). Do NOT touch the very edge.",
            "visual_container": "none",
            "hierarchy": "Headline | Body | FinePrint"
          }
        ],
        "components": [
          {
            "label": "Short label (e.g. 'Thai boy mascot')",
            "description": "Visual description for recreation",
            "position": { "top": 0, "left": 0, "width": 0, "height": 0, "rotation": 0 },
            "suggested_position": {
              "top": 0, "left": 0, "width": 0, "height": 0, "rotation": 0,
              "rationale": "e.g. Moved right to free left column for text. Person spans full height of purple zone."
            },
            "z_index": 15,
            "interaction_zone": {
              "enabled": false,
              "overlap_top": 200,
              "overlap_left": 350,
              "overlap_width": 300,
              "overlap_height": 400
            }
          }
        ]
      }
      
      IMPORTANT:
      - MODE is currently: ${mode}.
      - You MUST always extract both text elements AND visual components, regardless of mode.
      - If mode is 'only_bg_comp', the 'suggestions' (text) array should be empty [].
      - If mode is 'full' or 'text', you MUST extract BOTH text AND components.
      
      ✓ FONT SELECTION RULES (MANDATORY — NO EXCEPTIONS):
      - You MUST set "font_family": "Kanit" for EVERY SINGLE text element.
      - NEVER use Mitr, Sriracha, Inter, Playfair Display, or any other font.
      - Kanit is the ONLY allowed font for ALL Thai and English text in this system.
      - Set font_weight based on hierarchy:
          * "headline"  → font_weight: "800"  (bold, dominant)
          * "body"      → font_weight: "600"  (semi-bold, readable)
          * "badge"     → font_weight: "700"  (strong, compact)
          * "fineprint" → font_weight: "400"  (light, unobtrusive)
          * If the element is a large promotional number (e.g., "50%", "2 ต่อ") → font_weight: "900"
      
      ✓ DESIGN TRICKS (COMMERCIAL GRADE — MANDATORY, NOT OPTIONAL):
      - **STROKE + SHADOW (MANDATORY — replaces dark containers)**:
        * Every text element MUST have BOTH stroke AND shadow — this creates contrast without ugly boxes:
          → "stroke_hex": "#000000" (dark stroke for light text), "stroke_width": 4-6
          → "shadow": "strong" for headlines on photo/textured backgrounds
          → "shadow": "subtle" for text on solid-color areas
        * NEVER set visual_container to anything other than "none". Background boxes look amateur and amateurish.
        * SCB real ads use thick text outlines + drop shadows — NOT dark rectangle overlays.

      - **GRADIENTS**: For "Promotional Numbers" (e.g., "50%", "2 ต่อ"), use text_gradient to make them pop.
        Example: "text_gradient": ["#FFD700", "#FF8C00"] for gold/orange.
      
      ✓ FINEPRINT (Legal disclaimers, terms & conditions, policy text, footer):
        - font_size_normalized: 8-16 (VERY SMALL)
        - Examples: "Terms apply", "*See details"
        - These are NOT meant to be prominent. They can be TINY.
        - DO NOT make fine print larger than 16. It's OKAY if it's hard to read.
        - Better to be TOO SMALL than too large for fine print.
        - If in doubt whether text is fine print: check if it's legal/policy/disclaimer → YES = make it SMALL (8-12)

      CRITICAL BOUNDING BOX RULES:
      1. TIGHT WIDTH: For text 'suggestions', the 'width' must be as TIGHT as possible to the actual characters. Do NOT span the whole image width if the text only takes up a small portion.
      2. PRECISE COMPONENTS: For 'components', ensure the width and height cover the visual item (like a mascot or icon) with MINIMAL padding.
      3. AVOID BLOCKING: The goal is to make layers easy to click in an editor. Large, mostly-empty boxes are FORBIDDEN.

      DESIGNER MINDSET (ANTI-BORING RULES):
      - FILL THE SPACE: If there's a large solid background (like a purple block), DO NOT leave it empty. Scale the text (Headline) up to 120-180 to OWN the space.
      - STROKE IS NON-NEGOTIABLE: Before finalizing any text, set stroke_hex + stroke_width AND shadow. This is how real Thai ads achieve contrast — thick outline + drop shadow, NOT dark box overlay.
      - COMPOSITION DENSITY: An ad should look 'Full' and 'High-End'. If it looks 'empty', increase font sizes significantly.
      - TEXT STYLING: Use professional combinations. E.g., a huge lock-up "2 ต่อ" at font_size_normalized 180 with font_weight "900" and a text_gradient to make it dominant — not a flat, same-size line of text.
    `;

    const config: any = {
      temperature: 1,
      topP: 0.95,
      safetySettings: [
        { category: "HARM_CATEGORY_HATE_SPEECH", threshold: "OFF" },
        { category: "HARM_CATEGORY_DANGEROUS_CONTENT", threshold: "OFF" },
        { category: "HARM_CATEGORY_SEXUALLY_EXPLICIT", threshold: "OFF" },
        { category: "HARM_CATEGORY_HARASSMENT", threshold: "OFF" },
      ],
    };

    try {
      const modeLabel =
        mode === "only_bg_comp" ? "Components Only" : "Layout + Components";
      console.log(`[GenAI] Suggesting ${modeLabel} with model: ${model}`);
      const response = await this.withRetry(() =>
        this.client.models.generateContent({
          model,
          contents: [
            {
              role: "user",
              parts: [
                {
                  inlineData: {
                    data: processingBuffer.toString("base64"),
                    mimeType: processingMime,
                  },
                },
                { text: prompt },
              ],
            },
          ],
          config,
        }),
      );

      const responseText = response.text ? response.text.trim() : "";
      console.log(
        "[GenAI] Layout suggestion raw response:",
        responseText.substring(0, 500),
      );

      const jsonString = responseText.replace(/```json|```/g, "").trim();

      let parsed;
      try {
        parsed = JSON.parse(jsonString || "{}");
      } catch (parseErr) {
        console.error(
          "[GenAI] Layout JSON parse failed, attempting cleanup...",
        );
        const cleaned = jsonString
          .replace(/\\'/g, "'")
          .replace(/\\([^"\\\/bfnrtu])/g, "$1")
          .replace(/[\x00-\x1F\x7F]/g, " ");
        parsed = JSON.parse(cleaned);
      }

      // Log summary of suggestions
      if (parsed.suggestions) {
        console.log(
          `[GenAI] Got ${parsed.suggestions.length} text suggestions:`,
        );
        parsed.suggestions.forEach((s: any, i: number) => {
          console.log(
            `  [${i}] "${(s.part || "").substring(0, 40)}..." → top:${s.position?.top} left:${s.position?.left} size:${s.style?.font_size_normalized} hierarchy:${s.hierarchy}`,
          );
        });
      }
      if (parsed.components?.length) {
        console.log(`[GenAI] Got ${parsed.components.length} components`);
      }
      if (parsed.no_go_zones?.length) {
        console.log(
          `[GenAI] Detected ${parsed.no_go_zones.length} no-go zones:`,
        );
        parsed.no_go_zones.forEach((z: any, i: number) => {
          console.log(
            `  [${i}] "${z.label}" → top:${z.area?.top} left:${z.area?.left} w:${z.area?.width} h:${z.area?.height} - ${z.reason}`,
          );
        });
      }

      return parsed;
    } catch (error: any) {
      console.error("[GenAI] Suggest Layout Error:", error);
      throw error;
    }
  }

  /**
   * Render a visual preview of the layout for AI self-review
   */
  async generateLayoutPreview(
    baseImageBuffer: Buffer,
    suggestions: any[],
    components: any[],
    noGoZones?: any[],
  ): Promise<Buffer> {
    const metadata = await sharp(baseImageBuffer).metadata();
    const width = metadata.width || 800;
    const height = metadata.height || 600;

    // Helper to escape XML characters
    const escapeXml = (unsafe: string) => {
      return unsafe.replace(/[<>&'"]/g, (c) => {
        switch (c) {
          case "<":
            return "&lt;";
          case ">":
            return "&gt;";
          case "&":
            return "&amp;";
          case "'":
            return "&apos;";
          case '"':
            return "&quot;";
          default:
            return c;
        }
      });
    };

    let svgOverlay = `<svg width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" xmlns="http://www.w3.org/2000/svg">`;

    // Embed Google Fonts for correct rendering
    svgOverlay += `
      <defs>
        <style>
          @import url('https://fonts.googleapis.com/css2?family=Inter:wght@400;700&amp;family=Kanit:wght@400;700&amp;family=Mitr:wght@400;700&amp;family=Sriracha&amp;family=Playfair+Display:wght@400;700&amp;family=Roboto+Mono:wght@400;700&amp;display=swap');
          text { font-family: 'Inter', sans-serif; }
        </style>
      </defs>
    `;

    // Draw NO-GO ZONES first (behind text) — green semi-transparent boxes
    if (noGoZones && noGoZones.length > 0) {
      for (const zone of noGoZones) {
        if (!zone.area) continue;
        const zTop = (zone.area.top / 1000) * height;
        const zLeft = (zone.area.left / 1000) * width;
        const zW = (zone.area.width / 1000) * width;
        const zH = (zone.area.height / 1000) * height;
        svgOverlay += `
          <rect x="${zLeft}" y="${zTop}" width="${zW}" height="${zH}" 
                fill="rgba(0, 255, 0, 0.15)" stroke="#00FF00" stroke-width="2" stroke-dasharray="6,3" />
          <text x="${zLeft + 4}" y="${zTop + 14}" fill="#00FF00" font-size="12px" font-family="sans-serif" font-weight="bold">${escapeXml(zone.label || "NO-GO")}</text>
        `;
      }
    }

    // Define shadow filters
    svgOverlay += `
      <defs>
        <filter id="shadow-subtle" x="-5%" y="-5%" width="110%" height="110%">
          <feDropShadow dx="1" dy="1" stdDeviation="2" flood-color="#000000" flood-opacity="0.5"/>
        </filter>
        <filter id="shadow-strong" x="-10%" y="-10%" width="120%" height="120%">
          <feDropShadow dx="2" dy="2" stdDeviation="4" flood-color="#000000" flood-opacity="0.8"/>
        </filter>
      </defs>
    `;

    // 1. Draw Components
    for (const c of components) {
      if (!c.position || typeof c.position.top === "undefined") continue;

      const top = (c.position.top / 1000) * height;
      const left = (c.position.left / 1000) * width;
      const w = (c.position.width / 1000) * width;
      const h = (c.position.height / 1000) * height;
      const rotation = c.position.rotation || 0;

      const transform =
        rotation !== 0
          ? ` transform="rotate(${rotation}, ${left + w / 2}, ${top + h / 2})"`
          : "";

      svgOverlay += `
        <g${transform}>
          <rect x="${left}" y="${top}" width="${w}" height="${h}" fill="rgba(0, 255, 0, 0.15)" stroke="#00FF00" stroke-width="2" />
          <text x="${left + 5}" y="${top + 15}" fill="#00FF00" font-size="12" font-family="sans-serif" font-weight="bold">${escapeXml(c.label || "Component")}</text>
        </g>
      `;
    }

    // 2. Draw Text Layers with shadow + rotation support
    // 2. Draw Text Layers with shadow + rotation support
    for (const [idx, s] of suggestions.entries()) {
      if (!s.position || typeof s.position.top === "undefined") continue;

      const top = (s.position.top / 1000) * height;
      const left = (s.position.left / 1000) * width;
      const w = (s.position.width / 1000) * width;
      const h = (s.position.height / 1000) * height;
      const fontSize = s.style?.font_size_normalized || 40;
      const rotation = s.position?.rotation || 0;
      const fontStyle = s.style?.font_style || "normal";

      const textAnchor =
        s.style?.text_align === "center"
          ? "middle"
          : s.style?.text_align === "right"
            ? "end"
            : "start";
      const textX =
        s.style?.text_align === "center"
          ? left + w / 2
          : s.style?.text_align === "right"
            ? left + w
            : left;

      const lines = (s.part || "").split("\n");
      const lineHeight = s.style?.line_height || 1.2;

      // Filter
      let filterAttr = "";
      if (s.style?.shadow === "strong")
        filterAttr = `filter="url(#shadow-strong)"`;
      else if (s.style?.shadow === "subtle")
        filterAttr = `filter="url(#shadow-subtle)"`;

      // Font
      const fontFamily = s.style?.font_family || "sans-serif";
      const fontWeight = s.style?.font_weight || "normal";

      // Rotation Transform (centered on text block)
      const totalBlockHeight = lines.length * (fontSize * lineHeight);
      const transform =
        rotation !== 0
          ? ` transform="rotate(${rotation}, ${left + w / 2}, ${top + totalBlockHeight / 2})"`
          : "";

      // Fill (Gradient or Solid)
      let fill = s.style?.color_hex || "#FFFFFF";
      if (
        s.style?.text_gradient &&
        Array.isArray(s.style.text_gradient) &&
        s.style.text_gradient.length >= 2
      ) {
        const gradId = `grad-${idx}`;
        const colors = s.style.text_gradient;
        // Inject gradient defs dynamically
        svgOverlay += `
            <defs>
              <linearGradient id="${gradId}" x1="0%" y1="0%" x2="100%" y2="0%">
                <stop offset="0%" style="stop-color:${colors[0]};stop-opacity:1" />
                <stop offset="100%" style="stop-color:${colors[1]};stop-opacity:1" />
              </linearGradient>
            </defs>
          `;
        fill = `url(#${gradId})`;
      }

      // Stroke
      let strokeAttr = "";
      if (s.style?.stroke_hex) {
        const sw = s.style?.stroke_width || 2;
        strokeAttr = `stroke="${s.style.stroke_hex}" stroke-width="${sw * 2}" paint-order="stroke" stroke-linejoin="round"`;
      }

      lines.forEach((line: string, i: number) => {
        // Use fontSize * lineHeight for spacing, but careful with baseline
        // dominant-baseline="hanging" approach in previous code was... strict.
        // Let's stick to standard baseline, allowing 'top' to be the top of the line.
        const lineY = top + (i + 1) * (fontSize * lineHeight);

        // --- RESTORED: Subtle Red Halo (for visibility without clutter) ---
        svgOverlay += `
          <text x="${textX}" y="${lineY}" 
                fill="rgba(255, 0, 0, 0.1)" 
                stroke="rgba(255, 0, 0, 0.1)" stroke-width="${fontSize * 0.25}" paint-order="stroke" 
                font-family="${fontFamily}" font-size="${fontSize}px" font-weight="${fontWeight}" font-style="${fontStyle}" text-anchor="${textAnchor}" letter-spacing="${s.style?.letter_spacing || 0}px"
                ${transform}>${escapeXml(line)}</text>
        `;

        // --- Main Text Layer (with dynamic Stroke & Fill) ---
        svgOverlay += `
          <text x="${textX}" y="${lineY}" 
                fill="${fill}" 
                ${strokeAttr}
                font-family="${fontFamily}" 
                font-size="${fontSize}px" 
                font-weight="${fontWeight}"
                font-style="${fontStyle}"
                text-anchor="${textAnchor}"
                letter-spacing="${s.style?.letter_spacing || 0}px"
                ${filterAttr}${transform}>${escapeXml(line)}</text>
        `;
      });
    }

    svgOverlay += "</svg>";

    return sharp(baseImageBuffer)
      .composite([{ input: Buffer.from(svgOverlay), top: 0, left: 0 }])
      .png()
      .toBuffer();
  }

  /**
   * Step 1.2: AI reviews its own suggestions (as a Professional Graphic Designer)
   */
  async critiqueLayout(
    originalBuffer: Buffer,
    previewBuffer: Buffer,
    mimeType: string,
    targetText: string,
    styleOnly: boolean = false,
  ) {
    const model =
      process.env.GEMINI_MODEL_ENDPOINT_2 ||
      process.env.GEMINI_MODEL_ENDPOINT ||
      "gemini-3-flash-preview";

    // Position checks — skipped when safe zones guarantee placement
    const positionChecks = styleOnly
      ? ""
      : `
      ✗ TEXT BLOCKS OVERLAP EACH OTHER:
        - If two different text elements overlap or are placed on top of each other → FAIL
        - Each text block must have its own clear, separate space
      
      DEPTH LAYERING CONTEXT:
      Some text intentionally overlaps the character for a 3D "poster" effect (character renders in front of text).
      This is GOOD DESIGN — do NOT flag it as an error if the text appears behind the character.
      Only flag text-on-person as BAD if the text is clearly ON TOP of the character's face or body, obscuring them.

      ✗ TEXT OVERLAPS A PERSON'S BODY:
        - Look at IMAGE 2. Every text block has a SEMI-TRANSPARENT RED tint behind it.
        - If that RED tint touches or covers ANY part of a human's FACE or key identifying features → FAIL
        - Text that overlaps the lower body (legs, waist) but remains visually BEHIND the character is ACCEPTABLE depth layering.
        - PAY SPECIAL ATTENTION to the center and lower portions of the image where people typically stand.
        - In this ad, there is likely a woman standing. If you see RED covering her FACE or EYES → FAIL.

      ✗ TEXT OVERLAPS A MASCOT OR CHARACTER'S FACE:
        - If text covers the FACE of any cartoon/mascot figure → FAIL
        - Text overlapping a character's lower body for depth-layer effect → ACCEPTABLE
      
      ✗ TEXT CUT OFF AT EDGES:
        - Any text going past the image boundary → FAIL
      
      ✗ TEXT OR COMPONENT TOO CLOSE TO EDGE (10% SAFE ZONE — NON-NEGOTIABLE):
        - ALL text (except FinePrint) must have at least 10% margin from ANY edge of the image
        - ALL components (mascots, die-cuts, decorative images) must have at least 10% margin from ANY edge
        - In normalized coordinates (0-1000): elements must NOT start before 100 or extend past 900
        - Text/components crammed against the edge look cheap, get cut off in print → HARD FAIL
        - FinePrint is allowed to be closer to the bottom edge (min 1.5% / 15 in normalized coords)
      
      ✗ COMPONENT CUT OFF OR CROPPED AT EDGE:
        - If any mascot, character, die-cut, or decorative image extends beyond the canvas boundary → FAIL
        - Components should feel intentionally placed, not accidentally cropped
      
      ✗ COMPONENT OVERLAPS KEY TEXT or FACE IN A BAD WAY:
        - If a component image covers the promotional number (offer) or headline text → FAIL
        - Components may overlap secondary text for layering depth → ACCEPTABLE
        - Components covering a person's face in the base photo → FAIL
    `;

    const componentChecks = `
      ═══════════════════════════════════════
      COMPONENT POSITION CHECKS (Mascots, Die-cuts, Decorative elements):
      ═══════════════════════════════════════
      Look at IMAGE 2 for any overlaid component images (PNGs/die-cuts).
      
      ✓ IDEAL component placement:
        - Component anchored to one SIDE of canvas (left or right), leaving clear text zone on opposite side
        - Component vertically centered or placed lower third for visual balance
        - Component does NOT touch or cross any canvas edge
      
      ✗ COMPONENT PROBLEMS TO FLAG:
        - Component is cut off at any edge (top, bottom, left, right) → FAIL + recommend moving inward 5%
        - Component covers promotional number / headline text → FAIL + recommend moving to opposite side
        - Component in CENTER of canvas blocking all text space → FAIL + recommend left/right placement
        - Two components stacked on top of each other → FAIL
      
      In actionable_steps, add component moves EXPLICITLY:
        - "Move mascot component from left:800 to left:700 to prevent right-edge crop"
        - "Move character from top:0 to top:50 to give 5% top margin"
        - "Move product image to left side (left:30) to free right side for text"
    `;

    const styleChecks = `
      ✗ TEXT COLOR BLENDS WITH BACKGROUND:
        - If text color is too similar to the area directly behind it → FAIL
        - Light text (white/yellow/light green) on a photo of sky/trees/plants = FAIL (not enough contrast)
        - The text MUST contrast sharply with whatever photo/pattern is behind it
      
      ✗ TEXT OVER PHOTO WITHOUT SHADOW:
        - If text sits on top of a photograph (not a solid color band) and has no shadow → FAIL
        - Only text on a SOLID, HIGH-CONTRAST block of color can skip shadow
      
      ✗ FORBIDDEN: Text spanning across very high-contrast edges without proper Stroke/Background is a FAIL.
    `;

    const modeNote = styleOnly
      ? `\n      NOTE: Text positions have been verified by code (safe zone placement). Focus ONLY on visual style quality — colors, shadows, contrast, readability. Do NOT critique positions.\n`
      : "";

    const prompt = `
      You are the STRICTEST ART DIRECTOR in the advertising industry.
      You have been given TWO images:
      - IMAGE 1: The ORIGINAL reference image (the raw background photo)
      - IMAGE 2: The PREVIEW showing text overlays placed on top of the background

      AD BRIEF: "${targetText}"
      ${modeNote}
      ═══════════════════════════════════════
      MANDATORY VISUAL INSPECTION (YOU MUST DO THIS FIRST):
      ═══════════════════════════════════════
      
      Before making ANY judgment, you MUST examine IMAGE 2 (the PREVIEW) and answer these questions for EACH visible text block:
      
      For each text overlay you see in IMAGE 2:
        Q1: "What is DIRECTLY BEHIND this text?" (e.g., sky, person's shoulder, face, background, etc.)
        Q2: "Is the FACE or EYES of a human obscured?" (yes/no)
        Q3: "If body parts are obscured, is it just secondary areas like shoulders/arms?" (yes/no)
        Q4: "Can I read this text easily, or does the color blend with the background?"
      
      You MUST list your findings for EACH text block in your feedback. Do NOT skip this step.
      
      ═══════════════════════════════════════
      CRITIQUE CRITERIA (PROFESSIONAL STANDARD):
      ═══════════════════════════════════════
      
      ✓ ALLOWED: Overlapping secondary body parts (shoulders, hair outskirts, legs) is ACCEPTABLE if it improves the overall layout and flow.
      
      ✗ FORBIDDEN: Obscuring the FACE, EYES, or key identifying features of the subject is a HARD FAIL.
      
      ✗ NO TEXT OR MISSING TEXT:
        - If IMAGE 2 has NO visible text at all → FAIL
        - If key text from the AD BRIEF is missing (headline, offer, fine print) → FAIL
        - An ad with no text is not an ad. Automatic FAIL.
      
      ${positionChecks}
      ${componentChecks}
      ${styleChecks}
      
      NOTE ON FINE PRINT: Legal disclaimers, terms, and conditions (hierarchy="FinePrint") are ALLOWED to be very small (font_size 8-16). Do NOT fail them for being small. That is intentional.
      
      ═══════════════════════════════════════
      QUALITY CHECKS:
      ═══════════════════════════════════════
      
      ○ VISUAL HIERARCHY: Is headline the largest? Is fine print the smallest?
      ○ BALANCE: Professional layout, not cluttered?
      ○ INTENT: Does it match the brief?
      
      ═══════════════════════════════════════
      YOUR DEFAULT SHOULD BE "FAIL":
      ═══════════════════════════════════════
      
      Assume the layout FAILS unless you can prove every single text block passes ALL checks.
      DO NOT be generous. DO NOT give benefit of the doubt.
      If you are even slightly unsure whether text overlaps a person → FAIL.
      
      Return as STRICT JSON:
      {
        "status": "PASS" | "FAIL",
        "confidence": <number 0.0-1.0: how confident you are in this verdict. 0.95 = very sure, 0.5 = unsure>,
        "feedback": "Start by listing what you see behind EACH text block. Then explain your verdict.",
        "actionable_steps": ["Specific fix 1", "Specific fix 2", ...]
      }
      
      In actionable_steps, be VERY specific:
      - "Move 'ชวนลูกค้า...' text from top:400 to top:50 to clear the woman's body"
      - "Change text color from #FFFFFF to #FFD700 for contrast"
      - "Add shadow='strong' to headline text over photograph area"
      - "Move ALL text below top:700 into the solid purple band"
    `;

    try {
      console.log(`[AI-TRACE] [Critique] Prompt:\n${prompt}`);
      const response = await this.withRetry(() =>
        this.client.models.generateContent({
          model,
          contents: [
            {
              role: "user",
              parts: [
                {
                  inlineData: {
                    data: originalBuffer.toString("base64"),
                    mimeType,
                  },
                },
                {
                  inlineData: {
                    data: previewBuffer.toString("base64"),
                    mimeType: "image/png",
                  },
                },
                { text: prompt },
              ],
            },
          ],
        }),
      );

      const text = response.text || "";
      traceAI("Critique Layout", prompt, text);

      const jsonStr =
        text.match(/\{[\s\S]*\}/)?.[0] ||
        '{"status": "FAIL", "feedback": "Could not extract JSON from response", "actionable_steps": []}';

      try {
        return JSON.parse(jsonStr);
      } catch (parseErr) {
        // Try to fix common JSON issues: bad escape characters
        console.error(
          "[GenAI] Critique JSON parse failed, attempting cleanup...",
        );
        console.log("[GenAI] Raw JSON string:", jsonStr.substring(0, 1000));

        const cleaned = jsonStr
          .replace(/\\'/g, "'") // fix escaped single quotes
          .replace(/\\([^"\\\/bfnrtu])/g, "$1") // remove invalid escape sequences
          .replace(/[\x00-\x1F\x7F]/g, " "); // remove control characters

        try {
          return JSON.parse(cleaned);
        } catch (e2) {
          console.error("[GenAI] Critique cleanup also failed:", e2);
          // FAIL-SAFE: If we can't parse, assume FAIL (not PASS!)
          return {
            status: "FAIL",
            feedback:
              "AI critique response could not be parsed. Treating as FAIL for safety.",
            actionable_steps: ["Re-run the critique with cleaner output"],
          };
        }
      }
    } catch (e) {
      console.error("[GenAI] Critique error:", e);
      // FAIL-SAFE: Network/API errors should also FAIL (not PASS!)
      return {
        status: "FAIL",
        feedback:
          "Critique failed due to an error. Treating as FAIL for safety.",
        actionable_steps: [],
      };
    }
  }

  /**
   * Extractor helper: parses AI response containing <META> and <HTML_OVERLAY> tags
   * to avoid embedding unescaped HTML quotes/newlines inside a JSON string.
   */
  private parseHTMLResponse(raw: string): any {
    let meta = {};
    let htmlContent = "";

    const metaMatch = raw.match(/<META>([\s\S]*?)<\/META>/i);
    const htmlMatch = raw.match(/<HTML_OVERLAY>([\s\S]*?)<\/HTML_OVERLAY>/i);

    if (metaMatch || htmlMatch) {
      if (metaMatch) {
        const metaStr = metaMatch[1].trim();
        try {
          meta = JSON.parse(metaStr);
        } catch {
          console.warn(
            "[parseHTMLResponse] META JSON parse failed, attempting repair",
          );
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
            console.error("[parseHTMLResponse] META JSON repair failed too", e);
          }
        }
      }
      if (htmlMatch) {
        htmlContent = htmlMatch[1].trim();
      }
      return { ...meta, html_overlay: htmlContent };
    }

    // Fallback: Legacy full-JSON mode if tags completely missing
    console.warn(
      "[parseHTMLResponse] Delimiter tags missing, falling back to legacy JSON parse.",
    );
    const cleanedRaw = raw
      .trim()
      .replace(/```json|```|```html/g, "")
      .trim();
    try {
      return JSON.parse(cleanedRaw);
    } catch {
      const repaired =
        cleanedRaw.replace(/,\s*$/, "") +
        "}".repeat(
          Math.max(
            0,
            (cleanedRaw.match(/{/g) || []).length -
              (cleanedRaw.match(/}/g) || []).length,
          ),
        ) +
        '"'.repeat((cleanedRaw.match(/(?<![\\])"([^"]*?)$/g) || []).length % 2);
      const cleaned = repaired
        .replace(/\\'/g, "'")
        .replace(/\\([^"\\\/bfnrtu])/g, "$1")
        .replace(/[\x00-\x1F\x7F]/g, " ");
      return JSON.parse(cleaned);
    }
  }

  /**
   * Extractor helper: parses AI response containing <META> and <SVG_OVERLAY> tags.
   * SVG equivalent of parseHTMLResponse — looks for <SVG_OVERLAY> instead of <HTML_OVERLAY>.
   */
  private parseSVGResponse(raw: string): any {
    let meta = {};
    let svgContent = "";

    console.log(`[parseSVGResponse] Raw response length: ${raw.length} chars`);

    // 1. Extract SVG Content (Preferred Tags: <SVG_OVERLAY>, Fallback: [SVG_OVERLAY])
    const svgMatchClosed =
      raw.match(/<(?:SVG_OVERLAY|SVG)>([\s\S]*?)<\/(?:SVG_OVERLAY|SVG)>/i) ||
      raw.match(/\[(?:SVG_OVERLAY|SVG)\]([\s\S]*?)\[\/(?:SVG_OVERLAY|SVG)\]/i);

    const svgMatchOpen =
      raw.match(/<(?:SVG_OVERLAY|SVG)>([\s\S]*)/i) ||
      raw.match(/\[(?:SVG_OVERLAY|SVG)\]([\s\S]*)/i);

    if (svgMatchClosed) {
      svgContent = svgMatchClosed[1].trim();
    } else if (svgMatchOpen) {
      console.warn(
        "[parseSVGResponse] SVG tag was truncated — no closing tag found, using greedy match",
      );
      svgContent = svgMatchOpen[1].trim();
      // If we grabbed everything and META is after SVG, strip it out
      if (svgContent.includes("<META>")) {
        svgContent = svgContent.split(/<META>/i)[0].trim();
      } else if (svgContent.includes("[META]")) {
        svgContent = svgContent.split(/\[META\]/i)[0].trim();
      }
    }

    // 2. Extract META Content
    const metaMatch =
      raw.match(/<META>([\s\S]*?)<\/META>/i) ||
      raw.match(/\[META\]([\s\S]*?)\[\/META\]/i);
    const metaMatchOpen =
      raw.match(/<META>([\s\S]*)/i) || raw.match(/\[META\]([\s\S]*)/i);

    let metaStr = "";
    if (metaMatch) {
      metaStr = metaMatch[1].trim();
    } else if (metaMatchOpen) {
      // If we matched SVG first and it stripped META, this might be null.
      // But we check metaMatchOpen on the original raw.
      metaStr = metaMatchOpen[1].trim();
    }

    if (metaStr) {
      try {
        meta = JSON.parse(metaStr);
      } catch {
        // Attempt Repair
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

    // 3. Last Resort Fallbacks for SVG
    if (!svgContent || svgContent.length < 50) {
      // Fallback: Markdown code fence
      const fenceMatch =
        raw.match(/```(?:svg|xml|SVG)?\s*([\s\S]*?)<\/svg>/i) ||
        raw.match(/```(?:svg|xml|SVG)?\s*([\s\S]*?)```/i);
      if (fenceMatch) {
        const extracted = fenceMatch[1].includes("<svg")
          ? fenceMatch[1].slice(fenceMatch[1].indexOf("<svg"))
          : fenceMatch[1];
        if (extracted.length > 50) {
          svgContent = extracted.trim();
          if (!svgContent.endsWith("</svg>")) svgContent += "</svg>";
          console.log(
            `[parseSVGResponse] Fallback: Extracted SVG from code fence (${svgContent.length} chars)`,
          );
        }
      }

      // Fallback: Bare <svg> tag
      if (!svgContent || svgContent.length < 50) {
        const bareSvgMatch =
          raw.match(/<svg[\s\S]*?<\/svg>/i) || raw.match(/<svg[\s\S]*/i);
        if (bareSvgMatch) {
          svgContent = bareSvgMatch[0].trim();
          if (!svgContent.endsWith("</svg>")) svgContent += "</svg>";
          console.log(
            `[parseSVGResponse] Fallback: Extracted bare <svg> block (${svgContent.length} chars)`,
          );
        }
      }
    }

    if (svgContent) {
      // Final sanitization: ensure it has proper closing tags if truncated
      if (!svgContent.includes("</svg>")) {
        const openGs =
          (svgContent.match(/<g[^/]*/g) || []).length -
          (svgContent.match(/<\/g>/g) || []).length;
        svgContent += "</g>".repeat(Math.max(0, openGs)) + "</svg>";
      }
      console.log(
        `[parseSVGResponse] ✅ Extracted svg_overlay: ${svgContent.length} chars`,
      );
    } else {
      console.warn(
        "[parseSVGResponse] All extraction methods failed. Raw snippet:\n" +
          raw.slice(0, 800),
      );
    }

    return { ...meta, svg_overlay: svgContent };
  }

  /**
   * Task B: HTML/CSS layout generation — AI outputs html_overlay string
   * instead of JSON coordinates. Uses cqw units for font sizes and
   * text-shadow/text-stroke for contrast (no dark boxes).
   */
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
    html_overlay: string;
    background_description: string;
    campaign_vibe: string;
    no_go_zones: any[];
    components: any[];
  }> {
    let processingBuffer = imageBuffer;
    let processingMime = mimeType;
    try {
      processingBuffer = await sharp(imageBuffer)
        .resize(
          Math.min(1500, (await sharp(imageBuffer).metadata()).width || 1500),
        )
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
      `- "${c.label}": left=${(c.left / 10).toFixed(0)}% to ${((c.left + c.width) / 10).toFixed(0)}%, top=${(c.top / 10).toFixed(0)}% to ${((c.top + c.height) / 10).toFixed(0)}%`,
  )
  .join("\n")}
`
      : "";

    const textZoneBlock = artDirectorTextZone
      ? `
TEXT ZONE (place most text here):
  x-range: ${(artDirectorTextZone.left / 10).toFixed(0)}% to ${((artDirectorTextZone.left + artDirectorTextZone.width) / 10).toFixed(0)}%
  y-range: ${(artDirectorTextZone.top / 10).toFixed(0)}% to ${((artDirectorTextZone.top + artDirectorTextZone.height) / 10).toFixed(0)}%
`
      : "";

    const prompt = `You are a senior Thai advertising art director generating HTML/CSS for a campaign ad canvas.

AD BRIEF:
"""
${targetText}
"""
${strategyBlock}${componentsBlock}${textZoneBlock}
═══════════════════════════════════════
CANVAS COORDINATE SYSTEM
═══════════════════════════════════════
- Container: position:relative, container-type:inline-size, aspect ratio ~1:1
- Position text groups: position:absolute, top/left in %
- Font sizes: cqw units (container query width):
    * Promotional numbers (offer, %, ×, price): 12-18cqw  ← HUGE and dominant
    * Headline/sub-headline: 3.5-5.5cqw
    * Body text: 2.5-3.5cqw
    * Fine print / legal: 1.0-1.5cqw (intentionally tiny)

═══════════════════════════════════════
CONTRAST — MANDATORY (NO dark boxes allowed)
═══════════════════════════════════════
Use text-shadow ONLY for contrast. NO background-color on text elements.
Multi-layer text-shadow creates a thick colored outline effect:
- On photo backgrounds: "2px 2px 0 #000,-2px -2px 0 #000,2px -2px 0 #000,-2px 2px 0 #000,0 4px 12px rgba(0,0,0,0.8)"
- On solid-color areas: "1px 1px 3px rgba(0,0,0,0.7)"
- For light-colored text on dark: "0 2px 6px rgba(0,0,0,0.6)"
Also use: -webkit-text-stroke: "2px rgba(0,0,0,0.5)" for bold outlines on big text.

═══════════════════════════════════════
LAYOUT RULES — TEXT
═══════════════════════════════════════
1. Group related text in ONE flex-column div (number + label stacked = 1 group, NOT scattered)
2. Promotional number MUST be its own <span> with 12-18cqw — DOMINANT above all other text
3. Fine print: position:absolute; bottom:2%; left:5%; font-size:1.0-1.2cqw; opacity:0.85
4. Use gap between grouped elements (gap: 0.3cqw) rather than separate absolute positions
5. font-family: ALWAYS 'Kanit', sans-serif — no exceptions
6. All positioning: % units for top/left (NOT px or vw)
7. Color: check image — use white (#fff) on dark areas, golden (#FFD700) for promo numbers
8. Line-height: 1.0 for promo numbers, 1.2-1.3 for headlines, 1.4 for body
9. z-index: 5 for text groups
10. max-width:45% on text groups to avoid overflow

═══════════════════════════════════════
SAFE ZONE — NON-NEGOTIABLE (APPLIES TO BOTH TEXT AND COMPONENTS)
═══════════════════════════════════════
Canvas has a STRICT 5% padding on ALL four edges. Nothing may cross this boundary.
  - top: minimum 5% from top edge
  - bottom: maximum 93% (text), 95% (fine print only)
  - left: minimum 5% from left edge
  - right: text must end before 95% (use max-width to enforce)
Violating this makes the ad look cut-off and amateurish → REJECTED.

═══════════════════════════════════════
COMPONENT PLACEMENT RULES
═══════════════════════════════════════
Components (mascots, die-cuts, product images) are placed as JSON, NOT in html_overlay.
Your job: set suggested_position for each component to achieve ideal composition.

RULES:
1. ANCHOR to one side: component should sit left OR right, freeing the other half for text
2. 5% SAFE ZONE: component top/left/bottom/right must all stay within 5% of canvas edges
   - In normalized 0-1000: top≥50, left≥50, (left+width)≤950, (top+height)≤950
3. Do NOT center components — centered blocks text space
4. Scale component to fill 40-60% of canvas height for visual impact
5. Use z_index: 15 for components (renders in front of text)
6. interaction_zone: DISABLED — set enabled = false (no intentional overlap until system is ready)

COMPONENT SIDE-ANCHOR PATTERN (preferred):
  - Mascot on RIGHT → text group on LEFT (left:5% to left:50%)
  - Product on LEFT → text group on RIGHT (left:50% to left:90%)


═══════════════════════════════════════
WHAT TO RETURN
═══════════════════════════════════════
Return TWO parts exactly using these XML delimiters: <META> and <HTML_OVERLAY>.
Do NOT wrap the HTML inside a JSON string. Separate them!

<META>
{
  "background_description": "Scene without overlaid elements",
  "campaign_vibe": "Energetic | Bold | Luxury | Playful",
  "no_go_zones": [
    { "label": "Woman face", "priority": "HIGH", "area": { "top": 50, "left": 400, "width": 200, "height": 200 }, "reason": "face" }
  ],
  "components": [
    {
      "label": "Thai mascot",
      "description": "Visual description",
      "position": { "top": 600, "left": 600, "width": 350, "height": 400, "rotation": 0 },
      "suggested_position": { "top": 100, "left": 500, "width": 450, "height": 850, "rotation": 0, "rationale": "..." },
      "z_index": 15,
      "interaction_zone": { "enabled": false, "overlap_top": 200, "overlap_left": 500, "overlap_width": 200, "overlap_height": 500 }
    }
  ]
}
</META>
<HTML_OVERLAY>
<div style='position:absolute;inset:0;pointer-events:none;overflow:hidden'>
  CONTENT_HERE
</div>
</HTML_OVERLAY>

Example html_overlay for "2 ต่อ รับฟรี บัตรขึ้นชิงช้าสวรรค์":
"<div style='position:absolute;inset:0;pointer-events:none;overflow:hidden'><div style='position:absolute;top:52%;left:4%;z-index:5;display:flex;flex-direction:column;gap:0.5cqw;max-width:45%'><span style='font-family:Kanit,sans-serif;font-size:16cqw;font-weight:900;color:#FFD700;line-height:1.0;letter-spacing:-0.03em;text-shadow:2px 2px 0 #000,-2px -2px 0 #000,2px -2px 0 #000,-2px 2px 0 #000,0 4px 12px rgba(0,0,0,0.8);-webkit-text-stroke:2px rgba(0,0,0,0.4)'>2 ต่อ</span><span style='font-family:Kanit,sans-serif;font-size:3.5cqw;font-weight:700;color:#fff;line-height:1.25;text-shadow:1px 1px 0 #000,-1px -1px 0 #000,0 3px 8px rgba(0,0,0,0.7)'>รับฟรี บัตรขึ้นชิงช้าสวรรค์</span></div><div style='position:absolute;bottom:1.5%;left:2%;z-index:5'><span style='font-family:Kanit,sans-serif;font-size:1.1cqw;font-weight:400;color:rgba(255,255,255,0.8)'>เงื่อนไขเป็นไปตามที่ธนาคารกำหนด</span></div></div>"`;

    const htmlConfig: any = {
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
              {
                inlineData: {
                  data: processingBuffer.toString("base64"),
                  mimeType: processingMime,
                },
              },
              { text: prompt },
            ],
          },
        ],
        config: htmlConfig,
      }),
    );

    const raw = response.text || "";
    let parsed: any;
    try {
      parsed = this.parseHTMLResponse(raw);
    } catch (err) {
      console.error("[suggestLayoutHTML] Failed to parse response.", err);
      parsed = { html_overlay: "" };
    }

    if (
      !parsed.html_overlay ||
      typeof parsed.html_overlay !== "string" ||
      parsed.html_overlay.length < 50
    ) {
      throw new Error(
        "[suggestLayoutHTML] AI returned empty or invalid html_overlay",
      );
    }
    // Basic XSS guard
    if (/<script|<iframe|javascript:/i.test(parsed.html_overlay)) {
      throw new Error(
        "[suggestLayoutHTML] html_overlay contains disallowed content",
      );
    }

    console.log(
      `[HTML] Overlay generated (${parsed.html_overlay.length} chars). Vibe: "${parsed.campaign_vibe}". Components: ${parsed.components?.length || 0}`,
    );
    return parsed;
  }

  /**
   * SVG layout generation — AI outputs svg_overlay string.
   * Uses absolute px coordinates based on actual canvas size.
   * Box-model mental model: <g transform> = container, <rect> = background, <tspan dy> = line stack.
   * @deprecated Use suggestFlexLayout() instead
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
    // Resize for AI processing and get canvas dimensions
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

    // Step 1: Compute text-safe zone from component bounding boxes (used when no artDirectorTextZone)
    const computedTextZone = (() => {
      if (!fixedComponentPositions?.length) return null;

      const leftCov = fixedComponentPositions.reduce((acc, c) => {
        const overlap = Math.max(
          0,
          Math.min(c.left + c.width, 500) - Math.max(c.left, 0),
        );
        return acc + overlap * c.height;
      }, 0);
      const rightCov = fixedComponentPositions.reduce((acc, c) => {
        const overlap = Math.max(
          0,
          Math.min(c.left + c.width, 1000) - Math.max(c.left, 500),
        );
        return acc + overlap * c.height;
      }, 0);

      const INSET = 30; // normalized padding from component edge and canvas edge

      if (leftCov <= rightCov) {
        // Left side freer — find the leftmost component edge as the right boundary
        const rightEdge = Math.min(
          ...fixedComponentPositions.map((c) => c.left),
          950,
        );
        const zoneWidth = Math.max(rightEdge - 50 - INSET, 250); // 50 = left inset
        return { top: 50, left: 50, width: zoneWidth, height: 900 };
      } else {
        // Right side freer — find the rightmost component edge as the left boundary
        const leftEdge = Math.max(
          ...fixedComponentPositions.map((c) => c.left + c.width),
          50,
        );
        const zoneLeft = Math.min(leftEdge + INSET, 950 - 200); // guarantee at least 200 wide
        const zoneWidth = 950 - zoneLeft; // to canvas right edge
        return { top: 50, left: zoneLeft, width: zoneWidth, height: 900 };
      }
    })();

    // If computed zone is too narrow to be useful (< 250/1000 normalized width),
    // fall back to full-canvas mode so the LLM can use the entire canvas.
    // artDirectorTextZone is an explicit override and bypasses the narrow guard.
    const effectiveTextZone = (() => {
      if (artDirectorTextZone) return artDirectorTextZone;
      if (!computedTextZone) return null;
      // 250/1000 normalized = 25% of canvas — minimum for readable text
      if (computedTextZone.width < 250) return null;
      return computedTextZone;
    })();

    // Compute text zone in absolute canvas px
    const textZonePx = effectiveTextZone
      ? {
          x: Math.round((effectiveTextZone.left / 1000) * canvasWidth),
          y: Math.round((effectiveTextZone.top / 1000) * canvasHeight),
          w: Math.round((effectiveTextZone.width / 1000) * canvasWidth),
          h: Math.round((effectiveTextZone.height / 1000) * canvasHeight),
        }
      : null;

    // Always use actual canvas coordinates — LLM sees the full image so it naturally thinks in canvas px.
    // Zone enforcement happens via post-processing (_enforceZoneBounds), not virtual canvas coords.
    const safeX = textZonePx
      ? textZonePx.x + Math.round(textZonePx.w * 0.04)
      : Math.round(canvasWidth * 0.05);
    const safeY = textZonePx
      ? textZonePx.y + Math.round(textZonePx.h * 0.04)
      : Math.round(canvasHeight * 0.05);
    const maxX = textZonePx
      ? textZonePx.x + textZonePx.w - 20
      : Math.round(canvasWidth * 0.95);
    const maxY = textZonePx
      ? textZonePx.y + textZonePx.h - 20
      : Math.round(canvasHeight * 0.95);
    const maxTextWidth = textZonePx
      ? Math.round(textZonePx.w * 0.9)
      : Math.round(canvasWidth * 0.45);

    // In container mode, componentsBlock is omitted — the zone IS the safe area.
    // In full-canvas mode, show forbidden zones so LLM avoids components.
    const componentsBlock =
      !textZonePx && fixedComponentPositions?.length
        ? `
FORBIDDEN TEXT ZONES — component bounding boxes in px (absolute). Text groups MUST NOT enter these rectangles:
${fixedComponentPositions
  .map((c) => {
    const x1 = Math.round((c.left / 1000) * canvasWidth);
    const y1 = Math.round((c.top / 1000) * canvasHeight);
    const x2 = Math.round(((c.left + c.width) / 1000) * canvasWidth);
    const y2 = Math.round(((c.top + c.height) / 1000) * canvasHeight);
    return `  ❌ "${c.label}": x ${x1}–${x2}px, y ${y1}–${y2}px`;
  })
  .join("\n")}
`
        : "";

    // Text zone expressed in ABSOLUTE canvas coords — LLM naturally anchors to the image visually.
    // Post-processing (_enforceZoneBounds) deterministically clamps any out-of-zone placements.
    const textZoneBlock = textZonePx
      ? `
═══════════════════════════════════════
PRE-DEFINED TEXT ZONE — ABSOLUTE CANVAS COORDINATES
═══════════════════════════════════════
The backend computed this zone from component bounding boxes. ALL text must stay inside it.

  Text zone x: ${textZonePx.x}px  to  ${textZonePx.x + textZonePx.w}px
  Text zone y: ${textZonePx.y}px  to  ${textZonePx.y + textZonePx.h}px

Every <g transform="translate(TX,TY)"> MUST satisfy:
  TX >= ${textZonePx.x} AND TX <= ${textZonePx.x + textZonePx.w - 50}
  TY >= ${textZonePx.y} AND TY <= ${textZonePx.y + textZonePx.h - 50}
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
Allowed text area: min x=${safeX}px, min y=${safeY}px, max x=${maxX}px, max y=${maxY}px

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
FONT SIZES — scaled to text zone width (${maxTextWidth}px available)
═══════════════════════════════════════
- Promotional numbers (offer, %, ×, price): ${Math.round(maxTextWidth * 0.3)}-${Math.round(maxTextWidth * 0.45)}px  ← HUGE and dominant
- Headline / sub-headline: ${Math.round(maxTextWidth * 0.08)}-${Math.round(maxTextWidth * 0.12)}px
- Body text: ${Math.round(maxTextWidth * 0.06)}-${Math.round(maxTextWidth * 0.08)}px
- Fine print / legal: ${Math.round(maxTextWidth * 0.025)}-${Math.round(maxTextWidth * 0.035)}px
Max text block width: ${maxTextWidth}px — stay within this width, wrap text with <tspan> if needed.

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
8. ⚠️ CRITICAL — STAY IN CONTAINER: Every translate(TX,TY) MUST be inside the PRE-DEFINED TEXT CONTAINER above. This is a hard clip boundary — anything outside is invisible. Do NOT place any block outside the container x/y bounds.

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
RETURN FORMAT — OUTPUT <SVG_OVERLAY> FIRST, THEN <META>
═══════════════════════════════════════
No markdown fences. No JSON wrapping of SVG. SVG first, META second.

<SVG_OVERLAY>
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${canvasWidth} ${canvasHeight}" width="${canvasWidth}" height="${canvasHeight}">
  <defs>
    <filter id="f0" x="-20%" y="-20%" width="140%" height="140%">
      <feDropShadow dx="2" dy="4" stdDeviation="6" flood-color="#000" flood-opacity="0.85"/>
    </filter>
  </defs>
  <g id="text-overlay">
    <g id="block-promo" transform="translate(X_PX, Y_PX)">
      <text x="0" y="FONT_PX" font-family="Kanit, sans-serif" font-size="FONT_PX" font-weight="900" fill="#FFD700" stroke="rgba(0,0,0,0.45)" stroke-width="10" paint-order="stroke fill" filter="url(#f0)">
        <tspan x="0" dy="0">PROMO_TEXT</tspan>
        <tspan x="0" dy="1.1em" font-size="HEADLINE_PX" font-weight="700" fill="#fff">HEADLINE</tspan>
        <tspan x="0" dy="1.3em" font-size="BODY_PX" font-weight="400" fill="#fff">SUBTEXT</tspan>
      </text>
    </g>
    <g id="block-fine" transform="translate(${safeX}, ${maxY - 10})">
      <text x="0" y="0" font-family="Kanit, sans-serif" font-size="${Math.round(maxTextWidth * 0.035)}" fill="rgba(255,255,255,0.8)">FINE_PRINT</text>
    </g>
  </g>
</svg>
</SVG_OVERLAY>
<META>
{
  "background_description": "...",
  "campaign_vibe": "...",
  "no_go_zones": [{ "label": "face", "priority": "HIGH", "area": { "top": 0, "left": 0, "width": 0, "height": 0 }, "reason": "face" }],
  "components": [{ "label": "name", "position": { "top": 0, "left": 0, "width": 0, "height": 0, "rotation": 0 }, "suggested_position": { "top": 0, "left": 0, "width": 0, "height": 0, "rotation": 0, "rationale": "..." }, "z_index": 15, "interaction_zone": { "enabled": false, "overlap_top": 0, "overlap_left": 0, "overlap_width": 0, "overlap_height": 0 } }]
}
</META>

Replace ALL placeholders with real campaign copy and computed pixel values.

CRITICAL Y-POSITION RULE (MUST FOLLOW):
- For a text group with translate(X, Y_PX): the BOTTOM of the last text line must stay within maxY=${maxY}px
- Formula: Y_PX + (first_font_size * 1.05) + (headline_font_size * 1.1) + (body_font_size * 1.3) < ${maxY}
- Fine print line: ALWAYS translate(${safeX}, ${maxY - 15}) — do NOT put it lower than maxY`;

    console.log("[SVG] Prompt length:", prompt.length, "chars");
    const svgConfig: any = {
      temperature: 0.9,
      topP: 0.95,
      safetySettings: [
        { category: "HARM_CATEGORY_HATE_SPEECH", threshold: "OFF" },
        { category: "HARM_CATEGORY_DANGEROUS_CONTENT", threshold: "OFF" },
        { category: "HARM_CATEGORY_SEXUALLY_EXPLICIT", threshold: "OFF" },
        { category: "HARM_CATEGORY_HARASSMENT", threshold: "OFF" },
      ],
    };

    console.log(`[AI-TRACE] [SuggestSVG] Prompt:\n${prompt}`);
    const response = await this.withRetry(() =>
      this.client.models.generateContent({
        model,
        contents: [
          {
            role: "user",
            parts: [
              {
                inlineData: {
                  data: processingBuffer.toString("base64"),
                  mimeType: processingMime,
                },
              },
              { text: prompt },
            ],
          },
        ],
        config: svgConfig,
      }),
    );

    const raw = response.text || "";
    traceAI("Suggest Layout SVG", prompt, raw, {
      canvasWidth,
      canvasHeight,
      textZonePx,
    });
    let parsed: any;
    try {
      parsed = this.parseSVGResponse(raw);
    } catch (err) {
      console.error("[suggestLayoutSVG] Failed to parse response.", err);
      parsed = { svg_overlay: "" };
    }

    if (
      !parsed.svg_overlay ||
      typeof parsed.svg_overlay !== "string" ||
      parsed.svg_overlay.length < 50
    ) {
      throw new Error(
        "[suggestLayoutSVG] AI returned empty or invalid svg_overlay",
      );
    }
    if (/<script|<iframe|javascript:/i.test(parsed.svg_overlay)) {
      throw new Error(
        "[suggestLayoutSVG] svg_overlay contains disallowed content",
      );
    }

    // Post-process: clamp any out-of-zone translate(X,Y) values back into the text zone.
    if (textZonePx) {
      parsed.svg_overlay = this._enforceZoneBounds(
        parsed.svg_overlay,
        textZonePx,
      );
      parsed.svg_overlay = this._injectZoneClip(parsed.svg_overlay, textZonePx);
    }

    console.log(
      `[SVG] Overlay generated (${parsed.svg_overlay.length} chars). Vibe: "${parsed.campaign_vibe}". Components: ${parsed.components?.length || 0}`,
    );
    return parsed;
  }

  /**
   * Ask the AI for Layout Intent JSON — creative decisions only (text blocks,
   * hierarchy, colors, approximate font sizes).  The server-side svgBuilder
   * will turn this into pixel-perfect SVG, so the AI never has to do spatial math.
   * @deprecated Use suggestFlexLayout() instead
   */
  async suggestLayoutIntent(
    imageBuffer: Buffer,
    mimeType: string,
    targetText: string,
    textZone: { x: number; y: number; w: number; h: number },
    canvasSize: { w: number; h: number },
    layoutHint?: {
      layout_concept: string;
      dominant_element: string;
      text_hierarchy: string[];
      composition_notes: string;
    },
  ): Promise<{
    blocks: Array<{
      text: string;
      role:
        | "promo"
        | "headline"
        | "subheadline"
        | "body"
        | "offer"
        | "fineprint";
      fontSize: number;
      fontWeight: string;
      color: string;
      strokeColor?: string;
      strokeWidth?: number;
      align?: "left" | "center" | "right";
    }>;
    campaign_vibe: string;
    background_description: string;
  }> {
    // ── Image preprocessing (same as suggestLayoutSVG) ──
    let processingBuffer = imageBuffer;
    let processingMime = mimeType;
    try {
      const meta = await sharp(imageBuffer).metadata();
      const origW = meta.width || canvasSize.w;
      processingBuffer = await sharp(imageBuffer)
        .resize(Math.min(1500, origW))
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

    // ── Build prompt ──
    const strategyBlock = layoutHint
      ? `
ART DIRECTOR STRATEGY:
- Concept: ${layoutHint.layout_concept}
- Dominant element: "${layoutHint.dominant_element}"
- Text hierarchy: ${layoutHint.text_hierarchy.join(" › ")}
- Notes: ${layoutHint.composition_notes}`
      : "";

    const prompt = `You are a professional Thai advertising art director.

Your task: Decide the TEXT CONTENT, VISUAL HIERARCHY, COLORS, and APPROXIMATE FONT SIZES for an advertising campaign overlay.

IMPORTANT: You are NOT generating SVG or HTML. You are providing creative direction as structured JSON.
The server will handle exact pixel placement — you focus on creative decisions only.

CAMPAIGN TEXT TO USE:
${targetText}
${strategyBlock}

TEXT ZONE AVAILABLE: ${textZone.w}px wide × ${textZone.h}px tall
(The server will auto-fit text to this zone. Your font sizes are suggestions — the server may adjust them.)

RULES:
1. Split the campaign text into logical blocks with clear roles:
   - "promo": The dominant promotional number/offer (e.g. "2 ต่อ", "50%", "฿199")  — MUST be the largest, most eye-catching element
   - "headline": Main message headline
   - "subheadline": Supporting headline
   - "body": Body text, details
   - "offer": Special offer callout (e.g. "รับฟรี*", "สมัครวันนี้")
   - "fineprint": Legal text, terms and conditions — smallest

2. Font sizes are SUGGESTIONS (the server will auto-fit). Think in terms of visual hierarchy:
   - promo: Very large (150-300px suggested)
   - headline: Medium-large (40-80px)
   - subheadline: Medium (30-50px)
   - body: Medium-small (24-40px)
   - offer: Medium (30-50px)
   - fineprint: Small (12-18px)

3. Choose colors that:
   - Contrast well with the background image
   - Follow the campaign mood/vibe
   - Use stroke (outline) for text over busy backgrounds

4. fontWeight: Use "900" for promo, "700" for headlines/offers, "400" for body/fineprint

5. align: "left" for most text, "center" for promo numbers

OUTPUT FORMAT — respond with ONLY this JSON (no markdown, no explanation):
{
  "blocks": [
    { "text": "...", "role": "promo", "fontSize": 200, "fontWeight": "900", "color": "#FFD700", "strokeColor": "#000000", "strokeWidth": 3, "align": "center" },
    { "text": "...", "role": "headline", "fontSize": 50, "fontWeight": "700", "color": "#FFFFFF" },
    ...
  ],
  "campaign_vibe": "description of the visual mood",
  "background_description": "brief description of what's in the background image"
}`;

    console.log(
      `[LayoutIntent] Calling ${model} for layout intent (textZone: ${textZone.w}×${textZone.h}, canvas: ${canvasSize.w}×${canvasSize.h})`,
    );

    // ── Call the AI ──
    const response = await this.client.models.generateContent({
      model,
      contents: [
        {
          role: "user",
          parts: [
            {
              inlineData: {
                mimeType: processingMime,
                data: processingBuffer.toString("base64"),
              },
            },
            { text: prompt },
          ],
        },
      ],
      config: { temperature: 0.7 },
    });

    const raw = response.text ?? "";
    console.log(
      `[LayoutIntent] Raw response length: ${raw.length} chars`,
    );

    // ── Parse response ──
    try {
      // Strip markdown code fences if present
      const cleaned = raw
        .replace(/^```(?:json)?\s*/i, "")
        .replace(/\s*```$/i, "")
        .trim();

      const parsed = JSON.parse(cleaned);

      if (!Array.isArray(parsed.blocks) || parsed.blocks.length === 0) {
        throw new Error("Parsed JSON has no blocks array");
      }

      // Validate each block has required fields
      for (const block of parsed.blocks) {
        if (!block.text || !block.role || !block.fontSize || !block.color) {
          throw new Error(
            `Block missing required fields: ${JSON.stringify(block)}`,
          );
        }
      }

      console.log(
        `[LayoutIntent] Success — ${parsed.blocks.length} blocks, vibe: "${parsed.campaign_vibe}"`,
      );

      return {
        blocks: parsed.blocks,
        campaign_vibe: parsed.campaign_vibe || "modern Thai advertising",
        background_description:
          parsed.background_description || "campaign background",
      };
    } catch (err) {
      console.error(
        "[LayoutIntent] Failed to parse AI response, using fallback.",
        err,
      );
      console.error("[LayoutIntent] Raw response was:", raw.substring(0, 500));

      // Fallback: return the full text as a single headline block
      return {
        blocks: [
          {
            text: targetText,
            role: "headline" as const,
            fontSize: 48,
            fontWeight: "700",
            color: "#FFFFFF",
            strokeColor: "#000000",
            strokeWidth: 2,
            align: "center" as const,
          },
        ],
        campaign_vibe: "default",
        background_description: "campaign background",
      };
    }
  }

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

${
  previousComponents?.length
    ? `FORBIDDEN TEXT ZONES (component bounding boxes in px — text MUST stay OUTSIDE):
${(previousComponents as any[])
  .map((c: any) => {
    const p = c.position || c.suggested_position || {};
    const x1 = Math.round(((p.left || 0) / 1000) * canvasWidth);
    const y1 = Math.round(((p.top || 0) / 1000) * canvasHeight);
    const x2 = Math.round(
      (((p.left || 0) + (p.width || 0)) / 1000) * canvasWidth,
    );
    const y2 = Math.round(
      (((p.top || 0) + (p.height || 0)) / 1000) * canvasHeight,
    );
    return `  ❌ "${c.label}": x ${x1}–${x2}px, y ${y1}–${y2}px`;
  })
  .join("\n")}`
    : ""
}

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
7. If text scattered → merge into one <g> with <tspan dy> stacking
8. ⚠️ CRITICAL: text groups must NOT enter the FORBIDDEN TEXT ZONES above — move to the free side

═══════════════════════════════════════
YOUR TASK — COMPONENT FIXES
═══════════════════════════════════════
Return corrected positions in the "components" array (normalized 0-1000):
- top≥50, left≥50, (left+width)≤950, (top+height)≤950

═══════════════════════════════════════
RETURN FORMAT — OUTPUT <SVG_OVERLAY> FIRST, THEN <META>
═══════════════════════════════════════
<SVG_OVERLAY>
YOUR_IMPROVED_SVG_HERE
</SVG_OVERLAY>
<META>
{
  "components": [
    { "label": "name", "position": { "top": 100, "left": 500, "width": 450, "height": 850, "rotation": 0 }, "suggested_position": { "top": 100, "left": 500, "width": 450, "height": 850, "rotation": 0, "rationale": "why" }, "z_index": 15, "interaction_zone": { "enabled": false, "overlap_top": 200, "overlap_left": 500, "overlap_width": 200, "overlap_height": 500 } }
  ]
}
</META>`;

    const parts: any[] = [
      { inlineData: { data: imageBuffer.toString("base64"), mimeType } },
    ];
    if (previewBuffer) {
      parts.push({
        inlineData: {
          data: previewBuffer.toString("base64"),
          mimeType: "image/png",
        },
      });
    }
    parts.push({ text: prompt });

    console.log(`[AI-TRACE] [RefineSVG] Prompt:\n${prompt}`);
    const result = await this.withRetry(() =>
      this.client.models.generateContent({
        model,
        contents: [{ role: "user", parts }],
        config: { temperature: 0.8 },
      }),
    );

    const raw = result.text || "";
    traceAI("Refine Layout SVG", prompt, raw, { critique });
    let parsed: any;
    try {
      parsed = this.parseSVGResponse(raw);
    } catch (parseErr) {
      console.error(
        "[refineLayoutSVG] Completely failed to parse AI response:",
        parseErr,
      );
      parsed = { svg_overlay: "" };
    }

    if (!parsed.svg_overlay || parsed.svg_overlay.length < 50) {
      throw new Error("[refineLayoutSVG] AI returned empty svg_overlay");
    }
    if (/<script|<iframe|javascript:/i.test(parsed.svg_overlay)) {
      throw new Error(
        "[refineLayoutSVG] svg_overlay contains disallowed content",
      );
    }

    console.log(`[SVG] Refined overlay (${parsed.svg_overlay.length} chars)`);
    return parsed;
  }

  /**
   * Post-process SVG overlay for export.
   * mode='embed-fonts': inject @font-face base64 woff2 into <defs>
   * mode='paths': convert <text> elements to <path> via opentype.js
   */
  async exportSVG(
    svgOverlay: string,
    backgroundBuffer: Buffer | null,
    mode: "embed-fonts" | "paths",
  ): Promise<string> {
    const vbMatch = svgOverlay.match(/viewBox="0 0 (\d+) (\d+)"/);
    const w = vbMatch ? parseInt(vbMatch[1]) : 1080;
    const h = vbMatch ? parseInt(vbMatch[2]) : 1080;

    let bgLayer = "";
    if (backgroundBuffer) {
      const bgBase64 = backgroundBuffer.toString("base64");
      bgLayer = `<image id="background" href="data:image/jpeg;base64,${bgBase64}" x="0" y="0" width="${w}" height="${h}" preserveAspectRatio="xMidYMid slice"/>`;
    }

    if (mode === "embed-fonts") {
      const fontDir = path.join(
        __dirname,
        "../../node_modules/@fontsource/kanit/files",
      );
      let fontDefs = "";
      const variants = [
        { weight: "400", file: "kanit-thai-400-normal.woff2" },
        { weight: "700", file: "kanit-thai-700-normal.woff2" },
        { weight: "900", file: "kanit-thai-900-normal.woff2" },
      ];
      for (const v of variants) {
        const fontPath = path.join(fontDir, v.file);
        if (fs.existsSync(fontPath)) {
          const fontBase64 = fs.readFileSync(fontPath).toString("base64");
          fontDefs += `@font-face{font-family:'Kanit';font-weight:${v.weight};font-style:normal;src:url('data:font/woff2;base64,${fontBase64}') format('woff2');}`;
        }
      }

      let withFonts: string;
      if (svgOverlay.includes("<defs>")) {
        withFonts = svgOverlay.replace(
          "<defs>",
          `<defs><style>${fontDefs}</style>`,
        );
      } else {
        withFonts = svgOverlay.replace(
          /(<svg[^>]*>)/,
          `$1<defs><style>${fontDefs}</style></defs>`,
        );
      }

      return withFonts.replace(/(<svg[^>]*>)/, `$1${bgLayer}`);
    }

    if (mode === "paths") {
      // eslint-disable-next-line @typescript-eslint/no-var-requires
      const opentype = await import("opentype.js");
      const fontDir = path.join(
        __dirname,
        "../../node_modules/@fontsource/kanit/files",
      );

      const fontCache: Record<string, any> = {};
      const loadFont = async (weight: string): Promise<any> => {
        if (fontCache[weight]) return fontCache[weight];
        const assetsDir = path.join(__dirname, "../../assets/fonts");
        const candidates = [
          path.join(
            assetsDir,
            `Kanit-${weight === "400" ? "Regular" : weight === "700" ? "Bold" : "Black"}.ttf`,
          ),
          path.join(assetsDir, `kanit-${weight}.ttf`),
          path.join(fontDir, `kanit-thai-${weight}-normal.ttf`),
          path.join(fontDir, `kanit-latin-${weight}-normal.ttf`),
          "/usr/share/fonts/truetype/noto/NotoSansThai-Regular.ttf",
        ];
        for (const p of candidates) {
          if (fs.existsSync(p)) {
            fontCache[weight] = await (opentype as any).load(p);
            return fontCache[weight];
          }
        }
        console.warn(
          `[exportSVG] No TTF found for weight ${weight}, text will remain as <text>`,
        );
        return null;
      };

      // Verify at least one font weight can be loaded before attempting conversion
      const testFont = await loadFont("700");
      if (!testFont) {
        throw new Error(
          "[exportSVG] paths mode requires TTF font files. " +
            "Place Kanit TTF files in backend/assets/fonts/ (e.g. Kanit-Bold.ttf). " +
            "Download from https://fonts.google.com/specimen/Kanit",
        );
      }

      const converted = await this._convertSVGTextToPaths(svgOverlay, loadFont);
      return converted.replace(/(<svg[^>]*>)/, `$1${bgLayer}`);
    }

    return svgOverlay;
  }

  /**
   * Deterministically enforce that all translate(TX,TY) in the SVG stay within the text zone.
   * LLM uses absolute canvas coordinates, so we just clamp any out-of-bounds placements.
   * Also clamps Y so that the estimated text block height fits within zone bottom.
   */
  private _enforceZoneBounds(
    svg: string,
    zone: { x: number; y: number; w: number; h: number },
  ): string {
    const parts: string[] = [];
    let lastIndex = 0;
    // Match both "translate(X,Y)" and "translate(X Y)" (SVG allows space separator)
    const translateRe = /transform="translate\(([^,)\s]+)[,\s]\s*([^)]+)\)"/g;
    let m: RegExpExecArray | null;

    const zoneRight = zone.x + zone.w;
    const zoneBottom = zone.y + zone.h;

    while ((m = translateRe.exec(svg)) !== null) {
      parts.push(svg.slice(lastIndex, m.index));

      const txStr = m[1].trim();
      const tyStr = m[2].trim();
      let tx = parseFloat(txStr);
      let ty = parseFloat(tyStr);

      // Look ahead ~2000 chars for font-sizes and tspan count in this block
      const lookahead = svg.slice(m.index, m.index + 2000);
      const fontSizes: number[] = [];
      const fsRe = /font-size="(\d+(?:\.\d+)?)"/g;
      let fm: RegExpExecArray | null;
      while ((fm = fsRe.exec(lookahead)) !== null) {
        fontSizes.push(parseFloat(fm[1]));
      }
      const tspanCount = Math.max(1, (lookahead.match(/<tspan/g) || []).length);

      let newTx = tx;
      let newTy = ty;

      if (fontSizes.length > 0) {
        const maxFont = Math.max(...fontSizes);
        const subFonts = fontSizes.filter((f) => f < maxFont);
        const avgSubFont =
          subFonts.length > 0
            ? subFonts.reduce((a, b) => a + b, 0) / subFonts.length
            : maxFont * 0.4;
        const additionalLines = Math.max(0, tspanCount - 1);
        const estimatedHeight =
          maxFont * 1.4 + additionalLines * avgSubFont * 1.4;
        const estimatedWidth = maxFont * 0.7 * Math.max(3, 8); // rough width estimate

        // Clamp X: must start within zone, must not push text past zone right edge
        const maxTx = zoneRight - Math.min(estimatedWidth, zone.w * 0.5) - 20;
        newTx = Math.max(zone.x, Math.min(maxTx, tx));

        // Clamp Y: text block bottom must stay within zone
        const maxTy = zoneBottom - estimatedHeight - 30;
        newTy = Math.max(zone.y, Math.min(maxTy > zone.y ? maxTy : zone.y, ty));

        if (newTx !== tx || newTy !== ty) {
          console.log(
            `[SVG] Zone enforce: translate(${tx},${ty}) → (${Math.round(newTx)},${Math.round(newTy)}) zone=[${zone.x}-${zoneRight},${zone.y}-${zoneBottom}] estH=${Math.round(estimatedHeight)}`,
          );
        }
      } else {
        // No font info — just clamp to zone boundaries
        newTx = Math.max(zone.x, Math.min(zoneRight - 50, tx));
        newTy = Math.max(zone.y, Math.min(zoneBottom - 50, ty));
      }

      parts.push(
        `transform="translate(${Math.round(newTx)}, ${Math.round(newTy)})"`,
      );
      lastIndex = m.index + m[0].length;
    }

    parts.push(svg.slice(lastIndex));
    return parts.join("");
  }

  /**
   * Wraps all user-visible SVG content in a <clipPath> rect that matches
   * the text zone — hard visual boundary, nothing can paint outside it.
   */
  private _injectZoneClip(
    svg: string,
    zone: { x: number; y: number; w: number; h: number },
  ): string {
    // Match opening <svg ...> tag — use [\s\S]*? to handle potential multi-line attributes
    const svgTagMatch = svg.match(/^(<svg[\s\S]*?>)/);
    if (!svgTagMatch) return svg;
    const svgTag = svgTagMatch[1];

    const clipId = "textZoneClip";
    const clipRect = `<clipPath id="${clipId}"><rect x="${zone.x}" y="${zone.y}" width="${zone.w}" height="${zone.h}" /></clipPath>`;

    const inner = svg.slice(svgTag.length, -"</svg>".length).trim();

    let result: string;
    if (inner.includes("<defs>")) {
      // Merge clipPath into existing <defs> to avoid double-wrapping
      const mergedInner = inner.replace("<defs>", `<defs>${clipRect}`);
      result = `${svgTag}<g clip-path="url(#${clipId})">${mergedInner}</g></svg>`;
    } else {
      // No existing <defs> — prepend a new one
      result = `${svgTag}<defs>${clipRect}</defs><g clip-path="url(#${clipId})">${inner}</g></svg>`;
    }
    return result;
  }

  /**
   * Internal: convert SVG <text>/<tspan> elements to <path> elements using opentype.js.
   */
  private async _convertSVGTextToPaths(
    svg: string,
    loadFont: (weight: string) => Promise<any>,
  ): Promise<string> {
    let result = svg;

    const groupRegex =
      /<g([^>]*transform="translate\([^)]+\)"[^>]*)>([\s\S]*?)<\/g>/g;
    const allMatches: Array<{ full: string; attrs: string; content: string }> =
      [];
    let m;
    while ((m = groupRegex.exec(svg)) !== null) {
      allMatches.push({ full: m[0], attrs: m[1], content: m[2] });
    }

    for (const group of allMatches) {
      const txMatch = group.attrs.match(
        /translate\(\s*([\d.]+)[,\s]+([\d.]+)\s*\)/,
      );
      if (!txMatch) continue;
      const tx = parseFloat(txMatch[1]);
      const ty = parseFloat(txMatch[2]);

      const textRegex = /<text([^>]*)>([\s\S]*?)<\/text>/g;
      let textMatch;
      let newContent = group.content;

      while ((textMatch = textRegex.exec(group.content)) !== null) {
        const [fullText, textAttrs, textContent] = textMatch;

        const getAttr = (attr: string, fallback: string) => {
          const am = textAttrs.match(new RegExp(`${attr}="([^"]+)"`));
          return am ? am[1] : fallback;
        };

        const baseX = parseFloat(getAttr("x", "0"));
        const baseY = parseFloat(getAttr("y", "0"));
        const baseFontSize = parseFloat(getAttr("font-size", "36"));
        const baseFontWeight = getAttr("font-weight", "400");
        const baseFill = getAttr("fill", "#000000");
        const filterVal = getAttr("filter", "");
        const filterAttr = filterVal ? ` filter="${filterVal}"` : "";

        const font = await loadFont(baseFontWeight);
        if (!font) continue;

        const tspanRegex = /<tspan([^>]*)>([^<]*)<\/tspan>/g;
        let tspanMatch;
        let currentY = ty + baseY;
        let pathElements = "";
        let firstTspan = true;

        while ((tspanMatch = tspanRegex.exec(textContent)) !== null) {
          const [, tspanAttrs, text] = tspanMatch;
          const tGet = (attr: string, fallback: string) => {
            const am = tspanAttrs.match(new RegExp(`${attr}="([^"]+)"`));
            return am ? am[1] : fallback;
          };

          const tFontSize = parseFloat(tGet("font-size", String(baseFontSize)));
          const tFill = tGet("fill", baseFill);
          const dy = tGet("dy", "0");
          const tspanX = parseFloat(tGet("x", String(baseX)));

          if (!firstTspan && dy !== "0") {
            const dyEmMatch = dy.match(/([\d.]+)em/);
            if (dyEmMatch) {
              currentY += parseFloat(dyEmMatch[1]) * tFontSize;
            } else {
              currentY += parseFloat(dy);
            }
          }
          firstTspan = false;

          if (text.trim()) {
            try {
              const pathData = (font as any)
                .getPath(text, tx + tspanX, currentY, tFontSize)
                .toPathData(2);
              pathElements += `<path d="${pathData}" fill="${tFill}"${filterAttr}/>`;
            } catch (_e) {
              pathElements += `<text x="${tx + tspanX}" y="${currentY}" font-size="${tFontSize}" fill="${tFill}">${text}</text>`;
            }
          }
        }

        if (pathElements) {
          newContent = newContent.replace(fullText, `<g>${pathElements}</g>`);
        }
      }

      if (newContent !== group.content) {
        result = result.replace(
          group.full,
          group.full.replace(group.content, newContent),
        );
      }
    }

    return result;
  }

  /**
   * Task B: Refine HTML/CSS overlay based on critique feedback
   */
  async refineLayoutHTML(
    imageBuffer: Buffer,
    mimeType: string,
    targetText: string,
    currentHtmlOverlay: string,
    critique: { status: string; feedback: string; actionable_steps: string[] },
    previewBuffer?: Buffer,
    previousComponents?: any[],
  ): Promise<{ html_overlay: string; components?: any[] }> {
    const model =
      process.env.GEMINI_MODEL_ENDPOINT_2 ||
      process.env.GEMINI_MODEL_ENDPOINT ||
      "gemini-2.0-flash-exp";

    const prompt = `You are fixing an HTML/CSS ad layout based on an art director's critique.

You can see TWO images:
- IMAGE 1: The original reference background
- IMAGE 2: The current preview (current text + components — what needs fixing)

ORIGINAL BRIEF: "${targetText}"

CURRENT HTML OVERLAY (what you must improve):
${currentHtmlOverlay}

ART DIRECTOR CRITIQUE:
Status: ${critique.status}
Feedback: ${critique.feedback}
Actionable steps: ${JSON.stringify(critique.actionable_steps, null, 2)}

CURRENT COMPONENT POSITIONS (normalized 0-1000):
${JSON.stringify(previousComponents || [], null, 2)}

═══════════════════════════════════════
YOUR TASK — TEXT FIXES
═══════════════════════════════════════
1. Address ALL actionable steps from the critique feedback
2. Return an IMPROVED HTML overlay — keep same text content, freely change:
   top/left %, font-size (cqw), color, text-shadow, font-weight, letter-spacing, gap, max-width
3. NEVER add background-color on text elements (no dark boxes, no pills, no shields)
4. Use multi-layer text-shadow for contrast on photo backgrounds
5. If text covers a face → move top/left away from face area
6. If text too small → increase cqw value
7. If text scattered → wrap related text in flex-column div with gap

═══════════════════════════════════════
YOUR TASK — COMPONENT FIXES (EQUALLY IMPORTANT)
═══════════════════════════════════════
You MUST also reposition components if the critique mentions edge crop, overlap, or bad placement.
Return corrected positions in the "components" array.

SAFE ZONE (NON-NEGOTIABLE): normalized 0-1000 coordinates
  - top ≥ 50 (5% from top)
  - left ≥ 50 (5% from left)
  - (left + width) ≤ 950 (5% from right)
  - (top + height) ≤ 950 (5% from bottom)

COMPONENT FIX RULES:
- If component is cut off at right edge → decrease left by (left+width-950), keep width same
- If component is cut off at top → set top = 50
- If component blocks all text space → move to left:50 OR right (left = 950-width), free opposite side
- If component covers promo number/headline → shift left or right by 20% to clear text
- Aim for: component anchored to ONE side (left OR right), text on other side

IMPORTANT: Even if the critique says PASS, check component positions yourself and enforce the 5% safe zone.

═══════════════════════════════════════
Return TWO parts exactly using these XML delimiters: <META> and <HTML_OVERLAY>.
Do NOT wrap the HTML inside a JSON string. Separate them!

<META>
{
  "components": [
    {
      "label": "component name",
      "position": { "top": <corrected>, "left": <corrected>, "width": <same or adjusted>, "height": <same or adjusted>, "rotation": 0 },
      "suggested_position": { "top": <ideal>, "left": <ideal>, "width": <ideal>, "height": <ideal>, "rotation": 0, "rationale": "why this position" },
      "z_index": 15,
      "interaction_zone": { "enabled": false, "overlap_top": <n>, "overlap_left": <n>, "overlap_width": <n>, "overlap_height": <n> }
    }
  ]
}
</META>
<HTML_OVERLAY>
YOUR_IMPROVED_HTML_STRING_WITH_SINGLE_QUOTE_ATTRIBUTES
</HTML_OVERLAY>`;

    const parts: any[] = [
      { inlineData: { data: imageBuffer.toString("base64"), mimeType } },
    ];
    if (previewBuffer) {
      parts.push({
        inlineData: {
          data: previewBuffer.toString("base64"),
          mimeType: "image/png",
        },
      });
    }
    parts.push({ text: prompt });

    const result = await this.withRetry(() =>
      this.client.models.generateContent({
        model,
        contents: [{ role: "user", parts }],
        config: { temperature: 0.8 },
      }),
    );

    const raw = result.text || "";
    let parsed: any;
    try {
      parsed = this.parseHTMLResponse(raw);
    } catch (parseErr) {
      console.error(
        "[refineLayoutHTML] Completely failed to parse AI response:",
        parseErr,
      );
      parsed = { html_overlay: "" };
    }

    if (!parsed.html_overlay || parsed.html_overlay.length < 50) {
      throw new Error("[refineLayoutHTML] AI returned empty html_overlay");
    }
    if (/<script|<iframe|javascript:/i.test(parsed.html_overlay)) {
      throw new Error(
        "[refineLayoutHTML] html_overlay contains disallowed content",
      );
    }

    console.log(`[HTML] Refined overlay (${parsed.html_overlay.length} chars)`);
    return parsed;
  }

  /**
   * Step 1.3: Refine layout based on critique (legacy JSON mode — kept for fallback)
   */
  async refineLayout(
    imageBuffer: Buffer,
    mimeType: string,
    targetText: string,
    previousAnalysis: any,
    critique: any,
    previewBuffer?: Buffer,
  ) {
    const model =
      process.env.GEMINI_MODEL_ENDPOINT_2 ||
      process.env.GEMINI_MODEL_ENDPOINT ||
      "gemini-3-flash-preview";

    // Extract no-go zones from previous analysis if available
    const noGoZones = previousAnalysis.no_go_zones || [];
    const noGoZonesStr =
      noGoZones.length > 0
        ? `\nNO-GO ZONES (areas occupied by people/characters — text MUST NOT overlap these):\n${JSON.stringify(noGoZones, null, 2)}\n`
        : "";

    const prompt = `
      You are a UI/UX expert refining an ad layout based on a Creative Director's critique.
      You can see TWO images:
      - IMAGE 1: The ORIGINAL reference image
      - IMAGE 2: The CURRENT PREVIEW with text overlays (what needs fixing)
      
      ORIGINAL BRIEF: "${targetText}"
      
      ${noGoZonesStr}
      
      PREVIOUS LAYOUT:
      ${JSON.stringify(previousAnalysis.suggestions, null, 2)}
      
      CRITIQUE & FEEDBACK: 
      - Status: ${critique.status}
      - Feedback: ${critique.feedback}
      - Actionable Steps: ${JSON.stringify(critique.actionable_steps)}
      
      CRITICAL RULES FOR REFINEMENT:
      1. Address ALL feedback from the critique's actionable_steps
      2. DEPTH LAYERING: Text may intentionally overlap the character — the character renders IN FRONT (higher z-index). This is the SCB "character standing on the offer" effect. Do NOT move text just because it overlaps a character's lower body. DO move text if it covers the character's face.
      3. Keep the same text content — you may freely change: positions, font_size_normalized, colors, stroke styles, and composition grouping. Keep visual_container as "none" always.
      4. IMPROVE visual hierarchy aggressively: if the offer number (e.g. "2 ต่อ") is not clearly the dominant element, INCREASE its font_size_normalized to 180-200
      5. IMPROVE text visibility through stroke + shadow: if text is on a photo background, set stroke_width to 5-6, stroke_hex to "#000000", and shadow to "strong". NEVER use visual_container (must stay "none").
      6. GROUPING: if related text elements are scattered, pull them together (within 30 units of each other)
      7. Maintain at least 3% margin from image edges (30 in 0-1000 coords)
      8. Coordinates must be 0-1000 normalized
      9. For COMPONENTS: You may adjust their positions to create a more harmonious composition.
         - Characters/mascots should complement the text layout
         - Keep components within the image bounds
      
      PREVIOUS COMPONENT LAYOUT:
      ${JSON.stringify(previousAnalysis.components, null, 2)}
      
      Return as STRICT JSON (no markdown, no explanation):
      {
        "background_description": "${previousAnalysis.background_description || ""}",
        "campaign_vibe": "${previousAnalysis.campaign_vibe || ""}",
        "no_go_zones": ${JSON.stringify(noGoZones)},
        "suggestions": [same structure as before with fixed positions],
        "components": [same structure as before — you MAY adjust positions for better composition]
      }
    `;

    console.log("[GenAI] Refining layout based on critique...");

    const parts: any[] = [
      { inlineData: { data: imageBuffer.toString("base64"), mimeType } },
    ];

    // Include preview image so AI can SEE what's wrong
    if (previewBuffer) {
      parts.push({
        inlineData: {
          data: previewBuffer.toString("base64"),
          mimeType: "image/png",
        },
      });
    }

    parts.push({ text: prompt });

    const result = await this.withRetry(() =>
      this.client.models.generateContent({
        model,
        contents: [{ role: "user", parts }],
      }),
    );

    const text = result.text || "";
    console.log("[GenAI] Refine raw response:", text.substring(0, 500));

    const jsonStr = text.match(/\{[\s\S]*\}/)?.[0] || "";

    let parsed;
    try {
      parsed = JSON.parse(jsonStr);
    } catch (parseErr) {
      const cleaned = jsonStr
        .replace(/\\'/g, "'")
        .replace(/\\([^"\\\/bfnrtu])/g, "$1")
        .replace(/[\x00-\x1F\x7F]/g, " ");
      parsed = JSON.parse(cleaned);
    }

    // Log what changed
    if (parsed.suggestions) {
      console.log(
        `[GenAI] Refined to ${parsed.suggestions.length} suggestions:`,
      );
      parsed.suggestions.forEach((s: any, i: number) => {
        console.log(
          `  [${i}] "${(s.part || "").substring(0, 30)}..." → top:${s.position?.top} left:${s.position?.left} size:${s.style?.font_size_normalized}`,
        );
      });
    }

    return parsed;
  }

  async separateLayers(
    imageBuffer: Buffer,
    mimeType: string,
    backgroundImageBuffer?: Buffer,
    hintText?: string,
  ) {
    const model =
      process.env.GEMINI_MODEL_ENDPOINT_2 ||
      process.env.GEMINI_MODEL_ENDPOINT ||
      "gemini-3-flash-preview";

    const parts: any[] = [
      { inlineData: { data: imageBuffer.toString("base64"), mimeType } },
    ];

    let comparisonInstruction = "";
    if (backgroundImageBuffer) {
      parts.push({
        inlineData: {
          data: backgroundImageBuffer.toString("base64"),
          mimeType,
        },
      });
      comparisonInstruction = `
        I have provided TWO images:
        1. The FIRST image is the composite/final image.
        2. The SECOND image is the original background.
        
        Compare them and identify ONLY the text elements that were added on top of the background.
      `;
    }

    let hintInstruction = "";
    if (hintText) {
      hintInstruction = `
        IMPORTANT HINT: The user intended or used the following text in this image: "${hintText}".
        Use this hint to improve your detection and correct any visual OCR artifacts.
      `;
    }

    const prompt = `
      ${comparisonInstruction}
      ${hintInstruction}
      Analyze the image(s) and identify all individual text layers.
      For each text element found, provide its content, position, and style.
      
      Return the result as a STRICT JSON object:
      {
        "layers": [
          {
            "type": "text",
            "content": "The exact text as it appears",
            "position": {
              "top": 0, "left": 0, "width": 0, "height": 0,
              "explanation": "Normalized coordinates 0-1000"
            },
            "style": {
              "font_family": "Choose closest from: Inter, Kanit, Playfair Display, Roboto Mono",
              "font_weight": "normal | bold",
              "color_hex": "#FFFFFF",
              "font_size_normalized": "Relative size (e.g. 10-100)"
            }
          }
        ],
        "background": {
          "description": "Describe the main background visual components"
        }
      }
      
      NOTE: For 'font_family', pick the specific name from the list that MOST CLOSELY resembles the text in the image.
      NOTE: Only extract TEXT elements. Do NOT include logos, stickers, or graphic elements here.
    `;

    try {
      const response = await this.withRetry(() =>
        this.client.models.generateContent({
          model,
          contents: [
            {
              role: "user",
              parts: [...parts, { text: prompt }],
            },
          ],
        }),
      );

      const responseText = response.text ? response.text.trim() : "";
      const jsonString = responseText.replace(/```json|```/g, "").trim();
      try {
        return JSON.parse(jsonString || "{}");
      } catch (e) {
        return { raw: responseText };
      }
    } catch (error: any) {
      console.error("[GenAI] Separate Layers Error:", error);
      throw error;
    }
  }

  /**
   * Worker 2A: Analyze visual components in the image
   * Identifies all non-text visual elements and returns descriptions
   */
  async analyzeComponents(
    imageBuffer: Buffer,
    mimeType: string,
    backgroundImageBuffer?: Buffer,
  ) {
    const model =
      process.env.GEMINI_MODEL_ENDPOINT_2 ||
      process.env.GEMINI_MODEL_ENDPOINT ||
      "gemini-3-flash-preview";

    const parts: any[] = [
      { inlineData: { data: imageBuffer.toString("base64"), mimeType } },
    ];

    let comparisonInstruction = "";
    if (backgroundImageBuffer) {
      parts.push({
        inlineData: {
          data: backgroundImageBuffer.toString("base64"),
          mimeType,
        },
      });
      comparisonInstruction = `
        TWO images are provided:
        1. FIRST image: the composite/final image with all elements.
        2. SECOND image: the clean background without any overlays.
        Compare them and identify visual elements that were ADDED on top.
      `;
    }

    const prompt = `
      ${comparisonInstruction}
      Analyze the image and identify all NON-TEXT visual components overlaid on the background.
      Include: ribbons, banners, stickers, mascots, cartoon characters, logos, icons, 
      decorative shapes, frames, product images, person cutouts, etc.
      
      EXCLUDE: 
      - Any text or typography (handled separately)
      - The background scene itself
      
      For each component, provide a detailed visual description so it can be recreated.
      
      GROUPING RULE — CRITICAL:
      - If a person, character, or mascot is holding or wearing an object (phone, bag, gun, prop, etc.),
        that object is considered PART of that person/character.
        Do NOT list it as a separate component — include it in the person's description instead.
      - Only list an object as a separate, standalone component if it appears
        COMPLETELY INDEPENDENT and is NOT being held/worn by any character.

      Examples:
      ✅ Woman holding a smartphone → ONE component: "Woman full figure"
         (description: "...holding a purple smartphone in her left hand...")
      ✅ A floating logo badge in the corner → separate component
      ❌ Woman holding a phone + "Purple Smartphone" listed separately → WRONG, causes duplicates

      Z-INDEX RULES (set per component type):
      - PRIMARY characters/persons: z_index = 15, interaction_zone.enabled = false (DISABLED — no intentional overlap until system is ready)
      - MASCOTS / secondary characters: z_index = 10, interaction_zone.enabled = false
      - LOGOS / BADGES / decorative icons: z_index = 20, interaction_zone.enabled = false

      Return as STRICT JSON:
      {
        "components": [
          {
            "label": "Short label (e.g. 'Thai boy mascot')",
            "description": "Detailed visual description for recreation (e.g. 'A cute 3D cartoon Thai boy character wearing traditional gold and red Thai costume, waving hand, chibi style')",
            "position": { "top": 0, "left": 0, "width": 0, "height": 0, "rotation": 0 },
            "z_index": 15,
            "interaction_zone": { "enabled": false, "overlap_top": 200, "overlap_left": 350, "overlap_width": 300, "overlap_height": 400 }
          }
        ]
      }

      Position uses normalized coordinates 0-1000. Rotation is in degrees.
      Be accurate with width and height scale.
    `;

    try {
      console.log(`[GenAI] Analyzing components with model: ${model}`);
      const response = await this.withRetry(() =>
        this.client.models.generateContent({
          model,
          contents: [{ role: "user", parts: [...parts, { text: prompt }] }],
        }),
      );

      const responseText = response.text ? response.text.trim() : "";
      const jsonString = responseText.replace(/```json|```/g, "").trim();
      try {
        return JSON.parse(jsonString || "{}");
      } catch (e) {
        console.error("[GenAI] Failed to parse component analysis:", e);
        return { components: [] };
      }
    } catch (error: any) {
      console.error("[GenAI] Analyze Components Error:", error);
      return { components: [] };
    }
  }

  /**
   * Worker 2B: Generate die-cut components using a HYBRID approach.
   *
   * Strategy (per component):
   *  1. PRIMARY: Crop from source image + ML background removal (@imgly/background-removal-node)
   *     — No AI Image Gen call needed. Fast, style-accurate (it's the real photo).
   *  2. FALLBACK: AI Image Generation (original method)
   *     — Used only when the position data is missing/invalid so we can't crop.
   *
   * Why crop works well here:
   *  - The first AI pass already detected bounding boxes per component.
   *  - ML bg-removal handles complex backgrounds (gradients, scenes) — not just plain white.
   *  - Characters/mascots with complex backgrounds are exactly what BRIAAI RMBG excels at.
   */
  async generateDiecutComponents(
    imageBuffer: Buffer,
    mimeType: string,
    components: Array<{ label: string; description: string; position?: any }>,
    precomputedMaskedBuffer: Buffer | null = null,
  ): Promise<{
    results: Array<{ label: string; buffer: Buffer }>;
    gridImages: Buffer[];
    maskedFullImageBuffer: Buffer | null;
  }> {
    if (!components.length)
      return { results: [], gridImages: [], maskedFullImageBuffer: null };

    const allResults: Array<{ label: string; buffer: Buffer }> = [];

    // Run RMBG on the FULL source image ONCE before the component loop.
    // Strategy: full-image context gives the ML model much better segmentation accuracy
    // than cropped pieces, especially for complex handheld objects (water guns, phones, etc.).
    // The masked full-image is then cached and shared across all components — each one just
    // crops the relevant bounding box region from this pre-masked result.
    let maskedFullImageBuffer: Buffer | null = null;
    const hasAnyValidPosition = components.some(
      (c) =>
        c.position &&
        typeof c.position.top === "number" &&
        (c.position.width || 0) > 20,
    );
    if (hasAnyValidPosition) {
      console.log(
        "[Diecut] Running RMBG on full source image (shared across all components)...",
      );
      maskedFullImageBuffer = await this._removeBgFullImage(imageBuffer);
      if (maskedFullImageBuffer) {
        console.log(
          "[Diecut] ✅ Full-image RMBG complete — will crop components from masked result",
        );
      } else {
        console.warn(
          "[Diecut] ⚠️ Full-image RMBG failed — will run RMBG per-crop as fallback",
        );
      }
    }

    for (let i = 0; i < components.length; i++) {
      const comp = components[i];
      const hasValidPosition =
        comp.position &&
        typeof comp.position.top === "number" &&
        typeof comp.position.left === "number" &&
        (comp.position.width || 0) > 20 &&
        (comp.position.height || 0) > 20;

      console.log(
        `[Diecut] ${i + 1}/${components.length}: "${comp.label}" — using ${
          hasValidPosition
            ? maskedFullImageBuffer
              ? "FULL-ML+CROP"
              : "CROP+ML"
            : "AI-GEN fallback"
        }`,
      );

      try {
        let buf: Buffer | null = null;

        if (hasValidPosition) {
          // PRIMARY PATH: crop from full-image RMBG result (or fall back to per-crop RMBG)
          buf = await this._cropAndDiecut(
            imageBuffer,
            comp.position,
            comp.label,
            maskedFullImageBuffer,
          );
          if (buf) {
            console.log(
              `[Diecut] ✅ Crop success for "${comp.label}" (${buf.length} bytes)`,
            );
          } else {
            console.warn(
              `[Diecut] ⚠️ Crop returned null for "${comp.label}", falling back to AI Gen`,
            );
          }
        }

        if (!buf) {
          // FALLBACK PATH: AI Image Generation (original method)
          // Only reaches here if: no valid position OR crop+ML failed
          console.log(`[Diecut] 🔄 AI-Gen fallback for "${comp.label}"`);
          buf = await this._generateSingleDiecut(imageBuffer, mimeType, comp);
          // Throttle only for AI gen calls to avoid 429
          if (i < components.length - 1) {
            await new Promise((r) => setTimeout(r, 3000));
          }
        }

        if (buf) {
          allResults.push({ label: comp.label, buffer: buf });
        } else {
          console.warn(
            `[Diecut] ⚠️ No result for "${comp.label}" (both paths failed)`,
          );
        }
      } catch (err) {
        console.error(`[Diecut] ❌ Failed for "${comp.label}":`, err);
      }
    }

    // Build a local preview grid from individual results using Sharp (no AI parsing needed)
    const gridImages: Buffer[] = [];
    if (allResults.length > 0) {
      try {
        const THUMB = 256; // thumbnail size per cell
        const cols = Math.min(3, allResults.length);
        const rows = Math.ceil(allResults.length / cols);
        const gridW = cols * THUMB;
        const gridH = rows * THUMB;

        // White canvas
        const composites: sharp.OverlayOptions[] = [];
        for (let idx = 0; idx < allResults.length; idx++) {
          const col = idx % cols;
          const row = Math.floor(idx / cols);
          const thumb = await sharp(allResults[idx].buffer)
            .resize(THUMB - 10, THUMB - 10, {
              fit: "contain",
              background: { r: 255, g: 255, b: 255, alpha: 1 },
            })
            .extend({
              top: 5,
              bottom: 5,
              left: 5,
              right: 5,
              background: { r: 255, g: 255, b: 255, alpha: 1 },
            })
            .png()
            .toBuffer();
          composites.push({
            input: thumb,
            left: col * THUMB,
            top: row * THUMB,
          });
        }

        const gridBuf = await sharp({
          create: {
            width: gridW,
            height: gridH,
            channels: 4,
            background: { r: 255, g: 255, b: 255, alpha: 1 },
          },
        })
          .composite(composites)
          .png()
          .toBuffer();

        gridImages.push(gridBuf);
        console.log(
          `[GenAI] Preview grid built: ${cols}x${rows} (${allResults.length} components)`,
        );
      } catch (gridErr) {
        console.warn("[GenAI] Could not build preview grid:", gridErr);
      }
    }

    console.log(
      `[GenAI] Die-cut complete: ${allResults.length}/${components.length} components succeeded`,
    );
    return { results: allResults, gridImages, maskedFullImageBuffer };
  }

  /**
   * Inpaint the background using Vertex AI Imagen 3 editImage (INPAINT_REMOVAL mode).
   * It takes the original image and the full-scene alpha mask from RMBG,
   * converts the alpha mask into a solid Black & White inverted inpaint mask,
   * and sends it to the model.
   */
  async inpaintBackground(
    imageBuffer: Buffer,
    maskedFullImageBuffer: Buffer,
    analysis: any,
    onMaskReady?: (maskBase64: string) => void, // Called with downscaled mask PNG for live preview
  ): Promise<{ buffer: Buffer | null }> {
    try {
      console.log(
        "[Inpaint] Generating B&W inpaint mask from RMBG alpha channel...",
      );
      // Convert RMBG alpha mask (where subjects have alpha > 0)
      // to Imagen 3 Inpaint Mask (where regions to REMOVE are White 255, keep are Black 0)
      const maskOutput = await sharp(maskedFullImageBuffer)
        .ensureAlpha()
        .raw()
        .toBuffer({ resolveWithObject: true });

      const maskData = maskOutput.data;
      const maskW = maskOutput.info.width;
      const maskH = maskOutput.info.height;

      // Hard binarize: alpha > 30 → white (foreground to remove), else black (background).
      // No blur — we delegate dilation to maskDilation on the API side (see below).
      // Higher threshold (30 vs 5) avoids noisy semi-transparent noise pixels at feet contacts.
      for (let i = 0; i < maskData.length; i += 4) {
        const val = maskData[i + 3] > 30 ? 255 : 0;
        maskData[i] = val;
        maskData[i + 1] = val;
        maskData[i + 2] = val;
        maskData[i + 3] = 255;
      }

      // Convert to PNG — no blur/threshold (mask stays as sharp hard edges)
      const bwMaskBuffer = await sharp(maskData, {
        raw: { width: maskW, height: maskH, channels: 4 },
      })
        .png()
        .toBuffer();

      // Downscale mask to 25% for SSE preview (keeps payload small)
      if (onMaskReady) {
        const previewMask = await sharp(bwMaskBuffer)
          .resize(Math.round(maskW * 0.25), Math.round(maskH * 0.25))
          .png()
          .toBuffer();
        onMaskReady(previewMask.toString("base64"));
      }

      const { MaskReferenceImage, RawReferenceImage } =
        await import("@google/genai");

      const maskRef = new MaskReferenceImage();
      maskRef.referenceId = 1;
      maskRef.referenceImage = {
        imageBytes: bwMaskBuffer.toString("base64"),
        mimeType: "image/png",
      };
      maskRef.config = {
        maskMode: "MASK_MODE_USER_PROVIDED" as any,
        // KEY: Official Imagen 3 docs use maskDilation to expand the mask at the API level.
        // 0.03 = 3% of image dimension (~30px on a 1000px image), covers shadow fringe.
        // This is more accurate than manual sharp blur which confused Imagen into hallucinating.
        maskDilation: 0.03,
      };

      const rawRef = new RawReferenceImage();
      rawRef.referenceId = 0; // Official sample uses referenceId=0 for raw image
      rawRef.referenceImage = {
        imageBytes: imageBuffer.toString("base64"),
        mimeType: "image/png",
      };

      const editModel =
        process.env.IMAGEN_EDIT_ENDPOINT || "imagen-3.0-capability-001";
      console.log(
        `[Inpaint] Calling Imagen 3 (${editModel}) context: inpaint_removal`,
      );

      // Per official docs: INPAINT_REMOVAL works best with prompt="" (let the model
      // figure out the background from context). Complex prompts can anchor the model
      // on the wrong content type.
      const response = await this.client.models.editImage({
        model: editModel,
        prompt: "",
        referenceImages: [rawRef, maskRef],
        config: {
          editMode: "EDIT_MODE_INPAINT_REMOVAL" as any,
          numberOfImages: 1,
          outputMimeType: "image/png",
          personGeneration: "ALLOW_ALL" as any,
        },
      });

      if (
        response.generatedImages &&
        response.generatedImages.length > 0 &&
        response.generatedImages[0].image
      ) {
        const imageBytes = response.generatedImages[0].image.imageBytes;
        if (!imageBytes) {
          console.warn("[Inpaint] editImage returned image without imageBytes");
          return { buffer: null };
        }
        console.log("[Inpaint] ✅ Successfully inpainted background");
        return { buffer: Buffer.from(imageBytes, "base64") };
      }

      console.warn("[Inpaint] editImage returned no image data");
      return { buffer: null };
    } catch (err) {
      console.error("[Inpaint] Error during editImage:", err);
      return { buffer: null };
    }
  }

  /**
   * Run RMBG-2.0 and detect Bounding Boxes of subjects.
   * This is used by the controller to identify "No-Go Zones".
   */
  async runRMBGAndGetBboxes(
    imageBuffer: Buffer,
  ): Promise<{ maskedBuffer: Buffer | null; bboxes: any[] }> {
    try {
      console.log("[RMBG-2.0] Processing for Bboxes...");
      const masked = await this._removeBgRMBG2(imageBuffer);
      if (!masked) return { maskedBuffer: null, bboxes: [] };

      // Simple bbox detection from alpha channel
      const { data, info } = await sharp(masked)
        .ensureAlpha()
        .raw()
        .toBuffer({ resolveWithObject: true });
      let minX = info.width,
        minY = info.height,
        maxX = 0,
        maxY = 0;
      let found = false;

      for (let y = 0; y < info.height; y++) {
        for (let x = 0; x < info.width; x++) {
          const alpha = data[(y * info.width + x) * 4 + 3];
          if (alpha > 50) {
            if (x < minX) minX = x;
            if (x > maxX) maxX = x;
            if (y < minY) minY = y;
            if (y > maxY) maxY = y;
            found = true;
          }
        }
      }

      const bboxes = found
        ? [
            {
              label: "Detected Subject",
              top: Math.round((minY / info.height) * 1000),
              left: Math.round((minX / info.width) * 1000),
              width: Math.round(((maxX - minX) / info.width) * 1000),
              height: Math.round(((maxY - minY) / info.height) * 1000),
            },
          ]
        : [];

      return { maskedBuffer: masked, bboxes };
    } catch (err) {
      console.error("[RMBG-2.0] Bbox detection failed:", err);
      return { maskedBuffer: null, bboxes: [] };
    }
  }

  /**
   * Extract pixel-precise bounding boxes from die-cut component PNG buffers.
   * Each component is a transparent PNG — we scan its alpha channel to find
   * the tight bbox of non-transparent pixels, then map back to 0-1000
   * normalized source image coordinates using the component's known position.
   *
   * @param components Array of { label, buffer, position } — position is in 0-1000 normalized coords
   */
  async extractComponentStrokeBboxes(
    components: Array<{ label: string; buffer: Buffer; position: any }>,
  ): Promise<
    Array<{
      label: string;
      top: number;
      left: number;
      width: number;
      height: number;
    }>
  > {
    const results: Array<{
      label: string;
      top: number;
      left: number;
      width: number;
      height: number;
    }> = [];

    for (const comp of components) {
      if (!comp.buffer || !comp.position) continue;
      try {
        const { data, info } = await sharp(comp.buffer)
          .ensureAlpha()
          .raw()
          .toBuffer({ resolveWithObject: true });

        let minX = info.width,
          minY = info.height,
          maxX = 0,
          maxY = 0;
        let found = false;

        for (let y = 0; y < info.height; y++) {
          for (let x = 0; x < info.width; x++) {
            const alpha = data[(y * info.width + x) * 4 + 3];
            if (alpha > 30) {
              if (x < minX) minX = x;
              if (x > maxX) maxX = x;
              if (y < minY) minY = y;
              if (y > maxY) maxY = y;
              found = true;
            }
          }
        }

        if (!found) continue;

        // The component PNG is cropped to its position bbox.
        // Pixel coords within the PNG map to the component's position in the source image.
        const compLeft = comp.position.left / 1000;
        const compTop = comp.position.top / 1000;
        const compWidth = comp.position.width / 1000;
        const compHeight = comp.position.height / 1000;

        // Map local pixel bbox to normalized 0-1000 source image coords
        // Use minX and (maxX + 1) to get the inclusive pixel-width right edge
        const normLeft = compLeft + (minX / info.width) * compWidth;
        const normTop = compTop + (minY / info.height) * compHeight;
        const normRight = compLeft + ((maxX + 1) / info.width) * compWidth;
        const normBottom = compTop + ((maxY + 1) / info.height) * compHeight;

        results.push({
          label: comp.label,
          top: Math.round(normTop * 1000),
          left: Math.round(normLeft * 1000),
          width: Math.round((normRight - normLeft) * 1000),
          height: Math.round((normBottom - normTop) * 1000),
        });

        console.log(
          `[StrokeBbox] "${comp.label}": top=${Math.round(normTop * 1000)}, left=${Math.round(normLeft * 1000)}, w=${Math.round((normRight - normLeft) * 1000)}, h=${Math.round((normBottom - normTop) * 1000)}`,
        );
      } catch (err) {
        console.warn(`[StrokeBbox] Failed for "${comp.label}":`, err);
        // Fall back to using the position bbox directly
        if (comp.position) {
          results.push({
            label: comp.label,
            top: comp.position.top || 0,
            left: comp.position.left || 0,
            width: comp.position.width || 0,
            height: comp.position.height || 0,
          });
        }
      }
    }

    return results;
  }

  /**
   * Extract a single component from a full-image RMBG mask using BFS flood-fill.
   *
   * Problem with simple rectangular crop: when two subjects (e.g. woman + mascot) are close,
   * their bounding boxes may overlap, causing BOTH to appear in one component's crop.
   *
   * Solution: after RMBG gives us the full alpha mask, BFS from the CENTER of the target
   * component's bounding box — following only connected foreground pixels (alpha > 0).
   * Since the woman and mascot are separate foreground blobs, BFS from woman center reaches
   * only woman pixels. BFS from mascot center reaches only mascot pixels.
   *
   * Returns a tight transparent PNG of just that one component.
   */
  private async _extractComponentByFloodFill(
    maskedFullBuffer: Buffer, // RMBG output: full image with alpha mask
    position: { top: number; left: number; width: number; height: number },
    origW: number, // original image width (for coord scaling)
    origH: number, // original image height
    label: string = "",
  ): Promise<Buffer | null> {
    try {
      const maskedMeta = await sharp(maskedFullBuffer).metadata();
      const mW = maskedMeta.width || origW;
      const mH = maskedMeta.height || origH;

      // Scale factor: masked image may have been resized to max 1024/1500px
      const scaleX = mW / origW;
      const scaleY = mH / origH;

      // Bounding box center in masked-image pixel space (where we'll start BFS)
      const centerX = Math.round(
        ((position.left + position.width / 2) / 1000) * origW * scaleX,
      );
      const centerY = Math.round(
        ((position.top + position.height / 2) / 1000) * origH * scaleY,
      );

      // Get raw RGBA data of the masked full image
      const { data, info } = await sharp(maskedFullBuffer)
        .ensureAlpha()
        .raw()
        .toBuffer({ resolveWithObject: true });

      const W = info.width;
      const H = info.height;

      // BFS: walk connected foreground pixels starting from the component center.
      // We mark visited pixels in a separate boolean array to avoid revisiting.
      const visited = new Uint8Array(W * H); // 0 = unvisited
      const queue: number[] = []; // stores pixel index (y*W + x)
      const startIdx = centerY * W + centerX;

      const ALPHA_THRESHOLD = 10; // pixels above this are "foreground"
      const startAlpha = data[startIdx * 4 + 3];

      if (startAlpha < ALPHA_THRESHOLD) {
        // Center falls on background — scan outward in the bounding box to find a foreground seed
        let found = false;
        const bLeft = Math.max(
          0,
          Math.round((position.left / 1000) * origW * scaleX),
        );
        const bTop = Math.max(
          0,
          Math.round((position.top / 1000) * origH * scaleY),
        );
        const bRight = Math.min(
          W - 1,
          Math.round(
            ((position.left + position.width) / 1000) * origW * scaleX,
          ),
        );
        const bBottom = Math.min(
          H - 1,
          Math.round(
            ((position.top + position.height) / 1000) * origH * scaleY,
          ),
        );

        outer: for (let y = bTop; y <= bBottom; y++) {
          for (let x = bLeft; x <= bRight; x++) {
            if (data[(y * W + x) * 4 + 3] >= ALPHA_THRESHOLD) {
              queue.push(y * W + x);
              visited[y * W + x] = 1;
              found = true;
              break outer;
            }
          }
        }
        if (!found) {
          console.warn(
            `[FloodFill] No foreground seed found in bbox for "${label}", falling back to rectangular crop`,
          );
          return null;
        }
      } else {
        queue.push(startIdx);
        visited[startIdx] = 1;
      }

      // BFS — 5x5 neighborhood to jump small alpha gaps (up to 2px thick)
      // We dynamically generate the relative offsets.
      const dirs: number[] = [];
      for (let dy = -2; dy <= 2; dy++) {
        for (let dx = -2; dx <= 2; dx++) {
          if (dx === 0 && dy === 0) continue;
          dirs.push(dy * W + dx);
        }
      }

      let head = 0;
      while (head < queue.length) {
        const idx = queue[head++];
        const x = idx % W;
        const y = Math.floor(idx / W);

        for (const d of dirs) {
          const n = idx + d;
          if (n < 0 || n >= W * H) continue;
          if (visited[n]) continue;

          const nx = n % W;
          const ny = Math.floor(n / W);
          if (Math.abs(nx - x) > 2 || Math.abs(ny - y) > 2) continue; // prevent wrap-around

          if (data[n * 4 + 3] < ALPHA_THRESHOLD) continue;
          visited[n] = 1;
          queue.push(n);
        }
      }

      // Build output: keep only BFS-visited pixels, zero out the rest
      const outData = Buffer.alloc(W * H * 4, 0);
      let minX = W,
        maxX = 0,
        minY = H,
        maxY = 0;
      for (let i = 0; i < queue.length; i++) {
        const idx = queue[i];
        const x = idx % W;
        const y = Math.floor(idx / W);
        const p = idx * 4;
        outData[p] = data[p];
        outData[p + 1] = data[p + 1];
        outData[p + 2] = data[p + 2];
        outData[p + 3] = data[p + 3];
        if (x < minX) minX = x;
        if (x > maxX) maxX = x;
        if (y < minY) minY = y;
        if (y > maxY) maxY = y;
      }

      if (minX > maxX || minY > maxY) return null; // nothing found

      // Crop to tight bounding box of the flood-filled region
      const cropW = maxX - minX + 1;
      const cropH = maxY - minY + 1;
      const tightBuffer = await sharp(outData, {
        raw: { width: W, height: H, channels: 4 },
      })
        .extract({ left: minX, top: minY, width: cropW, height: cropH })
        .png()
        .toBuffer();

      console.log(
        `[FloodFill] ✅ "${label}": filled ${queue.length} px → crop ${cropW}x${cropH}`,
      );
      return tightBuffer;
    } catch (err) {
      console.error(`[FloodFill] Error for "${label}":`, err);
      return null;
    }
  }

  /**
   * Remove background using BRIAAI RMBG-2.0 via @huggingface/transformers (local ONNX inference).
   * RMBG-2.0 is significantly better than 1.4 at preserving handheld objects, props, and
   * complex subject boundaries. Model is lazy-loaded and cached as a singleton to avoid
   * repeated download/initialization overhead (first call ~10-30s, subsequent calls ~1-3s).
   *
   * Falls back to @imgly/background-removal-node (RMBG-1.4) if transformers fails or is unavailable.
   */
  private async _removeBgRMBG2(imageBuffer: Buffer): Promise<Buffer | null> {
    try {
      if (!_rmbg2Model || !_rmbg2Processor) {
        if (!_rmbg2Loading) {
          console.log("[RMBG-2.0] Initializing model & processor...");
          _rmbg2Loading = (async () => {
            try {
              const { AutoModel, AutoProcessor, env } =
                await import("@huggingface/transformers");

              // Silence excessive ONNX warnings (Shape mismatch, etc.)
              (env as any).backends.onnx.logLevel = "error";
              (env as any).backends.onnx.preferredOutputLocation = null;
              (env as any).backends.onnx.numThreads = 1;

              _rmbg2Processor =
                await AutoProcessor.from_pretrained("briaai/RMBG-2.0");
              _rmbg2Model = await AutoModel.from_pretrained("briaai/RMBG-2.0", {
                device: "cpu",
                dtype: "fp32",
              });
              console.log("[RMBG-2.0] Model ready ✅");
            } catch (err) {
              console.error("[RMBG-2.0] Pipeline initialization failed:", err);
              throw err;
            }
          })();
        }
        await _rmbg2Loading;
      }

      if (!_rmbg2Model || !_rmbg2Processor) return null;

      const { RawImage } = await import("@huggingface/transformers");

      // RMBG-2.0 is trained on 1024x1024. Forcing this size avoids ONNX buffer reallocations
      // and eliminates the "Shape mismatch" logs entirely.
      const MODEL_SIZE = 1024;
      const { data: pixels, info } = await sharp(imageBuffer)
        .resize(MODEL_SIZE, MODEL_SIZE, { fit: "fill" }) // Standard size for BiRefNet
        .removeAlpha()
        .raw()
        .toBuffer({ resolveWithObject: true });

      const img = new RawImage(
        new Uint8Array(pixels),
        info.width,
        info.height,
        3,
      );
      const { pixel_values } = await _rmbg2Processor(img);

      const modelResult = await _rmbg2Model({ pixel_values });
      const output =
        modelResult.output ||
        modelResult.logits ||
        modelResult[Object.keys(modelResult)[0]];

      if (!output) {
        throw new Error(
          `Model result keys [${Object.keys(modelResult).join(", ")}] did not contain output/logits`,
        );
      }

      // RMBG-2.0 returns logits, we need to apply sigmoid and convert to mask
      const { data, dims } = output;
      const [batch, channels, height, width] = dims;

      // Sigmoid + alpha channel mapping
      const alpha = new Uint8ClampedArray(height * width);
      for (let i = 0; i < height * width; ++i) {
        alpha[i] = Math.round((1 / (1 + Math.exp(-data[i]))) * 255);
      }

      // Use sharp to merge the original bytes with the new alpha
      const { data: originalPixels } = await sharp(imageBuffer)
        .resize(width, height)
        .ensureAlpha()
        .raw()
        .toBuffer({ resolveWithObject: true });

      for (let i = 0; i < height * width; ++i) {
        originalPixels[i * 4 + 3] = alpha[i];
      }

      const resultBuffer = await sharp(originalPixels, {
        raw: { width, height, channels: 4 },
      })
        .png()
        .toBuffer();

      console.log(`[RMBG-2.0] ✅ Done (${width}x${height})`);
      return resultBuffer;
    } catch (err) {
      console.error("[RMBG-2.0] Runtime failure:", err);
      return null;
    }
  }

  /**
   * Run background removal on the FULL source image and return the masked result.
   * Running on the full image gives the ML model complete scene context, which significantly
   * improves accuracy for complex items like handheld objects (water guns, phones, bags).
   * The result is shared/cached by the caller across all components.
   */
  private async _removeBgFullImage(
    imageBuffer: Buffer,
  ): Promise<Buffer | null> {
    const tmpPath = path.join(os.tmpdir(), `diecut-full-${Date.now()}.png`);
    try {
      // Resize full image to max 1500px to balance quality vs ML processing time
      const resized = await sharp(imageBuffer)
        .resize({
          width: 1500,
          height: 1500,
          fit: "inside",
          withoutEnlargement: true,
        })
        .png()
        .toBuffer();

      fs.writeFileSync(tmpPath, resized);
      console.log("[Diecut/FullML] Sending full image to RMBG...");
      const resultBlob = await removeBackground(tmpPath);
      const rawBuffer = Buffer.from(await resultBlob.arrayBuffer());

      // Store the dimensions of the resized image so we can upscale back if needed
      const meta = await sharp(rawBuffer).metadata();
      console.log(`[Diecut/FullML] RMBG done: ${meta.width}x${meta.height}`);
      return rawBuffer;
    } catch (err) {
      console.error("[Diecut/FullML] Full-image RMBG failed:", err);
      return null;
    } finally {
      if (fs.existsSync(tmpPath)) fs.unlinkSync(tmpPath);
    }
  }

  /**
   * PRIMARY die-cut method: Crop component from source image + ML background removal.
   *
   * This avoids AI Image Generation entirely — uses the real photo pixels + an ML
   * segmentation model (BRIAAI RMBG-1.4 via @imgly/background-removal-node) to separate
   * the foreground subject from background.
   *
   * The position is a normalized 0-1000 bounding box from the AI layout analysis.
   * Padding is adaptive: characters (people/mascots) get 10% to preserve extended arms,
   * while standalone objects get 4%.
   */
  private async _cropAndDiecut(
    imageBuffer: Buffer,
    position: { top: number; left: number; width: number; height: number },
    label: string = "",
    maskedFullImage: Buffer | null = null,
  ): Promise<Buffer | null> {
    try {
      const CHARACTER_KW = [
        "woman",
        "man",
        "girl",
        "boy",
        "mascot",
        "character",
        "person",
        "figure",
        "human",
        "chibi",
      ];
      const isCharacter = CHARACTER_KW.some((kw) =>
        label.toLowerCase().includes(kw),
      );
      const PAD = isCharacter ? 0.1 : 0.04;
      console.log(
        `[Diecut/Crop] "${label}" → ${isCharacter ? "character" : "object"} padding=${(PAD * 100).toFixed(0)}%`,
      );

      // Determine source dimensions (original image)
      const origMeta = await sharp(imageBuffer).metadata();
      const origW = origMeta.width || 1000;
      const origH = origMeta.height || 1000;

      // Compute bounding box in original pixel space
      const topNorm = Math.max(0, position.top / 1000 - PAD);
      const leftNorm = Math.max(0, position.left / 1000 - PAD);
      const bottomNorm = Math.min(
        1,
        (position.top + position.height) / 1000 + PAD,
      );
      const rightNorm = Math.min(
        1,
        (position.left + position.width) / 1000 + PAD,
      );

      // ── Branch A: Use pre-masked full image (preferred — better context for ML) ──
      if (maskedFullImage) {
        // Use BFS flood fill to isolate just this component's pixels (ignores other disjoint foregrounds)
        const extractedBuffer = await this._extractComponentByFloodFill(
          maskedFullImage,
          position,
          origW,
          origH,
          label,
        );

        if (extractedBuffer) {
          // To maintain scale, we resize the tight extracted blob into the exact expected
          // target width/height based on the original component proportion
          const targetW = Math.round((rightNorm - leftNorm) * origW);
          const targetH = Math.round((bottomNorm - topNorm) * origH);
          return await sharp(extractedBuffer)
            // fit: "contain" ensures we don't stretch the pixel ratio if the flood-fill
            // bounding box aspect ratio differs slightly from the raw crop aspect ratio
            .resize({
              width: targetW,
              height: targetH,
              fit: "contain",
              background: { r: 0, g: 0, b: 0, alpha: 0 },
            })
            .png()
            .toBuffer();
        } else {
          console.warn(
            `[Diecut/Crop] FloodFill failed for "${label}", falling back to Branch B`,
          );
          // Fall through to Branch B if flood fill fails (e.g., no foreground pixels)
        }
      }

      // ── Branch B: Crop first, then run RMBG-2.0 (primary) or RMBG-1.4 (fallback) ──
      const cropLeft = Math.round(leftNorm * origW);
      const cropTop = Math.round(topNorm * origH);
      const cropWidth = Math.round((rightNorm - leftNorm) * origW);
      const cropHeight = Math.round((bottomNorm - topNorm) * origH);

      if (cropWidth < 10 || cropHeight < 10) {
        console.warn("[Diecut/Crop] Crop region too small, skipping.");
        return null;
      }

      console.log(
        `[Diecut/Crop] Crop: left=${cropLeft} top=${cropTop} w=${cropWidth} h=${cropHeight}`,
      );

      const croppedBuffer = await sharp(imageBuffer)
        .extract({
          left: cropLeft,
          top: cropTop,
          width: cropWidth,
          height: cropHeight,
        })
        .png()
        .toBuffer();

      // Try RMBG-2.0 first — better at preserving props, handheld objects, and fine edges
      let rawResultBuffer = await this._removeBgRMBG2(croppedBuffer);

      if (!rawResultBuffer) {
        // Fallback to @imgly RMBG-1.4
        console.log("[Diecut/Crop] Using RMBG-1.4 fallback...");
        const tmpPath = path.join(os.tmpdir(), `diecut-crop-${Date.now()}.png`);
        try {
          fs.writeFileSync(tmpPath, croppedBuffer);
          const resultBlob = await removeBackground(tmpPath);
          rawResultBuffer = Buffer.from(await resultBlob.arrayBuffer());
        } finally {
          if (fs.existsSync(tmpPath)) fs.unlinkSync(tmpPath);
        }
      }

      if (!rawResultBuffer) return null;

      const { data, info } = await sharp(rawResultBuffer)
        .ensureAlpha()
        .raw()
        .toBuffer({ resolveWithObject: true });

      const ALPHA_THRESHOLD = 25;
      for (let i = 3; i < data.length; i += 4) {
        if (data[i] < ALPHA_THRESHOLD) data[i] = 0;
      }
      const cleanedBuffer = await sharp(data, {
        raw: { width: info.width, height: info.height, channels: 4 },
      })
        .png()
        .toBuffer();

      if (!isCharacter) {
        try {
          return await sharp(cleanedBuffer).trim().png().toBuffer();
        } catch {
          return cleanedBuffer;
        }
      }
      return cleanedBuffer;
    } catch (err) {
      console.error("[Diecut/Crop] Error:", err);
      return null;
    }
  }

  /**
   * Generate ONE die-cut component at full resolution, then flood-fill remove white background.
   */
  private async _generateSingleDiecut(
    imageBuffer: Buffer,
    mimeType: string,
    component: { label: string; description: string },
  ): Promise<Buffer | null> {
    const model =
      process.env.GEMINI_IMAGE_ENDPOINT_2 ||
      process.env.GEMINI_IMAGE_ENDPOINT ||
      "gemini-3-pro-image-preview";

    // Determine if this is a character (person/mascot) or an inanimate object
    // Objects must NOT be shown with hands or arms holding them
    const labelLower = component.label.toLowerCase();
    const isCharacter =
      labelLower.includes("woman") ||
      labelLower.includes("man") ||
      labelLower.includes("girl") ||
      labelLower.includes("boy") ||
      labelLower.includes("mascot") ||
      labelLower.includes("character") ||
      labelLower.includes("person") ||
      labelLower.includes("figure") ||
      labelLower.includes("human");

    const prompt = isCharacter
      ? `
      Look at the reference image carefully.
      Your task is to recreate ONE specific visual element as a HIGH-RESOLUTION PHOTOGRAPHIC CUTOUT.

      ELEMENT TO RECREATE: "${component.label}"
      ${component.description ? `EXTRA DESCRIPTION: "${component.description}"` : ""}

      STRICT RULES:
      1. Generate ONLY this single person/character. Do NOT include any other people or elements.
      2. PURE WHITE BACKGROUND — the entire background must be perfectly flat white (#FFFFFF).
      3. ABSOLUTELY NO WHITE BORDERS: Do NOT draw a white stroke, white outline, or sticker-style border around the character. The edges of the character must transition directly into the white background.
      4. FULL BODY RULE: You MUST show the COMPLETE body from the very top of the head to the tips of the toes/feet. Absolutely NO cropping — feet must be fully visible.
      5. CENTER the character with generous padding (at least 10% on each side).
      6. Match the exact style, colors, outfit, proportions, and details from the reference image.
      7. High resolution, sharp edges, vibrant colors.
      8. Do NOT include any text, labels, borders, shadows, or drop shadows.
      9. The character may hold any props they are holding in the reference image.
    `
      : `
      Look at the reference image carefully.
      Your task is to recreate ONE specific object as a HIGH-RESOLUTION PRODUCT CUTOUT.

      OBJECT TO RECREATE: "${component.label}"
      ${component.description ? `EXTRA DESCRIPTION: "${component.description}"` : ""}

      STRICT RULES:
      1. Generate ONLY this isolated object by itself. Do NOT include any other objects or elements.
      2. PURE WHITE BACKGROUND — the entire background must be perfectly flat white (#FFFFFF).
      3. ABSOLUTELY NO WHITE BORDERS: Do NOT draw a white stroke, white outline, or sticker-style border around the object. The edges of the object must transition directly into the white background.
      4. OBJECT ONLY — Do NOT include any hands, arms, fingers, bodies, or human body parts holding or touching the object.
      5. Show the object floating/standing alone, centered in the image.
      6. CENTER the object with generous padding (at least 15% on each side).
      7. Match the exact style, colors, design, and details from the reference image.
      8. High resolution, sharp edges, vibrant colors.
      9. Do NOT include any text, labels, borders, shadows, or drop shadows.
    `;

    const parts: any[] = [
      { inlineData: { data: imageBuffer.toString("base64"), mimeType } },
      { text: prompt },
    ];

    const config: any = {
      temperature: 1,
      topP: 0.95,
      responseModalities: ["TEXT", "IMAGE"],
      imageConfig: { aspectRatio: "1:1" },
      safetySettings: [
        { category: "HARM_CATEGORY_HATE_SPEECH", threshold: "OFF" },
        { category: "HARM_CATEGORY_DANGEROUS_CONTENT", threshold: "OFF" },
        { category: "HARM_CATEGORY_SEXUALLY_EXPLICIT", threshold: "OFF" },
        { category: "HARM_CATEGORY_HARASSMENT", threshold: "OFF" },
      ],
    };

    const streamingResp = await this.withRetry(() =>
      this.client.models.generateContentStream({
        model,
        contents: [{ role: "user", parts }],
        config,
      }),
    );

    let imgBuffer: Buffer | null = null;
    for await (const chunk of streamingResp) {
      if (chunk.candidates?.[0]?.content?.parts) {
        for (const part of chunk.candidates[0].content.parts) {
          if (part.inlineData?.data && !imgBuffer) {
            imgBuffer = Buffer.from(part.inlineData.data as string, "base64");
          }
        }
      }
    }

    if (!imgBuffer) return null;

    // --- Flood-fill background removal ---
    const WHITE_THRESHOLD = 250; // Safety first: don't eat highlights

    const { data: pixels, info } = await sharp(imgBuffer)
      .ensureAlpha()
      .raw()
      .toBuffer({ resolveWithObject: true });

    const w = info.width;
    const h = info.height;
    const pidx = (px: number, py: number) => py * w + px;
    const ri = (px: number, py: number) => (py * w + px) * 4;

    const isBg = (px: number, py: number): boolean => {
      const i = ri(px, py);
      const r = pixels[i],
        g = pixels[i + 1],
        b = pixels[i + 2];
      // ONLY remove pure or near-pure white background
      return (
        r >= WHITE_THRESHOLD && g >= WHITE_THRESHOLD && b >= WHITE_THRESHOLD
      );
    };

    const bgFlag = new Uint8Array(w * h);
    const queue: number[] = [];

    // Seed from all 4 edges
    for (let ex = 0; ex < w; ex++) {
      if (isBg(ex, 0) && !bgFlag[pidx(ex, 0)]) {
        bgFlag[pidx(ex, 0)] = 1;
        queue.push(pidx(ex, 0));
      }
      if (isBg(ex, h - 1) && !bgFlag[pidx(ex, h - 1)]) {
        bgFlag[pidx(ex, h - 1)] = 1;
        queue.push(pidx(ex, h - 1));
      }
    }
    for (let ey = 1; ey < h - 1; ey++) {
      if (isBg(0, ey) && !bgFlag[pidx(0, ey)]) {
        bgFlag[pidx(0, ey)] = 1;
        queue.push(pidx(0, ey));
      }
      if (isBg(w - 1, ey) && !bgFlag[pidx(w - 1, ey)]) {
        bgFlag[pidx(w - 1, ey)] = 1;
        queue.push(pidx(w - 1, ey));
      }
    }

    // BFS
    const dx = [-1, 1, 0, 0];
    const dy = [0, 0, -1, 1];
    let qi = 0;
    while (qi < queue.length) {
      const cur = queue[qi++];
      const cx = cur % w;
      const cy = Math.floor(cur / w);
      for (let d = 0; d < 4; d++) {
        const nx = cx + dx[d],
          ny = cy + dy[d];
        if (nx < 0 || nx >= w || ny < 0 || ny >= h) continue;
        const np = pidx(nx, ny);
        if (!bgFlag[np] && isBg(nx, ny)) {
          bgFlag[np] = 1;
          queue.push(np);
        }
      }
    }

    // Apply transparency
    for (let py = 0; py < h; py++) {
      for (let px = 0; px < w; px++) {
        if (bgFlag[pidx(px, py)]) pixels[ri(px, py) + 3] = 0;
      }
    }

    // --- NEW: Alpha Erosion to remove white stroke/halo ---
    // We basically look at transparent pixels and make their neighbors transparent too
    // to "eat" into the white halo.
    const EROSION_ITERATIONS = 2;
    for (let iter = 0; iter < EROSION_ITERATIONS; iter++) {
      const currentAlpha = new Uint8Array(w * h);
      for (let i = 0; i < w * h; i++) currentAlpha[i] = pixels[i * 4 + 3];

      for (let py = 1; py < h - 1; py++) {
        for (let px = 1; px < w - 1; px++) {
          const idx = py * w + px;
          if (currentAlpha[idx] > 0) {
            // If any neighbor is transparent, make this pixel transparent (or reduce alpha)
            if (
              currentAlpha[idx - 1] === 0 ||
              currentAlpha[idx + 1] === 0 ||
              currentAlpha[idx - w] === 0 ||
              currentAlpha[idx + w] === 0
            ) {
              pixels[idx * 4 + 3] = 0;
            }
          }
        }
      }
    }

    const diecut = await sharp(pixels, {
      raw: { width: w, height: h, channels: 4 },
    })
      .png()
      .toBuffer();

    try {
      return await sharp(diecut).trim().png().toBuffer();
    } catch {
      return diecut;
    }
  }

  /**
   * SIMPLE RENDER: Composites layers directly onto background without AI
   */
  async renderSimpleComposite(
    baseImageBuffer: Buffer,
    suggestions: any[],
  ): Promise<Buffer> {
    const metadata = await sharp(baseImageBuffer).metadata();
    const width = metadata.width || 800;
    const height = metadata.height || 600;

    let svgOverlay = `<svg width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" xmlns="http://www.w3.org/2000/svg">`;

    // Define shadow filters (matches preview)
    svgOverlay += `
      <defs>
        <filter id="shadow-subtle" x="-5%" y="-5%" width="110%" height="110%">
          <feDropShadow dx="1" dy="1" stdDeviation="2" flood-color="#000000" flood-opacity="0.5"/>
        </filter>
        <filter id="shadow-strong" x="-10%" y="-10%" width="120%" height="120%">
          <feDropShadow dx="2" dy="2" stdDeviation="4" flood-color="#000000" flood-opacity="0.8"/>
        </filter>
      </defs>
    `;

    const compositeItems: any[] = [];

    for (const s of suggestions) {
      if (!s.position || typeof s.position.top === "undefined") continue;

      const top = (s.position.top / 1000) * height;
      const left = (s.position.left / 1000) * width;
      const w = (s.position.width / 1000) * width;
      const h = (s.position.height / 1000) * height;
      const rotation = s.position.rotation || 0;

      if (s.type === "image" && s.imageUrl) {
        // We'll handle images via Sharp composite for better quality/transparency
        try {
          // Extract local filename from URL
          const filename = s.imageUrl.split("/").pop();
          const localPath = path.join(__dirname, "../../uploads", filename);
          if (fs.existsSync(localPath)) {
            const imgBuffer = fs.readFileSync(localPath);
            const resizedImg = await sharp(imgBuffer)
              .resize({
                width: Math.round(w),
                height: Math.round(h),
                fit: "contain",
                background: { r: 0, g: 0, b: 0, alpha: 0 },
              })
              .rotate(rotation, { background: { r: 0, g: 0, b: 0, alpha: 0 } })
              .toBuffer();

            compositeItems.push({
              input: resizedImg,
              top: Math.round(top),
              left: Math.round(left),
            });
          }
        } catch (err) {
          console.error(
            `[SimpleRender] Failed to include component: ${s.imageUrl}`,
            err,
          );
        }
        continue;
      }

      // Draw Text Layers in SVG
      const fontSize = s.style?.font_size_normalized || 40;
      const color = s.style?.color_hex || "#FFFFFF";
      const shadow = s.style?.shadow || "none";
      const fontStyle = s.style?.font_style || "normal";
      const textAnchor =
        s.style?.text_align === "center"
          ? "middle"
          : s.style?.text_align === "right"
            ? "end"
            : "start";
      const textX =
        s.style?.text_align === "center"
          ? left + w / 2
          : s.style?.text_align === "right"
            ? left + w
            : left;

      const lines = (s.part || "").split("\n");
      const lineHeight = s.style?.line_height || 1.2;

      const filterAttr =
        shadow === "strong"
          ? ' filter="url(#shadow-strong)"'
          : shadow === "subtle"
            ? ' filter="url(#shadow-subtle)"'
            : "";
      const computedH = lines.length * fontSize * lineHeight;
      const transform =
        rotation !== 0
          ? ` transform="rotate(${rotation}, ${left + w / 2}, ${top + computedH / 2})"`
          : "";

      svgOverlay += `<g${transform}${filterAttr}>`;
      lines.forEach((line: string, i: number) => {
        const yLine = top + i * (fontSize * lineHeight);
        svgOverlay += `
          <text 
            x="${textX}" y="${yLine}" 
            fill="${color}" 
            font-size="${fontSize}px" 
            font-family="${s.style?.font_family || "sans-serif"}" 
            font-weight="${s.style?.font_weight || "normal"}"
            font-style="${fontStyle}"
            text-anchor="${textAnchor}"
            dominant-baseline="hanging"
            letter-spacing="${s.style?.letter_spacing || 0}"
          >${line.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")}</text>
        `;
      });
      svgOverlay += `</g>`;
    }

    svgOverlay += `</svg>`;

    // Layer SVG over background
    compositeItems.push({
      input: Buffer.from(svgOverlay),
      top: 0,
      left: 0,
    });

    return sharp(baseImageBuffer).composite(compositeItems).png().toBuffer();
  }

  async warmupRMBG2(): Promise<void> {
    try {
      console.log("[RMBG-2.0] Warming up model (256x256)...");
      // Use a 256x256 dummy image instead of 1x1 to avoid ONNX shape issues
      const dummyBuffer = await sharp({
        create: {
          width: 256,
          height: 256,
          channels: 3,
          background: { r: 255, g: 255, b: 255 },
        },
      })
        .png()
        .toBuffer();
      await this._removeBgRMBG2(dummyBuffer);
    } catch (e) {
      console.warn("[RMBG-2.0] Warmup skip/fail:", e);
    }
  }

  // ---------------------------------------------------------------------------
  // Flex-tree layout: AI outputs a hierarchical flex tree JSON
  // ---------------------------------------------------------------------------

  /**
   * Validate a flex tree produced by the AI. Returns an array of warning
   * strings (empty = valid). Does not throw — AI output is best-effort.
   */
  private validateFlexTree(
    node: FlexNode,
    componentLabels: string[],
    path = "root",
  ): string[] {
    const warnings: string[] = [];

    if (!node.id) {
      warnings.push(`${path}: missing id`);
    }

    const isContainer =
      node.direction !== undefined || Array.isArray(node.children);

    if (isContainer) {
      if (!node.direction) {
        warnings.push(`${path}: container missing direction`);
      }
      if (!Array.isArray(node.children) || node.children.length === 0) {
        warnings.push(`${path}: container has no children`);
      } else {
        for (let i = 0; i < node.children.length; i++) {
          const childPath = `${path}.children[${i}]`;
          warnings.push(
            ...this.validateFlexTree(node.children[i], componentLabels, childPath),
          );
        }
      }
    } else {
      // Leaf node
      if (node.type === "component") {
        if (!node.label) {
          warnings.push(`${path}: component leaf missing label`);
        } else if (!componentLabels.includes(node.label)) {
          warnings.push(
            `${path}: component label "${node.label}" not in available labels [${componentLabels.join(", ")}]`,
          );
        }
      } else if (node.type === "text") {
        if (!node.text) {
          warnings.push(`${path}: text leaf missing text content`);
        }
      }
    }

    return warnings;
  }

  /**
   * Ask the AI for a Flex Tree JSON — a hierarchical layout tree with
   * row/column containers and text/component leaves.  The flex layout engine
   * (`computeFlexLayout`) will turn this into pixel-level bounding boxes.
   */
  async suggestFlexLayout(
    imageBuffer: Buffer,
    mimeType: string,
    targetText: string,
    componentLabels: string[],
    canvasSize: { w: number; h: number },
  ): Promise<{
    flexTree: FlexNode;
    campaign_vibe: string;
    background_description: string;
  }> {
    // ── Image preprocessing ──
    let processingBuffer = imageBuffer;
    let processingMime = mimeType;
    try {
      const meta = await sharp(imageBuffer).metadata();
      const origW = meta.width || canvasSize.w;
      processingBuffer = await sharp(imageBuffer)
        .resize(Math.min(1500, origW))
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

    // ── Build prompt ──
    const componentsList =
      componentLabels.length > 0
        ? `Available die-cut component images:\n${componentLabels.map((l) => `  - "${l}"`).join("\n")}`
        : "No die-cut components available.";

    const prompt = `You are a professional graphic designer creating an advertising campaign layout.

CAMPAIGN TEXT TO PLACE:
${targetText}

${componentsList}

CANVAS SIZE: ${canvasSize.w}px × ${canvasSize.h}px

YOUR TASK: Output a flex tree JSON that describes the layout hierarchy.

THE FLEX TREE FORMAT:
A tree of nested containers (row/column) with leaf nodes (text or component).

CONTAINER NODE:
{
  "id": "unique-id",
  "direction": "row" | "column",   // how children are arranged
  "children": [ ... ],             // array of child nodes
  "height": "40%",                 // percentage of parent's main axis (for column parent)
  "width": "60%",                  // percentage of parent's main axis (for row parent)
  "gap": 16,                       // px gap between children (default 8, use 16-40 for breathing room)
  "padding": 30                    // px inset from edges (default 0, use 20-50 for margins)
}

TEXT LEAF NODE:
{
  "id": "unique-id",
  "type": "text",
  "text": "the text content",
  "height": "30%",                 // percentage along parent's main axis
  "style": {
    "fontSize": "xlarge",          // options: "xlarge" | "large" | "medium" | "small" | "xsmall"
    "fontWeight": "900",           // options: "400" | "700" | "900"
    "color": "#FFD700",
    "strokeColor": "#000000",      // optional outline for readability on busy backgrounds
    "strokeWidth": 2,              // optional
    "align": "center"              // options: "left" | "center" | "right"
  }
}

COMPONENT LEAF NODE (die-cut image):
{
  "id": "unique-id",
  "type": "component",
  "label": "must match one of the available component labels exactly",
  "height": "50%"                  // percentage along parent's main axis
}

LAYOUT DESIGN PRINCIPLES:
1. Every line of the campaign text MUST appear as a text leaf node.
2. Every available component MUST appear exactly once as a component leaf.
3. Use 2-3 levels of nesting for interesting composition (root → sections → subsections → leaves).
4. Promotional numbers/prices should use fontSize "xlarge" or "large" and fontWeight "900".
5. Fine print / legal text should use fontSize "xsmall" or "small" and fontWeight "400".

CREATIVE LAYOUT GUIDANCE:
6. DO NOT make a boring 50/50 split. Vary proportions: 65/35, 70/30, or asymmetric layouts.
7. Sibling percentages do NOT need to sum to 100% — leaving unused space creates whitespace and breathing room.
8. Use padding (20-50) on the ROOT node to create margins. Use gap (16-40) between siblings.
9. Mix row and column directions at different levels for dynamic layouts.
10. Components can be placed alongside text (not just in a separate column). Be creative.
11. Think like a magazine designer: hero element large, supporting text compact, whitespace is valuable.
12. Choose text colors that contrast well with the background image.
13. Use strokeColor for text over busy or colorful backgrounds to ensure readability.

OUTPUT FORMAT — respond with ONLY this JSON (no markdown, no explanation):
{
  "flexTree": {
    "id": "root",
    "direction": "row",
    "padding": 30,
    "gap": 20,
    "children": [ ... ]
  },
  "campaign_vibe": "brief description of the visual mood/style",
  "background_description": "brief description of what's in the background image"
}`;

    console.log(
      `[FlexLayout] Calling ${model} for flex tree layout (canvas: ${canvasSize.w}×${canvasSize.h}, components: ${componentLabels.length})`,
    );

    // ── Call the AI ──
    const response = await this.client.models.generateContent({
      model,
      contents: [
        {
          role: "user",
          parts: [
            {
              inlineData: {
                mimeType: processingMime,
                data: processingBuffer.toString("base64"),
              },
            },
            { text: prompt },
          ],
        },
      ],
      config: { temperature: 0.7 },
    });

    const raw = response.text ?? "";
    console.log(`[FlexLayout] Raw response length: ${raw.length} chars`);

    // ── Parse response ──
    try {
      // Strip markdown code fences if present
      const cleaned = raw
        .replace(/^```(?:json)?\s*/i, "")
        .replace(/\s*```$/i, "")
        .trim();

      const parsed = JSON.parse(cleaned);

      if (!parsed.flexTree || typeof parsed.flexTree !== "object") {
        throw new Error("Parsed JSON has no flexTree object");
      }

      // Validate the tree structure
      const warnings = this.validateFlexTree(parsed.flexTree, componentLabels);
      if (warnings.length > 0) {
        console.warn(
          `[FlexLayout] Validation warnings:\n  ${warnings.join("\n  ")}`,
        );
      }

      console.log(
        `[FlexLayout] Success — vibe: "${parsed.campaign_vibe}", warnings: ${warnings.length}`,
      );

      return {
        flexTree: parsed.flexTree as FlexNode,
        campaign_vibe: parsed.campaign_vibe || "modern advertising",
        background_description:
          parsed.background_description || "campaign background",
      };
    } catch (err) {
      console.error(
        "[FlexLayout] Failed to parse AI response, using fallback.",
        err,
      );
      console.error("[FlexLayout] Raw response was:", raw.substring(0, 500));

      // Fallback: simple single-column layout with all text
      const textLines = targetText
        .split("\n")
        .map((l) => l.trim())
        .filter((l) => l.length > 0);

      const textChildren: FlexNode[] = textLines.map((line, i) => ({
        id: `text-${i}`,
        type: "text" as const,
        text: line,
        height: `${Math.floor(80 / textLines.length)}%`,
        style: {
          fontSize: i === 0 ? ("large" as const) : ("medium" as const),
          fontWeight: i === 0 ? "900" : "400",
          color: "#FFFFFF",
          strokeColor: "#000000",
          strokeWidth: 2,
          align: "center" as const,
        },
      }));

      const componentChildren: FlexNode[] = componentLabels.map((label, i) => ({
        id: `comp-${i}`,
        type: "component" as const,
        label,
        height: `${Math.floor(100 / componentLabels.length)}%`,
      }));

      const rootChildren: FlexNode[] = [];
      if (textChildren.length > 0) {
        rootChildren.push({
          id: "text-col",
          direction: "column",
          children: textChildren,
          width:
            componentChildren.length > 0 ? "60%" : "100%",
        });
      }
      if (componentChildren.length > 0) {
        rootChildren.push({
          id: "comp-col",
          direction: "column",
          children: componentChildren,
          width: textChildren.length > 0 ? "40%" : "100%",
        });
      }

      return {
        flexTree: {
          id: "root",
          direction: "row",
          padding: 30,
          gap: 20,
          children:
            rootChildren.length > 0
              ? rootChildren
              : [
                  {
                    id: "fallback-text",
                    type: "text",
                    text: targetText,
                    style: {
                      fontSize: "large",
                      fontWeight: "700",
                      color: "#FFFFFF",
                      strokeColor: "#000000",
                      strokeWidth: 2,
                      align: "center",
                    },
                  },
                ],
        },
        campaign_vibe: "default",
        background_description: "campaign background",
      };
    }
  }
}

export const vertexService = new AIService();
