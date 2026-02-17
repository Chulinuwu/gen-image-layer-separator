/**
 * AI Service using @google/genai SDK (Vertex AI mode)
 * Billing goes to GCP Vertex AI
 *
 * Key: location must be "global" for Gemini 3 preview models
 */

import { GoogleGenAI } from "@google/genai";
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
  });

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
   * Generates an image based on prompt and optional reference images
   */
  async generateImage(params: {
    prompt: string;
    aspect_ratio?: string;
    resolution?: string;
    inputImages?: Array<{ buffer: Buffer; mimeType: string }>;
  }) {
    const model =
      process.env.GEMINI_IMAGE_ENDPOINT || "gemini-3-pro-image-preview";

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
    parts.push({ text: params.prompt });

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
      const streamingResp = await this.client.models.generateContentStream({
        model,
        contents: [{ role: "user", parts }],
        config,
      });

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
        (s: any) =>
          `- Text: "${s.part}"
       - Style: ${s.style.font_family}, ${s.style.font_weight}, Color ${s.style.color_hex}
       - Character size: ${s.style.font_size_normalized} (relative scale)
       - Placement description: ${s.position.explanation || `Place at top:${s.position.top}, left:${s.position.left}`}`,
      )
      .join("\n");

    // Use background as base if provided to avoid ghosting of original text
    const baseImage = backgroundBuffer || imageBuffer;

    const prompt = `
      Create a high-quality advertisement based on the attached reference image.
      YOU MUST RENDER THE FOLLOWING TEXT ELEMENTS ONTO THE IMAGE:
      ${textDescriptions}
      
      CRITICAL INSTRUCTIONS:
      1. Use a high-quality ${suggestions[0]?.style.font_family || "modern"} font style that matches professional graphic design standards.
      2. The text must be crisp, high-contrast, and perfectly integrated.
      3. Maintain the background visual elements from the reference.
      4. Ensure all text is spelled correctly and placed according to instructions.
    `;

    return this.generateImage({
      prompt,
      inputImages: [{ buffer: baseImage, mimeType }],
    });
  }

  /**
   * Suggests text placement and styling for an advertising campaign
   */
  async suggestCampaignLayout(
    imageBuffer: Buffer,
    mimeType: string,
    targetText: string,
  ) {
    const model = process.env.GEMINI_MODEL_ENDPOINT || "gemini-3-flash-preview";

    const prompt = `
      Act as a professional graphic designer and advertising specialist.
      Analyze this image for an advertising campaign.
      
      Target Text to include: "${targetText}"
      
      Suggest the best placement and styling for this text to make a stunning and effective advertisement.
      Consider focal points, empty space (negative space), and color contrast.
      
      Return the result as a STRICT JSON object:
      {
        "background_analysis": "Brief description of focal points and colors",
        "campaign_vibe": "Energetic, Minimalist, Luxury, etc.",
        "suggestions": [
          {
            "part": "Specific chunk of the text (if split, else full text)",
            "position": {
              "top": 0, "left": 0, "width": 0, "height": 0,
              "explanation": "Normalized coordinates 0-1000"
            },
            "style": {
              "font_family": "serif | sans-serif | display | script",
              "font_weight": "normal | bold",
              "color_hex": "#FFFFFF",
              "font_size_normalized": "Relative size (e.g. 10-100)",
              "text_align": "left | center | right",
              "letter_spacing": "normal | wide",
              "shadow": "none | subtle | strong"
            },
            "rationale": "Why this placement and style works for this specific image"
          }
        ]
      }
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
      console.log(`[GenAI] Suggesting Layout with model: ${model}`);
      const response = await this.client.models.generateContent({
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
        config,
      });

      const responseText = response.text ? response.text.trim() : "";
      const jsonString = responseText.replace(/```json|```/g, "").trim();
      return JSON.parse(jsonString || "{}");
    } catch (error: any) {
      console.error("[GenAI] Suggest Layout Error:", error);
      throw error;
    }
  }

  async separateLayers(
    imageBuffer: Buffer,
    mimeType: string,
    backgroundImageBuffer?: Buffer,
    hintText?: string,
  ) {
    const model = process.env.GEMINI_MODEL_ENDPOINT || "gemini-3-flash-preview";

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
    `;

    try {
      const response = await this.client.models.generateContent({
        model,
        contents: [
          {
            role: "user",
            parts: [...parts, { text: prompt }],
          },
        ],
      });

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
}

export const vertexService = new AIService();
