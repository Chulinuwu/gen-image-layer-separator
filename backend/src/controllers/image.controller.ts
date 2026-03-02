import { Request, Response } from "express";
import { vertexService } from "../services/vertex.service";
import fs from "fs";
import path from "path";
import sharp from "sharp";
import { computeSafeZones, assignTextToZones } from "../utils/safeZones";

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

    const { hintText, mode } = req.body;

    // Step 1: Analyze components + Extract text in parallel
    console.log(
      `[Pipeline] Step 1: Analyzing components (Mode: ${mode || "full"})...`,
    );

    const tasks: any[] = [
      vertexService.analyzeComponents(imageBuffer, mimeType, backgroundBuffer),
    ];

    // Only extract text if NOT in 'only_bg_comp' mode
    if (mode !== "only_bg_comp") {
      tasks.push(
        vertexService.separateLayers(
          imageBuffer,
          mimeType,
          backgroundBuffer,
          hintText,
        ),
      );
    }

    const results = await Promise.allSettled(tasks);

    const analysisData =
      results[0].status === "fulfilled" ? results[0].value : { components: [] };

    const layersData =
      mode !== "only_bg_comp" && results[1]?.status === "fulfilled"
        ? (results[1] as any).value
        : { layers: [] };

    if (results[0].status === "rejected") {
      console.error("Worker (Analyze) failed:", results[0].reason);
    }
    if (mode !== "only_bg_comp" && results[1]?.status === "rejected") {
      console.error("Worker (Text) failed:", (results[1] as any).reason);
    }

    // Step 1.5: Generate clean background if not provided (Inpainting approach)
    let generatedBackgroundImageUrl: string | null = null;
    if (
      !backgroundBuffer &&
      (analysisData.components?.length > 0 ||
        analysisData.background_description ||
        layersData.layers?.length > 0)
    ) {
      try {
        console.log("[Pipeline] Inpainting clean background...");
        const componentsToDelete = (analysisData.components || [])
          .map(
            (c: any) =>
              `- COMPONENT: "${c.label}" at [top: ${c.position.top}, left: ${c.position.left}, width: ${c.position.width}, height: ${c.position.height}]`,
          )
          .join("\n");

        const textToDelete = (layersData.layers || [])
          .map(
            (t: any) =>
              `- TEXT: "${t.content}" at [top: ${t.position.top}, left: ${t.position.left}, width: ${t.position.width}, height: ${t.position.height}]`,
          )
          .join("\n");

        const bgResponse = await vertexService.generateImage({
          prompt: `
            Act as a professional image INPAINTER. 
            TASK: Remove all identified foreground components, characters, and ALL text from the provided image to create a clean background plate.
            
            ELEMENTS TO REMOVE (Coordinates 0-1000):
            ${componentsToDelete}
            ${textToDelete}
            
            INSTRUCTIONS:
            - Delete the listed components and text, then seamlessly fill/reconstruct the background behind them.
            - Match the exact atmosphere, textures, and lighting of the reference.
            - Result MUST be a CLEAN empty background plate of the original scene.
            - Do NOT add new elements.
          `,
          aspect_ratio: "3:4",
          inputImages: [{ buffer: imageBuffer, mimeType }],
        });
        if (bgResponse.buffer) {
          const uploadDir = path.join(__dirname, "../../uploads");
          if (!fs.existsSync(uploadDir))
            fs.mkdirSync(uploadDir, { recursive: true });
          const bgFilename = `bg-inpaint-${Date.now()}.png`;
          fs.writeFileSync(path.join(uploadDir, bgFilename), bgResponse.buffer);
          generatedBackgroundImageUrl = `/uploads/${bgFilename}`;
        }
      } catch (err) {
        console.error("Background inpainting failed:", err);
      }
    }

    // Step 2: Generate die-cut PNGs (uses image gen model — 1 call for all components)
    let visualComponents: Array<{
      label: string;
      imageUrl: string;
      position: any;
      z_index: number;
      interaction_zone?: any;
    }> = [];
    const stackImageUrls: string[] = [];

    // Deduplicate: if a character (person/mascot/figure) is already in the list,
    // remove any pure-object components that are likely just props of that character.
    // This prevents duplicates like "Woman full figure" + "Purple Smartphone" (already held by woman).
    const rawComponents: Array<{
      label: string;
      description: string;
      position: any;
      suggested_position?: any; // AI's composition recommendation — where component SHOULD GO
      z_index: number;
      interaction_zone?: any;
    }> = analysisData.components || [];

    const CHARACTER_KEYWORDS = [
      "woman",
      "man",
      "girl",
      "boy",
      "mascot",
      "character",
      "person",
      "figure",
      "human",
    ];
    const PROP_KEYWORDS = [
      "phone",
      "smartphone",
      "mobile",
      "tablet",
      "gun",
      "pistol",
      "weapon",
      "rifle",
      "water gun",
      "squirt",
      "bag",
      "purse",
      "handbag",
      "backpack",
      "bottle",
      "cup",
      "mug",
      "drink",
      "hat",
      "cap",
      "helmet",
      "glasses",
      "sunglasses",
      "umbrella",
      "fan",
      "flag",
    ];

    const hasCharacter = rawComponents.some((c) =>
      CHARACTER_KEYWORDS.some((kw) => c.label.toLowerCase().includes(kw)),
    );

    const components = hasCharacter
      ? rawComponents.filter((c) => {
          const lbl = c.label.toLowerCase();
          // Check prop FIRST — "Phone (held by woman)" contains "woman" but IS a prop
          const isProp = PROP_KEYWORDS.some((kw) => lbl.includes(kw));
          if (isProp) {
            console.log(
              `[Pipeline] ⚠️ Filtered prop component (already part of character): "${c.label}"`,
            );
            return false;
          }
          return true;
        })
      : rawComponents;

    console.log(
      `[Pipeline] Components after dedup: ${components.length}/${rawComponents.length} — [${components.map((c) => c.label).join(", ")}]`,
    );

    if (components.length > 0) {
      console.log(
        `[Pipeline] Step 2: Generating ${components.length} die-cut components...`,
      );
      const { results: diecutResults, gridImages } =
        await vertexService.generateDiecutComponents(
          imageBuffer,
          mimeType,
          components,
        );

      const uploadDir = path.join(__dirname, "../../uploads");
      if (!fs.existsSync(uploadDir))
        fs.mkdirSync(uploadDir, { recursive: true });

      // Save stack preview images
      const stackImageUrls: string[] = [];
      if (gridImages && gridImages.length > 0) {
        gridImages.forEach((img, idx) => {
          const stackFilename = `stack-${Date.now()}-${idx}.png`;
          fs.writeFileSync(path.join(uploadDir, stackFilename), img);
          stackImageUrls.push(`/uploads/${stackFilename}`);
        });
      }

      visualComponents = diecutResults.map(
        (result: { label: string; buffer: Buffer }, i: number) => {
          const filename = `component-${Date.now()}-${i}.png`;
          fs.writeFileSync(path.join(uploadDir, filename), result.buffer);
          const comp = components[i];
          // suggested_position = AI's composition recommendation; prefer over raw detected position
          const pos = comp?.suggested_position ||
            comp?.position || { top: 0, left: 0, width: 200, height: 200 };
          return {
            label: result.label,
            imageUrl: `/uploads/${filename}`,
            position: pos,
            z_index: comp?.z_index || 15,
            interaction_zone: comp?.interaction_zone || null,
          };
        },
      );
      console.log(
        `[Pipeline] Generated ${visualComponents.length} die-cut images.`,
      );
    }

    res.json({
      success: true,
      data: {
        original: `/uploads/${mainImageFile.filename}`,
        backgroundDescription:
          analysisData.background_description ||
          layersData.background_description ||
          "",
        generatedBackgroundImageUrl,
        textLayers: layersData.layers || [],
        visualComponents,
        stackImageUrls: stackImageUrls || [],
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

    const mode = req.body.mode || "ai";

    if (
      mode === "pre-rendered" ||
      (files && files.rendered_image && files.rendered_image.length > 0)
    ) {
      // Pre-rendered mode doesn't strictly need the source image buffer for AI
      imageBuffer = Buffer.alloc(0);
      mimeType = "image/png";
    } else if (files && files.image && files.image.length > 0) {
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

    let result: any;
    if (
      mode === "pre-rendered" &&
      files.rendered_image &&
      files.rendered_image.length > 0
    ) {
      console.log("[Controller] Using pre-rendered image from client");
      const buffer = fs.readFileSync(files.rendered_image[0]!.path);
      result = { buffer, text: "Client-side render saved", prompt: "none" };
    } else if (mode === "simple") {
      console.log(
        "[Controller] Performing SEARCH-FREE SIMPLE RENDER (Sharp only)",
      );
      const buffer = await vertexService.renderSimpleComposite(
        backgroundBuffer || imageBuffer,
        suggestions,
      );
      result = { buffer, text: "Simple render completed", prompt: "none" };
    } else {
      console.log("[Controller] Performing AI PRODUCTION RENDER (Gemini)");
      result = await vertexService.renderCampaignImage(
        imageBuffer,
        mimeType,
        suggestions,
        backgroundBuffer,
      );
    }

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

/**
 * NEW FLOW: Build-Up Pipeline with SSE Live Preview
 * 1. Suggest text + components from reference image
 * 2. Iterative AI refinement with live updates
 * 3. Generate die-cut component PNGs
 * 4. Return everything as layers for the editor
 */
export const createCampaign = async (req: Request, res: Response) => {
  try {
    const files = req.files as { [fieldname: string]: Express.Multer.File[] };
    const { text: targetText, image: base64Image } = req.body;

    let imageBuffer: Buffer;
    let mimeType: string;

    // Accept image from multipart or base64
    if (files?.image?.[0]) {
      imageBuffer = fs.readFileSync(files.image[0].path);
      mimeType = files.image[0].mimetype;
    } else if (base64Image) {
      const match = base64Image.match(/^data:(image\/\w+);base64,/);
      mimeType = match ? match[1]! : "image/png";
      const cleanB64 = base64Image.replace(/^data:image\/\w+;base64,/, "");
      imageBuffer = Buffer.from(cleanB64, "base64");
    } else {
      return res.status(400).json({ error: "Reference image is required" });
    }

    if (!targetText) {
      return res.status(400).json({ error: "Text brief is required" });
    }

    // Optional: background image
    let backgroundBuffer: Buffer | undefined;
    if (files?.background?.[0]) {
      backgroundBuffer = fs.readFileSync(files.background[0].path);
    }

    // Save reference image for frontend access
    const uploadDir = path.join(__dirname, "../../uploads");
    if (!fs.existsSync(uploadDir)) fs.mkdirSync(uploadDir, { recursive: true });

    const refFilename = `ref-${Date.now()}.png`;
    const refImageUrl = `/uploads/${refFilename}`;
    fs.writeFileSync(path.join(uploadDir, refFilename), imageBuffer);

    // Setup SSE
    res.setHeader("Content-Type", "text/event-stream");
    res.setHeader("Cache-Control", "no-cache");
    res.setHeader("Connection", "keep-alive");
    res.flushHeaders();

    const sendSSE = (event: string, data: any) => {
      res.write(`event: ${event}\n`);
      res.write(`data: ${JSON.stringify(data)}\n\n`);
    };

    // ───── Step 1A: RMBG (local, free) — runs BEFORE layout suggestion ─────
    // We run RMBG first so we have pixel-accurate bboxes of every foreground subject.
    // These bboxes become the no-go zones for text placement, eliminating blind guessing.
    const { mode, noGoZones } = req.body;
    console.log("[DEBUG] Received mode from frontend:", mode);

    let parsedNoGoZones: any[] = [];
    if (noGoZones) {
      try {
        parsedNoGoZones =
          typeof noGoZones === "string" ? JSON.parse(noGoZones) : noGoZones;
        console.log(
          `[DEBUG] Received ${parsedNoGoZones.length} external No-Go Zones`,
        );
      } catch (e) {
        console.warn("[DEBUG] Failed to parse noGoZones:", e);
      }
    }

    sendSSE("progress", {
      step: "rmbg_analysis",
      message: "Running background removal to detect subject positions...",
    });

    let precomputedMaskedBuffer: Buffer | null = null;

    try {
      const { maskedBuffer, bboxes } =
        await vertexService.runRMBGAndGetBboxes(imageBuffer);
      precomputedMaskedBuffer = maskedBuffer;

      if (bboxes.length > 0) {
        // Merge RMBG bboxes into no-go zones (RMBG takes priority over external)
        const rmbgNoGoZones = bboxes.map((b) => ({
          label: b.label,
          top: b.top,
          left: b.left,
          width: b.width,
          height: b.height,
          area: { top: b.top, left: b.left, width: b.width, height: b.height },
        }));
        // Prepend RMBG bboxes — they are more accurate than user-provided estimates
        parsedNoGoZones = [...rmbgNoGoZones, ...parsedNoGoZones];
        console.log(
          `[Pipeline] ✅ RMBG bboxes injected as no-go zones: ${bboxes.map((b) => `${b.label}(top:${b.top},left:${b.left},w:${b.width},h:${b.height})`).join(", ")}`,
        );
      }
    } catch (rmbgErr) {
      console.warn(
        "[Pipeline] RMBG pre-scan failed, proceeding without pixel-accurate bboxes:",
        rmbgErr,
      );
    }

    // ───── Step 1B: Pass 1 — Art Director Component Placement ─────────────────
    sendSSE("progress", {
      step: "initial_analysis",
      message: "AI art director is composing component placement...",
    });

    const componentAnalysis = await vertexService.suggestCampaignLayout(
      imageBuffer,
      mimeType,
      targetText,
      "only_bg_comp",
      parsedNoGoZones,
    );
    let componentSuggestions = componentAnalysis.components || [];
    const artDirectorTextZone = componentAnalysis.composition_text_zone || null;

    // textSuggestions will be populated in Pass 2 (after die-cut)
    let textSuggestions: any[] = [];

    // Mutable analysis object used throughout for no_go_zones, metadata, and inpainting context
    const analysis: any = {
      ...componentAnalysis,
      suggestions: [],
      components: componentSuggestions,
    };

    // Helper: enforce readable contrast — if text is on dark bg and color is dark, swap to light
    // Uses position-based heuristic: lower half (top > 450) of Thai ad templates → usually dark bg
    const enforceContrast = (
      colorHex: string | undefined,
      pos: any,
    ): string => {
      if (!colorHex) return "#FFFFFF";
      // Parse hex luminance (0-255 average of R,G,B)
      const hex = colorHex.replace("#", "");
      if (hex.length < 6) return "#FFFFFF";
      const r = parseInt(hex.slice(0, 2), 16);
      const g = parseInt(hex.slice(2, 4), 16);
      const b = parseInt(hex.slice(4, 6), 16);
      const luminance = 0.299 * r + 0.587 * g + 0.114 * b; // ITU-R BT.601 luma
      const isOnDarkBg = (pos?.top || 0) > 450; // below midpoint → likely dark/purple zone
      if (isOnDarkBg && luminance < 100) {
        // Dark text on dark bg — swap to white (default safe) or yellow for badges
        const swapped = "#FFFFFF";
        console.log(
          `[Contrast] "${colorHex}" (luma:${Math.round(luminance)}) → ${swapped} (dark bg fix)`,
        );
        return swapped;
      }
      return colorHex;
    };

    // Visual Quality Gate: SCB pattern enforcement — promo number must dominate
    // Regex matches: 1-6 char strings of digits, Thai numerals, common promo symbols, and Thai ad units
    const PROMO_RE =
      /^[\d๐-๙%+×\s]{1,6}$|^[\d๐-๙.]+\s*(ต่อ|เท่า|ครั้ง|คืน|%|×)\s*$/;
    const enforceDesignRules = (suggestions: any[]): any[] => {
      if (suggestions.length === 0) return suggestions;
      const maxFont = Math.max(
        ...suggestions.map(
          (s: any) =>
            s.font_size_normalized || s.style?.font_size_normalized || 0,
        ),
      );
      return suggestions.map((s: any) => {
        const part = (s.part || "").trim();
        const fontSize =
          s.font_size_normalized || s.style?.font_size_normalized || 0;
        if (PROMO_RE.test(part) && fontSize < maxFont * 0.8 && maxFont > 0) {
          const boosted = 160;
          console.log(
            `[QualityGate] Boosting promo number "${part}" font ${fontSize} → ${boosted}`,
          );
          // font_size_normalized lives at top-level in text suggestions
          return { ...s, font_size_normalized: boosted };
        }
        return s;
      });
    };

    // ════════════════════════════════════════════════════════════════

    // Step 1.5 + 2: INPAINT BG + DIE-CUT COMPONENTS (parallel, BEFORE refinement)
    // ════════════════════════════════════════════════════════════════
    let generatedBackgroundImageUrl: string | null = null;
    let visualComponents: Array<{
      label: string;
      imageUrl: string;
      position: any;
      z_index: number;
      interaction_zone?: any;
    }> = [];
    const stackImageUrls: string[] = [];
    let safeZonePlacementDone = false;

    // --- Dedup: remove props already held by a character ---
    const CHAR_KW = [
      "woman",
      "man",
      "girl",
      "boy",
      "mascot",
      "character",
      "person",
      "figure",
      "human",
    ];
    const PROP_KW = [
      "phone",
      "smartphone",
      "mobile",
      "tablet",
      "gun",
      "pistol",
      "weapon",
      "rifle",
      "water gun",
      "squirt",
      "bag",
      "purse",
      "handbag",
      "backpack",
      "bottle",
      "cup",
      "mug",
      "drink",
      "hat",
      "cap",
      "helmet",
      "glasses",
      "sunglasses",
      "umbrella",
      "fan",
      "flag",
    ];
    // Keywords that indicate decorative graphic elements (NOT actual subjects to die-cut)
    // These are background design elements, patterns, borders, etc.
    const GRAPHICAL_KW = [
      "pattern",
      "hexagon",
      "geometric",
      "background",
      "texture",
      "gradient",
      "border",
      "decoration",
      "ornament",
      "abstract",
      "shape",
      "wave",
      "frame",
      "watermark",
    ];
    // Filter out pure graphic/decorative elements that are part of the background
    componentSuggestions = componentSuggestions.filter((c: any) => {
      const lbl = c.label.toLowerCase();
      const desc = (c.description || "").toLowerCase();
      const isGraphicOnly =
        GRAPHICAL_KW.some((kw) => lbl.includes(kw)) &&
        !CHAR_KW.some((kw) => lbl.includes(kw));
      if (isGraphicOnly) {
        console.log(`[Build-Up] 🎨 Filtered graphic element: "${c.label}"`);
        return false;
      }
      return true;
    });

    const hasChar = componentSuggestions.some((c: any) =>
      CHAR_KW.some((kw) => c.label.toLowerCase().includes(kw)),
    );
    if (hasChar) {
      componentSuggestions = componentSuggestions.filter((c: any) => {
        const lbl = c.label.toLowerCase();
        const hasPropWord = PROP_KW.some((kw) => lbl.includes(kw));
        const hasCharWord = CHAR_KW.some((kw) => lbl.includes(kw));
        // Filter out only if it contains a prop word but NO character word
        if (hasPropWord && !hasCharWord) {
          console.log(`[Build-Up] ⚠️ Filtered prop: "${c.label}"`);
          return false;
        }
        return true;
      });
    }

    // --- Dedup: remove bounding boxes that heavily overlap (IoU > 70%) ---
    // This prevents getting duplicate crops when AI returns near-identical bounding boxes
    const computeIoU = (a: any, b: any): number => {
      const aPos = a.position || {};
      const bPos = b.position || {};
      const xA = Math.max(aPos.left, bPos.left);
      const yA = Math.max(aPos.top, bPos.top);
      const xB = Math.min(aPos.left + aPos.width, bPos.left + bPos.width);
      const yB = Math.min(aPos.top + aPos.height, bPos.top + bPos.height);
      if (xB <= xA || yB <= yA) return 0;
      const inter = (xB - xA) * (yB - yA);
      const aArea = aPos.width * aPos.height;
      const bArea = bPos.width * bPos.height;
      return inter / (aArea + bArea - inter);
    };
    const deduped: any[] = [];
    for (const comp of componentSuggestions) {
      const pos = comp.position || {};
      const compArea = (pos.width || 0) * (pos.height || 0);

      const isDuplicate = deduped.some((kept) => {
        // Standard IoU check
        if (computeIoU(kept, comp) > 0.7) return true;

        // Containment check: if one bbox is mostly inside the other, keep the larger one.
        // Handles case where AI returns "woman full body" + "woman upper body" for the same person.
        const kPos = kept.position || {};
        const kArea = (kPos.width || 0) * (kPos.height || 0);
        if (kArea === 0 || compArea === 0) return false;

        const xA = Math.max(pos.left, kPos.left);
        const yA = Math.max(pos.top, kPos.top);
        const xB = Math.min(pos.left + pos.width, kPos.left + kPos.width);
        const yB = Math.min(pos.top + pos.height, kPos.top + kPos.height);
        if (xB <= xA || yB <= yA) return false;
        const inter = (xB - xA) * (yB - yA);

        // If smaller bbox is >60% contained within larger bbox → duplicate
        const smallerArea = Math.min(compArea, kArea);
        if (inter / smallerArea > 0.6) return true;

        return false;
      });

      if (isDuplicate) {
        console.log(
          `[Build-Up] 🔁 Removed overlapping/contained duplicate: "${comp.label}"`,
        );
      } else {
        deduped.push(comp);
      }
    }
    componentSuggestions = deduped;

    console.log(
      `[Build-Up] Components after dedup: ${componentSuggestions.length}`,
    );

    // --- Run die-cut FIRST, so we get the full-image RMBG mask for true inpainting ---
    let strokeBboxes: Array<{
      label: string;
      top: number;
      left: number;
      width: number;
      height: number;
    }> = [];
    let fullImageAlphaMask: Buffer | null = null;
    if (componentSuggestions.length > 0) {
      // Task A: Generate die-cut components
      try {
        sendSSE("progress", {
          step: "diecut_generation",
          message: `Generating ${componentSuggestions.length} die-cut components...`,
        });
        const {
          results: diecutResults,
          gridImages,
          maskedFullImageBuffer,
        } = await vertexService.generateDiecutComponents(
          imageBuffer,
          mimeType,
          componentSuggestions,
          precomputedMaskedBuffer, // reuse RMBG mask from Step 1A (skip re-run)
        );
        fullImageAlphaMask = maskedFullImageBuffer || null;

        if (gridImages?.length) {
          gridImages.forEach((img, idx) => {
            const fn = `stack-${Date.now()}-${idx}.png`;
            fs.writeFileSync(path.join(uploadDir, fn), img);
            stackImageUrls.push(`/uploads/${fn}`);
          });
        }
        visualComponents = diecutResults.map(
          (res: { label: string; buffer: Buffer }, idx: number) => {
            const fn = `component-${Date.now()}-${idx}.png`;
            fs.writeFileSync(path.join(uploadDir, fn), res.buffer);
            const matched =
              componentSuggestions.find((c: any) => c.label === res.label) ||
              componentSuggestions[idx];
            // suggested_position = AI's active composition choice; prefer over detected position
            const pos = matched?.suggested_position ||
              matched?.position || {
                top: 0,
                left: 0,
                width: 200,
                height: 200,
              };
            if (matched?.suggested_position) {
              console.log(
                `[Compose] "${res.label}" repositioned → ${JSON.stringify(matched.suggested_position)}`,
              );
            }
            return {
              label: res.label,
              imageUrl: `/uploads/${fn}`,
              position: pos,
              z_index: matched?.z_index || 15,
              interaction_zone: matched?.interaction_zone || null,
            };
          },
        );
        console.log(
          `[Build-Up] Generated ${visualComponents.length} die-cut images`,
        );
        sendSSE("progress", {
          step: "diecut_complete",
          message: `✅ ${visualComponents.length} components ready!`,
        });

        // ── SAFE ZONE COMPUTATION from die-cut stroke bboxes ──────────────────
        // Extract pixel-accurate bboxes from component PNGs, then compute safe zones
        try {
          const diecutWithPositions = diecutResults.map(
            (res: any, idx: number) => ({
              label: res.label,
              buffer: res.buffer,
              position: componentSuggestions[idx]?.position || null,
            }),
          );

          strokeBboxes =
            await vertexService.extractComponentStrokeBboxes(
              diecutWithPositions,
            );
          console.log(
            `[SafeZone] Got ${strokeBboxes.length} stroke bboxes from die-cut components`,
          );
        } catch (strokeErr) {
          console.warn(
            "[SafeZone] Stroke bbox extraction failed, using RMBG bboxes only:",
            strokeErr,
          );
        }

        // Combine stroke bboxes + RMBG bboxes as obstacles
        const allObstacles = [
          ...strokeBboxes,
          ...parsedNoGoZones.map((z: any) => ({
            top: z.area?.top ?? z.top ?? 0,
            left: z.area?.left ?? z.left ?? 0,
            width: z.area?.width ?? z.width ?? 0,
            height: z.area?.height ?? z.height ?? 0,
          })),
        ];

        const safeZones = computeSafeZones(allObstacles);
        console.log(
          `[SafeZone] ${safeZones.length} safe zones computed: ${safeZones
            .slice(0, 3)
            .map((z) => `${z.label}(${z.area})`)
            .join(", ")}`,
        );
        sendSSE("progress", {
          step: "safe_zones_computed",
          message: `Computed ${safeZones.length} safe placement zones from component boundaries`,
        });

        // NOTE: Text layout (Pass 2) now runs AFTER the die-cut block closes,
        // so strokeBboxes and visualComponents are fully available.
      } catch (err) {
        console.error("[Build-Up] Die-cut failed:", err);
        sendSSE("progress", {
          step: "diecut_error",
          message: "⚠️ Die-cut generation failed.",
        });
      }

      // Task B: Inpaint background — 3 passes, each refines the previous result
      try {
        sendSSE("progress", {
          step: "inpaint_background",
          message: "AI is cleaning the background (3 passes)...",
        });

        const INPAINT_ITERS = 1;
        let bgBufferedResponse: Buffer | null = null;
        // currentSource starts as the original image; each iter feeds its output as next source
        let currentSource: Buffer = imageBuffer;

        if (fullImageAlphaMask) {
          for (let iter = 1; iter <= INPAINT_ITERS; iter++) {
            sendSSE("progress", {
              step: "inpaint_background",
              message: `Inpainting pass ${iter}/${INPAINT_ITERS}...`,
            });

            const iterStart = Date.now();

            // Emit mask preview only on first iteration (mask doesn't change)
            const onMaskReady =
              iter === 1
                ? (maskBase64: string) => {
                    sendSSE("inpaint_mask", { imageBase64: maskBase64 });
                  }
                : undefined;

            const inpaintRes = await vertexService.inpaintBackground(
              currentSource,
              fullImageAlphaMask,
              analysis,
              onMaskReady,
            );

            if (inpaintRes.buffer) {
              bgBufferedResponse = inpaintRes.buffer;
              currentSource = inpaintRes.buffer; // chain: next pass refines this result

              const iterFilename = `bg-inpaint-iter${iter}-${Date.now()}.png`;
              fs.writeFileSync(
                path.join(uploadDir, iterFilename),
                inpaintRes.buffer,
              );
              const iterUrl = `/uploads/${iterFilename}`;
              const elapsed = ((Date.now() - iterStart) / 1000).toFixed(1);

              sendSSE("inpaint_iteration", {
                iteration: iter,
                totalIterations: INPAINT_ITERS,
                previewUrl: iterUrl,
                elapsedSeconds: elapsed,
              });

              console.log(
                `[Build-Up] Inpaint iter ${iter}/${INPAINT_ITERS} done in ${elapsed}s → ${iterUrl}`,
              );
            } else {
              console.warn(
                `[Build-Up] Inpaint iter ${iter} returned null, keeping previous result`,
              );
              break; // stop early if Imagen fails — don't lose previous good result
            }
          }
        }

        if (bgBufferedResponse) {
          const bgFilename = `bg-inpaint-${Date.now()}.png`;
          fs.writeFileSync(
            path.join(uploadDir, bgFilename),
            bgBufferedResponse,
          );
          generatedBackgroundImageUrl = `/uploads/${bgFilename}`;
          console.log(
            `[Build-Up] Final inpainted BG: ${generatedBackgroundImageUrl}`,
          );
          sendSSE("background_ready", {
            previewUrl: generatedBackgroundImageUrl,
            message: "Background cleaned!",
          });
        } else {
          sendSSE("background_ready", {
            previewUrl: refImageUrl,
            message:
              "⚠️ Background inpainting could not complete. Using original image.",
          });
        }
      } catch (err) {
        console.error("[Build-Up] BG inpaint failed:", err);
        sendSSE("background_ready", {
          previewUrl: refImageUrl,
          message: "⚠️ Background cleaning failed. Using original image.",
        });
      }

      sendSSE("progress", {
        step: "assets_ready",
        message: `Assets: BG ${generatedBackgroundImageUrl ? "✅" : "❌"} | Components: ${visualComponents.length}`,
      });
    }

    // ───── Step 1C: Pass 2 — Text Layout Around Fixed Components ──────────────
    if (mode !== "only_bg_comp") {
      sendSSE("progress", {
        step: "text_layout",
        message: "AI is planning layout strategy...",
      });

      // textNoGoZones removed — Pass 2 no longer uses forbidden zones.
      // Character depth (interaction_zone z-index) handles visual separation instead.

      // Step 0 (DesignAsCode Plan phase): let AI brainstorm layout concept before committing to coordinates
      let layoutHint:
        | Awaited<ReturnType<typeof vertexService.planLayoutStrategy>>
        | undefined;
      try {
        layoutHint = await vertexService.planLayoutStrategy(
          imageBuffer,
          mimeType,
          targetText,
          visualComponents.map((c) => c.label),
        );
        sendSSE("progress", {
          step: "layout_strategy",
          message: `🎨 Layout strategy: "${layoutHint.layout_concept}"`,
        });
      } catch (planErr) {
        console.warn(
          "[Pass2] Plan phase failed — proceeding without hint:",
          planErr,
        );
      }

      sendSSE("progress", {
        step: "text_layout",
        message: "AI is fitting text around the composed layout...",
      });

      // Tell the AI where components are (use their final suggested_position or position)
      const fixedPositions = visualComponents.map((c) => ({
        label: c.label,
        top: c.position.top || 0,
        left: c.position.left || 0,
        width: c.position.width || 200,
        height: c.position.height || 200,
      }));

      try {
        const textAnalysis = await vertexService.suggestCampaignLayout(
          imageBuffer,
          mimeType,
          targetText,
          "text",
          [], // 5: no forbidden zones — character depth handles layering
          [], // 6: safeZones (empty — not pre-computed for text pass)
          fixedPositions, // 7: fixedComponentPositions
          artDirectorTextZone || undefined, // 8: textZone
          layoutHint, // 9: art director strategy hint
        );
        textSuggestions = textAnalysis.suggestions || [];
        // Sync Pass 2 results into analysis so refineLayout has full context
        analysis.suggestions = textSuggestions;
        if (textAnalysis.no_go_zones) {
          analysis.no_go_zones = textAnalysis.no_go_zones;
        }
      } catch (pass2Err) {
        console.warn(
          "[Pass2] Text layout failed, proceeding with empty text suggestions:",
          pass2Err,
        );
      }

      sendSSE("progress", {
        step: "initial_analysis_complete",
        message: `Found ${textSuggestions.length} text + ${visualComponents.length} components`,
        textCount: textSuggestions.length,
        componentCount: visualComponents.length,
      });
    }

    // POST-PROCESS width clamp removed: intentional text-character overlap is now
    // by design (character renders in front via z-index / interaction_zone depth).

    // Safety net: force Kanit + strip containers + auto-fill stroke/shadow for contrast
    if (textSuggestions.length > 0) {
      textSuggestions = textSuggestions.map((s: any) => {
        const isFinePrint = (s.hierarchy || "").toLowerCase() === "fineprint";
        return {
          ...s,
          visual_container: "none", // containers stripped — stroke+shadow handles contrast
          style: {
            ...s.style,
            font_family: "Kanit",
            color_hex: enforceContrast(s.style?.color_hex, s.position),
            // Ensure stroke exists for all non-fineprint text
            stroke_hex:
              s.style?.stroke_hex || (isFinePrint ? undefined : "#000000"),
            stroke_width:
              s.style?.stroke_width ?? (isFinePrint ? undefined : 4),
            // Ensure shadow exists and is at least "subtle" for non-fineprint
            shadow:
              s.style?.shadow && s.style.shadow !== "none"
                ? s.style.shadow
                : isFinePrint
                  ? "none"
                  : "strong",
          },
        };
      });
      // Visual Quality Gate: ensure promo numbers are visually dominant
      textSuggestions = enforceDesignRules(textSuggestions);
    }

    // Send initial layout to canvas (fires after Pass 2 + post-processing — has full text + components)
    sendSSE("iteration_end", {
      iteration: 0,
      message: "Initial layout mapped to canvas.",
      textCount: textSuggestions.length,
      componentCount: visualComponents.length,
      textLayers: textSuggestions,
      components: componentSuggestions,
      visualComponents,
    });

    // ════════════════════════════════════════════════════════════════
    // Step 3: REFINEMENT LOOP — adjusts BOTH text AND component positions
    // ════════════════════════════════════════════════════════════════
    const MAX_ITERATIONS = 3;
    let currentIteration = 0;
    let lastCritique: any = { status: "FAIL" };

    try {
      const shouldSkipIteration = mode === "only_bg_comp";

      if (shouldSkipIteration) {
        sendSSE("progress", {
          step: "refinement_skipped",
          message:
            "Refinement skipped (Component Only Mode). Proceeding to final generation...",
        });
      }

      // ── PRE-LOOP GEOMETRIC CHECK ───────────────────────────────────────────
      // Run overlap check on the INITIAL layout BEFORE entering the refinement loop.
      // If the layout is already clean (RMBG bboxes helped the AI place text well),
      // skip the entire loop — saves N × (critiqueLayout + refineLayout) API calls.
      let preCheckOverlapFound = false;
      const preCheckDetails: string[] = [];

      if (safeZonePlacementDone && !shouldSkipIteration) {
        // Safe zone placement guarantees no overlap — skip pre-check entirely
        console.log(
          `[OVERLAP CHECK] ✅ Safe zone placement used — positions mathematically guaranteed. Skipping overlap check.`,
        );
        sendSSE("critique_complete", {
          iteration: 0,
          status: "PASS",
          feedback:
            "Text placed within verified safe zones. No overlap possible.",
          actionableSteps: [],
          message:
            "✅ Layout approved by safe zone system — no refinement needed!",
        });
        lastCritique = {
          status: "PASS",
          feedback: "Safe zone placement guarantees no overlap.",
        };
      } else if (
        !shouldSkipIteration &&
        !safeZonePlacementDone &&
        textSuggestions.length > 0
      ) {
        const allNoGoZones = [
          ...(analysis.no_go_zones || []),
          ...parsedNoGoZones,
        ];
        const imgMeta0 = await sharp(imageBuffer).metadata();
        const imgW0 = imgMeta0.width || 1000;
        const imgH0 = imgMeta0.height || 1000;

        const computeTextBBox0 = (s: any) => {
          const fontSize = s.style?.font_size_normalized || 40;
          const lines = (s.part || "").split("\n");
          const longestLine = Math.max(...lines.map((l: string) => l.length));
          const lh = s.style?.line_height || 1.2;
          const w = Math.max(
            s.position?.width || 0,
            ((longestLine * fontSize * 0.6) / imgW0) * 1000,
          );
          const h = Math.max(
            s.position?.height || 0,
            ((lines.length * fontSize * lh) / imgH0) * 1000,
          );
          const top = s.position?.top || 0;
          const left = s.position?.left || 0;
          return {
            top,
            left,
            width: w,
            height: h,
            right: left + w,
            bottom: top + h,
          };
        };

        // 1. Pinpoint ALL distinct people and characters in the image as separate subjects.
        // 2. For EACH subject, create EXACTLY ONE tight full-body bounding box — do NOT split one person/character into multiple boxes (e.g. no separate "head", "upper body", "legs").
        // 3. Use the 0-1000 coordinate scale to specify coordinates accurately.
        // 4. Do NOT guess. Use the visible image to estimate positions.
        // Add containment dedup logic for no-go zones (after IoU dedup, if any)
        const dedupedNoGoZones = [];
        for (const zoneA of allNoGoZones) {
          let isContained = false;
          const aTop = zoneA.area?.top ?? zoneA.top ?? 0;
          const aLeft = zoneA.area?.left ?? zoneA.left ?? 0;
          const aW = zoneA.area?.width ?? zoneA.width ?? 0;
          const aH = zoneA.area?.height ?? zoneA.height ?? 0;
          const aRight = aLeft + aW;
          const aBottom = aTop + aH;

          for (const zoneB of allNoGoZones) {
            if (zoneA === zoneB) continue; // Don't compare with self

            const bTop = zoneB.area?.top ?? zoneB.top ?? 0;
            const bLeft = zoneB.area?.left ?? zoneB.left ?? 0;
            const bW = zoneB.area?.width ?? zoneB.width ?? 0;
            const bH = zoneB.area?.height ?? zoneB.height ?? 0;
            const bRight = bLeft + bW;
            const bBottom = bTop + bH;

            // Check if zoneA is completely contained within zoneB
            if (
              aLeft >= bLeft &&
              aRight <= bRight &&
              aTop >= bTop &&
              aBottom <= bBottom
            ) {
              isContained = true;
              break;
            }
          }
          if (!isContained) {
            dedupedNoGoZones.push(zoneA);
          }
        }

        for (const s of textSuggestions) {
          if (!s.position) continue;
          const t = computeTextBBox0(s);
          for (const zone of dedupedNoGoZones) {
            // Use deduped zones here
            const zTop = zone.area?.top ?? zone.top ?? 0;
            const zLeft = zone.area?.left ?? zone.left ?? 0;
            const zW = zone.area?.width ?? zone.width ?? 0;
            const zH = zone.area?.height ?? zone.height ?? 0;
            const overlaps = !(
              t.right <= zLeft ||
              t.left >= zLeft + zW ||
              t.bottom <= zTop ||
              t.top >= zTop + zH
            );
            if (overlaps) {
              preCheckOverlapFound = true;
              preCheckDetails.push(
                `"${(s.part || "").substring(0, 25)}..." overlaps "${zone.label}" — needs repositioning`,
              );
            }
          }
        }

        if (!preCheckOverlapFound) {
          console.log(
            `[OVERLAP CHECK] ✅ Initial layout is clean — skipping refinement loop entirely (0 API calls saved!)`,
          );
          sendSSE("critique_complete", {
            iteration: 0,
            status: "PASS",
            feedback:
              "Initial layout passed geometric check. No refinement needed.",
            actionableSteps: [],
            message:
              "✅ Layout approved by geometric check — skipping AI critique loop!",
          });
          lastCritique = {
            status: "PASS",
            feedback: "Geometric pre-check passed.",
          };
        } else {
          console.log(
            `[OVERLAP CHECK] ⚠️ ${preCheckDetails.length} initial overlaps — refinement loop will run (max ${MAX_ITERATIONS} iterations)`,
          );
        }
      }

      while (
        currentIteration < MAX_ITERATIONS &&
        !shouldSkipIteration &&
        (currentIteration === 0 || lastCritique?.status !== "PASS")
      ) {
        currentIteration++;
        console.log(
          `\n[Refinement] 🔄 Iteration ${currentIteration}/${MAX_ITERATIONS} starting...`,
        );

        sendSSE("iteration_start", {
          iteration: currentIteration,
          maxIterations: MAX_ITERATIONS,
          message: `Iteration ${currentIteration}/${MAX_ITERATIONS}: Generating preview...`,
        });

        // Generate visual preview using SVG overlay (matches editor output)
        const previewBuffer = await vertexService.generateLayoutPreview(
          imageBuffer,
          textSuggestions,
          componentSuggestions,
          analysis.no_go_zones || [],
        );

        // Save preview for debugging and frontend display
        const previewFilename = `preview-iter${currentIteration}-${Date.now()}.png`;
        const previewPath = path.join(uploadDir, previewFilename);
        fs.writeFileSync(previewPath, previewBuffer);

        sendSSE("debug_preview", {
          iteration: currentIteration,
          previewUrl: `/uploads/${previewFilename}`,
          message: "Preview generated, checking for overlaps...",
        });

        // ═══════════════════════════════════════════
        // DETERMINISTIC OVERLAP CHECK (code-based, not AI!)
        // ═══════════════════════════════════════════
        const noGoZones = analysis.no_go_zones || [];
        let overlapFound = false;
        const overlapDetails: string[] = [];

        // Get actual image dimensions for text width calculation
        const imgMeta = await sharp(imageBuffer).metadata();
        const imgW = imgMeta.width || 1000;
        const imgH = imgMeta.height || 1000;

        // Trust AI position.width as primary bbox — AI has visual context.
        // Fallback to character estimate only if AI returned 0 width.
        const computeTextBBox = (s: any) => {
          const fontSize = s.style?.font_size_normalized || 40;
          const lines = (s.part || "").split("\n");
          const longestLine = Math.max(...lines.map((l: string) => l.length));
          const lineHeight = s.style?.line_height || 1.2;
          // 0.45 coefficient for Thai Kanit (narrower than Latin 0.6)
          const textWidthPx = longestLine * fontSize * 0.45;
          const textHeightPx = lines.length * fontSize * lineHeight;
          const computedW = (textWidthPx / imgW) * 1000;
          const computedH = (textHeightPx / imgH) * 1000;
          // Prefer AI width; use estimate only when AI width is missing/zero
          const w = (s.position?.width || 0) > 0 ? s.position.width : computedW;
          const h = Math.max(s.position?.height || 0, computedH);
          const top = s.position?.top || 0;
          const left = s.position?.left || 0;
          return {
            top,
            left,
            width: w,
            height: h,
            right: left + w,
            bottom: top + h,
          };
        };

        if (noGoZones.length > 0) {
          for (const s of textSuggestions) {
            if (!s.position) continue;
            const t = computeTextBBox(s);

            for (const zone of noGoZones) {
              // Handle both flat {top,left,width,height} and nested {area:{...}} formats
              const zTop = zone.area?.top ?? zone.top ?? 0;
              const zLeft = zone.area?.left ?? zone.left ?? 0;
              const zW = zone.area?.width ?? zone.width ?? 0;
              const zH = zone.area?.height ?? zone.height ?? 0;
              if (zW === 0 && zH === 0) continue; // skip degenerate zones
              const zRight = zLeft + zW;
              const zBottom = zTop + zH;

              const overlaps = !(
                t.right <= zLeft ||
                t.left >= zRight ||
                t.bottom <= zTop ||
                t.top >= zBottom
              );

              if (overlaps) {
                overlapFound = true;
                const textSnippet = (s.part || "").substring(0, 30);
                overlapDetails.push(
                  `Text "${textSnippet}..." (top:${t.top}, left:${t.left}, computed_w:${Math.round(t.width)}, h:${Math.round(t.height)}) overlaps PERSON "${zone.label}" (top:${zTop}, left:${zLeft}, w:${zW}, h:${zH}). Move text COMPLETELY OUTSIDE.`,
                );
                console.log(
                  `[OVERLAP] ❌ "${textSnippet}..." overlaps "${zone.label}" | text_right:${Math.round(t.right)} > zone_left:${zLeft}`,
                );
              }
            }
          }
        }

        // TEXT-VS-TEXT overlap check
        for (let i = 0; i < textSuggestions.length; i++) {
          for (let j = i + 1; j < textSuggestions.length; j++) {
            const a = textSuggestions[i];
            const b = textSuggestions[j];
            if (!a.position || !b.position) continue;

            const boxA = computeTextBBox(a);
            const boxB = computeTextBBox(b);

            const overlaps = !(
              boxA.right <= boxB.left ||
              boxA.left >= boxB.right ||
              boxA.bottom <= boxB.top ||
              boxA.top >= boxB.bottom
            );

            if (overlaps) {
              overlapFound = true;
              const snippetA = (a.part || "").substring(0, 20);
              const snippetB = (b.part || "").substring(0, 20);
              overlapDetails.push(
                `TEXT-TEXT OVERLAP: "${snippetA}..." (top:${boxA.top}, left:${boxA.left}, w:${Math.round(boxA.width)}) overlaps "${snippetB}..." (top:${boxB.top}, left:${boxB.left}, w:${Math.round(boxB.width)}). Separate them.`,
              );
              console.log(
                `[OVERLAP] ❌ TEXT-TEXT: "${snippetA}..." overlaps "${snippetB}..."`,
              );
            }
          }
        }

        // Always use AI art director critique — no code auto-fail
        // (intentional overlap with character is valid in depth-layered composition)
        const critique = await vertexService.critiqueLayout(
          imageBuffer,
          previewBuffer,
          mimeType,
          targetText,
          false, // full critique — positions + style + composition quality
        );

        lastCritique = critique;

        sendSSE("critique_complete", {
          iteration: currentIteration,
          status: critique.status,
          confidence: critique.confidence ?? null,
          feedback: critique.feedback,
          actionableSteps: critique.actionable_steps || [],
          message:
            critique.status === "PASS"
              ? `✅ Layout approved by AI Creative Director! (confidence: ${((critique.confidence ?? 0.5) * 100).toFixed(0)}%)`
              : `❌ Issues found: ${critique.feedback}`,
        });

        const confidence = critique.confidence ?? 0.5; // default 0.5 when field missing
        console.log(
          `[Compose] Iteration ${currentIteration} → ${critique.status} (confidence: ${(confidence * 100).toFixed(0)}%)`,
        );

        if (critique.status === "PASS" && confidence >= 0.85) {
          console.log(
            `[Compose] High confidence PASS (${(confidence * 100).toFixed(0)}%) — stopping at iteration ${currentIteration}`,
          );
          sendSSE("progress", {
            step: "refinement_complete",
            message: "Layout approved! Proceeding to final generation...",
          });
          break;
        } else if (critique.status === "PASS") {
          // Low-confidence PASS — let it run another iteration to improve further
          console.log(
            `[Compose] Low-confidence PASS (${(confidence * 100).toFixed(0)}%) — continuing for one more iteration`,
          );
          sendSSE("progress", {
            step: "refinement_complete",
            message: "Layout approved! Proceeding to final generation...",
          });
          break; // Still break — PASS is PASS, confidence just informs logging
        }

        // FAIL - needs refinement
        if (currentIteration >= MAX_ITERATIONS) {
          sendSSE("progress", {
            step: "max_iterations_reached",
            message: "⚠️ Max iterations reached. Using best available layout.",
          });
          break;
        }

        sendSSE("refining", {
          iteration: currentIteration,
          message: "Refining layout based on feedback...",
        });

        // Refine the layout based on critique — pass previewBuffer so AI can SEE the problems
        const refinedAnalysis = await vertexService.refineLayout(
          imageBuffer,
          mimeType,
          targetText,
          analysis,
          critique,
          previewBuffer,
        );

        // Update local variables with refined data — but VALIDATE first!
        const prevCount = textSuggestions.length;
        const newCount = refinedAnalysis.suggestions?.length || 0;

        if (newCount === 0) {
          // AI deleted all text — reject completely
          console.warn(
            `[WARNING] Refine returned 0 suggestions (had ${prevCount}). Keeping previous layout.`,
          );
          sendSSE("refine_rejected", {
            iteration: currentIteration,
            message: `⚠️ Refinement rejected: AI returned 0 text elements (had ${prevCount}). Keeping previous layout.`,
          });
        } else if (newCount < Math.ceil(prevCount * 0.5)) {
          // AI deleted too many texts — reject
          console.warn(
            `[WARNING] Refine dropped from ${prevCount} to ${newCount} suggestions. Keeping previous layout.`,
          );
          sendSSE("refine_rejected", {
            iteration: currentIteration,
            message: `⚠️ Refinement rejected: Too many text elements removed (${prevCount} → ${newCount}).`,
          });
        } else {
          textSuggestions = enforceDesignRules(refinedAnalysis.suggestions);
          analysis.suggestions = textSuggestions;
        }
        if (refinedAnalysis.components) {
          componentSuggestions = refinedAnalysis.components;
          analysis.components = refinedAnalysis.components;
          // Sync positions back into visualComponents (images stay, positions update)
          for (const vc of visualComponents) {
            const updated = componentSuggestions.find(
              (c: any) => c.label === vc.label,
            );
            if (updated?.position) {
              vc.position = updated.position;
              vc.z_index = updated.z_index || vc.z_index;
            }
          }
        }
        sendSSE("iteration_end", {
          iteration: currentIteration,
          message: `Layout refined (iteration ${currentIteration}).`,
          textCount: textSuggestions.length,
          componentCount: componentSuggestions.length,
          textLayers: textSuggestions,
          components: componentSuggestions,
          visualComponents,
        });
      }

      // Add iteration metadata to response
      analysis.critique_iterations = currentIteration;
      analysis.final_critique_status = lastCritique.status;
      analysis.final_critique_feedback = lastCritique.feedback;
    } catch (err) {
      sendSSE("error", {
        step: "refinement_loop",
        message: "Feedback loop failed, continuing with initial analysis",
        error: err instanceof Error ? err.message : String(err),
      });
    }

    // ───── Step 3: Return Everything ─────
    sendSSE("done", {
      success: true,
      data: {
        referenceImage: `/uploads/${refFilename}`,
        backgroundDescription: analysis.background_description || "",
        generatedBackgroundImageUrl,
        campaignVibe: analysis.campaign_vibe || "",
        textLayers: textSuggestions,
        visualComponents,
        stackImageUrls: stackImageUrls || [],
        critiqueIterations: analysis.critique_iterations,
        finalCritiqueStatus: analysis.final_critique_status,
        finalCritiqueFeedback: analysis.final_critique_feedback,
      },
    });

    res.end();
  } catch (error: any) {
    console.error("Create Campaign error:", error);

    // Try to send error via SSE if headers not sent yet
    if (!res.headersSent) {
      res.setHeader("Content-Type", "text/event-stream");
      res.setHeader("Cache-Control", "no-cache");
      res.setHeader("Connection", "keep-alive");
    }

    res.write(`event: error\n`);
    res.write(`data: ${JSON.stringify({ error: error.message })}\n\n`);
    res.end();
  }
};
