import { GoogleGenAI } from "@google/genai";
import { VertexAI } from "@google-cloud/vertexai";
import dotenv from "dotenv";

dotenv.config();

const project_id =
  process.env.GOOGLE_SERVICE_ACCOUNT_PROJECT_ID || "chulinmain";
const location = "us-central1";

/**
 * AI Service using the new @google/genai (Unified SDK)
 */
export class AIService {
  private ai: any;
  private vertexAI: VertexAI; // Kept for legacy if needed

  constructor() {
    console.log("Initializing Unified Google Gen AI SDK...");

    const private_key = process.env.GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY?.replace(
      /\\n/g,
      "\n",
    );
    const client_email = process.env.GOOGLE_SERVICE_ACCOUNT_CLIENT_EMAIL;
    const locationOverride =
      process.env.GOOGLE_SERVICE_ACCOUNT_LOCATION || "us-central1";
    const apiKey = process.env.GOOGLE_API_KEY;

    // ERROR FIX: Project/location and API key are mutually exclusive in this SDK.
    // If API key is present, we try using it. Otherwise, use Service Account.
    const options: any = {
      vertexai: true,
    };

    if (apiKey) {
      console.log("Using API Key for GenAI (Vertex mode)...");
      // ERROR FIX: Project/location and API key are mutually exclusive in the client initializer.
      // If we use an API Key, we must NOT pass project or location in the options.
      // Note: When using an API key, this defaults to the 'global' Google AI mode, not Vertex AI.
      this.ai = new GoogleGenAI({
        apiKey: apiKey,
        vertexai: true,
      });
    } else {
      console.log(
        "Using Service Account for GenAI (Vertex mode) in",
        locationOverride,
      );
      this.ai = new GoogleGenAI({
        vertexai: true,
        project: project_id,
        location: locationOverride,
        googleAuthOptions:
          private_key && client_email
            ? {
                credentials: { client_email, private_key, project_id },
              }
            : undefined,
      });
    }

    // Keeping standalone VertexAI SDK just in case
    this.vertexAI = new VertexAI({
      project: project_id,
      location: locationOverride,
      googleAuthOptions:
        private_key && client_email
          ? {
              credentials: { client_email, private_key, project_id },
            }
          : undefined,
    });
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

    // Add reference images
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

    // Add text prompt
    parts.push({ text: params.prompt });

    console.log(`[GenAI] Generating with model: ${model}`);

    const generationConfig = {
      maxOutputTokens: 32768,
      temperature: 1,
      topP: 0.95,
      responseModalities: ["TEXT", "IMAGE"],
      imageConfig: {
        aspectRatio: params.aspect_ratio || "1:1",
        imageSize: params.resolution || "1K",
        // Note: outputMimeType sometimes causes 400 in Vertex SDK if not supported by the specific model version
        // We will include it as the user's snippet had it, but be wary of 400 errors.
        outputMimeType: "image/png",
      },
      safetySettings: [
        { category: "HARM_CATEGORY_HATE_SPEECH", threshold: "OFF" },
        { category: "HARM_CATEGORY_DANGEROUS_CONTENT", threshold: "OFF" },
        { category: "HARM_CATEGORY_SEXUALLY_EXPLICIT", threshold: "OFF" },
        { category: "HARM_CATEGORY_HARASSMENT", threshold: "OFF" },
      ],
    };

    try {
      // Use generateContentStream as per user request
      const streamingResp = await this.ai.models.generateContentStream({
        model: model,
        contents: [{ role: "user", parts }],
        config: generationConfig,
      });

      let generatedImageBuffer: Buffer | null = null;
      let responseText = "";

      for await (const chunk of streamingResp) {
        if (chunk.text) {
          responseText += chunk.text;
        }

        // Handle parts in the response chunk
        if (chunk.candidates?.[0]?.content?.parts) {
          for (const part of chunk.candidates[0].content.parts) {
            if (part.inlineData) {
              generatedImageBuffer = Buffer.from(
                part.inlineData.data,
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
      console.error("[GenAI] SDK Error:", error);
      throw error;
    }
  }

  async separateLayers(imageBuffer: Buffer, mimeType: string) {
    const modelName =
      process.env.GEMINI_MODEL_ENDPOINT || "gemini-3-flash-preview";

    const prompt = `
      Analyze this image. I want to separate it into layers for editing.
      1. Identify all text elements.
      2. Identify the main background.
      3. For each text element, provide:
         - The exact text content.
         - The bounding box [ymin, xmin, ymax, xmax] in normalized coordinates (0-1000).
         - Likely font style (serif, sans-serif, script).
         - Color in hex.
      
      Return the result as a JSON object with a "layers" array.
    `;

    try {
      const result = await this.ai.models.generateContent({
        model: modelName,
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
      });

      const text = result.response.candidates?.[0]?.content.parts[0].text;
      const jsonString = text?.replace(/```json|```/g, "").trim();

      try {
        return JSON.parse(jsonString || "{}");
      } catch (e) {
        return { raw: text };
      }
    } catch (error: any) {
      console.error("[GenAI] Separate Layers Error:", error);
      throw error;
    }
  }
}

export const vertexService = new AIService();
