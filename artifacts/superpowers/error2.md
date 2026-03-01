"Thai boy mascot" (295374 bytes)
[GenAI] Preview grid built: 2x1 (2 components)
[GenAI] Die-cut complete: 2/2 components succeeded
[Build-Up] Generated 2 die-cut images
[Inpaint] Generating B&W inpaint mask from RMBG alpha channel...
[Inpaint] Mask size: 1024x1024 | Image resized to match | mimeType: image/png
[Inpaint] Calling Imagen editImage (EDIT_MODE_INPAINT_REMOVAL)...
[Inpaint] Error during editImage: ApiError: {"error":{"code":400,"message":"Image editing failed with the following error: No uri or raw bytes are provided in media content.","status":"INVALID_ARGUMENT"}}
    at throwErrorIfNotOK (/Users/chulin/gen-image-layer-separator/backend/node_modules/@google/genai/dist/node/index.cjs:12224:30)
    at processTicksAndRejections (node:internal/process/task_queues:105:5)
    at /Users/chulin/gen-image-layer-separator/backend/node_modules/@google/genai/dist/node/index.cjs:11927:13
    at Models.editImage (/Users/chulin/gen-image-layer-separator/backend/node_modules/@google/genai/dist/node/index.cjs:13508:20)
    at AIService.inpaintBackground (/Users/chulin/gen-image-layer-separator/backend/src/services/vertex.service.ts:1832:24)
    at createCampaign (/Users/chulin/gen-image-layer-separator/backend/src/controllers/image.controller.ts:899:30) {
  status: 400
}
[Build-Up] Inpaint returned null — canvas will use original image as BG
[OVERLAP CHECK] ⚠️ 5 initial overlaps — refinement loop will run (max 3 iterations)
[OVERLAP] ❌ "SCB EASY และ Robinhood..." overlaps "Woman's face" | text_right:700 > zone_left:440
[OVERLAP] ❌ "บัตรขึ้นชิงช้าสวรรค์..." overlaps "Woman's upper body (holding phone and water gun)" | text_right:587 > zone_left:390
[OVERLAP] ❌ "บัตรขึ้นชิงช้าสวรรค์..." overlaps "Woman's lower body (jeans, legs, shoes)" | text_right:587 > zone_left:440
[OVERLAP] ❌ TEXT-TEXT: "2..." overlaps "ต่อ..."