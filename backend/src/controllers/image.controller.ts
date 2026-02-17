import { Request, Response } from "express";
import { vertexService } from "../services/vertex.service";
import fs from "fs";
import path from "path";

export const processImage = async (req: Request, res: Response) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: "Image file is required" });
    }

    const imageBuffer = fs.readFileSync(req.file.path);
    const mimeType = req.file.mimetype;

    const layersData = await vertexService.separateLayers(
      imageBuffer,
      mimeType,
    );

    res.json({
      success: true,
      data: {
        original: `/uploads/${req.file.filename}`,
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
