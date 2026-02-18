import { Request, Response } from "express";
import { vertexService } from "../services/vertex.service";
import fs from "fs";
import path from "path";
import sharp from "sharp";

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

    // Step 1: Analyze components + Extract text in parallel (both use fast text model)
    console.log("[Pipeline] Step 1: Analyzing components + Extracting text...");
    const [analysisResult, textResult] = await Promise.allSettled([
      vertexService.analyzeComponents(imageBuffer, mimeType, backgroundBuffer),
      vertexService.separateLayers(
        imageBuffer,
        mimeType,
        backgroundBuffer,
        hintText,
      ),
    ]);

    const analysisData =
      analysisResult.status === "fulfilled"
        ? analysisResult.value
        : { components: [] };
    const layersData =
      textResult.status === "fulfilled" ? textResult.value : { layers: [] };

    if (analysisResult.status === "rejected") {
      console.error("Worker (Analyze) failed:", analysisResult.reason);
    }
    if (textResult.status === "rejected") {
      console.error("Worker (Text) failed:", textResult.reason);
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
    }> = [];
    const stackImageUrls: string[] = [];

    const components = analysisData.components || [];
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
          return {
            label: result.label,
            imageUrl: `/uploads/${filename}`,
            position: components[i]?.position || {
              top: 0,
              left: 0,
              width: 200,
              height: 200,
            },
            z_index: components[i]?.z_index || 1,
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

    // ───── Step 1: AI Suggest Text + Components ─────
    const { mode, noGoZones } = req.body;
    console.log("[DEBUG] Received mode from frontend:", mode);

    // Parse noGoZones if they exist (might come as JSON string or object)
    let parsedNoGoZones = [];
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
      step: "initial_analysis",
      message: "AI is analyzing the reference image...",
    });

    const analysis = await vertexService.suggestCampaignLayout(
      imageBuffer,
      mimeType,
      targetText,
      mode || "full",
      parsedNoGoZones,
    );

    let textSuggestions = analysis.suggestions || [];
    let componentSuggestions = analysis.components || [];

    // FORCE: Strip components if mode is 'text' — don't trust AI to follow the prompt
    if ((mode || "full") === "text" && componentSuggestions.length > 0) {
      console.warn(
        `[WARNING] AI returned ${componentSuggestions.length} components in text-only mode! Stripping them.`,
      );
      componentSuggestions = [];
    }

    sendSSE("progress", {
      step: "initial_analysis_complete",
      message: `Found ${textSuggestions.length} text + ${componentSuggestions.length} components`,
      textCount: textSuggestions.length,
      componentCount: componentSuggestions.length,
    });

    // ───── Step 1.2: AI Self-Review / Design Feedback Loop (Iterative) ─────
    const MAX_ITERATIONS = 10;
    let currentIteration = 0;
    let lastCritique: any = { status: "FAIL" };

    try {
      while (currentIteration < MAX_ITERATIONS) {
        currentIteration++;

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

        sendSSE("preview_ready", {
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

        // Helper: compute REAL text bounding box from text content + fontSize
        const computeTextBBox = (s: any) => {
          const fontSize = s.style?.font_size_normalized || 40;
          const lines = (s.part || "").split("\n");
          const longestLine = Math.max(...lines.map((l: string) => l.length));
          const lineHeight = s.style?.line_height || 1.2;
          // fontSize is in PIXELS; compute pixel dimensions then convert to 0-1000
          const textWidthPx = longestLine * fontSize * 0.55;
          const textHeightPx = lines.length * fontSize * lineHeight;
          const computedW = (textWidthPx / imgW) * 1000;
          const computedH = (textHeightPx / imgH) * 1000;
          // Use LARGER of AI prediction vs computed (be conservative)
          const w = Math.max(s.position?.width || 0, computedW);
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
              if (!zone.area) continue;
              const zTop = zone.area.top || 0;
              const zLeft = zone.area.left || 0;
              const zRight = zLeft + (zone.area.width || 0);
              const zBottom = zTop + (zone.area.height || 0);

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
                  `Text "${textSnippet}..." (top:${t.top}, left:${t.left}, computed_w:${Math.round(t.width)}, h:${Math.round(t.height)}) overlaps PERSON "${zone.label}" (top:${zTop}, left:${zLeft}, w:${zone.area.width}, h:${zone.area.height}). Move text COMPLETELY OUTSIDE.`,
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

        let critique;

        if (overlapFound) {
          // AUTO-FAIL: Code detected overlap, skip AI critique entirely
          console.log(
            `[OVERLAP CHECK] Found ${overlapDetails.length} overlaps. Auto-FAIL.`,
          );
          critique = {
            status: "FAIL",
            feedback: `CODE-DETECTED OVERLAP: ${overlapDetails.length} text block(s) overlap with people/characters. This was detected by geometric intersection, not AI vision.`,
            actionable_steps: overlapDetails,
          };
        } else {
          // No code-detected overlap, proceed with AI critique for other checks
          critique = await vertexService.critiqueLayout(
            imageBuffer,
            previewBuffer,
            mimeType,
            targetText,
          );
        }

        lastCritique = critique;

        sendSSE("critique_complete", {
          iteration: currentIteration,
          status: critique.status,
          feedback: critique.feedback,
          actionableSteps: critique.actionable_steps || [],
          message:
            critique.status === "PASS"
              ? "✅ Layout approved by AI Creative Director!"
              : `❌ Issues found: ${critique.feedback}`,
        });

        if (critique.status === "PASS") {
          sendSSE("progress", {
            step: "refinement_complete",
            message: "Layout approved! Proceeding to final generation...",
          });
          break;
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
          textSuggestions = refinedAnalysis.suggestions;
          analysis.suggestions = refinedAnalysis.suggestions;
        }
        if (refinedAnalysis.components && (mode || "full") !== "text") {
          componentSuggestions = refinedAnalysis.components;
          analysis.components = refinedAnalysis.components;
        } else if ((mode || "full") === "text") {
          // Force clear components in text-only mode
          componentSuggestions = [];
          analysis.components = [];
        }
        sendSSE("iteration_end", {
          iteration: currentIteration,
          message: `Layout refined (iteration ${currentIteration}).`,
          textCount: textSuggestions.length,
          componentCount: componentSuggestions.length,
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

    // ───── Step 1.5: Inpaint Clean Background Image ─────
    let generatedBackgroundImageUrl: string | null = null;
    if (mode === "text") {
      sendSSE("progress", {
        step: "inpaint_background",
        message: "Skipped background inpainting (Mode: Text Only)",
      });
    } else if (componentSuggestions.length > 0) {
      try {
        console.log("[Build-Up] Step 1.5: Inpainting clean background...");
        const componentsToDelete = componentSuggestions
          .map(
            (c: any) =>
              `- COMPONENT: "${c.label}" at [top: ${c.position.top}, left: ${c.position.left}, width: ${c.position.width}, height: ${c.position.height}]`,
          )
          .join("\n");

        const textToDelete = textSuggestions
          .map(
            (t: any) =>
              `- TEXT: "${t.part}" at [top: ${t.position.top}, left: ${t.position.left}, width: ${t.position.width}, height: ${t.position.height}]`,
          )
          .join("\n");

        const bgResponse = await vertexService.generateImage({
          prompt: `
            You are a professional image editing AI specializing in INPAINTING and REMOVING objects.
            
            TASK: Create a clean background plate by REMOVING all foreground subjects, characters, and text from the provided image.
            
            IDENTIFIED ELEMENTS TO REMOVE (Coordinates 0-1000):
            ${componentsToDelete}
            ${textToDelete}
            
            CRITICAL RULES:
            1. REMOVE these components and text, then reconstruct the background behind them perfectly.
            2. MAINTAIN the exact environment, structure, lighting, and style of the existing background.
            3. THE RESULT MUST BE AN EMPTY BACKGROUND VERSION OF THE REFERENCE IMAGE.
            4. Do NOT hallucinate new objects. If a greenhouse is there, keep same greenhouse style.
          `,
          // Try to match aspect ratio of original
          aspect_ratio: "3:4",
          inputImages: [{ buffer: imageBuffer, mimeType }],
        });

        if (bgResponse.buffer) {
          const bgFilename = `bg-inpaint-${Date.now()}.png`;
          fs.writeFileSync(path.join(uploadDir, bgFilename), bgResponse.buffer);
          generatedBackgroundImageUrl = `/uploads/${bgFilename}`;
          console.log(
            `[Build-Up] Inpainted clean background: ${generatedBackgroundImageUrl}`,
          );
        }
      } catch (err) {
        console.error("[Build-Up] Background generation failed:", err);
      }
    }

    // ───── Step 2: Generate Die-cut Components ─────
    let visualComponents: Array<{
      label: string;
      imageUrl: string;
      position: any;
      z_index: number;
    }> = [];
    const stackImageUrls: string[] = [];

    if (mode === "text") {
      console.log("[Build-Up] Step 2: Skipped (Mode: Text Only)");
    } else if (componentSuggestions.length > 0) {
      console.log(
        `[Build-Up] Step 2: Generating ${componentSuggestions.length} die-cut components...`,
      );
      const { results: diecutResults, gridImages } =
        await vertexService.generateDiecutComponents(
          imageBuffer,
          mimeType,
          componentSuggestions,
        );

      // Save stack preview images
      if (gridImages && gridImages.length > 0) {
        gridImages.forEach((img, idx) => {
          const stackFilename = `stack-${Date.now()}-${idx}.png`;
          fs.writeFileSync(path.join(uploadDir, stackFilename), img);
          const url = `/uploads/${stackFilename}`;
          stackImageUrls.push(url);
          console.log(`[Build-Up] Saved stack preview ${idx}: ${url}`);
        });
      }

      visualComponents = diecutResults.map(
        (result: { label: string; buffer: Buffer }, i: number) => {
          const filename = `component-${Date.now()}-${i}.png`;
          fs.writeFileSync(path.join(uploadDir, filename), result.buffer);
          return {
            label: result.label,
            imageUrl: `/uploads/${filename}`,
            position: componentSuggestions[i]?.position || {
              top: 0,
              left: 0,
              width: 200,
              height: 200,
            },
            z_index: componentSuggestions[i]?.z_index || 1,
          };
        },
      );
      console.log(
        `[Build-Up] Generated ${visualComponents.length} die-cut images.`,
      );
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
