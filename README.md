# AI Image Layer Separator & Campaign Generator

An AI-powered tool for generating advertising campaign images. It uses Google Vertex AI (Gemini and Imagen models) to generate backgrounds, separate image layers, lay out text with AI-driven design, and produce ready-to-use campaign visuals -- all from a single web interface.

The application is built as a **monorepo** with a **Python/FastAPI backend** and a **Vue 3/TypeScript frontend**. The backend handles all AI interactions (image generation, text analysis, layout computation, background removal), while the frontend provides a three-tab workflow: generate a background, create a campaign layout, and fine-tune in a layer editor.

---

## Table of Contents

1. [What This Project Does](#what-this-project-does)
2. [Architecture Overview](#architecture-overview)
3. [Prerequisites](#prerequisites)
4. [Backend Setup (Python)](#backend-setup-python)
   - [Clone the Repository](#1-clone-the-repository)
   - [Create a Virtual Environment](#2-create-a-virtual-environment)
   - [Install Dependencies](#3-install-dependencies)
   - [Google Cloud / Vertex AI Credentials](#4-google-cloud--vertex-ai-credentials)
   - [Configure Environment Variables](#5-configure-environment-variables)
   - [Font Assets](#6-font-assets)
   - [Reference Images and Embeddings](#7-reference-images-and-embeddings)
   - [Footer Text (Optional)](#8-footer-text-optional)
   - [Start the Backend Server](#9-start-the-backend-server)
5. [Frontend Setup (Vue 3)](#frontend-setup-vue-3)
   - [Install Frontend Dependencies](#1-install-frontend-dependencies)
   - [Configure the API URL](#2-configure-the-api-url)
   - [Start the Frontend Dev Server](#3-start-the-frontend-dev-server)
6. [Running Both Together](#running-both-together)
7. [Project Structure](#project-structure)
8. [Key Features Explained](#key-features-explained)
   - [Background Generation](#background-generation)
   - [Campaign Pipeline (SSE)](#campaign-pipeline-sse)
   - [Layer Editor](#layer-editor)
   - [Background Removal (RMBG-2.0)](#background-removal-rmbg-20)
   - [Flex Layout Engine](#flex-layout-engine)
   - [SVG Builder with Thai Font Support](#svg-builder-with-thai-font-support)
   - [AI Critique Loop](#ai-critique-loop)
   - [Reference Image Style Matching](#reference-image-style-matching)
   - [Anti-Hallucination System](#anti-hallucination-system)
9. [API Endpoints](#api-endpoints)
10. [Troubleshooting](#troubleshooting)
11. [Development Workflow](#development-workflow)

---

## What This Project Does

This application automates the creation of advertising campaign images. A typical workflow looks like this:

1. **Generate a background** -- You type a prompt (e.g., "a tropical beach at sunset") and the AI generates a high-quality background image using Google Gemini's image generation models.

2. **Create a campaign** -- You upload a product image and provide campaign text (headlines, subheadlines, call-to-action, disclaimers). The AI then:
   - Removes the background from your product image
   - Detects and extracts visual components (product, logo, mascot, etc.)
   - Cleans up the background behind extracted components
   - Designs a flex-based text layout
   - Renders the layout as an SVG overlay on top of the background
   - Runs an AI "Art Director" critique to check readability and visual hierarchy
   - Refines the layout if needed

3. **Edit layers** -- A canvas-based editor lets you manually adjust the position, size, and stacking order of every layer (background, components, text overlay).

The end result is a production-ready campaign image with properly placed text, extracted product shots, and AI-optimized layout.

---

## Architecture Overview

```
                           ┌──────────────────────────────────────┐
                           │           User's Browser             │
                           │                                      │
                           │   Vue 3 + TypeScript SPA (Vite)      │
                           │   http://localhost:5173               │
                           │                                      │
                           │   ┌────────────┐ ┌───────────────┐   │
                           │   │ Background  │ │   Campaign    │   │
                           │   │ Generator   │ │   Layout      │   │
                           │   │ (Tab 1)     │ │   (Tab 2)     │   │
                           │   └────────────┘ └───────────────┘   │
                           │   ┌────────────┐ ┌───────────────┐   │
                           │   │   Layer     │ │ AI Refinement │   │
                           │   │   Editor    │ │ Preview       │   │
                           │   │   (Tab 3)   │ │ (overlay)     │   │
                           │   └────────────┘ └───────────────┘   │
                           └──────────────┬───────────────────────┘
                                          │ HTTP / SSE
                                          │ http://localhost:5001
                                          ▼
                           ┌──────────────────────────────────────┐
                           │       Python Backend (FastAPI)        │
                           │       http://localhost:5001           │
                           │                                      │
                           │   Routes ──► Controllers ──► Services │
                           │                                      │
                           │   ┌──────────┐  ┌──────────────────┐ │
                           │   │ Vertex AI │  │   RMBG-2.0      │ │
                           │   │ Service   │  │   (local ML)    │ │
                           │   │ (Gemini,  │  │   Background    │ │
                           │   │  Imagen)  │  │   Removal       │ │
                           │   └────┬─────┘  └──────────────────┘ │
                           │        │                              │
                           │   ┌────┴──────────────────────────┐  │
                           │   │ Utils: flex_layout, svg_builder│  │
                           │   │ text_measure, safe_zones,      │  │
                           │   │ ref_image_search, ai_logger    │  │
                           │   └───────────────────────────────┘  │
                           └──────────────┬───────────────────────┘
                                          │ API calls
                                          ▼
                           ┌──────────────────────────────────────┐
                           │        Google Cloud Platform          │
                           │                                      │
                           │   Gemini 3.1 Flash (image gen)       │
                           │   Gemini 3 Pro (image gen fallback)  │
                           │   Gemini 2.5 Flash (image gen)       │
                           │   Gemini 2.5 Pro (text/analysis)     │
                           │   Imagen 3.0 (inpainting)            │
                           │   Gemini Embedding (ref similarity)  │
                           └──────────────────────────────────────┘
```

---

## Prerequisites

Before you begin, make sure you have the following installed on your system:

| Tool | Minimum Version | How to Check | How to Install |
|------|----------------|-------------|----------------|
| **Python** | 3.11 or higher | `python3 --version` | [python.org/downloads](https://www.python.org/downloads/) or your OS package manager |
| **pip** | Latest | `pip --version` | Usually bundled with Python. Update: `python3 -m pip install --upgrade pip` |
| **Node.js** | 18 or higher | `node --version` | [nodejs.org](https://nodejs.org/) (LTS recommended) |
| **npm** | 9 or higher | `npm --version` | Bundled with Node.js |
| **Git** | Any recent | `git --version` | [git-scm.com](https://git-scm.com/) |

### System Libraries (Linux / WSL)

The backend uses `cairosvg` to rasterize SVG files, which requires the Cairo graphics library. On Ubuntu/Debian:

```bash
sudo apt update
sudo apt install -y libcairo2-dev libffi-dev
```

On macOS (with Homebrew):

```bash
brew install cairo libffi
```

### Optional: GPU Acceleration

If you have an NVIDIA GPU with CUDA, PyTorch (used by RMBG-2.0 for background removal) will automatically use it for faster inference. No extra setup is needed beyond having CUDA drivers installed. CPU-only works fine but is slower for background removal.

### Google Cloud Account

You need a Google Cloud project with the **Vertex AI API** enabled and a **service account** with appropriate permissions. Detailed instructions are in the [credentials section](#4-google-cloud--vertex-ai-credentials) below.

---

## Backend Setup (Python)

The backend lives in the `backend-python/` directory. It is a FastAPI application that handles all AI interactions, image processing, and file management.

### 1. Clone the Repository

```bash
git clone <your-repo-url> gen-image-layer-separator
cd gen-image-layer-separator
```

### 2. Create a Virtual Environment

```bash
cd backend-python

# Create a virtual environment named "venv"
python3 -m venv venv

# Activate the virtual environment
# On Linux / macOS / WSL:
source venv/bin/activate

# On Windows (Command Prompt):
venv\Scripts\activate

# On Windows (PowerShell):
venv\Scripts\Activate.ps1
```

You should see `(venv)` at the beginning of your terminal prompt. **Every time** you open a new terminal to work on this project, you need to activate the virtual environment again.

### 3. Install Dependencies

With the virtual environment activated:

```bash
# Install the project and all its dependencies
pip install -e ".[dev]"
```

This installs:

| Package | Purpose |
|---------|---------|
| `fastapi` | Web framework for the REST API |
| `uvicorn[standard]` | ASGI server to run FastAPI |
| `python-multipart` | File upload handling |
| `python-dotenv` | Load `.env` file into environment variables |
| `pydantic-settings` | Type-safe configuration from environment variables |
| `google-genai` | Google Generative AI SDK (Gemini, Imagen, Embeddings) |
| `Pillow` | Image manipulation (resize, crop, alpha channel operations) |
| `fonttools` | Font file parsing for text measurement |
| `transformers` | Hugging Face Transformers (loads RMBG-2.0 model) |
| `torch` | PyTorch (ML framework for RMBG-2.0 inference) |
| `numpy` | Numerical operations (cosine similarity, array ops) |
| `aiofiles` | Async file I/O |
| `rembg` | Fallback background removal (ONNX-based) |
| `cairosvg` | SVG to PNG rasterization |

Dev dependencies (for testing and linting):

| Package | Purpose |
|---------|---------|
| `pytest` | Test runner |
| `pytest-asyncio` | Async test support |
| `httpx` | HTTP client for testing FastAPI |
| `ruff` | Fast Python linter and formatter |

**Note about PyTorch:** The `torch` package is large (several GB). The initial install may take a while depending on your internet connection.

### 4. Google Cloud / Vertex AI Credentials

The backend communicates with Google's Gemini and Imagen AI models through the Vertex AI API. You need a Google Cloud service account to authenticate.

#### Step-by-step:

1. **Go to the Google Cloud Console:** [console.cloud.google.com](https://console.cloud.google.com/)

2. **Create a project** (or use an existing one):
   - Click the project dropdown at the top of the page
   - Click "New Project"
   - Give it a name (e.g., "campaign-generator") and click "Create"

3. **Enable the Vertex AI API:**
   - In the left sidebar, go to "APIs & Services" > "Library"
   - Search for "Vertex AI API"
   - Click on it and click "Enable"
   - Also enable "Generative Language API" if prompted

4. **Create a service account:**
   - Go to "IAM & Admin" > "Service Accounts"
   - Click "Create Service Account"
   - Give it a name (e.g., "campaign-generator-sa")
   - Click "Create and Continue"
   - For the role, select "Vertex AI User" (or "Vertex AI Administrator" for broader access)
   - Click "Continue" then "Done"

5. **Create a key for the service account:**
   - Click on the service account you just created
   - Go to the "Keys" tab
   - Click "Add Key" > "Create new key"
   - Choose **JSON** format
   - Click "Create" -- this downloads a JSON file to your computer

6. **Extract values from the JSON key file.** Open the downloaded JSON file. It looks like this:

   ```json
   {
     "type": "service_account",
     "project_id": "your-project-id",
     "private_key_id": "abc123...",
     "private_key": "-----BEGIN PRIVATE KEY-----\nMIIEvg...\n-----END PRIVATE KEY-----\n",
     "client_email": "campaign-generator-sa@your-project-id.iam.gserviceaccount.com",
     "client_id": "123456789012345678901",
     ...
   }
   ```

   You will need the values for `type`, `project_id`, `private_key_id`, `private_key`, `client_email`, and `client_id` in the next step.

### 5. Configure Environment Variables

Copy the example file and fill in your values:

```bash
cp .env.example .env
```

Open `.env` in a text editor. Here is every variable explained:

```bash
# ──────────────────────────────────────────────────────────────
# Server Configuration
# ──────────────────────────────────────────────────────────────

# The port the backend server listens on.
# The frontend expects this to be 5001 by default.
PORT=5001

# ──────────────────────────────────────────────────────────────
# Google Cloud Service Account Credentials
# ──────────────────────────────────────────────────────────────
# These values come from the JSON key file you downloaded in step 4.

# Always "service_account" -- do not change this.
GOOGLE_SERVICE_ACCOUNT_TYPE=service_account

# Your Google Cloud project ID (e.g., "my-campaign-project-123456").
# Found in the JSON key file under "project_id".
GOOGLE_SERVICE_ACCOUNT_PROJECT_ID=your-project-id

# The private key ID from your JSON key file.
# Found under "private_key_id".
GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY_ID=your-private-key-id

# The private key itself. This is a long multi-line string.
# IMPORTANT: Copy the ENTIRE value from the JSON file, including the
# "-----BEGIN PRIVATE KEY-----" and "-----END PRIVATE KEY-----" parts.
# In the .env file, replace actual newlines with \n (backslash-n).
# Wrap the whole thing in double quotes.
# Example:
#   "-----BEGIN PRIVATE KEY-----\nMIIEvgIBADA...<lots of characters>...w==\n-----END PRIVATE KEY-----\n"
GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY="-----BEGIN PRIVATE KEY-----\nYOUR_KEY_HERE\n-----END PRIVATE KEY-----\n"

# The service account email address.
# Found under "client_email" in the JSON key file.
GOOGLE_SERVICE_ACCOUNT_CLIENT_EMAIL=your-sa@your-project.iam.gserviceaccount.com

# The numeric client ID.
# Found under "client_id" in the JSON key file.
GOOGLE_SERVICE_ACCOUNT_CLIENT_ID=123456789

# ──────────────────────────────────────────────────────────────
# Google Cloud Location
# ──────────────────────────────────────────────────────────────

# The region to use for Vertex AI API calls.
# CRITICAL: Gemini 3 preview models REQUIRE this to be "global".
# If you set it to a specific region (e.g., "us-central1"), those
# models will return 404 errors. Leave this as "global".
GOOGLE_CLOUD_LOCATION=global

# ──────────────────────────────────────────────────────────────
# AI Model Endpoints (Image Generation)
# ──────────────────────────────────────────────────────────────
# The backend tries these models in order (fallback chain).
# If the first model fails or is rate-limited, it tries the next.

# Primary image generation model (fastest, latest preview).
GEMINI_IMAGE_ENDPOINT=gemini-3.1-flash-image-preview

# Second fallback image generation model (higher quality but slower).
GEMINI_IMAGE_ENDPOINT_2=gemini-3-pro-image-preview

# Third fallback image generation model.
GEMINI_IMAGE_ENDPOINT_3=gemini-2.5-flash-image

# ──────────────────────────────────────────────────────────────
# AI Model Endpoints (Text/Analysis)
# ──────────────────────────────────────────────────────────────

# Model used for text analysis, layout critique, component detection,
# and other non-image-generation tasks. Gemini 2.5 Pro is recommended
# for its strong reasoning capability.
GEMINI_TEXT_ENDPOINT=gemini-2.5-pro

# ──────────────────────────────────────────────────────────────
# AI Model Endpoints (Layout/Campaign)
# ──────────────────────────────────────────────────────────────

# Model used for flex layout generation and campaign planning.
GEMINI_MODEL_ENDPOINT=gemini-3-flash-preview

# Optional second model for layout (leave empty to skip fallback).
GEMINI_MODEL_ENDPOINT_2=

# ──────────────────────────────────────────────────────────────
# AI Model Endpoints (Inpainting)
# ──────────────────────────────────────────────────────────────

# Model used to clean up backgrounds after component extraction.
# Must support EDIT_MODE_INPAINT_REMOVAL. Imagen 3.0 is currently
# the only model with this capability.
IMAGEN_EDIT_ENDPOINT=imagen-3.0-capability-001

# ──────────────────────────────────────────────────────────────
# Embedding Model
# ──────────────────────────────────────────────────────────────

# Used to generate vector embeddings for reference image similarity search.
GEMINI_EMBEDDING_MODEL=gemini-embedding-001

# Dimensionality of embedding vectors. Higher = more precise but more storage.
# 3072 is the default for gemini-embedding-001.
GEMINI_EMBEDDING_DIMENSIONS=3072
```

### 6. Font Assets

The application renders Thai text in SVG overlays using the **Kanit** font family. These font files must be present for the SVG builder and AI critique loop to work correctly. Without them, Thai characters render as empty boxes (`[]`).

The fonts should already be in the repository at `backend-python/assets/fonts/`:

```
backend-python/assets/fonts/
  Kanit-Regular.ttf   (weight 400)
  Kanit-Bold.ttf      (weight 700)
  Kanit-Black.ttf     (weight 900)
```

If they are missing, download Kanit from [Google Fonts](https://fonts.google.com/specimen/Kanit):

1. Go to [fonts.google.com/specimen/Kanit](https://fonts.google.com/specimen/Kanit)
2. Click "Download family"
3. Extract the ZIP file
4. Copy `Kanit-Regular.ttf`, `Kanit-Bold.ttf`, and `Kanit-Black.ttf` into `backend-python/assets/fonts/`

### 7. Reference Images and Embeddings

Reference images allow the AI to learn from examples of well-designed ads. When generating a campaign layout, the system finds the most visually similar reference images and uses their style (colors, typography, composition) to guide the new layout.

**This step is optional.** The application works without reference images, but layout quality improves significantly with them.

#### Setting up reference images:

1. Create the directory (if it does not exist):

   ```bash
   mkdir -p backend-python/assets/ref_images
   ```

2. Place your example ad images in that directory. Supported formats: PNG, JPG, JPEG, WEBP.

3. Generate embeddings for the reference images by running the embedding script:

   ```bash
   cd backend-python
   source venv/bin/activate
   python scripts/embed_ref_images.py
   ```

   This script:
   - Reads every image in `assets/ref_images/`
   - Sends each image to the Gemini API to generate a text description and a 3072-dimensional embedding vector
   - Saves results incrementally to `assets/ref_images/embeddings.json`
   - Is safe to interrupt and resume (already-processed images are skipped)
   - Adds a 1-second delay between API calls to avoid rate limits

4. The resulting `embeddings.json` file looks like this:

   ```json
   [
     {
       "filename": "example_ad_01.png",
       "description": "A promotional banner with bold red headline...",
       "embedding": [0.0123, -0.0456, ...]
     }
   ]
   ```

**When to re-run:** Run the embedding script again any time you add or remove reference images. It will only process new images and clean up entries for deleted ones.

### 8. Footer Text (Optional)

You can include a standard disclaimer or footer text that automatically appears at the bottom of generated campaign layouts.

Create or edit the file `backend-python/assets/Ref_footer/footer.txt` with your disclaimer text. For example:

```
คำเตือน: การลงทุนมีความเสี่ยง ผู้ลงทุนควรทำความเข้าใจลักษณะสินค้า เงื่อนไขผลตอบแทน และความเสี่ยงก่อนตัดสินใจลงทุน
```

If this file exists, the flex layout engine will automatically add it as a footer element in the campaign layout.

### 9. Start the Backend Server

With the virtual environment activated and `.env` configured:

```bash
cd backend-python
source venv/bin/activate

# Development mode (auto-reloads on file changes):
python -m uvicorn app.main:app --reload --port 5001

# Production mode:
python -m uvicorn app.main:app --host 0.0.0.0 --port 5001
```

The server starts at `http://localhost:5001`.

**First startup is slow:** On the first request (or at startup), the RMBG-2.0 background removal model is downloaded and loaded into memory. This takes approximately 30 seconds and several GB of disk space. Subsequent starts are much faster because the model is cached locally.

You should see output like:

```
INFO:     Uvicorn running on http://127.0.0.1:5001 (Press CTRL+C to quit)
[ML] RMBG-2.0 system is ready and idle.
```

**Verify it is running:** Open `http://localhost:5001/` in your browser or use curl:

```bash
curl http://localhost:5001/
```

You should get:

```json
{
  "message": "Vertex AI Image Layer Separator API",
  "status": "online",
  "timestamp": "2026-03-16T12:00:00.000000+00:00"
}
```

---

## Frontend Setup (Vue 3)

The frontend lives in the `frontend/` directory. It is a Vue 3 Single Page Application built with Vite and TypeScript.

### 1. Install Frontend Dependencies

```bash
cd frontend
npm install
```

This installs:

| Package | Purpose |
|---------|---------|
| `vue` (3.5+) | UI framework |
| `dompurify` | Sanitizes HTML/SVG to prevent XSS |
| `vite` (7+) | Build tool and dev server |
| `typescript` (5.9+) | Type checking |
| `vue-tsc` | Vue-aware TypeScript compiler |
| `@vitejs/plugin-vue` | Vite plugin for Vue SFC support |

### 2. Configure the API URL

The frontend currently has the backend URL **hardcoded** to `http://localhost:5001` in the Vue component files. If your backend runs on a different host or port, you need to update it.

The URL appears in these files:
- `frontend/src/components/ImageGenerator.vue`
- `frontend/src/components/CampaignLayout.vue`
- `frontend/src/components/LayerEditor.vue`
- `frontend/src/components/AIRefinementPreview.vue`

If your backend is on `http://localhost:5001` (the default), no changes are needed.

### 3. Start the Frontend Dev Server

```bash
cd frontend
npm run dev
```

The dev server starts at `http://localhost:5173` (Vite's default port).

Open `http://localhost:5173` in your browser to use the application.

Other useful commands:

```bash
# Build for production (outputs to frontend/dist/)
npm run build

# Preview the production build locally
npm run preview
```

---

## Running Both Together

You need **two terminal windows** (or tabs) running simultaneously:

**Terminal 1 -- Backend:**

```bash
cd backend-python
source venv/bin/activate
python -m uvicorn app.main:app --reload --port 5001
```

**Terminal 2 -- Frontend:**

```bash
cd frontend
npm run dev
```

Then open `http://localhost:5173` in your browser.

The frontend (port 5173) makes HTTP requests and SSE connections to the backend (port 5001). CORS is configured to allow all origins in development, so cross-origin requests work out of the box.

---

## Project Structure

```
gen-image-layer-separator/
│
├── backend-python/                    # Primary backend (FastAPI + Python)
│   ├── app/
│   │   ├── main.py                    # FastAPI app entry point
│   │   │                              #   - CORS middleware (allow all origins)
│   │   │                              #   - Static file serving for /uploads
│   │   │                              #   - Request logging middleware
│   │   │                              #   - RMBG-2.0 warmup on startup
│   │   │                              #   - Health check endpoint at /
│   │   │
│   │   ├── config.py                  # Pydantic settings (reads from .env)
│   │   │
│   │   ├── constants/
│   │   │   ├── pipeline.py            # All thresholds, magic numbers, keyword lists
│   │   │   │                          #   (foreground detection ratio, min die-cut size,
│   │   │   │                          #    alpha cutoffs, grid sizes, etc.)
│   │   │   └── models.py             # Safety settings, model selection functions
│   │   │                              #   (get_text_model, get_text_model_best)
│   │   │
│   │   ├── prompts/                   # AI prompt templates (one file per domain)
│   │   │   ├── campaign_layout.py     # Component placement prompt + JSON schema
│   │   │   ├── flex_layout.py         # Flex tree generation prompt + style rules
│   │   │   ├── critique.py            # Art director critique prompt (PASS/FAIL)
│   │   │   ├── diecut.py              # Die-cut component generation prompt
│   │   │   ├── layout_strategy.py     # Layout planning strategy prompt
│   │   │   ├── render_campaign.py     # Final campaign image render prompt
│   │   │   ├── separate_layers.py     # Layer separation + component analysis prompts
│   │   │   └── describe.py            # Image description prompt (for embeddings)
│   │   │
│   │   ├── routes/
│   │   │   └── image.py               # Route definitions (maps URLs to controllers)
│   │   │
│   │   ├── controllers/
│   │   │   └── image.py               # Request handlers and SSE pipeline orchestration
│   │   │                              #   - create_campaign (SSE streaming)
│   │   │                              #   - generate_and_separate
│   │   │                              #   - process_image
│   │   │                              #   - suggest_campaign
│   │   │                              #   - render_campaign
│   │   │                              #   - export_svg_handler
│   │   │
│   │   ├── services/
│   │   │   └── vertex.py              # Google GenAI client + all AI method wrappers
│   │   │                              #   - generate_image (3-model fallback chain)
│   │   │                              #   - suggest_campaign_layout
│   │   │                              #   - suggest_flex_layout
│   │   │                              #   - critique_layout
│   │   │                              #   - generate_diecut_components
│   │   │                              #   - inpaint_background
│   │   │                              #   - run_rmbg_and_get_bboxes
│   │   │                              #   - describe_and_embed
│   │   │                              #   - with_retry (exponential backoff)
│   │   │
│   │   └── utils/
│   │       ├── flex_layout.py         # Flex tree -> absolute pixel positions
│   │       │                          #   - compute_flex_layout()
│   │       │                          #   - _strip_component_nodes()
│   │       │                          #   - Handles AI quirks (string gap, dict padding)
│   │       │
│   │       ├── svg_builder.py         # SVG generation with base64 font embedding
│   │       │                          #   - build_flex_svg()
│   │       │                          #   - Kanit @font-face injection
│   │       │                          #   - Rounded rect CTA buttons
│   │       │
│   │       ├── text_measure.py        # Pillow-based font measurement
│   │       ├── safe_zones.py          # Bounding box safe zone computation
│   │       ├── ref_image_search.py    # Reference image cosine similarity search
│   │       │                          #   - find_similar_refs()
│   │       │                          #   - extract_style_guide()
│   │       └── ai_logger.py           # AI call trace logging (logs/ai-trace.md)
│   │
│   ├── assets/
│   │   ├── fonts/                     # Kanit TTF files (Regular, Bold, Black)
│   │   ├── ref_images/                # Reference ad images + embeddings.json
│   │   └── Ref_footer/                # Footer disclaimer text (footer.txt)
│   │
│   ├── scripts/
│   │   └── embed_ref_images.py        # Batch embedding script for reference images
│   │
│   ├── uploads/                       # Runtime file storage (auto-created, gitignored)
│   ├── logs/                          # AI trace logs (auto-created)
│   ├── tests/                         # pytest test suite
│   ├── pyproject.toml                 # Python project config and dependencies
│   ├── .env.example                   # Environment variable template
│   └── .env                           # Your environment variables (not committed)
│
├── frontend/                          # Vue 3 + TypeScript SPA
│   ├── src/
│   │   ├── main.ts                    # App entry point
│   │   ├── App.vue                    # Root component with tab navigation
│   │   │                              #   - Manages sharedBackgroundUrl
│   │   │                              #   - Manages sharedCampaignData
│   │   │                              #   - Three tabs: generate, campaign, editor
│   │   │
│   │   └── components/
│   │       ├── ImageGenerator.vue     # Tab 1: Background generation from prompt
│   │       ├── CampaignLayout.vue     # Tab 2: Campaign creation interface
│   │       ├── AIRefinementPreview.vue # AI-powered layout preview and refinement
│   │       │                          #   (SSE client for /create-campaign)
│   │       └── LayerEditor.vue        # Tab 3: Canvas-based layer editor
│   │                                  #   (drag, resize, reorder layers)
│   │
│   ├── public/                        # Static assets
│   ├── index.html                     # HTML entry point (loads Google Fonts)
│   ├── vite.config.ts                 # Vite configuration
│   ├── package.json                   # Node.js dependencies
│   ├── tsconfig.json                  # TypeScript configuration
│   └── tsconfig.app.json             # App-specific TS config
│
├── backend/                           # Original Express.js backend (legacy, not used)
├── CLAUDE.md                          # AI coding assistant instructions
└── README.md                          # This file
```

---

## Key Features Explained

### Background Generation

The Image Generator tab lets you type a natural language prompt to generate a background image. The backend uses a **3-model fallback chain**:

1. **Gemini 3.1 Flash** (fastest, latest preview) -- tried first
2. **Gemini 3 Pro** (higher quality) -- if the first fails
3. **Gemini 2.5 Flash** -- last resort

You can also upload reference images to guide the generation and select an aspect ratio (default 3:4).

### Campaign Pipeline (SSE)

The `/create-campaign` endpoint runs a multi-stage pipeline and streams progress updates to the frontend via **Server-Sent Events (SSE)**. This allows the UI to show real-time progress without polling.

The pipeline stages:

```
1. RMBG Prescan
   └── Run background removal to detect foreground subjects
   └── Foreground Gate: if <5% opaque pixels → skip component extraction

2. Component Placement (AI)
   └── AI identifies visual components IN the uploaded image
   └── Only lists elements actually visible, NOT from the brief text

3. Die-cut + Inpaint
   └── Extract components from image (quality gate: min 40px, >5% opaque)
   └── Inpaint the background to clean up where components were removed

4. Layout Strategy (AI)
   └── Plan where components and text should be placed

5. Flex Layout (AI)
   └── Generate a flex tree structure → converted to absolute pixel positions
   └── Strip hallucinated component nodes if none were actually extracted
   └── Enforce minimum 40px height for text nodes

6. SVG Render
   └── Generate SVG with embedded Kanit fonts
   └── Rounded rectangles for CTA buttons, semi-transparent backgrounds

7. Critique Loop (AI Art Director)
   └── Composite SVG onto the image → AI reviews the result
   └── If FAIL → refine the flex tree → re-render → re-critique
   └── If PASS → return the final result
```

SSE events sent to the frontend: `progress`, `background_ready`, `iteration_start`, `critique_complete`, `iteration_end`, `done`, `error`.

### Layer Editor

A canvas-based editor (Tab 3) that lets you manually adjust every layer of the generated campaign:

- Drag layers to reposition them
- Resize layers
- Change stacking order (bring to front, send to back)
- Process additional images through layer separation
- Render text overlays with AI assistance

### Background Removal (RMBG-2.0)

The backend uses **RMBG-2.0** from the Hugging Face `transformers` library for local background removal. Key details:

- The model is loaded once at server startup and kept in memory as a singleton
- First load downloads the model (~several hundred MB) and takes around 30 seconds
- Subsequent calls are fast (milliseconds on GPU, seconds on CPU)
- A fallback to `rembg` (ONNX-based) exists if RMBG-2.0 fails

### Flex Layout Engine

The flex layout engine (`app/utils/flex_layout.py`) converts an AI-generated flex tree into absolute pixel positions. The AI generates a tree like:

```json
{
  "direction": "column",
  "children": [
    { "type": "text", "role": "headline", "text": "Big Sale!", "flex": 2 },
    { "type": "text", "role": "body", "text": "50% off everything", "flex": 1 },
    { "type": "text", "role": "cta", "text": "Shop Now", "flex": 1 }
  ]
}
```

The engine then:
- Resolves flex ratios to actual pixel heights/widths
- Handles the AI returning gap/padding as a string, dict, or int (defensive parsing)
- Enforces a minimum 40px height for text nodes so nothing is unreadable
- Strips hallucinated component nodes (nodes referencing die-cut components that do not exist)
- Redistributes freed space to sibling nodes

### SVG Builder with Thai Font Support

The SVG builder (`app/utils/svg_builder.py`) generates SVG markup with Kanit font files embedded as **base64 `@font-face`** declarations. This is required because:

- The `cairosvg` library (used to rasterize SVG to PNG for the AI critique loop) cannot access system fonts or Google Fonts URLs
- Without embedded fonts, Thai characters render as empty boxes (`[]`), which breaks the AI's ability to judge readability

### AI Critique Loop

After rendering the layout as SVG, the pipeline composites it onto the background image and sends the result to an "AI Art Director" for critique. The AI checks:

- Text readability and contrast
- Visual hierarchy
- Overall composition

If the critique returns FAIL, the system refines the flex tree and re-renders. This loop runs up to a configurable number of iterations.

When no die-cut components exist (e.g., the image is a pure background), the critique prompt is adjusted to NOT fail for missing visual elements -- it only judges text quality.

### Reference Image Style Matching

When reference ad images are available (in `assets/ref_images/` with computed embeddings), the system:

1. Generates an embedding for the user's uploaded image
2. Finds the top 3 most similar reference images via cosine similarity
3. Extracts a style guide from the reference descriptions (color palette, layout patterns, typography)
4. Sends the reference images, descriptions, and style guide to the layout AI
5. The AI matches the "visual DNA" of the references in the new layout

### Anti-Hallucination System

The AI sometimes invents components that do not exist in the image or generates placeholder text. The system has a four-layer defense:

| Layer | Mechanism | Where |
|-------|-----------|-------|
| RMBG Gate | If foreground is <5% of the image, skip component detection entirely | `controllers/image.py` |
| Prompt Hardening | Prompts explicitly say "only list visually present components" and "do NOT create text for visual elements" | `prompts/*.py` |
| Component Node Strip | `_strip_component_nodes()` removes flex tree nodes referencing components when no die-cuts were actually extracted | `utils/flex_layout.py` |
| Placeholder Text Strip | `_is_placeholder_text()` removes text nodes containing bracket patterns like `[Logo]` or visual element descriptions | `controllers/image.py` |

---

## API Endpoints

All endpoints are prefixed with `/api/image`. The base URL is `http://localhost:5001`.

### `GET /`

Health check. Returns server status.

**Response:**
```json
{
  "message": "Vertex AI Image Layer Separator API",
  "status": "online",
  "timestamp": "2026-03-16T12:00:00+00:00"
}
```

---

### `POST /api/image/generate`

Generate a background image from a text prompt.

**Content-Type:** `multipart/form-data` or `application/json`

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `prompt` | string | Yes | Natural language description of the image to generate |
| `aspect_ratio` | string | No | Aspect ratio (default: `3:4`). Options include `1:1`, `3:4`, `4:3`, `9:16`, `16:9` |
| `resolution` | string | No | Target resolution (e.g., `1024x1024`) |
| `images` | File[] | No | Reference images to guide the generation |

**Response:** JSON with `imageUrl` (relative path to the generated image).

---

### `POST /api/image/process`

Analyze an image and separate it into layers (text, visual components, background).

**Content-Type:** `multipart/form-data`

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `image` | File | Yes | The source image to analyze |
| `background` | File | No | A pre-separated background image |
| `hintText` | string | No | Hint text to help with text extraction |
| `mode` | string | No | Set to `only_bg_comp` to skip text separation |

**Response:** JSON with separated layers, text content, and component information.

---

### `POST /api/image/add-text`

Get AI-generated text placement suggestions for an image.

**Content-Type:** `multipart/form-data` or `application/json`

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `image` | File | Yes | The image to add text to |
| `text` | string | No | The text content to place |

**Response:** JSON with suggested text positions and styling.

---

### `POST /api/image/render-text`

Render text onto an image using AI.

**Content-Type:** `multipart/form-data` or `application/json`

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `image` | File | Conditional | The base image |
| `background` | File | No | Background image |
| `rendered_image` | File | No | Previously rendered image |
| `suggestions` | string | No | JSON string of text placement suggestions |
| `mode` | string | No | Render mode (default: `ai`) |

**Response:** JSON with rendered image URL.

---

### `POST /api/image/create-campaign`

Full campaign generation pipeline. Returns **Server-Sent Events (SSE)**.

**Content-Type:** `multipart/form-data` or `application/json`

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `image` | File or base64 string | Yes | The reference/product image |
| `text` | string | Yes | Campaign brief (headlines, body text, CTA, etc.) |
| `background` | File | No | Custom background image (otherwise AI generates one) |
| `mode` | string | No | Set to `only_bg_comp` for components only |
| `noGoZones` | JSON string | No | Areas to avoid placing text (array of bounding boxes) |

**SSE Event Types:**

| Event | Description |
|-------|-------------|
| `progress` | Status update with a message string |
| `background_ready` | Background image URL is available |
| `iteration_start` | A layout iteration has begun |
| `critique_complete` | AI critique result (PASS or FAIL with feedback) |
| `iteration_end` | A layout iteration has finished |
| `done` | Pipeline complete, final result payload |
| `error` | An error occurred, includes error message |

---

### `POST /api/image/export-svg`

Export a campaign layout as SVG.

**Content-Type:** `multipart/form-data`

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `background` | File | No | Background image to embed |
| `svgString` | string | No | SVG markup to process |
| `mode` | string | No | Export mode (default: `embed-fonts`) |
| `includeBackground` | string | No | Whether to embed background in SVG (`true`/`false`) |

**Response:** SVG file or JSON with SVG URL.

---

## Troubleshooting

### Backend fails to start with "ModuleNotFoundError"

Make sure you activated the virtual environment and installed dependencies:

```bash
cd backend-python
source venv/bin/activate
pip install -e ".[dev]"
```

### 404 errors from Gemini API

The Gemini 3 preview models **require** `GOOGLE_CLOUD_LOCATION=global`. If you set it to a specific region like `us-central1`, you will get 404 errors. Check your `.env` file:

```bash
GOOGLE_CLOUD_LOCATION=global
```

### Thai text renders as empty boxes `[]`

The Kanit font files are missing or incorrectly placed. Verify they exist:

```bash
ls backend-python/assets/fonts/
# Should show: Kanit-Regular.ttf  Kanit-Bold.ttf  Kanit-Black.ttf
```

### RMBG-2.0 model download is stuck or fails

The model downloads from Hugging Face on first use. If your network is slow or blocks Hugging Face:

- Check your internet connection
- Try setting the `HF_HOME` environment variable to control where models are cached
- The download is approximately several hundred MB

### "429 Too Many Requests" from Google API

The backend has built-in retry logic with exponential backoff (3 retries, starting at 2 seconds). If you consistently hit rate limits:

- Reduce the frequency of requests
- Check your Google Cloud API quotas in the console
- Consider requesting a quota increase

### CORS errors in the browser

The backend allows all origins by default (`allow_origins=["*"]`). If you still see CORS errors:

- Make sure the backend is actually running on port 5001
- Check that you are accessing the frontend via `http://localhost:5173`, not opening the HTML file directly

### "cairosvg" import error or SVG rendering fails

You need the Cairo system library installed:

```bash
# Ubuntu/Debian/WSL:
sudo apt install -y libcairo2-dev

# macOS:
brew install cairo
```

### Frontend shows "Failed to fetch" or network errors

- Verify the backend is running: `curl http://localhost:5001/`
- Check that the port in the frontend code matches your backend port (default: 5001)
- Check your browser's developer tools (F12) Network tab for details

### PyTorch/CUDA errors

If you see CUDA-related errors but do not have a GPU:

- PyTorch should automatically fall back to CPU. If it does not, install the CPU-only version:
  ```bash
  pip install torch --index-url https://download.pytorch.org/whl/cpu
  ```

### Private key format issues in .env

The private key must have `\n` (literal backslash-n) where newlines appear, wrapped in double quotes:

```bash
GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY="-----BEGIN PRIVATE KEY-----\nMIIEvg...\n-----END PRIVATE KEY-----\n"
```

Do NOT paste the key with actual newlines. The `\n` sequences are converted to real newlines by the dotenv loader.

---

## Development Workflow

### Running Tests

```bash
cd backend-python
source venv/bin/activate

# Run all tests
pytest

# Run with verbose output
pytest -v

# Run a specific test file
pytest tests/test_flex_layout.py

# Run a specific test function
pytest tests/test_flex_layout.py::test_compute_flex_layout_basic
```

### Linting and Formatting

The project uses [Ruff](https://docs.astral.sh/ruff/) for linting and formatting (configured in `pyproject.toml` with a 120-character line length):

```bash
cd backend-python
source venv/bin/activate

# Check for lint errors
ruff check .

# Auto-fix lint errors
ruff check --fix .

# Format code
ruff format .
```

### Editing AI Prompts

All AI prompts are in `backend-python/app/prompts/`. Each file contains a builder function that returns the prompt string. To change AI behavior:

| File | What it Controls |
|------|-----------------|
| `campaign_layout.py` | How the AI detects and places visual components |
| `flex_layout.py` | How the AI generates the flex tree (text sizing, spacing, style rules) |
| `critique.py` | What the AI Art Director checks during critique (readability, contrast, hierarchy) |
| `diecut.py` | How die-cut components are extracted/generated |
| `layout_strategy.py` | High-level layout planning strategy |
| `render_campaign.py` | How the final campaign image is rendered |
| `separate_layers.py` | How the AI separates image layers and analyzes components |
| `describe.py` | How reference images are described for embeddings |

**Do not** edit prompts inside `vertex.py`. The service file only wires prompts to API calls.

### Editing Thresholds and Constants

All magic numbers (alpha cutoffs, minimum sizes, ratios, keyword lists) are centralized in `backend-python/app/constants/pipeline.py`. If you want to change, for example, the minimum die-cut size or the foreground detection threshold, edit that file.

### AI Trace Logging

Every AI call is logged to `backend-python/logs/ai-trace.md` via the `ai_logger.py` utility. This is useful for debugging prompt responses, understanding what the AI saw, and tracking API usage.

### Adding New Endpoints

1. Add a handler function in `backend-python/app/controllers/image.py`
2. Add a route in `backend-python/app/routes/image.py` that maps a URL to your handler
3. If you need new AI capabilities, add methods to `backend-python/app/services/vertex.py`
4. If you need new prompts, create a new file in `backend-python/app/prompts/`

### Building the Frontend for Production

```bash
cd frontend
npm run build
```

This outputs static files to `frontend/dist/`. You can serve them with any static file server (nginx, Caddy, etc.) or configure the FastAPI backend to serve them.
