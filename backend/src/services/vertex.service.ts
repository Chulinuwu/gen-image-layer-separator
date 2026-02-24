/**
 * AI Service using @google/genai SDK (Vertex AI mode)
 * Billing goes to GCP Vertex AI
 *
 * Key: location must be "global" for Gemini 3 preview models
 */

import { GoogleGenAI } from "@google/genai";
import sharp from "sharp";
import fs from "fs";
import path from "path";
import dotenv from "dotenv";

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
        maxOutputTokens: 32768,
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
   * Suggests BOTH text placement AND visual components for a campaign
   * Returns text suggestions + component descriptions for die-cut generation
   */
  async suggestCampaignLayout(
    imageBuffer: Buffer,
    mimeType: string,
    targetText: string,
    mode: string = "full",
    externalNoGoZones: any[] = [],
  ) {
    // 1. Resize for faster analysis & stay within model limits
    let processingBuffer = imageBuffer;
    let processingMime = mimeType;
    try {
      const meta = await sharp(imageBuffer).metadata();
      const w = meta.width || 800;
      const h = meta.height || 600;

      // --- OPTIMIZATION: Physical Grid Overlay for Coordinate Accuracy ---
      let gridSvg = `<svg width="${w}" height="${h}" viewBox="0 0 ${w} ${h}" xmlns="http://www.w3.org/2000/svg">`;
      // Draw 10x10 Grid
      for (let i = 1; i < 10; i++) {
        const x = (i / 10) * w;
        const y = (i / 10) * h;
        // Vertical lines
        gridSvg += `<line x1="${x}" y1="0" x2="${x}" y2="${h}" stroke="rgba(255,255,255,0.3)" stroke-width="1" />`;
        gridSvg += `<text x="${x + 2}" y="15" fill="white" font-size="14" font-weight="bold" opacity="0.6">${i * 100}</text>`;
        // Horizontal lines
        gridSvg += `<line x1="0" y1="${y}" x2="${w}" y2="${y}" stroke="rgba(255,255,255,0.3)" stroke-width="1" />`;
        gridSvg += `<text x="5" y="${y + 12}" fill="white" font-size="14" font-weight="bold" opacity="0.6">${i * 100}</text>`;
      }
      gridSvg += `</svg>`;

      processingBuffer = await sharp(imageBuffer)
        .resize(Math.min(w, 1500))
        .composite([{ input: Buffer.from(gridSvg), top: 0, left: 0 }])
        .toBuffer();

      processingMime = "image/jpeg";
    } catch (e) {
      console.warn("[GenAI] Grid/Resize failed, using original:", e);
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

    const isCompOnly = mode === "only_bg_comp";

    const prompt = `
      Act as a professional graphic designer. 
      NOTE: The image has a VISIBLE 10x10 WHITE GRID with numeric markers (100, 200... 900).
      Use these grid lines as a strict PHYSICAL RULER to determine coordinates. 
      Map your 0-1000 coordinates exactly to these visible markers. 
      
      AD BRIEF / TEXT (Reference only for context):
      """
      ${targetText}
      """

      ${noGoInstruction}
      
      ═══════════════════════════════════════
      TASK 0: PRECISION OBJECT DETECTION
      ═══════════════════════════════════════
      1. Use the VISIBLE GRID to pinpoint ALL people and characters.
      2. Create tight bounding boxes for each significant body part.
      3. Use the grid lines to ensure accuracy.
      4. For mascots: Head area, Body area.
      5. Each zone should have its own tight bounding box (top, left, width, height in 0-1000).
      6. Do NOT guess. Map to the grid.

      ═══════════════════════════════════════
      
      TASKS:
      ${
        isCompOnly
          ? `
      1. COMPONENT EXTRACTION (MAIN TASK):
         - Identify ALL foreground visual elements: Ribbons, banners, price badges, mascots, stickers, logos, person cutouts.
         - For EACH element, provide a detailed description.
      2. SKIP TEXT TASKS: Do NOT analyze or suggest text layouts for this request.
      `
          : `
      1. SPATIAL ANALYSIS (CRITICAL FIRST STEP):
         - Divide the image into 3 vertical columns: LEFT (0-333), CENTER (334-666), RIGHT (667-1000).
         - Identify which column is EMPTY/SAFE.
         - **RULE: PLACE 90% OF TEXT IN THE 'SAFE COLUMN' ONLY.**
      
      2. TEXT EXTRACTION & SMART LINE BREAKING:
         - Read the AD BRIEF.
         - Split long sentences into multiple visual lines to fit the Safe Zone.
         - YOU MUST RETURN AT LEAST ONE TEXT SUGGESTION.
      
      3. DESIGN POLISHING:
         - Group related text visually close together.
         - Push text block inwards towards subjects to avoid awkward floating gaps.
      `
      }
      
      ${
        mode === "full" || mode === "only_bg_comp"
          ? `4. COMPONENT LIST: Identify ALL non-text visual elements overlaid on the background.
         Examples: Ribbons, banners, price badges, mascots, characters, stickers, person cutouts.
         For each, provide a DETAILED visual description.`
          : `4. SKIP COMPONENTS: Return empty array [] for 'components'.`
      }
      
      Return the result as a STRICT JSON object:
      {
        "background_description": "Describe the background scene (without any overlaid elements)",
        "campaign_vibe": "Energetic, Minimalist, Luxury, etc.",
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
              "font_size_normalized": "Relative size (e.g. 10 to 120)",
              "text_align": "left | center | right",
              "letter_spacing": "Numeric tracking (e.g. 0, -1)",
              "line_height": "Default 1.2",
              "shadow": "none | subtle | strong | outline"
            },
            "design_notes": "CRITICAL: Maintain a 'Safety Margin' of at least 5-8% from ALL edges (0-1000 scale, so avoid left < 50, right > 950, top < 50, bottom > 950). Do NOT touch the very edge.",
            "hierarchy": "Headline | Body | FinePrint"
          }
        ],
        "components": ${
          mode === "full" || mode === "only_bg_comp"
            ? `[
          {
            "label": "Short label (e.g. 'Thai boy mascot')",
            "description": "Visual description for recreation",
            "position": { "top": 0, "left": 0, "width": 0, "height": 0, "rotation": 0 },
            "z_index": 1
          }
        ]`
            : "[]"
        }
      }
      
      IMPORTANT:
      - MODE is currently: ${mode}.
      - If mode is 'text', the 'components' array MUST be empty [].
      - If mode is 'full', you MUST extract both text elements and visual components.
      
      ✓ FONT SELECTION RULES:
      - STANDARD THAI: Use 'Kanit'.
      - HEADER/MODERN THAI: Use 'Mitr' (Tailless, Friendly).
      - HANDWRITTEN/FUN: Use 'Sriracha'.
      - MODERN/CLEAN: Use 'Inter'.
      - LUXURY/ELEGANT: Use 'Playfair Display'.
      
      ✓ DESIGN TRICKS (COMMERCIAL GRADE):
      - **STROKE/OUTLINE**: For main HEADLINES on busy backgrounds, ADD A STROKE (e.g., white stroke on orange text). 
        Set "stroke_hex": "#FFFFFF", "stroke_width": 3.
      - **GRADIENTS**: For "Promotional Numbers" (e.g., "50%", "2 ต่อ"), use gradients to make them pop.
      
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
      - USE GRAPHIC CONTAINERS: Suggest visual elements like 'yellow_tag', 'red_ribbon', 'glassmorphism_card', or 'neon_banner' in 'visual_container' property to anchor the text.
      - COMPOSITION DENSITY: An ad should look 'Full' and 'High-End'. If it looks 'empty', add more decorative components or increase font sizes significantly.
      - TEXT STYLING: Use professional combinations. E.g., a huge number '2' with a smaller 'ต่อ' next to it, not just a flat line.
    `;

    const config: any = {
      maxOutputTokens: 65535,
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
        mode === "text"
          ? "Text Layout (text-only mode)"
          : "Layout + Components";
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
  ) {
    const model =
      process.env.GEMINI_MODEL_ENDPOINT_2 ||
      process.env.GEMINI_MODEL_ENDPOINT ||
      "gemini-3-flash-preview";

    const prompt = `
      You are the STRICTEST ART DIRECTOR in the advertising industry.
      You have been given TWO images:
      - IMAGE 1: The ORIGINAL reference image (the raw background photo)
      - IMAGE 2: The PREVIEW showing text overlays placed on top of the background

      AD BRIEF: "${targetText}"
      
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
      
      ✗ FORBIDDEN: Text spanning across very high-contrast edges without proper Stroke/Background is a FAIL.
      
      ✗ NO TEXT OR MISSING TEXT:
        - If IMAGE 2 has NO visible text at all → FAIL
        - If key text from the AD BRIEF is missing (headline, offer, fine print) → FAIL
        - An ad with no text is not an ad. Automatic FAIL.
      
      ✗ TEXT BLOCKS OVERLAP EACH OTHER:
        - If two different text elements overlap or are placed on top of each other → FAIL
        - Each text block must have its own clear, separate space
      
      ✗ TEXT OVERLAPS A PERSON'S BODY:
        - Look at IMAGE 2. Every text block has a SEMI-TRANSPARENT RED tint behind it.
        - If that RED tint touches or covers ANY part of a human (legs, arms, hair, clothes, face) → FAIL
        - This is non-negotiable. RED on PERSON = REJECT.
        - PAY SPECIAL ATTENTION to the center and lower portions of the image where people typically stand.
        - In this ad, there is likely a woman standing. If you see RED covering any part of her denim shirt, jeans, or skin → FAIL.
      
      ✗ TEXT OVERLAPS A MASCOT OR CHARACTER:
        - If text covers any cartoon/mascot figure → FAIL
      
      ✗ TEXT COLOR BLENDS WITH BACKGROUND:
        - If text color is too similar to the area directly behind it → FAIL
        - Light text (white/yellow/light green) on a photo of sky/trees/plants = FAIL (not enough contrast)
        - The text MUST contrast sharply with whatever photo/pattern is behind it
      
      ✗ TEXT OVER PHOTO WITHOUT SHADOW:
        - If text sits on top of a photograph (not a solid color band) and has no shadow → FAIL
        - Only text on a SOLID, HIGH-CONTRAST block of color can skip shadow
      
      ✗ TEXT CUT OFF AT EDGES:
        - Any text going past the image boundary → FAIL
      
      ✗ TEXT TOO CLOSE TO EDGE (SAFE ZONE):
        - ALL text (except FinePrint) must have at least 3% margin from ANY edge of the image
        - In normalized coordinates (0-1000): text must not start before 30 or extend past 970
        - Text crammed against the edge looks cheap and unprofessional → FAIL
        - FinePrint is allowed to be closer to the bottom edge (min 1.5% / 15 in normalized coords)
      
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
      console.log("[GenAI] Critique raw response:", text.substring(0, 500));

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
   * Step 1.3: Refine layout based on critique
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
      1. Fix ALL issues mentioned in the critique's actionable_steps
      2. NO text may overlap with any person, mascot, or character in the image
         - Look at IMAGE 2: if text is on top of a person's body, MOVE IT AWAY
         - Even if there's a colored banner behind the person, the person is IN FRONT
      3. Keep the same text content — only change positions, sizes, colors, and styles
      4. Maintain at least 3% margin from image edges (30 in 0-1000 coords)
      5. Coordinates must be 0-1000 normalized
      
      Return as STRICT JSON (no markdown, no explanation):
      {
        "background_description": "${previousAnalysis.background_description || ""}",
        "campaign_vibe": "${previousAnalysis.campaign_vibe || ""}",
        "no_go_zones": ${JSON.stringify(noGoZones)},
        "suggestions": [same structure as before with fixed positions],
        "components": []
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

      Return as STRICT JSON:
      {
        "components": [
          {
            "label": "Short label (e.g. 'Thai boy mascot')",
            "description": "Detailed visual description for recreation (e.g. 'A cute 3D cartoon Thai boy character wearing traditional gold and red Thai costume, waving hand, chibi style')",
            "position": { "top": 0, "left": 0, "width": 0, "height": 0, "rotation": 0 },
            "z_index": 1
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
   * Worker 2B: Generate all die-cut components in BATCHES
   * Limits to 6 components per API call to avoid timeouts and improve quality.
   */
  async generateDiecutComponents(
    imageBuffer: Buffer,
    mimeType: string,
    components: Array<{ label: string; description: string }>,
  ): Promise<{
    results: Array<{ label: string; buffer: Buffer }>;
    gridImages: Buffer[];
  }> {
    if (!components.length) return { results: [], gridImages: [] };

    const allResults: Array<{ label: string; buffer: Buffer }> = [];

    // Generate each component individually at full resolution for best quality
    for (let i = 0; i < components.length; i++) {
      const comp = components[i];
      console.log(
        `[GenAI] Generating die-cut ${i + 1}/${components.length}: "${comp.label}"`,
      );
      try {
        const buf = await this._generateSingleDiecut(
          imageBuffer,
          mimeType,
          comp,
        );
        if (buf) {
          allResults.push({ label: comp.label, buffer: buf });
          console.log(
            `[GenAI] ✅ Die-cut "${comp.label}" complete (${buf.length} bytes)`,
          );
        } else {
          console.warn(`[GenAI] ⚠️ No image returned for "${comp.label}"`);
        }
        // Throttle between calls — keep at 3s to avoid 429 rate limits on per-image generation
        if (i < components.length - 1) {
          await new Promise((r) => setTimeout(r, 3000));
        }
      } catch (err) {
        console.error(`[GenAI] ❌ Failed die-cut for "${comp.label}":`, err);
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
    return { results: allResults, gridImages };
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
      maxOutputTokens: 32768,
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
}

export const vertexService = new AIService();
