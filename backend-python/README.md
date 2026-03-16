# Backend Python — Image Layer Separator API

FastAPI + Python backend for AI-powered image layer separation, campaign generation, and text layout with Google Vertex AI (Gemini).

## Features

- **Image Generation** — Generate background images via Gemini (3.1-flash, 3-pro, 2.5-flash fallback chain)
- **Layer Separation** — Analyze and extract text/visual components from images
- **Background Removal** — Local ML inference with RMBG-2.0 (transformers + PyTorch) + fallback to rembg (ONNX)
- **Campaign Pipeline** — Full SSE-streamed pipeline: RMBG prescan → component placement → die-cut → inpaint background → flex layout → SVG overlay → AI critique/refinement loop
- **Text Layout** — AI-driven flex layout system with SVG generation and font embedding (Kanit)
- **SVG Export** — Export ad layouts as SVG with embedded/path fonts

## Prerequisites

- Python 3.11+
- Google Cloud service account with Vertex AI API enabled
- (Optional) NVIDIA GPU + CUDA for faster background removal

## Setup

```bash
cd backend-python

# Create virtual environment
python3 -m venv venv
source venv/bin/activate

# Install dependencies
pip install -e ".[dev]"

# Install onnxruntime for rembg (pick one)
pip install "rembg[cpu]"    # CPU only
pip install "rembg[gpu]"    # NVIDIA/CUDA GPU
```

## Environment Variables

Copy `.env.example` to `.env` and fill in your credentials:

```bash
cp .env.example .env
```

## Run

```bash
# Development (hot reload)
uvicorn app.main:app --reload --port 5001

# Production
uvicorn app.main:app --host 0.0.0.0 --port 5001
```

Server starts at `http://localhost:5001`. On startup, RMBG-2.0 model is warmed up (first load takes ~30s).

## API Endpoints

All routes are under `/api/image`.

| Method | Route | Content-Type | Description |
|--------|-------|-------------|-------------|
| POST | `/generate` | multipart/form-data or JSON | Generate background image from prompt |
| POST | `/process` | multipart/form-data | Analyze + separate image layers |
| POST | `/add-text` | multipart/form-data or JSON | AI text placement suggestions |
| POST | `/render-text` | multipart/form-data or JSON | Render text onto image |
| POST | `/create-campaign` | multipart/form-data or JSON | Full campaign pipeline (SSE stream) |
| POST | `/export-svg` | multipart/form-data or JSON | Export layout as SVG |
| GET | `/` | — | Health check |

### `/generate`

Generate a background image.

| Param | Type | Required | Description |
|-------|------|----------|-------------|
| `prompt` | string | Yes | Image generation prompt |
| `aspect_ratio` | string | No | Default `3:4` |
| `resolution` | string | No | Target resolution |
| `images` | File[] | No | Reference images |

### `/process`

Analyze and separate image into layers.

| Param | Type | Required | Description |
|-------|------|----------|-------------|
| `image` | File | Yes | Source image |
| `background` | File | No | Pre-separated background |
| `hintText` | string | No | Hint for text extraction |
| `mode` | string | No | `only_bg_comp` to skip text separation |

### `/create-campaign`

Full campaign pipeline. Returns **Server-Sent Events** (SSE).

| Param | Type | Required | Description |
|-------|------|----------|-------------|
| `image` | File or base64 | Yes | Reference image |
| `text` | string | Yes | Campaign text/brief |
| `background` | File | No | Custom background |
| `mode` | string | No | `only_bg_comp` for components only |
| `noGoZones` | JSON string | No | Areas to avoid placing text |

SSE events: `progress`, `background_ready`, `iteration_start`, `critique_complete`, `iteration_end`, `done`, `error`

## Project Structure

```
backend-python/
├── app/
│   ├── main.py                  # FastAPI app, CORS, lifespan, middleware
│   ├── config.py                # Pydantic settings (reads .env)
│   ├── constants/               # Centralized config values
│   │   ├── pipeline.py          # Thresholds, magic numbers, keyword lists
│   │   └── models.py            # SAFETY_OFF, model selection functions
│   ├── prompts/                 # AI prompt templates (one file per domain)
│   │   ├── campaign_layout.py   # Component placement prompt + JSON schema
│   │   ├── flex_layout.py       # Flex tree generation prompt + rules
│   │   ├── critique.py          # Art director critique prompt
│   │   ├── diecut.py            # Die-cut generation prompt
│   │   ├── layout_strategy.py   # Layout planning prompt
│   │   ├── render_campaign.py   # Campaign render prompt
│   │   ├── separate_layers.py   # Layer separation prompts
│   │   └── describe.py          # Image description prompt
│   ├── routes/image.py          # Route definitions
│   ├── controllers/image.py     # Request handlers, campaign SSE pipeline
│   ├── services/vertex.py       # GenAI client + all AI methods
│   └── utils/
│       ├── ai_logger.py         # AI call tracing → logs/ai-trace.md
│       ├── flex_layout.py       # Flex tree → absolute box computation
│       ├── ref_image_search.py  # Similar reference image lookup (cosine)
│       ├── safe_zones.py        # No-go zone / safe area calculation
│       ├── svg_builder.py       # SVG generation with Kanit font embedding
│       └── text_measure.py      # Text measurement (Pillow-based)
├── assets/
│   ├── fonts/                   # Kanit TTFs (see below)
│   ├── ref_images/              # Reference ad images + embeddings.json (see below)
│   └── Ref_Footer/              # Footer disclaimer text (see below)
├── logs/                        # AI trace logs (auto-generated)
├── tests/                       # pytest test suite
├── uploads/                     # Runtime upload directory (gitignored)
├── pyproject.toml               # Project config & dependencies
├── .env.example                 # Environment variable template
└── .env                         # Environment variables (not committed)
```

## Assets Setup

### Fonts (`assets/fonts/`)

Download Kanit from [Google Fonts](https://fonts.google.com/specimen/Kanit) and place:
- `Kanit-Regular.ttf` (weight 400)
- `Kanit-Bold.ttf` (weight 700)
- `Kanit-Black.ttf` (weight 900)

Required for Thai text rendering in SVG previews and AI critique loop.

### Reference Images (`assets/ref_images/`)

Place example ad images here for layout reference. The system uses cosine similarity to find similar layouts.

Optional `embeddings.json` with pre-computed embeddings (auto-generated on first use).

### Footer Text (`assets/Ref_Footer/footer.txt`)

Place your disclaimer/footer text here. Example:
```
คำเตือน: การลงทุนมีความเสี่ยง ผู้ลงทุนควรทำความเข้าใจลักษณะสินค้า เงื่อนไขผลตอบแทน และความเสี่ยงก่อนตัดสินใจลงทุน
```

If the file exists, the flex layout will include it as a footer element automatically.

## Campaign Pipeline Flow

The `/create-campaign` endpoint runs a multi-stage SSE pipeline:

```
┌─────────────────────────────────────────────────────────────┐
│  1. RMBG Prescan                                            │
│     Run background removal to detect foreground subjects    │
│     └─ Foreground Gate: if <5% opaque → skip components     │
├─────────────────────────────────────────────────────────────┤
│  2. Component Placement (AI)                                │
│     AI identifies visual components IN the image            │
│     ⚠ Only lists elements visually present, not from brief  │
├─────────────────────────────────────────────────────────────┤
│  3. Die-cut + Inpaint                                       │
│     Extract components → quality gate (min 40px, >5% opaque)│
│     Inpaint background to remove extracted subjects         │
├─────────────────────────────────────────────────────────────┤
│  4. Layout Strategy (AI)                                    │
│     Plan unified layout: where components + text go         │
├─────────────────────────────────────────────────────────────┤
│  5. Flex Layout (AI)                                        │
│     Generate flex tree → compute_flex_layout() → LayoutBoxes│
│     Strip hallucinated component nodes if none available    │
│     Enforce min 40px height for text nodes                  │
├─────────────────────────────────────────────────────────────┤
│  6. SVG Render                                              │
│     build_flex_svg() → SVG with embedded Kanit fonts        │
│     Rounded rect for CTA buttons, semi-transparent bg       │
├─────────────────────────────────────────────────────────────┤
│  7. Critique Loop (AI Art Director)                         │
│     Composite SVG onto image → AI reviews preview           │
│     If FAIL → refine flex tree → re-render → re-critique    │
│     Skips "missing component" complaints when none exist    │
└─────────────────────────────────────────────────────────────┘
```

### Anti-Hallucination (3 layers)

| Layer | Mechanism |
|-------|-----------|
| RMBG Gate | Foreground <5% → `component_suggestions = []` → skip die-cut |
| Prompt Hardening | AI told "only list visually present components, not from brief" |
| Code Strip | `_strip_component_nodes()` removes hallucinated nodes, redistributes height |

## Reference Image Embeddings

Reference images improve layout quality by providing the AI with examples of well-designed ads.

### Setup

1. Place reference ad images in `assets/ref_images/` (PNG, JPG, WEBP)
2. Run the embedding script:

```bash
source venv/bin/activate
python scripts/embed_ref_images.py
```

This generates `assets/ref_images/embeddings.json` with detailed descriptions + 3072-dim embedding vectors.

### How it works

1. When a user uploads an image, `describe_and_embed()` creates a description + embedding
2. `find_similar_refs()` finds the top-3 most similar reference images via cosine similarity
3. These reference images are sent to the flex layout AI as composition examples

### Config

Embedding model and dimensions are configurable via `.env`:
```
GEMINI_EMBEDDING_MODEL=gemini-embedding-001
GEMINI_EMBEDDING_DIMENSIONS=3072
```

## Prompt Editing

All AI prompts are in `app/prompts/` — one file per domain. To modify AI behavior, edit the prompt file directly:

| File | Controls |
|------|----------|
| `campaign_layout.py` | Component detection + text placement |
| `flex_layout.py` | Flex tree generation rules + styling |
| `critique.py` | Art director critique criteria |
| `diecut.py` | Die-cut image generation |
| `layout_strategy.py` | Layout planning strategy |
| `render_campaign.py` | Final campaign image render |
| `describe.py` | Reference image description (2-part: background + layout) |

Thresholds and magic numbers are in `app/constants/pipeline.py`.

## Testing

```bash
source venv/bin/activate
pytest                    # run all tests
pytest -v                 # verbose
pytest tests/test_flex_layout.py  # specific test file
```

## Key Technical Notes

- **Gemini 3 preview models require `GOOGLE_CLOUD_LOCATION=global`** — other regions return 404
- **RMBG-2.0** loads once at startup and stays in memory. First request is slow (~30s model download), subsequent calls are fast
- **Retry logic** — `with_retry()` handles 429 rate limits and `UND_ERR_HEADERS_TIMEOUT` with exponential backoff (3 retries, starts at 2s)
- **File uploads** go to `backend-python/uploads/` via FastAPI's `UploadFile`, served statically at `/uploads`
- **CORS** is wide open (`*`) in dev — restrict in production
