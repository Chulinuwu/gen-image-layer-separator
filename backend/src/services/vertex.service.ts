/**
 * AI Service using @google/genai SDK (Vertex AI mode)
 * Billing goes to GCP Vertex AI
 *
 * Key: location must be "global" for Gemini 3 preview models
 */

import { GoogleGenAI } from "@google/genai";
import sharp from "sharp";
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
    const model =
      params.model ||
      process.env.GEMINI_IMAGE_ENDPOINT ||
      process.env.GEMINI_IMAGE_ENDPOINT_2 ||
      "gemini-3-pro-image-preview";

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

    // Prepend no-text instruction to keep backgrounds clean
    const cleanPrompt = `IMPORTANT: Do NOT include any text, typography, letters, words, numbers, logos with text, watermarks, or any written content in the generated image. The image must be completely free of any text elements. Only generate visual/graphical elements.\n\n${params.prompt}`;
    parts.push({ text: cleanPrompt });

    console.log(`[GenAI] Generating image with model: ${model}`);

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

    try {
      const streamingResp = await this.withRetry(() =>
        this.client.models.generateContentStream({
          model,
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
    } catch (error: any) {
      console.error("[GenAI] Image Generation Error:", error);
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
  ) {
    const model =
      process.env.GEMINI_MODEL_ENDPOINT_2 ||
      process.env.GEMINI_MODEL_ENDPOINT ||
      "gemini-3-flash-preview";

    const prompt = `
      Act as a professional graphic designer and advertising specialist.
      Analyze this reference image and the provided ad brief/text elements.
      
      AD BRIEF / TEXT:
      """
      ${targetText}
      """
      
      CRITICAL: The AD BRIEF above contains the TEXT CONTENT that MUST appear in the final ad.
      Even if the reference image doesn't show all text clearly, you MUST extract and suggest
      placement for ALL text elements mentioned in the brief.
      
      TASKS:
      1. TEXT EXTRACTION (MANDATORY):
         - Read EVERY text element from the AD BRIEF above
         - Also read any visible text in the reference image
         - If multiple text lines are VISUALLY GROUPED TOGETHER (same area, similar style), 
           combine them into ONE suggestion with '\n' (newline character) separating the lines.
         - Example: "ชวนลูกค้าแอป SCB EASY\nและ Robinhood มาสนุก" should be ONE text layer.
         - Only split into separate suggestions if text elements are clearly in different locations or serve different purposes.
         - YOU MUST RETURN AT LEAST ONE TEXT SUGGESTION. If the brief contains text, it MUST be in 'suggestions'.
      
      2. Cross-reference the AD BRIEF for correct spelling and intent.
      
      3. FOR EACH text element/group: provide exact position (bounding box that covers ALL lines), style, and hierarchy.
         - Use the reference image as a DESIGN GUIDE for placement
         - If text is not visible in the image, suggest a logical placement based on design principles
      
      4. COMPONENT EXTRACTION: Identify ALL non-text visual elements in the image that are
         overlaid on the background (NOT the background itself). Examples:
         - Ribbons, banners, tags, price badges
         - Mascots, cartoon characters, stickers
         - Person cutouts, product images
         - Decorative shapes, frames, boxes, logos
         For each component, provide a DETAILED visual description so it can be recreated.
      
      Return the result as a STRICT JSON object:
      {
        "background_description": "Describe the background scene (without any overlaid elements)",
        "campaign_vibe": "Energetic, Minimalist, Luxury, etc.",
        "suggestions": [
          {
            "part": "The exact text (e.g. 'SUMMER SALE')",
            "position": {
              "top": 0, "left": 0, "width": 0, "height": 0, "rotation": 0,
              "explanation": "Normalized coordinates 0-1000. Rotation in degrees (0 for normal, 90 for vertical)."
            },
            "style": {
              "font_family": "serif | sans-serif | display | script",
              "font_weight": "normal | bold",
              "font_style": "normal | italic",
              "color_hex": "#FFFFFF",
              "font_size_normalized": "Relative size (e.g. 10 to 120)",
              "text_align": "left | center | right",
              "letter_spacing": "Numeric tracking (e.g. 0 for normal, 2 for slightly wide, -1 for tight)",
              "line_height": "Line spacing (e.g. 1.0, 1.2, 1.5)",
              "shadow": "none | subtle | strong"
            },
            "hierarchy": "Headline | Body | FinePrint"
          }
        ],
        "components": [
          {
            "label": "Short label (e.g. 'Thai boy mascot', 'yellow ribbon banner')",
            "description": "Detailed visual description for image generation (e.g. 'A cute 3D chibi-style Thai boy character wearing traditional gold and red Thai costume (ชุดไทย), waving hand happily, cartoon render style')",
            "position": {
              "top": 0, "left": 0, "width": 0, "height": 0, "rotation": 0,
              "explanation": "Normalized coordinates 0-1000. Rotation in degrees."
            },
            "z_index": 1
          }
        ]
      }
      
      IMPORTANT:
      - 'suggestions' = ONLY text elements (MUST NOT BE EMPTY if brief contains text)
      - 'components' = ONLY visual/graphic elements (NO text)
      - Position: Be EXTREMELY accurate. The values must be PIXEL-PERFECT so that if I place the components using these percentages, they overlap the reference image EXACTLY.
      - Rotation: Specify the rotation in degrees if the element is not perfectly horizontal.
      - Scale: Do NOT guess. Compare the component's size to the full image carefully.
      - Position uses normalized coordinates 0-1000.
      - Component descriptions must be detailed enough to recreate the element in isolation.
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
      console.log(
        `[GenAI] Suggesting Layout + Components with model: ${model}`,
      );
      const response = await this.withRetry(() =>
        this.client.models.generateContent({
          model,
          contents: [
            {
              role: "user",
              parts: [
                {
                  inlineData: {
                    data: imageBuffer.toString("base64"),
                    mimeType,
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
      const jsonString = responseText.replace(/```json|```/g, "").trim();
      return JSON.parse(jsonString || "{}");
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
  ): Promise<Buffer> {
    const metadata = await sharp(baseImageBuffer).metadata();
    const width = metadata.width || 800;
    const height = metadata.height || 600;

    let svgOverlay = `<svg width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" xmlns="http://www.w3.org/2000/svg">`;

    // 1. Draw Components
    for (const c of components) {
      if (!c.position || typeof c.position.top === "undefined") continue;

      const top = (c.position.top / 1000) * height;
      const left = (c.position.left / 1000) * width;
      const w = (c.position.width / 1000) * width;
      const h = (c.position.height / 1000) * height;

      svgOverlay += `
        <rect x="${left}" y="${top}" width="${w}" height="${h}" fill="rgba(0, 255, 0, 0.15)" stroke="#00FF00" stroke-width="2" />
        <text x="${left + 5}" y="${top + 15}" fill="#00FF00" font-size="12" font-family="sans-serif" font-weight="bold">${c.label || "Component"}</text>
      `;
    }

    // 2. Draw Text Layers
    for (const s of suggestions) {
      if (!s.position || typeof s.position.top === "undefined") continue;

      const top = (s.position.top / 1000) * height;
      const left = (s.position.left / 1000) * width;
      const w = (s.position.width / 1000) * width;
      const h = (s.position.height / 1000) * height;
      const fontSize = s.style?.font_size_normalized || 40;
      const color = s.style?.color_hex || "#FFFFFF";

      svgOverlay += `
        <rect x="${left}" y="${top}" width="${w}" height="${h}" fill="rgba(255, 255, 255, 0.05)" stroke="#FFFFFF" stroke-dasharray="4" />
      `;

      const lines = (s.part || "").split("\n");
      lines.forEach((line: string, i: number) => {
        const yLine =
          top + fontSize * 0.8 + i * (fontSize * (s.style?.line_height || 1.2));
        svgOverlay += `
          <text 
            x="${left}" 
            y="${yLine}" 
            fill="${color}" 
            font-size="${fontSize}px" 
            font-family="${s.style?.font_family || "sans-serif"}" 
            font-weight="${s.style?.font_weight || "normal"}"
          >${line}</text>
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
      You are a SENIOR GRAPHIC DESIGNER reviewing a proposed advertisement layout.
      You have been given:
      1. The ORIGINAL reference image
      2. A PREVIEW showing the proposed text and component placement (with colored overlays)
      
      AD BRIEF: "${targetText}"
      
      YOUR JOB: Critique this layout with PROFESSIONAL STANDARDS. Be STRICT.
      
      CRITICAL CHECKS (ALL must pass):
      ✓ READABILITY: Is EVERY text element clearly readable?
         - Check contrast against background (especially on patterns/gradients)
         - Text on busy areas MUST have shadows/outlines
         - No text should blend into the background
      
      ✓ VISUAL HIERARCHY: Is the most important text (headline) the most prominent?
         - Size, color, and position should guide the eye correctly
         - Secondary text should be clearly secondary
      
      ✓ COMPOSITION: Are visual elements placed intelligently?
         - Text must NOT cover faces, eyes, or key product features
         - Text must NOT be cut off at edges
         - Components (mascots, people) should not be obscured by text
      
      ✓ BALANCE: Is the layout professional and balanced?
         - Not too cluttered, not too empty
         - Proper use of white space
      
      ✓ INTENT: Does it match the brief and convey the message clearly?
      
      PASS CRITERIA: Only return "PASS" if you would be PROUD to show this to a client.
      If there are ANY issues with readability, placement, or professionalism, return "FAIL".
      
      Return as STRICT JSON:
      {
        "status": "PASS" | "FAIL",
        "feedback": "Detailed explanation of what's wrong or what's good",
        "actionable_steps": ["Specific instruction 1", "Specific instruction 2", ...]
      }
      
      Be specific in actionable_steps. Use coordinate adjustments (e.g., "Move headline down by 100 units"),
      color changes (e.g., "Change Body text to #FFFFFF"), or style additions (e.g., "Add 'strong' shadow to all headline text").
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
      const jsonStr = text.match(/\{[\s\S]*\}/)?.[0] || '{"status": "PASS"}';
      return JSON.parse(jsonStr);
    } catch (e) {
      console.error("[GenAI] Critique parsing error:", e);
      return { status: "PASS" }; // Fail-safe
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
  ) {
    const model =
      process.env.GEMINI_MODEL_ENDPOINT_2 ||
      process.env.GEMINI_MODEL_ENDPOINT ||
      "gemini-3-flash-preview";
    const prompt = `
      You are a UI/UX expert refining an ad layout based on a Creative Director's critique.
      
      ORIGINAL BRIEF: "${targetText}"
      PREVIOUS PROPOSAL: ${JSON.stringify(previousAnalysis, null, 2)}
      
      CRITIQUE & FEEDBACK: 
      - Status: ${critique.status}
      - Feedback: ${critique.feedback}
      - Steps: ${JSON.stringify(critique.actionable_steps)}
      
      TASK:
      Generate an IMPROVED version of the layout JSON. Fix ALL issues mentioned in the critique.
      Ensure coordinates are 0-1000 and the JSON structure is preserved perfectly.
      
      Return as STRICT JSON (no markdown):
      {
        "background_description": "...",
        "campaign_vibe": "...",
        "suggestions": [...],
        "components": [...]
      }
    `;

    const result = await this.withRetry(() =>
      this.client.models.generateContent({
        model,
        contents: [
          {
            role: "user",
            parts: [
              {
                inlineData: { data: imageBuffer.toString("base64"), mimeType },
              },
              { text: prompt },
            ],
          },
        ],
      }),
    );

    const text = result.text || "";
    const jsonStr = text.match(/\{[\s\S]*\}/)?.[0] || "";
    return JSON.parse(jsonStr);
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

    const BATCH_SIZE = 6;
    const allResults: Array<{ label: string; buffer: Buffer }> = [];
    const allGridImages: Buffer[] = [];

    for (let i = 0; i < components.length; i += BATCH_SIZE) {
      const batch = components.slice(i, i + BATCH_SIZE);
      console.log(
        `[GenAI] Processing batch ${Math.floor(i / BATCH_SIZE) + 1}/${Math.ceil(components.length / BATCH_SIZE)} (${batch.length} components)`,
      );

      try {
        const { results, gridImage } = await this._generateDiecutBatch(
          imageBuffer,
          mimeType,
          batch,
        );
        allResults.push(...results);
        if (gridImage) allGridImages.push(gridImage);

        // Small delay between batches to be safe
        if (i + BATCH_SIZE < components.length) {
          await new Promise((resolve) => setTimeout(resolve, 1000));
        }
      } catch (err) {
        console.error(`[GenAI] Batch failed at index ${i}:`, err);
      }
    }

    return { results: allResults, gridImages: allGridImages };
  }

  /**
   * Internal helper to generate a single batch of components in a grid
   */
  private async _generateDiecutBatch(
    imageBuffer: Buffer,
    mimeType: string,
    batch: Array<{ label: string; description: string }>,
  ): Promise<{
    results: Array<{ label: string; buffer: Buffer }>;
    gridImage: Buffer | null;
  }> {
    const model =
      process.env.GEMINI_IMAGE_ENDPOINT ||
      process.env.GEMINI_IMAGE_ENDPOINT_2 ||
      "gemini-3-pro-image-preview";

    const n = batch.length;
    const cols = n > 3 ? 3 : n; // Max 3 columns
    const rows = Math.ceil(n / cols);

    const prompt = `
      Look at the reference image. Recreate these ${n} visual components as ISOLATED stickers in a SINGLE SQUARE grid.

      LAYOUT: Arrange them in a ${rows}x${cols} GRID (Total ${rows * cols} cells). 
      You MUST draw THICK BRIGHT RED (#FF0000) lines to separate EVERY row and EVERY column.

      Components to include (exactly one per cell):
      ${batch.map((c, i) => `${i + 1}. "${c.label}"`).join(", ")}

      CRITICAL RULES:
      - FULL BODY: For all people, human characters, or mascots, you MUST generate the FULL BODY from HEAD TO TOE. Do NOT crop them at the waist.
      - PLACE EXACTLY ONE COMPONENT PER CELL. 
      - IF THERE ARE EMPTY CELLS, LEAVE THEM COMPLETELY PURE WHITE.
      - DO NOT REPEAT ANY COMPONENT.
      - EACH COMPONENT MUST BE SMALLER THAN THE CELL WITH GENEROUS PADDING.
      - THE COMPONENT MUST NOT TOUCH OR CROSS THE RED LINES.
      - Match the style, colors, proportions, and details from the reference image perfectly.
      - Do NOT include any text, letters, or numbers.
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
      imageConfig: {
        aspectRatio: "3:4",
      },
      safetySettings: [
        { category: "HARM_CATEGORY_HATE_SPEECH", threshold: "OFF" },
        { category: "HARM_CATEGORY_DANGEROUS_CONTENT", threshold: "OFF" },
        { category: "HARM_CATEGORY_SEXUALLY_EXPLICIT", threshold: "OFF" },
        { category: "HARM_CATEGORY_HARASSMENT", threshold: "OFF" },
      ],
    };

    try {
      console.log(
        `[GenAI] Generating ${rows}x${cols} Red-Line Grid for ${n} components`,
      );

      const streamingResp = await this.withRetry(() =>
        this.client.models.generateContentStream({
          model,
          contents: [{ role: "user", parts }],
          config,
        }),
      );

      let gridBuffer: Buffer | null = null;
      for await (const chunk of streamingResp) {
        if (chunk.candidates?.[0]?.content?.parts) {
          for (const part of chunk.candidates[0].content.parts) {
            if (part.inlineData?.data && !gridBuffer) {
              gridBuffer = Buffer.from(
                part.inlineData.data as string,
                "base64",
              );
            }
          }
        }
      }

      if (!gridBuffer) return { results: [], gridImage: null };

      const metadata = await sharp(gridBuffer).metadata();
      const imgW = metadata.width || 1024;
      const imgH = metadata.height || 1024;

      const { data: rawPixels } = await sharp(gridBuffer)
        .ensureAlpha()
        .raw()
        .toBuffer({ resolveWithObject: true });

      const RED_THRESHOLD_MIN = 200;
      const GREEN_BLUE_THRESHOLD_MAX = 100;
      const RED_PIXEL_RATIO_THRESHOLD = 0.3; // 30% of a line must be red
      const DIVIDER_GROUP_THRESHOLD = 5; // Pixels to group consecutive red lines

      // --- Detect Horizontal Dividers (Rows) ---
      const redRows: number[] = [];
      for (let y = 0; y < imgH; y++) {
        let redCount = 0;
        for (let x = 0; x < imgW; x++) {
          const idx = (y * imgW + x) * 4;
          const r = rawPixels[idx];
          const g = rawPixels[idx + 1];
          const b = rawPixels[idx + 2];
          if (
            r > RED_THRESHOLD_MIN &&
            g < GREEN_BLUE_THRESHOLD_MAX &&
            b < GREEN_BLUE_THRESHOLD_MAX
          ) {
            redCount++;
          }
        }
        if (redCount > imgW * RED_PIXEL_RATIO_THRESHOLD) {
          redRows.push(y);
        }
      }

      const hDividers: number[] = [];
      if (redRows.length > 0) {
        let groupStart = redRows[0];
        for (let i = 1; i < redRows.length; i++) {
          if (redRows[i] - redRows[i - 1] > DIVIDER_GROUP_THRESHOLD) {
            hDividers.push(Math.floor((groupStart + redRows[i - 1]) / 2));
            groupStart = redRows[i];
          }
        }
        hDividers.push(
          Math.floor((groupStart + redRows[redRows.length - 1]) / 2),
        );
      }

      console.log(
        `[GenAI] Found ${hDividers.length} horizontal divider(s) at rows: [${hDividers.join(", ")}]`,
      );

      // --- Detect Vertical Dividers (Columns) ---
      const redCols: number[] = [];
      for (let x = 0; x < imgW; x++) {
        let redCount = 0;
        for (let y = 0; y < imgH; y++) {
          const idx = (y * imgW + x) * 4;
          const r = rawPixels[idx];
          const g = rawPixels[idx + 1];
          const b = rawPixels[idx + 2];
          if (
            r > RED_THRESHOLD_MIN &&
            g < GREEN_BLUE_THRESHOLD_MAX &&
            b < GREEN_BLUE_THRESHOLD_MAX
          ) {
            redCount++;
          }
        }
        if (redCount > imgH * RED_PIXEL_RATIO_THRESHOLD) {
          redCols.push(x);
        }
      }

      const vDividers: number[] = [];
      if (redCols.length > 0) {
        let groupStart = redCols[0];
        for (let i = 1; i < redCols.length; i++) {
          if (redCols[i] - redCols[i - 1] > DIVIDER_GROUP_THRESHOLD) {
            vDividers.push(Math.floor((groupStart + redCols[i - 1]) / 2));
            groupStart = redCols[i];
          }
        }
        vDividers.push(
          Math.floor((groupStart + redCols[redCols.length - 1]) / 2),
        );
      }

      console.log(
        `[GenAI] Found ${vDividers.length} vertical divider(s) at columns: [${vDividers.join(", ")}]`,
      );

      // --- Define Cell Boundaries ---
      const rowBoundaries = [0, ...hDividers, imgH];
      const colBoundaries = [0, ...vDividers, imgW];

      const results: Array<{ label: string; buffer: Buffer }> = [];
      let componentIndex = 0;

      for (let r = 0; r < rowBoundaries.length - 1; r++) {
        const top = rowBoundaries[r];
        const bottom = rowBoundaries[r + 1];
        const cellHeight = bottom - top;

        if (cellHeight < 10) continue; // Skip very small row segments

        for (let c = 0; c < colBoundaries.length - 1; c++) {
          const left = colBoundaries[c];
          const right = colBoundaries[c + 1];
          const cellWidth = right - left;

          if (cellWidth < 10) continue; // Skip very small column segments
          if (componentIndex >= n) break; // Stop if all components are processed

          try {
            // Crop the cell segment
            const cropped = await sharp(gridBuffer)
              .extract({ left, top, width: cellWidth, height: cellHeight })
              .png()
              .toBuffer();

            // Remove white + red background -> transparent
            const { data: cellPixels, info } = await sharp(cropped)
              .ensureAlpha()
              .raw()
              .toBuffer({ resolveWithObject: true });

            const WHITE_THRESHOLD = 240;
            for (let p = 0; p < cellPixels.length; p += 4) {
              const r = cellPixels[p];
              const g = cellPixels[p + 1];
              const b = cellPixels[p + 2];
              // Remove white
              if (
                r >= WHITE_THRESHOLD &&
                g >= WHITE_THRESHOLD &&
                b >= WHITE_THRESHOLD
              ) {
                cellPixels[p + 3] = 0;
              }
              // Also remove red divider remnants
              if (
                r > RED_THRESHOLD_MIN &&
                g < GREEN_BLUE_THRESHOLD_MAX &&
                b < GREEN_BLUE_THRESHOLD_MAX
              ) {
                cellPixels[p + 3] = 0;
              }
            }

            // Reconstruct transparent PNG
            const diecutBuffer = await sharp(cellPixels, {
              raw: { width: info.width, height: info.height, channels: 4 },
            })
              .png()
              .toBuffer();

            // Trim transparent edges
            const trimmed = await sharp(diecutBuffer).trim().png().toBuffer();

            const label =
              batch[componentIndex]?.label || `Component ${componentIndex + 1}`;
            results.push({ label, buffer: trimmed });

            console.log(
              `[GenAI] Die-cut component ${results.length}: "${label}" (cell: R${r}C${c}, bounds: ${left},${top},${cellWidth},${cellHeight})`,
            );
            componentIndex++;
          } catch (cropErr) {
            console.error(
              `[GenAI] Failed to crop cell R${r}C${c} (bounds: ${left},${top},${cellWidth},${cellHeight}):`,
              cropErr,
            );
          }
        }
      }

      console.log(
        `[GenAI] Generated ${results.length}/${n} die-cut components`,
      );
      return { results, gridImage: gridBuffer };
    } catch (error: any) {
      console.error("[GenAI] Generate Die-cut Components Error:", error);
      return { results: [], gridImage: null };
    }
  }
}

export const vertexService = new AIService();
