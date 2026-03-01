# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

AI-powered image layer separator and campaign generator using Google Vertex AI (Gemini). Allows users to generate backgrounds, create advertising campaigns, and separate/edit image layers.

## Architecture

**Monorepo** with two independent apps:

- `backend/` — Express.js + TypeScript REST API (port 5001)
- `frontend/` — Vue 3 + TypeScript SPA (Vite, port 5173)

### Backend Structure

```
backend/src/
  index.ts                    # Express app entry, CORS, static file serving
  routes/image.routes.ts      # All routes under /api/image, Multer file upload config
  controllers/image.controller.ts  # Request handlers, orchestrates the pipeline
  services/vertex.service.ts  # All AI logic (Gemini, background removal, Sharp)
  middleware/
  types/
```

**Key service methods in `vertex.service.ts`:**
- `generateImage()` — Generates images via Gemini image models (3.1-flash, 3-pro, 2.5-flash with fallback chain)
- `analyzeComponents()` — Analyzes image to identify separatable layers/components
- `separateLayers()` — Extracts text and layer info from image
- `removeBackgroundML()` — Uses `@imgly/background-removal-node` (ONNX, runs locally, no API call)
- `withRetry()` — Exponential backoff for 429/timeout errors (3 retries, starts at 2s)

**AI Client:** Singleton `GoogleGenAI` in Vertex AI mode. Credentials built entirely from env vars (no JSON file needed). Location must be `"global"` for Gemini 3 preview models.

### Frontend Structure

```
frontend/src/
  App.vue                    # Tab router: generate → campaign → editor
  components/
    ImageGenerator.vue       # Tab 1: Background generation
    CampaignLayout.vue       # Tab 2: Campaign creation (calls /create-campaign)
    LayerEditor.vue          # Tab 3: Canvas-based layer editor
    AIRefinementPreview.vue  # AI preview overlay within editor
```

**State flow:** `App.vue` owns `sharedBackgroundUrl` and `sharedCampaignData`, passing them down as props between tabs.

### API Endpoints

| Route | Method | Controller | Purpose |
|---|---|---|---|
| `/api/image/generate` | POST | `generateAndSeprate` | Generate background image |
| `/api/image/process` | POST | `processImage` | Analyze + separate image layers |
| `/api/image/add-text` | POST | `suggestCampaign` | AI text placement suggestions |
| `/api/image/render-text` | POST | `renderCampaign` | Render text onto image |
| `/api/image/create-campaign` | POST | `createCampaign` | Full pipeline: analyze → die-cut → components |

All file uploads go to `backend/uploads/` via Multer disk storage.

## Development Commands

### Backend
```bash
cd backend
npm run dev      # ts-node-dev with hot reload
npm run build    # compile to dist/
npm start        # run compiled dist/index.js
```

### Frontend
```bash
cd frontend
npm run dev      # Vite dev server
npm run build    # vue-tsc + vite build
```

## Environment Variables (backend/.env)

```
PORT=5001
GOOGLE_SERVICE_ACCOUNT_TYPE=service_account
GOOGLE_SERVICE_ACCOUNT_PROJECT_ID=
GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY_ID=
GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY=      # Use \\n for newlines
GOOGLE_SERVICE_ACCOUNT_CLIENT_EMAIL=
GOOGLE_SERVICE_ACCOUNT_CLIENT_ID=
GOOGLE_CLOUD_LOCATION=global             # Must be "global" for Gemini 3 preview

# Model endpoints (priority order, falls back down the chain)
GEMINI_IMAGE_ENDPOINT=gemini-3.1-flash-image-preview
GEMINI_IMAGE_ENDPOINT_2=gemini-3-pro-image-preview
GEMINI_IMAGE_ENDPOINT_3=gemini-2.5-flash-image

# Text/analysis model
GEMINI_TEXT_ENDPOINT=gemini-2.5-pro

# Inpaint editing model (MUST be an editing-capable model, NOT a generation-only model)
# imagen-4.0-fast-generate-001 does NOT support editImage/EDIT_MODE_INPAINT_REMOVAL
IMAGEN_EDIT_ENDPOINT=imagen-3.0-capability-001
```

## Important Technical Notes

### Gemini Model Location
Gemini 3 preview models **require** `location="global"`. Using `us-central1` or other regions causes 404 errors.

### Background Removal
`removeBackgroundML()` uses `@imgly/background-removal-node` which runs ONNX models **locally** (no API call). The model singleton is loaded once and reused. First call is slow due to model loading.

### Error Handling Pattern
Network/timeout errors from Vertex AI surface as `UND_ERR_HEADERS_TIMEOUT`. The `withRetry()` wrapper handles both 429 (rate limit) and timeout errors with exponential backoff. If errors reach the frontend as "Network error", check:
1. Backend is running on port 5001
2. CORS is configured (it uses `cors()` with no restrictions in dev)
3. The specific Vertex AI error in backend logs (not frontend)

### File Upload
- All uploads use Multer `diskStorage` to `backend/uploads/`
- Static files served at `/uploads` route
- `Content-Disposition: attachment` header set for all uploaded files
