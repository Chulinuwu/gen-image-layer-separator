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
│   ├── routes/image.py          # Route definitions
│   ├── controllers/image.py     # Request handlers, campaign pipeline
│   ├── services/vertex.py       # All AI logic (Gemini, RMBG, Sharp-like ops)
│   └── utils/
│       ├── ai_logger.py         # AI call tracing/logging
│       ├── flex_layout.py       # Flex tree → absolute box computation
│       ├── ref_image_search.py  # Similar reference image lookup
│       ├── safe_zones.py        # No-go zone / safe area calculation
│       ├── svg_builder.py       # SVG generation with font embedding
│       └── text_measure.py      # Text measurement utilities
├── assets/fonts/                # Kanit font family (Regular, Bold, Black)
├── tests/                       # pytest test suite
├── uploads/                     # Runtime upload directory (gitignored)
├── pyproject.toml               # Project config & dependencies
└── .env                         # Environment variables (not committed)
```

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
