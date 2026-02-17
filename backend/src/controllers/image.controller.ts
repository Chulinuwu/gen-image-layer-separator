import { Request, Response } from "express";
import { vertexService } from "../services/vertex.service";
import fs from "fs";
import path from "path";

export const processImage = async (req: Request, res: Response) => {
  try {
    const files = req.files as { [fieldname: string]: Express.Multer.File[] };

    if (!files || !files.image || files.image.length === 0) {
      return res.status(400).json({ error: "Main image file is required" });
    }

    const mainImageFile = files.image[0]!;
    const imageBuffer = fs.readFileSync(mainImageFile.path);
    const mimeType = mainImageFile.mimetype;

    let backgroundBuffer: Buffer | undefined;
    if (files.background && files.background.length > 0) {
      backgroundBuffer = fs.readFileSync(files.background[0]!.path);
    }

    const { hintText } = req.body;

    const layersData = await vertexService.separateLayers(
      imageBuffer,
      mimeType,
      backgroundBuffer,
      hintText,
    );

    res.json({
      success: true,
      data: {
        original: `/uploads/${mainImageFile.filename}`,
        analysis: layersData,
      },
    });
  } catch (error: any) {
    console.error("Process error:", error);
    res.status(500).json({ error: error.message });
  }
};

export const generateAndSeprate = async (req: Request, res: Response) => {
  try {
    const { prompt, aspect_ratio, resolution, images: base64Images } = req.body;
    const files = req.files as Express.Multer.File[];

    if (!prompt) return res.status(400).json({ error: "Prompt is required" });

    // 1. Prepare input images from Multi-part OR JSON Base64
    let inputImages: Array<{ buffer: Buffer; mimeType: string }> = [];

    if (files && files.length > 0) {
      inputImages = files.map((file) => ({
        buffer: fs.readFileSync(file.path),
        mimeType: file.mimetype,
      }));
    } else if (Array.isArray(base64Images)) {
      inputImages = base64Images.map((b64: string) => {
        const match = b64.match(/^data:(image\/\w+);base64,/);
        const mimeType = match ? match[1]! : "image/png";
        const cleanB64 = b64.replace(/^data:image\/\w+;base64,/, "");
        return {
          buffer: Buffer.from(cleanB64, "base64"),
          mimeType,
        };
      });
    }

    // 2. Generate image using Service
    const result = await vertexService.generateImage({
      prompt,
      aspect_ratio,
      resolution,
      inputImages,
    });

    if (!result.buffer) {
      return res.status(500).json({
        success: false,
        message: "Failed to generate image buffer",
        text: result.text,
      });
    }

    // 2. Save the generated image locally
    const fileName = `generated-${Date.now()}.png`;
    const uploadDir = path.join(__dirname, "../../uploads");
    if (!fs.existsSync(uploadDir)) {
      fs.mkdirSync(uploadDir, { recursive: true });
    }

    const filePath = path.join(uploadDir, fileName);
    fs.writeFileSync(filePath, result.buffer);

    // 3. Optional: Separate layers immediately if desired, or return just the image
    // For this "first API" request, we focus on background generation
    res.json({
      success: true,
      data: {
        imageUrl: `/uploads/${fileName}`,
        text: result.text,
        prompt: result.prompt,
        // placeholder for layers to be used in next step
        layers: [],
      },
    });
  } catch (error: any) {
    console.error("Generation error:", error);
    res.status(500).json({ error: error.message });
  }
};
export const suggestCampaign = async (req: Request, res: Response) => {
  try {
    const { text: targetText, image: base64Image } = req.body;
    let imageBuffer: Buffer;
    let mimeType: string;

    if (req.file) {
      imageBuffer = fs.readFileSync(req.file.path);
      mimeType = req.file.mimetype;
    } else if (base64Image) {
      const match = base64Image.match(/^data:(image\/\w+);base64,/);
      mimeType = match ? match[1]! : "image/png";
      const cleanB64 = base64Image.replace(/^data:image\/\w+;base64,/, "");
      imageBuffer = Buffer.from(cleanB64, "base64");
    } else {
      return res
        .status(400)
        .json({ error: "Image (file or base64) and text are required" });
    }

    if (!targetText) {
      return res
        .status(400)
        .json({ error: "Text is required for campaign analysis" });
    }

    const analysis = await vertexService.suggestCampaignLayout(
      imageBuffer,
      mimeType,
      targetText,
    );

    res.json({
      success: true,
      data: analysis,
    });
  } catch (error: any) {
    console.error("Campaign Suggest error:", error);
    res.status(500).json({ error: error.message });
  }
};

export const renderCampaign = async (req: Request, res: Response) => {
  try {
    const { image: base64Image } = req.body;
    let suggestionsRaw = req.body.suggestions;

    // Logic: If suggestions field is missing, check if the whole body is the result object
    if (!suggestionsRaw) {
      if (req.body.data?.suggestions) {
        suggestionsRaw = req.body.data.suggestions;
      } else if (req.body.suggestions) {
        suggestionsRaw = req.body.suggestions;
      }
    }

    if (!suggestionsRaw) {
      return res.status(400).json({
        error: "suggestions are required.",
        hint: "In Postman form-data, use key 'suggestions'. Or send JSON body with a 'suggestions' array.",
      });
    }

    let imageBuffer: Buffer;
    let mimeType: string;

    // Handle suggestions being sent as string (from form-data) or object (from JSON)
    let suggestions: any;
    try {
      suggestions =
        typeof suggestionsRaw === "string"
          ? JSON.parse(suggestionsRaw)
          : suggestionsRaw;

      // extraction logic: handle nested data or plain array
      if (suggestions.data?.suggestions) {
        suggestions = suggestions.data.suggestions;
      } else if (suggestions.suggestions) {
        suggestions = suggestions.suggestions;
      }
    } catch (e) {
      return res.status(400).json({ error: "Invalid suggestions JSON format" });
    }

    if (!Array.isArray(suggestions)) {
      return res.status(400).json({
        error:
          "suggestions must be an array (or a response object containing a suggestions array)",
      });
    }

    const files = req.files as { [fieldname: string]: Express.Multer.File[] };
    let backgroundBuffer: Buffer | undefined;

    if (files && files.image && files.image.length > 0) {
      imageBuffer = fs.readFileSync(files.image[0]!.path);
      mimeType = files.image[0]!.mimetype;

      if (files.background && files.background.length > 0) {
        backgroundBuffer = fs.readFileSync(files.background[0]!.path);
      }
    } else if (base64Image) {
      const match = base64Image.match(/^data:(image\/\w+);base64,/);
      mimeType = match ? match[1]! : "image/png";
      const cleanB64 = base64Image.replace(/^data:image\/\w+;base64,/, "");
      imageBuffer = Buffer.from(cleanB64, "base64");
    } else {
      return res
        .status(400)
        .json({ error: "Image and suggestions are required" });
    }

    const result = await vertexService.renderCampaignImage(
      imageBuffer,
      mimeType,
      suggestions,
      backgroundBuffer,
    );

    if (result.buffer) {
      const filename = `rendered-${Date.now()}.png`;
      const uploadPath = path.join(__dirname, "../../uploads", filename);
      fs.writeFileSync(uploadPath, result.buffer);

      res.json({
        success: true,
        data: {
          imageUrl: `/uploads/${filename}`,
          text: result.text,
          prompt: result.prompt,
        },
      });
    } else {
      res.status(500).json({ error: "Failed to render image" });
    }
  } catch (error: any) {
    console.error("Render Campaign error:", error);
    res.status(500).json({ error: error.message });
  }
};
