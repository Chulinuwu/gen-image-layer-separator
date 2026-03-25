# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

AI-powered image layer separator and campaign generator using Google Vertex AI (Gemini). Allows users to generate backgrounds, create advertising campaigns with AI-driven layout, and separate/edit image layers.

## Architecture

**Monorepo** with three independent apps:

- `backend/` — Express.js + TypeScript REST API (port 5001) — original backend
- `backend-python/` — FastAPI + Python REST API (port 5001) — primary backend
- `frontend/` — Vue 3 + TypeScript SPA (Vite, port 5173)

## Python Backend (`backend-python/`)

### Structure

```
backend-python/
  app/
    main.py                       # FastAPI app entry, CORS, lifespan, static files
    config.py                     # Pydantic settings (env vars)
    constants/                    # Centralized config values
      pipeline.py                 # All thresholds, magic numbers, keyword lists
      models.py                   # SAFETY_OFF, model selection (get_text_model, get_text_model_best)
    prompts/                      # AI prompt templates (one file per domain)
      campaign_layout.py          # suggest_campaign_layout prompt + JSON schema
      flex_layout.py              # Flex tree prompt + rules
      critique.py                 # Art director critique prompt
      diecut.py                   # Die-cut generation prompt
      layout_strategy.py          # Layout planning prompt
      render_campaign.py          # Render campaign image prompt
      separate_layers.py          # Layer separation + component analysis prompts
      describe.py                 # Image description prompt
    controllers/
      image.py                    # SSE pipeline, request handlers, orchestration
    services/
      vertex.py                   # GenAI client, all AI methods (generate, layout, diecut, inpaint, RMBG)
    utils/
      flex_layout.py              # Flex tree → absolute box computation
      svg_builder.py              # SVG generation with Kanit font embedding
      text_measure.py             # Font measurement (Pillow-based)
      safe_zones.py               # Bbox-based safe zone computation
      ai_logger.py                # AI trace logging to logs/ai-trace.md
      ref_image_search.py         # Reference image similarity (cosine) + style guide extraction
  assets/
    fonts/                        # Kanit TTF files (Regular, Bold, Black)
    Ref_Footer/                   # Footer text templates
  uploads/                        # Multer-style file storage
  logs/                           # AI trace logs
  tests/                          # pytest test suite
  pyproject.toml                  # Dependencies + project config
```

### Key Concepts

**Campaign render pipeline** (`create-campaign` SSE endpoint):
1. **RMBG prescan** — Background removal to detect foreground subjects
2. **Foreground gate** — If <5% opaque pixels → skip component extraction (background-only image)
3. **Component placement** — AI identifies visual components in image (NOT from brief text)
4. **Die-cut** — Extract components with quality gate (min 40px, >5% opaque)
5. **Flex layout** — AI generates a flex tree → `compute_flex_layout()` converts to absolute boxes
6. **SVG render** — `build_flex_svg()` generates SVG with embedded Kanit fonts
7. **Critique loop** — AI Art Director reviews preview, optionally refines

**Prompt editing:** All prompts are in `app/prompts/`. Each file exports a builder function. Change prompts there, NOT in vertex.py.

**Config/thresholds:** All magic numbers are in `app/constants/pipeline.py`. Keywords shared between services and controllers are defined once there.

**Flex layout engine** (`app/utils/flex_layout.py`):
- Converts flex tree (from AI) → `LayoutBox` list with absolute pixel positions
- Handles AI returning gap/padding as string, dict, or int (hardened `_safe_int`)
- Enforces min 40px height for text nodes
- `_strip_component_nodes()` removes hallucinated component nodes and redistributes their height

**SVG builder** (`app/utils/svg_builder.py`):
- `build_flex_svg()` generates SVG with Kanit font base64-embedded via `@font-face`
- Required for cairosvg to render Thai text correctly

### Key Service Methods (`vertex.py`)

- `generate_image()` — Image generation via Gemini (3.1-flash → 3-pro → 2.5-flash fallback)
- `suggest_campaign_layout()` — AI component/text placement (0-1000 coords)
- `suggest_flex_layout()` — AI generates flex tree for SVG rendering
- `critique_layout()` — AI Art Director critique with PASS/FAIL
- `generate_diecut_components()` — Extract/generate die-cut components with quality gate
- `inpaint_background()` — AI background cleanup via Imagen
- `run_rmbg_and_get_bboxes()` — RMBG-2.0 background removal + bbox detection
- `with_retry()` — Exponential backoff for 429/timeout (3 retries)

### Development Commands

```bash
cd backend-python
source venv/bin/activate
python -m uvicorn app.main:app --reload --port 5001   # dev server
python -m pytest tests/ -v                              # run tests
```

### Environment Variables (`backend-python/.env`)

```
PORT=5001
GOOGLE_SERVICE_ACCOUNT_TYPE=service_account
GOOGLE_SERVICE_ACCOUNT_PROJECT_ID=
GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY_ID=
GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY=      # Use \\n for newlines
GOOGLE_SERVICE_ACCOUNT_CLIENT_EMAIL=
GOOGLE_SERVICE_ACCOUNT_CLIENT_ID=
GOOGLE_CLOUD_LOCATION=global             # Must be "global" for Gemini 3 preview

# Model endpoints (priority order)
GEMINI_IMAGE_ENDPOINT=gemini-3.1-flash-image-preview
GEMINI_IMAGE_ENDPOINT_2=gemini-3-pro-image-preview
GEMINI_IMAGE_ENDPOINT_3=gemini-2.5-flash-image
GEMINI_TEXT_ENDPOINT=gemini-2.5-pro
IMAGEN_EDIT_ENDPOINT=imagen-3.0-capability-001
```

## Frontend (`frontend/`)

### Structure

```
frontend/src/
  App.vue                    # Tab router: generate → campaign → editor
  components/
    ImageGenerator.vue       # Tab 1: Background generation
    CampaignLayout.vue       # Tab 2: Campaign creation (calls /create-campaign)
    LayerEditor.vue          # Tab 3: Canvas-based layer editor
    AIRefinementPreview.vue  # AI preview overlay within editor
```

**State flow:** `App.vue` owns `sharedBackgroundUrl` and `sharedCampaignData`, passing them down as props.

## Design Principles

### No post-processing hotfixes on AI layout output
Do NOT use code to "fix" AI-generated layout after the fact (clamping positions, normalizing height%, scaling boxes, forcing elements into bounds). These hotfixes produce ugly results. If the AI output is wrong, fix the INPUT (prompt, data sent to AI, canvas dimensions) so the AI generates correct output in the first place. The flex layout engine should faithfully render what the AI decides -- it should not second-guess or modify the AI's decisions.

### No image-specific hardcoding in prompts
Prompt examples and instructions in `app/prompts/` must be GENERIC -- they should work for any input image, not just one specific test case. Do NOT put image-specific content (e.g. "port/logistics scene", "purple padlock", specific Thai text) in prompt examples. If the AI needs context about the current image, that comes from the pipeline data (image_description, layout_strategy, no_go_zones), not from hardcoded examples. Examples should illustrate the FORMAT and STRUCTURE of expected output, using placeholder descriptions like "body text section" or "a busy scene with objects".

### Prompt rules must be universal design principles, not image-specific
Rules in prompts (e.g. background classification, font size minimums, color guidelines) must apply to ALL images universally. They are graphic design best practices, not fixes for one test case. Valid rules teach the AI HOW to decide, not WHAT to decide. Example: "look at the actual brightness of the area to classify light vs dark" (teaches reasoning) is good. "Asphalt is always dark" (hardcodes a surface type) is bad -- it doesn't scale to beaches, forests, or other scenes. The AI should observe the image and decide, not follow a lookup table of surface types.

## Debugging & Inspection

### AI Trace Logs
All AI calls (layout reasoning, critique, diecut, etc.) are logged to `backend-python/logs/ai-trace.md`. Check here to inspect what the AI decided and why -- includes full prompts and raw responses. Look for "Flex Layout Thought" entries to see the AI's placement reasoning vs the actual flex tree it generated.

### Campaign Pipeline Flow
The campaign creation SSE endpoint (`create_campaign` in `controllers/image.py`) runs this pipeline:
1. RMBG prescan -> foreground detection + bounding boxes
2. Component placement -> AI identifies visual components
3. Die-cut & inpaint -> extract components + clean background
4. Layout strategy -> AI plans layout concept
5. **Flex layout** -> AI generates flex tree (`prompts/flex_layout.py`) -> `compute_flex_layout()` converts to absolute positions -> `build_flex_svg()` renders SVG
6. Refinement loop (optional) -> AI critique + re-layout

To debug layout issues, check step 5 in the trace logs.

## Important Technical Notes

### Gemini Model Location
Gemini 3 preview models **require** `location="global"`. Other regions cause 404 errors.

### Background Removal
Python backend uses **RMBG-2.0** (transformers + PyTorch) locally. Model loaded once, reused as singleton.

### Component & Placeholder Hallucination Prevention
Four-layer defense against AI inventing components or placeholder text:
1. **RMBG gate** — If foreground <5% → skip component detection entirely
2. **Prompt hardening** — Prompts explicitly say "only list visually present components" and "do NOT create text nodes for visual elements described in the brief"
3. **Code strip (components)** — `_strip_component_nodes()` removes any component nodes from flex tree when no die-cuts available, redistributes height to siblings
4. **Code strip (placeholder text)** — `_is_placeholder_text()` removes text nodes containing `[...]` bracket patterns or visual element descriptions (e.g. "Phone mockup", "screenshot", "app UI")

### Reference Style Intelligence
The pipeline enriches AI layout generation with structured style information from reference images:
1. **Embedding search** — `find_similar_refs()` finds top-3 similar reference ads via cosine similarity
2. **Style guide extraction** — `extract_style_guide()` parses ref descriptions to extract color palette, layout patterns, typography traits
3. **Prompt enrichment** — `suggest_flex_layout()` sends ref images + their text descriptions + extracted style guide to AI
4. **Style matching rules** — Prompt instructs AI to match the visual DNA (colors, typography, layout patterns, mood) of references

Key files: `app/utils/ref_image_search.py` (search + style extraction), `app/prompts/flex_layout.py` (style-aware prompt), `app/services/vertex.py` (wiring)

### Critique Prompt
`app/prompts/critique.py` — When no die-cut components exist, critique prompt explicitly instructs AI to NOT fail for missing visual elements (logos, phone mockups, etc.) and to judge ONLY text readability, contrast, and hierarchy.

### Thai Text Rendering
SVG preview embeds Kanit fonts as base64 `@font-face` in both:
- `generate_layout_preview()` in vertex.py
- `build_flex_svg()` in svg_builder.py

Without this, cairosvg renders Thai as `[]` boxes, breaking the AI critique loop.

### Error Handling Pattern
`with_retry()` handles 429 (rate limit) and timeout errors with exponential backoff (3 retries, starts at 2s).
