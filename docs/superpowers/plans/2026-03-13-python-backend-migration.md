# Python Backend Migration — Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the Express.js/TypeScript backend with a Python/FastAPI backend, preserving all API contracts so the Vue frontend works unchanged.

**Architecture:** FastAPI app mirroring the current 6 endpoints with identical request/response shapes. Same monorepo layout (`backend-python/` alongside existing `backend/`). Google GenAI Python SDK replaces `@google/genai` Node SDK. Pillow + fonttools replace sharp + opentype.js. HuggingFace transformers (native Python) replaces the Node ONNX bridge.

**Tech Stack:** Python 3.11+, FastAPI, Uvicorn, google-genai, Pillow, fonttools, transformers (HuggingFace), numpy, aiofiles

---

## File Structure

```
backend-python/
├── pyproject.toml              # Dependencies, project metadata
├── .env                        # Same env vars as Node backend
├── requirements.txt            # Pinned deps (generated from pyproject.toml)
├── assets/
│   ├── fonts/                  # Kanit TTF files (symlink or copy from backend/assets/fonts/)
│   └── ref_images/             # Reference images + embeddings.json
├── uploads/                    # Runtime upload directory
├── logs/                       # AI trace logs
├── app/
│   ├── __init__.py
│   ├── main.py                 # FastAPI app, CORS, static files, startup
│   ├── config.py               # Environment variables, settings
│   ├── routes/
│   │   ├── __init__.py
│   │   └── image.py            # All /api/image/* endpoints
│   ├── controllers/
│   │   ├── __init__.py
│   │   └── image.py            # Request handlers (process, generate, campaign, etc.)
│   ├── services/
│   │   ├── __init__.py
│   │   └── vertex.py           # AI service (Gemini, RMBG, image gen)
│   └── utils/
│       ├── __init__.py
│       ├── flex_layout.py      # Flex-tree layout engine
│       ├── svg_builder.py      # SVG generation (text + flex)
│       ├── text_measure.py     # Font metrics, wrap, auto-fit (fonttools)
│       ├── safe_zones.py       # Safe zone computation
│       ├── ref_image_search.py # Reference image cosine similarity
│       └── ai_logger.py        # AI trace logging
└── tests/
    ├── __init__.py
    ├── conftest.py             # Shared fixtures
    ├── test_flex_layout.py     # Flex-tree layout tests
    ├── test_text_measure.py    # Font metrics tests
    ├── test_svg_builder.py     # SVG builder tests
    ├── test_safe_zones.py      # Safe zone computation tests
    ├── test_ref_image_search.py
    ├── test_controllers.py     # Integration tests (FastAPI TestClient)
    └── test_vertex_service.py  # Service unit tests (mocked AI)
```

## Deprecated Code — DO NOT PORT

These methods exist in the Node backend but are marked `@deprecated` and only appear in commented-out code in the controller. **Skip them entirely:**

- `suggestLayoutSVG()`
- `suggestLayoutIntent()`
- `suggestLayoutHTML()`
- `refineLayoutSVG()`
- `refineLayoutHTML()`
- `refineLayout()`

## Active Methods to Port

### AIService (vertex.service.ts → vertex.py)
| Node Method | Python Function | Notes |
|---|---|---|
| `generateImage()` | `generate_image()` | Model fallback chain |
| `renderCampaignImage()` | `render_campaign_image()` | Gemini image gen |
| `planLayoutStrategy()` | `plan_layout_strategy()` | Still used in controller despite @deprecated tag |
| `suggestCampaignLayout()` | `suggest_campaign_layout()` | Component placement |
| `generateLayoutPreview()` | `generate_layout_preview()` | Sharp composite → Pillow |
| `critiqueLayout()` | `critique_layout()` | AI critique |
| `suggestFlexLayout()` | `suggest_flex_layout()` | Core flex-tree pipeline |
| `separateLayers()` | `separate_layers()` | Text extraction |
| `analyzeComponents()` | `analyze_components()` | Component identification |
| `generateDiecutComponents()` | `generate_diecut_components()` | Die-cut PNG generation |
| `inpaintBackground()` | `inpaint_background()` | Imagen 3 inpainting |
| `runRMBGAndGetBboxes()` | `run_rmbg_and_get_bboxes()` | RMBG + bbox |
| `extractComponentStrokeBboxes()` | `extract_component_stroke_bboxes()` | Stroke bbox |
| `renderSimpleComposite()` | `render_simple_composite()` | Simple composite |
| `warmupRMBG2()` | `warmup_rmbg2()` | Model warmup |
| `exportSVG()` | `export_svg()` | SVG export |
| `describeAndEmbed()` | `describe_and_embed()` | Image embedding |
| `withRetry()` | `with_retry()` | Exponential backoff |
| `_removeBgRMBG2()` | `_remove_bg_rmbg2()` | ONNX bg removal |
| `_cropAndDiecut()` | `_crop_and_diecut()` | Crop + cleanup |
| `_generateSingleDiecut()` | `_generate_single_diecut()` | Single component gen |
| `_extractComponentByFloodFill()` | `_extract_component_by_flood_fill()` | Pixel flood fill |
| `_removeBgFullImage()` | `_remove_bg_full_image()` | Full image bg removal — uses `rembg` library (replaces `@imgly/background-removal-node`) |
| `validateFlexTree()` | `validate_flex_tree()` | Tree validation |

### Utilities
| Node File | Python File | Key Change |
|---|---|---|
| `flexLayout.ts` | `flex_layout.py` | Direct port, dataclasses |
| `svgBuilder.ts` | `svg_builder.py` | Direct port |
| `textMeasure.ts` | `text_measure.py` | opentype.js → fonttools |
| `safeZones.ts` | `safe_zones.py` | Direct port |
| `refImageSearch.ts` | `ref_image_search.py` | Direct port, numpy for cosine |
| `ai-logger.ts` | `ai_logger.py` | Direct port |

### Controller Endpoints
| Route | Method | Handler | SSE? |
|---|---|---|---|
| `POST /api/image/process` | multipart | `process_image()` | No |
| `POST /api/image/generate` | multipart | `generate_and_separate()` | No |
| `POST /api/image/add-text` | multipart | `suggest_campaign()` | No |
| `POST /api/image/render-text` | multipart | `render_campaign()` | No |
| `POST /api/image/create-campaign` | multipart | `create_campaign()` | **Yes** |
| `POST /api/image/export-svg` | multipart | `export_svg()` | No |

---

## Chunk 1: Project Scaffolding & Configuration

### Task 1.1: Create project structure and dependencies

**Files:**
- Create: `backend-python/pyproject.toml`
- Create: `backend-python/requirements.txt`
- Create: `backend-python/app/__init__.py`
- Create: `backend-python/app/config.py`
- Create: `backend-python/tests/__init__.py`
- Create: `backend-python/tests/conftest.py`

- [ ] **Step 1: Create pyproject.toml**

```toml
[project]
name = "gen-image-layer-separator"
version = "1.0.0"
requires-python = ">=3.11"
dependencies = [
    "fastapi>=0.115.0",
    "uvicorn[standard]>=0.32.0",
    "python-multipart>=0.0.18",
    "python-dotenv>=1.1.0",
    "pydantic-settings>=2.6.0",
    "google-genai>=1.10.0",
    "Pillow>=11.0.0",
    "fonttools>=4.55.0",
    "transformers>=4.47.0",
    "torch>=2.5.0",
    "numpy>=2.1.0",
    "aiofiles>=24.1.0",
    "rembg>=2.0.0",
]

[project.optional-dependencies]
dev = [
    "pytest>=8.3.0",
    "pytest-asyncio>=0.24.0",
    "httpx>=0.28.0",
    "ruff>=0.8.0",
]

[tool.pytest.ini_options]
asyncio_mode = "auto"
testpaths = ["tests"]

[tool.ruff]
line-length = 120
```

- [ ] **Step 2: Create config.py**

```python
from pydantic_settings import BaseSettings
from functools import lru_cache

class Settings(BaseSettings):
    port: int = 5001
    google_service_account_type: str = "service_account"
    google_service_account_project_id: str = ""
    google_service_account_private_key_id: str = ""
    google_service_account_private_key: str = ""
    google_service_account_client_email: str = ""
    google_service_account_client_id: str = ""
    google_cloud_location: str = "global"
    gemini_image_endpoint: str = "gemini-3.1-flash-image-preview"
    gemini_image_endpoint_2: str = "gemini-3-pro-image-preview"
    gemini_image_endpoint_3: str = "gemini-2.5-flash-image"
    gemini_text_endpoint: str = "gemini-2.5-pro"
    imagen_edit_endpoint: str = "imagen-3.0-capability-001"

    model_config = {"env_file": ".env", "env_file_encoding": "utf-8"}

@lru_cache
def get_settings() -> Settings:
    return Settings()
```

- [ ] **Step 3: Create conftest.py with FastAPI TestClient fixture**

```python
import pytest
from fastapi.testclient import TestClient
from app.main import app

@pytest.fixture
def client():
    return TestClient(app)
```

- [ ] **Step 4: Install dependencies**

Run: `cd backend-python && pip install -e ".[dev]"`
Expected: All packages install successfully

- [ ] **Step 5: Commit**

```bash
git add backend-python/
git commit -m "feat: scaffold Python backend with FastAPI project structure"
```

### Task 1.2: Create FastAPI app entry point

**Files:**
- Create: `backend-python/app/main.py`
- Create: `backend-python/app/routes/__init__.py`
- Create: `backend-python/app/routes/image.py` (empty router)
- Create: `backend-python/app/controllers/__init__.py`
- Create: `backend-python/app/services/__init__.py`
- Create: `backend-python/app/utils/__init__.py`

- [ ] **Step 1: Write the failing test**

```python
# tests/test_main.py
def test_health_check(client):
    resp = client.get("/")
    assert resp.status_code == 200
    data = resp.json()
    assert data["status"] == "online"
    assert "timestamp" in data
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd backend-python && python -m pytest tests/test_main.py -v`
Expected: FAIL (app module not found)

- [ ] **Step 3: Create main.py**

```python
from contextlib import asynccontextmanager
from datetime import datetime, timezone
from pathlib import Path

from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles

from app.config import get_settings

UPLOAD_DIR = Path(__file__).parent.parent / "uploads"
UPLOAD_DIR.mkdir(exist_ok=True)

@asynccontextmanager
async def lifespan(app: FastAPI):
    # Startup: warmup RMBG model
    from app.services.vertex import vertex_service
    try:
        await vertex_service.warmup_rmbg2()
        print("\n[ML] RMBG-2.0 system is ready and idle.")
    except Exception as e:
        print(f"\n[ML] Warmup failed: {e}")
    yield

app = FastAPI(lifespan=lifespan)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

app.mount("/uploads", StaticFiles(directory=str(UPLOAD_DIR)), name="uploads")

# Match Node backend: Content-Disposition: attachment on all uploads
@app.middleware("http")
async def add_upload_headers(request: Request, call_next):
    response = await call_next(request)
    if request.url.path.startswith("/uploads/"):
        response.headers["Content-Disposition"] = "attachment"
    return response

@app.get("/")
async def health_check():
    return {
        "message": "Vertex AI Image Layer Separator API",
        "status": "online",
        "timestamp": datetime.now(timezone.utc).isoformat(),
    }

# Import routes after app creation
from app.routes.image import router as image_router
app.include_router(image_router, prefix="/api/image")
```

- [ ] **Step 4: Create stub files** (empty `__init__.py` for all packages, stub router)

```python
# app/routes/image.py
from fastapi import APIRouter
router = APIRouter()
```

```python
# app/services/vertex.py
class VertexService:
    async def warmup_rmbg2(self):
        pass  # stub for now

vertex_service = VertexService()
```

- [ ] **Step 5: Run test to verify it passes**

Run: `cd backend-python && python -m pytest tests/test_main.py -v`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add backend-python/
git commit -m "feat: FastAPI app with health check, CORS, static files"
```

---

## Chunk 2: Core Utilities

### Task 2.1: Flex Layout Engine

**Files:**
- Create: `backend-python/app/utils/flex_layout.py`
- Create: `backend-python/tests/test_flex_layout.py`

- [ ] **Step 1: Write failing tests**

```python
# tests/test_flex_layout.py
import pytest
from app.utils.flex_layout import compute_flex_layout, FlexNode

def test_single_leaf():
    root = FlexNode(id="root", type="text", text="hello")
    boxes = compute_flex_layout(root, 1080, 1080)
    assert len(boxes) == 1
    assert boxes[0].id == "root"
    assert boxes[0].x == 0
    assert boxes[0].y == 0
    assert boxes[0].w == 1080
    assert boxes[0].h == 1080

def test_row_with_two_children():
    root = FlexNode(
        id="root",
        direction="row",
        children=[
            FlexNode(id="left", type="text", text="L", width="50%"),
            FlexNode(id="right", type="text", text="R", width="50%"),
        ],
    )
    boxes = compute_flex_layout(root, 1000, 500)
    assert len(boxes) == 2
    left = next(b for b in boxes if b.id == "left")
    right = next(b for b in boxes if b.id == "right")
    gap = 8  # default gap
    avail = 1000 - gap
    assert left.w == pytest.approx(avail * 0.5, abs=1)
    assert right.w == pytest.approx(avail * 0.5, abs=1)
    assert right.x > left.x

def test_column_with_padding():
    root = FlexNode(
        id="root",
        direction="column",
        padding=20,
        children=[
            FlexNode(id="top", type="text", text="T", height="60%"),
            FlexNode(id="bot", type="component", label="img", height="40%"),
        ],
    )
    boxes = compute_flex_layout(root, 500, 1000)
    assert len(boxes) == 2
    top = next(b for b in boxes if b.id == "top")
    assert top.x == 20  # padding
    assert top.y == 20

def test_unsized_children_share_remaining():
    root = FlexNode(
        id="root",
        direction="row",
        gap=0,
        children=[
            FlexNode(id="a", type="text", text="A", width="50%"),
            FlexNode(id="b", type="text", text="B"),  # no width
            FlexNode(id="c", type="text", text="C"),  # no width
        ],
    )
    boxes = compute_flex_layout(root, 1000, 100)
    a = next(b for b in boxes if b.id == "a")
    b = next(b for b in boxes if b.id == "b")
    c = next(b for b in boxes if b.id == "c")
    assert a.w == pytest.approx(500, abs=1)
    assert b.w == pytest.approx(250, abs=1)
    assert c.w == pytest.approx(250, abs=1)
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd backend-python && python -m pytest tests/test_flex_layout.py -v`
Expected: FAIL (module not found)

- [ ] **Step 3: Implement flex_layout.py**

```python
from __future__ import annotations
from dataclasses import dataclass, field
from typing import Literal

@dataclass
class FlexNodeStyle:
    fontSize: Literal["xlarge", "large", "medium", "small", "xsmall"] | None = None
    fontWeight: str | None = None
    color: str | None = None
    strokeColor: str | None = None
    strokeWidth: int | None = None
    align: Literal["left", "center", "right"] | None = None
    backgroundColor: str | None = None

@dataclass
class FlexNode:
    id: str
    direction: Literal["row", "column"] | None = None
    children: list[FlexNode] | None = None
    type: Literal["text", "component"] | None = None
    text: str | None = None
    label: str | None = None
    width: str | None = None
    height: str | None = None
    style: FlexNodeStyle | None = None
    gap: int | None = None
    padding: int | None = None

@dataclass
class LayoutBox:
    id: str
    type: Literal["text", "component"]
    x: float
    y: float
    w: float
    h: float
    text: str | None = None
    label: str | None = None
    style: FlexNodeStyle | None = None

def _parse_pct(value: str | None) -> float:
    if not value:
        return float("nan")
    trimmed = value.strip()
    if not trimmed.endswith("%"):
        return float("nan")
    try:
        return float(trimmed[:-1]) / 100
    except ValueError:
        return float("nan")

def compute_flex_layout(root: FlexNode, canvas_w: float, canvas_h: float) -> list[LayoutBox]:
    results: list[LayoutBox] = []
    _layout_node(root, 0, 0, canvas_w, canvas_h, results)
    return results

def _layout_node(node: FlexNode, x: float, y: float, w: float, h: float, out: list[LayoutBox]) -> None:
    is_container = node.direction is not None and isinstance(node.children, list)

    if not is_container:
        out.append(LayoutBox(
            id=node.id,
            type=node.type or "text",
            x=x, y=y, w=w, h=h,
            text=node.text,
            label=node.label,
            style=node.style,
        ))
        return

    children = node.children
    if not children:
        return

    gap = node.gap if node.gap is not None else 8
    padding = node.padding if node.padding is not None else 0

    inner_x = x + padding
    inner_y = y + padding
    inner_w = max(0, w - padding * 2)
    inner_h = max(0, h - padding * 2)

    is_row = node.direction == "row"
    main_size = inner_w if is_row else inner_h
    total_gap = gap * (len(children) - 1)
    available_main = max(0, main_size - total_gap)

    import math
    claimed_fraction = 0.0
    unsized_count = 0

    for child in children:
        pct = _parse_pct(child.width if is_row else child.height)
        if not math.isnan(pct):
            claimed_fraction += pct
        else:
            unsized_count += 1

    remaining_fraction = max(0, 1 - claimed_fraction)
    per_unsized = remaining_fraction / unsized_count if unsized_count > 0 else 0

    cursor = 0.0
    for i, child in enumerate(children):
        pct = _parse_pct(child.width if is_row else child.height)
        fraction = per_unsized if math.isnan(pct) else pct
        child_main = fraction * available_main

        child_x = inner_x + cursor if is_row else inner_x
        child_y = inner_y if is_row else inner_y + cursor
        child_w = child_main if is_row else inner_w
        child_h = inner_h if is_row else child_main

        _layout_node(child, child_x, child_y, child_w, child_h, out)

        cursor += child_main
        if i < len(children) - 1:
            cursor += gap
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd backend-python && python -m pytest tests/test_flex_layout.py -v`
Expected: All PASS

- [ ] **Step 5: Commit**

```bash
git add backend-python/app/utils/flex_layout.py backend-python/tests/test_flex_layout.py
git commit -m "feat: port flex-tree layout engine to Python"
```

### Task 2.2: Text Measurement (fonttools)

**Files:**
- Create: `backend-python/app/utils/text_measure.py`
- Create: `backend-python/tests/test_text_measure.py`
- Symlink or copy: `backend-python/assets/fonts/` ← `backend/assets/fonts/`

- [ ] **Step 1: Copy font assets**

```bash
cp -r backend/assets/fonts backend-python/assets/fonts
```

- [ ] **Step 2: Write failing tests**

```python
# tests/test_text_measure.py
from app.utils.text_measure import measure_text, wrap_text, auto_fit_font_size

def test_measure_text_returns_positive():
    m = measure_text("Hello", 48, "400")
    assert m.width > 0
    assert m.height > 0
    assert m.ascent > 0

def test_wrap_text_single_line():
    result = wrap_text("Short", 500, 32, "400")
    assert len(result.lines) == 1
    assert result.lines[0] == "Short"

def test_wrap_text_wraps_long():
    result = wrap_text("This is a fairly long text that should wrap", 100, 24, "400")
    assert len(result.lines) > 1

def test_auto_fit_shrinks():
    result = auto_fit_font_size("Very long promo text here!!", 200, 120, 12, "700")
    assert result.font_size <= 120
    assert result.width <= 200
```

- [ ] **Step 3: Run to verify failure**

Run: `cd backend-python && python -m pytest tests/test_text_measure.py -v`

- [ ] **Step 4: Implement text_measure.py**

```python
from __future__ import annotations
from dataclasses import dataclass
from pathlib import Path
from fontTools.ttLib import TTFont

FONT_DIR = Path(__file__).parent.parent.parent / "assets" / "fonts"

FONT_FILES = {"400": "Kanit-Regular.ttf", "700": "Kanit-Bold.ttf", "900": "Kanit-Black.ttf"}
WEIGHT_ALIASES = {"normal": "400", "regular": "400", "bold": "700", "black": "900"}

_font_cache: dict[str, TTFont] = {}

def _get_font(weight: str = "400") -> TTFont:
    normalized = WEIGHT_ALIASES.get(weight.lower(), weight)
    w = normalized if normalized in FONT_FILES else "400"
    if w not in _font_cache:
        _font_cache[w] = TTFont(str(FONT_DIR / FONT_FILES[w]))
    return _font_cache[w]

def _glyph_width(font: TTFont, text: str, font_size: float) -> float:
    cmap = font.getBestCmap()
    glyf = font["hmtx"]
    units_per_em = font["head"].unitsPerEm
    total = 0
    for ch in text:
        gid = cmap.get(ord(ch))
        if gid:
            total += glyf[gid][0]
        else:
            total += units_per_em * 0.5  # fallback for missing glyphs
    return total * font_size / units_per_em

@dataclass
class TextMetrics:
    width: float
    height: float
    ascent: float
    descent: float

def measure_text(text: str, font_size: float, font_weight: str = "400") -> TextMetrics:
    font = _get_font(font_weight)
    width = _glyph_width(font, text, font_size)
    units_per_em = font["head"].unitsPerEm
    os2 = font["OS/2"]
    ascent = os2.sTypoAscender * font_size / units_per_em
    descent = abs(os2.sTypoDescender) * font_size / units_per_em
    return TextMetrics(width=width, height=ascent + descent, ascent=ascent, descent=descent)

@dataclass
class WrapResult:
    lines: list[str]
    line_height: float
    total_height: float

def wrap_text(text: str, max_width: float, font_size: float, font_weight: str = "400") -> WrapResult:
    line_height = font_size * 1.35
    lines: list[str] = []

    for paragraph in text.split("\n"):
        if not paragraph:
            lines.append("")
            continue

        if measure_text(paragraph, font_size, font_weight).width <= max_width:
            lines.append(paragraph)
            continue

        words = paragraph.split()
        current_line = ""
        for word in words:
            candidate = f"{current_line} {word}" if current_line else word
            if measure_text(candidate, font_size, font_weight).width <= max_width:
                current_line = candidate
            else:
                if current_line:
                    lines.append(current_line)
                if measure_text(word, font_size, font_weight).width <= max_width:
                    current_line = word
                else:
                    # character-level break
                    char_line = ""
                    for ch in word:
                        if measure_text(char_line + ch, font_size, font_weight).width <= max_width:
                            char_line += ch
                        else:
                            if char_line:
                                lines.append(char_line)
                            char_line = ch
                    current_line = char_line
        if current_line:
            lines.append(current_line)

    return WrapResult(lines=lines, line_height=line_height, total_height=len(lines) * line_height)

@dataclass
class AutoFitResult:
    font_size: int
    width: float

def auto_fit_font_size(text: str, max_width: float, max_font_size: int, min_font_size: int, font_weight: str = "400") -> AutoFitResult:
    lo, hi = min_font_size, max_font_size
    best_size = min_font_size
    best_width = measure_text(text, min_font_size, font_weight).width

    while hi - lo >= 1:
        mid = (lo + hi) // 2
        w = measure_text(text, mid, font_weight).width
        if w <= max_width:
            best_size = mid
            best_width = w
            lo = mid + 1
        else:
            hi = mid - 1

    return AutoFitResult(font_size=best_size, width=best_width)
```

- [ ] **Step 5: Run tests**

Run: `cd backend-python && python -m pytest tests/test_text_measure.py -v`
Expected: All PASS

- [ ] **Step 6: Commit**

```bash
git add backend-python/app/utils/text_measure.py backend-python/tests/test_text_measure.py backend-python/assets/
git commit -m "feat: port text measurement to Python using fonttools"
```

### Task 2.3: Safe Zones

**Files:**
- Create: `backend-python/app/utils/safe_zones.py`
- Create: `backend-python/tests/test_safe_zones.py`

- [ ] **Step 1: Write failing tests**

```python
# tests/test_safe_zones.py
from app.utils.safe_zones import compute_safe_zones, assign_text_to_zones, BBox

def test_no_obstacles_returns_full_canvas():
    zones = compute_safe_zones([])
    assert len(zones) == 1
    assert zones[0].area == 1000 * 1000

def test_center_obstacle_creates_multiple_zones():
    obs = [BBox(top=400, left=400, width=200, height=200)]
    zones = compute_safe_zones(obs)
    assert len(zones) >= 2
    for z in zones:
        assert z.width >= 150
        assert z.height >= 50

def test_small_zones_filtered_out():
    obs = [BBox(top=0, left=0, width=950, height=950)]
    zones = compute_safe_zones(obs)
    for z in zones:
        assert z.width >= 150
        assert z.height >= 50
```

- [ ] **Step 2: Run to verify failure**

Run: `cd backend-python && python -m pytest tests/test_safe_zones.py -v`

- [ ] **Step 3: Implement safe_zones.py** — direct port from `safeZones.ts`, using dataclasses for `BBox`, `SafeZone`, `TextSuggestion`.

- [ ] **Step 4: Run tests**

Run: `cd backend-python && python -m pytest tests/test_safe_zones.py -v`
Expected: All PASS

- [ ] **Step 5: Commit**

```bash
git add backend-python/app/utils/safe_zones.py backend-python/tests/test_safe_zones.py
git commit -m "feat: port safe zone computation to Python"
```

### Task 2.4: SVG Builder

**Files:**
- Create: `backend-python/app/utils/svg_builder.py`
- Create: `backend-python/tests/test_svg_builder.py`

- [ ] **Step 1: Write failing tests**

```python
# tests/test_svg_builder.py
from app.utils.svg_builder import build_flex_svg, FlexSVGInput
from app.utils.flex_layout import LayoutBox, FlexNodeStyle

def test_build_flex_svg_with_text_box():
    boxes = [LayoutBox(id="t1", type="text", x=100, y=100, w=400, h=200,
                       text="Hello", style=FlexNodeStyle(fontSize="large", color="#FFF"))]
    result = build_flex_svg(FlexSVGInput(boxes=boxes, canvas_w=1080, canvas_h=1080))
    assert "<svg" in result.svg
    assert "</svg>" in result.svg
    assert "Hello" in result.svg

def test_build_flex_svg_with_bg_image():
    boxes = []
    result = build_flex_svg(FlexSVGInput(
        boxes=boxes, canvas_w=1080, canvas_h=1080,
        bg_image_url="http://localhost:5001/uploads/bg.png",
    ))
    assert "bg.png" in result.svg

def test_build_flex_svg_with_component():
    boxes = [LayoutBox(id="c1", type="component", x=0, y=0, w=500, h=500, label="mascot")]
    imgs = {"mascot": "http://localhost/img.png"}
    result = build_flex_svg(FlexSVGInput(boxes=boxes, canvas_w=1080, canvas_h=1080, component_images=imgs))
    assert "img.png" in result.svg
```

- [ ] **Step 2: Run to verify failure**
- [ ] **Step 3: Implement svg_builder.py** — port `buildSVG()`, `buildFlexSVG()`, and `renderTextBox()` from `svgBuilder.ts`. Uses `text_measure.py` for font metrics.
- [ ] **Step 4: Run tests**
- [ ] **Step 5: Commit**

```bash
git add backend-python/app/utils/svg_builder.py backend-python/tests/test_svg_builder.py
git commit -m "feat: port SVG builder to Python"
```

### Task 2.5: Reference Image Search & AI Logger

**Files:**
- Create: `backend-python/app/utils/ref_image_search.py`
- Create: `backend-python/app/utils/ai_logger.py`
- Create: `backend-python/tests/test_ref_image_search.py`

- [ ] **Step 1: Write test for cosine similarity**

```python
# tests/test_ref_image_search.py
import pytest
from app.utils.ref_image_search import cosine_similarity

def test_cosine_identical():
    assert cosine_similarity([1, 0, 0], [1, 0, 0]) == pytest.approx(1.0)

def test_cosine_orthogonal():
    assert cosine_similarity([1, 0], [0, 1]) == pytest.approx(0.0)
```

- [ ] **Step 2: Implement ref_image_search.py** — use `numpy.dot` for cosine similarity, `json.load` for embeddings index.
- [ ] **Step 3: Implement ai_logger.py** — direct port, `pathlib.Path` for file ops.
- [ ] **Step 4: Run tests**
- [ ] **Step 5: Commit**

```bash
git add backend-python/app/utils/ref_image_search.py backend-python/app/utils/ai_logger.py backend-python/tests/test_ref_image_search.py
git commit -m "feat: port ref image search and AI logger to Python"
```

---

## Chunk 3: AI Service (vertex.py)

This is the largest and most complex piece. Port in sub-sections.

### Task 3.1: GenAI Client Setup & Retry Logic

**Files:**
- Modify: `backend-python/app/services/vertex.py`
- Create: `backend-python/tests/test_vertex_service.py`

- [ ] **Step 1: Write test for retry logic**

```python
# tests/test_vertex_service.py
import pytest
from app.services.vertex import with_retry

call_count = 0

async def flaky_fn():
    global call_count
    call_count += 1
    if call_count < 3:
        raise Exception("429 Resource exhausted")
    return "success"

@pytest.mark.asyncio
async def test_with_retry_retries_on_429():
    global call_count
    call_count = 0
    result = await with_retry(flaky_fn, retries=3, delay=0.01)
    assert result == "success"
    assert call_count == 3
```

- [ ] **Step 2: Implement GenAI client singleton + with_retry**

```python
import asyncio
import re
from google import genai

_client: genai.Client | None = None

def get_genai_client() -> genai.Client:
    global _client
    if _client:
        return _client
    from app.config import get_settings
    s = get_settings()
    credentials = {
        "type": s.google_service_account_type,
        "project_id": s.google_service_account_project_id,
        "private_key_id": s.google_service_account_private_key_id,
        "private_key": s.google_service_account_private_key.replace("\\n", "\n"),
        "client_email": s.google_service_account_client_email,
        "client_id": s.google_service_account_client_id,
    }
    from google.oauth2 import service_account
    creds = service_account.Credentials.from_service_account_info(
        credentials, scopes=["https://www.googleapis.com/auth/cloud-platform"]
    )
    _client = genai.Client(vertexai=True, project=s.google_service_account_project_id,
                           location=s.google_cloud_location, credentials=creds)
    return _client

async def with_retry(fn, retries: int = 3, delay: float = 2.0):
    for attempt in range(retries + 1):
        try:
            return await fn()
        except Exception as e:
            msg = str(e)
            is_retryable = "429" in msg or "timeout" in msg.lower() or "RESOURCE_EXHAUSTED" in msg
            if is_retryable and attempt < retries:
                wait = delay * (2 ** attempt)
                print(f"[Retry] Attempt {attempt + 1} failed, waiting {wait}s...")
                await asyncio.sleep(wait)
            else:
                raise
```

- [ ] **Step 3: Run tests**
- [ ] **Step 4: Commit**

```bash
git add backend-python/app/services/vertex.py backend-python/tests/test_vertex_service.py
git commit -m "feat: GenAI client setup and retry logic in Python"
```

### Task 3.2: Image Generation (generate_image)

**Files:**
- Modify: `backend-python/app/services/vertex.py`

- [ ] **Step 1: Port generateImage() with model fallback chain**

Key behavior to preserve:
- Primary model: `GEMINI_IMAGE_ENDPOINT_2` → fallback `GEMINI_IMAGE_ENDPOINT` → `gemini-2.5-flash-image`
- Support `inputImages` (reference images sent inline)
- Extract both text and image from streaming response
- Return `{"buffer": bytes, "text": str, "prompt": str}`

```python
async def generate_image(self, prompt: str, aspect_ratio: str = "1:1",
                         resolution: str | None = None,
                         input_images: list[dict] | None = None,
                         model: str | None = None) -> dict:
    settings = get_settings()
    primary = model or settings.gemini_image_endpoint_2 or settings.gemini_image_endpoint or "gemini-2.5-flash-image"
    fallback = settings.gemini_image_endpoint if primary != settings.gemini_image_endpoint else None

    client = get_genai_client()
    contents = []
    if input_images:
        for img in input_images:
            contents.append(genai.types.Part.from_bytes(data=img["buffer"], mime_type=img["mime_type"]))
    contents.append(prompt)

    config = genai.types.GenerateContentConfig(
        response_modalities=["TEXT", "IMAGE"],
        temperature=1.0,
    )

    async def try_model(m: str):
        response = await client.aio.models.generate_content(
            model=m, contents=contents, config=config
        )
        img_buffer = None
        text = ""
        for part in response.candidates[0].content.parts:
            if part.inline_data and part.inline_data.data:
                img_buffer = part.inline_data.data
            if part.text:
                text += part.text
        return {"buffer": img_buffer, "text": text, "prompt": prompt}

    try:
        return await with_retry(lambda: try_model(primary))
    except Exception:
        if fallback and fallback != primary:
            return await with_retry(lambda: try_model(fallback))
        raise
```

- [ ] **Step 2: Commit**

```bash
git commit -m "feat: port generate_image with fallback chain"
```

### Task 3.3: RMBG-2.0 Background Removal

**Files:**
- Modify: `backend-python/app/services/vertex.py`

- [ ] **Step 1: Port RMBG-2.0 singleton loading + _remove_bg_rmbg2()**

Key difference: Python transformers is native — no ONNX bridge needed.

```python
from transformers import AutoModelForImageSegmentation, AutoImageProcessor
from PIL import Image
import torch
import numpy as np
import io

_rmbg_model = None
_rmbg_processor = None

async def _load_rmbg(self):
    global _rmbg_model, _rmbg_processor
    if _rmbg_model is None:
        _rmbg_processor = AutoImageProcessor.from_pretrained("briaai/RMBG-2.0", trust_remote_code=True)
        _rmbg_model = AutoModelForImageSegmentation.from_pretrained("briaai/RMBG-2.0", trust_remote_code=True)
        _rmbg_model.eval()

async def _remove_bg_rmbg2(self, image_bytes: bytes) -> bytes | None:
    await self._load_rmbg()
    img = Image.open(io.BytesIO(image_bytes)).convert("RGB")
    inputs = _rmbg_processor(images=img, return_tensors="pt")
    with torch.no_grad():
        preds = _rmbg_model(**inputs).logits
    mask = torch.sigmoid(preds[0][0]).numpy()
    mask = (mask * 255).astype(np.uint8)
    mask_img = Image.fromarray(mask).resize(img.size, Image.BILINEAR)
    result = img.copy()
    result.putalpha(mask_img)
    buf = io.BytesIO()
    result.save(buf, format="PNG")
    return buf.getvalue()
```

- [ ] **Step 2: Port _remove_bg_full_image() using rembg as fallback**

```python
from rembg import remove as rembg_remove

async def _remove_bg_full_image(self, image_bytes: bytes) -> bytes | None:
    """Fallback BG removal using rembg (replaces @imgly/background-removal-node)."""
    try:
        return rembg_remove(image_bytes)
    except Exception as e:
        print(f"[rembg] Fallback BG removal failed: {e}")
        return None
```

- [ ] **Step 3: Port warmup_rmbg2(), run_rmbg_and_get_bboxes()**
- [ ] **Step 4: Port extract_component_stroke_bboxes()**
- [ ] **Step 5: Commit**

```bash
git commit -m "feat: port RMBG-2.0 background removal to Python"
```

### Task 3.4: Component Analysis & Die-Cut Generation

**Files:**
- Modify: `backend-python/app/services/vertex.py`

- [ ] **Step 1: Port analyze_components()** — Gemini vision call, JSON parse
- [ ] **Step 2: Port separate_layers()** — text extraction from image
- [ ] **Step 3: Port generate_diecut_components()** — RMBG + crop + individual generation
- [ ] **Step 4: Port _crop_and_diecut()** — Pillow crop, alpha cleanup, flood fill
- [ ] **Step 5: Port _extract_component_by_flood_fill()** — pixel-level segmentation using numpy
- [ ] **Step 6: Commit**

```bash
git commit -m "feat: port component analysis and die-cut generation"
```

### Task 3.5: Layout Planning & Critique

**Files:**
- Modify: `backend-python/app/services/vertex.py`

- [ ] **Step 1: Port suggest_campaign_layout()** — component placement
- [ ] **Step 2: Port plan_layout_strategy()** — unified layout planning
- [ ] **Step 3: Port critique_layout()** — AI art director critique
- [ ] **Step 4: Port suggest_flex_layout()** — flex tree generation (largest prompt, ~200 lines)
- [ ] **Step 5: Port validate_flex_tree()** — recursive validation
- [ ] **Step 6: Commit**

```bash
git commit -m "feat: port layout planning, critique, and flex-tree generation"
```

### Task 3.6: Inpainting & Rendering

**Files:**
- Modify: `backend-python/app/services/vertex.py`

- [ ] **Step 1: Port inpaint_background()** — Imagen 3 inpainting via editImage API
- [ ] **Step 2: Port render_campaign_image()** — Gemini image render
- [ ] **Step 3: Port render_simple_composite()** — Pillow-based composite (replace Sharp)
- [ ] **Step 4: Port generate_layout_preview()** — SVG overlay composite
- [ ] **Step 5: Commit**

```bash
git commit -m "feat: port inpainting and rendering pipelines"
```

### Task 3.7: Export & Embeddings

**Files:**
- Modify: `backend-python/app/services/vertex.py`

- [ ] **Step 1: Port export_svg()** — embed-fonts mode (base64 font embedding) and paths mode (fonttools glyph→path)
- [ ] **Step 2: Port describe_and_embed()** — image description + embedding vector
- [ ] **Step 3: Commit**

```bash
git commit -m "feat: port SVG export and image embedding"
```

---

## Chunk 4: Controllers & Routes

### Task 4.1: Standard Endpoints (non-SSE)

**Files:**
- Modify: `backend-python/app/routes/image.py`
- Create: `backend-python/app/controllers/image.py`
- Create: `backend-python/tests/test_controllers.py`

- [ ] **Step 1: Write integration test for /generate endpoint**

```python
# tests/test_controllers.py
from unittest.mock import AsyncMock, patch

def test_generate_requires_prompt(client):
    resp = client.post("/api/image/generate", data={})
    assert resp.status_code == 400

@patch("app.services.vertex.vertex_service.generate_image")
def test_generate_returns_image_url(mock_gen, client, tmp_path):
    mock_gen.return_value = {"buffer": b"\x89PNG...", "text": "ok", "prompt": "test"}
    resp = client.post("/api/image/generate", data={"prompt": "test bg"})
    assert resp.status_code == 200
    assert resp.json()["success"]
```

- [ ] **Step 2: Implement routes/image.py with FastAPI router**

All endpoints must handle BOTH multipart file uploads AND JSON base64 input (the Vue frontend may use either). Use `Optional` file params and check `request.content_type` to determine mode.

```python
from fastapi import APIRouter, UploadFile, File, Form, Request
from fastapi.responses import JSONResponse, StreamingResponse
from app.controllers.image import (
    process_image, generate_and_separate, suggest_campaign,
    render_campaign, create_campaign, export_svg_handler,
)

router = APIRouter()

@router.post("/process")
async def route_process(request: Request,
                        image: UploadFile = File(...),
                        background: UploadFile | None = File(None),
                        hintText: str = Form(""),
                        mode: str = Form("")):
    return await process_image(request, image, background, hintText, mode)

@router.post("/generate")
async def route_generate(request: Request,
                         prompt: str = Form(None),
                         aspect_ratio: str = Form("3:4"),
                         resolution: str = Form(None),
                         images: list[UploadFile] = File(default=[])):
    # Also accept JSON body with base64 images array
    body = None
    if not prompt:
        body = await request.json()
        prompt = body.get("prompt")
    return await generate_and_separate(request, prompt, aspect_ratio, resolution, images, body)

@router.post("/add-text")
async def route_add_text(request: Request,
                         image: UploadFile | None = File(None),
                         text: str = Form(None)):
    # Accept image as file OR base64 in JSON body
    body = None
    if not image:
        body = await request.json()
    return await suggest_campaign(request, image, text, body)

@router.post("/render-text")
async def route_render_text(request: Request,
                            image: UploadFile | None = File(None),
                            background: UploadFile | None = File(None),
                            rendered_image: UploadFile | None = File(None),
                            suggestions: str = Form(None),
                            mode: str = Form("ai")):
    # Accept base64 image from JSON body as fallback
    body = None
    if not image and not rendered_image:
        body = await request.json()
    return await render_campaign(request, image, background, rendered_image, suggestions, mode, body)

@router.post("/create-campaign")
async def route_create_campaign(request: Request,
                                image: UploadFile | None = File(None),
                                background: UploadFile | None = File(None),
                                text: str = Form(None),
                                mode: str = Form(""),
                                noGoZones: str = Form(None)):
    # Accept base64 image from JSON body as fallback
    body = None
    if not image:
        body = await request.json()
    return await create_campaign(request, image, background, text, mode, noGoZones, body)

@router.post("/export-svg")
async def route_export_svg(request: Request,
                           background: UploadFile | None = File(None),
                           svgString: str = Form(None),
                           mode: str = Form("embed-fonts"),
                           includeBackground: str = Form("false")):
    return await export_svg_handler(request, background, svgString, mode, includeBackground)
```

- [ ] **Step 3: Implement controllers/image.py** — port all 6 controller functions:
  - `process_image()` — parallel analyze + separate + inpaint + die-cut
  - `generate_and_separate()` — generate bg image
  - `suggest_campaign()` — text placement suggestions
  - `render_campaign()` — multi-mode render (pre-rendered, simple, AI)
  - `export_svg_handler()` — SVG post-processing

Key patterns to preserve:
  - File upload → save to `uploads/` → return `/uploads/filename` URLs
  - Same JSON response shapes as Node backend
  - Character/prop deduplication logic
  - IoU overlap deduplication
  - Safe zone clamping

- [ ] **Step 4: Run tests**
- [ ] **Step 5: Commit**

```bash
git add backend-python/app/routes/ backend-python/app/controllers/ backend-python/tests/test_controllers.py
git commit -m "feat: port standard API endpoints to FastAPI"
```

### Task 4.2: SSE Create Campaign Endpoint

**Files:**
- Modify: `backend-python/app/controllers/image.py`
- Modify: `backend-python/app/routes/image.py`

- [ ] **Step 1: Implement SSE streaming for create_campaign**

FastAPI SSE pattern using `StreamingResponse`:

```python
from fastapi.responses import StreamingResponse
import json

async def create_campaign_stream(request, image, background, text, mode, no_go_zones):
    async def event_generator():
        def send_sse(event: str, data: dict):
            return f"event: {event}\ndata: {json.dumps(data)}\n\n"

        yield send_sse("progress", {"step": "rmbg_analysis", "message": "Running background removal..."})

        # ... full pipeline logic ...

        yield send_sse("done", {"success": True, "data": {...}})

    return StreamingResponse(event_generator(), media_type="text/event-stream",
                             headers={"Cache-Control": "no-cache", "Connection": "keep-alive"})
```

Key SSE events to preserve (same as Node):
- `progress`, `inpaint_mask`, `inpaint_iteration`, `background_ready`
- `debug`, `debug_preview`, `iteration_start`, `iteration_end`
- `critique_complete`, `refining`, `refine_rejected`
- `done`, `error`

- [ ] **Step 2: Port create_campaign pipeline — decompose into helper functions**

  **DO NOT port as one monolithic 800-line function.** Break into these async helpers:

  ```python
  async def _step_rmbg_prescan(image_bytes, send_sse) -> tuple[bytes | None, list[dict]]
  async def _step_component_placement(image_bytes, mime, text, no_go_zones, send_sse) -> dict
  async def _step_diecut_and_inpaint(image_bytes, mime, components, masked_buf, send_sse) -> tuple[list, str | None, list]
  async def _step_flex_layout(image_bytes, mime, text, components, canvas, refs, footer, send_sse) -> tuple[str, dict]
  async def _step_refinement_loop(image_bytes, mime, text, svg, components, canvas, refs, footer, send_sse, max_iter=3) -> tuple[str, dict]
  ```

  Each helper:
  1. RMBG pre-scan — run background removal, extract bboxes, merge with external no-go zones
  2. Component placement — call `suggest_campaign_layout()`, filter props/graphics/duplicates (IoU dedup), clamp to safe zone
  3. Die-cut + inpaint — generate die-cut PNGs, run iterative background inpainting (1 pass), compute safe zones from stroke bboxes
  4. Flex layout — call `suggest_flex_layout()`, compute boxes, build SVG
  5. Refinement loop — critique → re-run flex layout with feedback, max 3 iterations

  Port the deduplication logic (CHARACTER_KEYWORDS, PROP_KEYWORDS, GRAPHICAL_KEYWORDS, IoU overlap) as module-level constants and helper functions.

  Port `footer.txt` reading from `assets/Ref_Footer/footer.txt`.

  Port `mode === "only_bg_comp"` branch that skips text layout entirely.

- [ ] **Step 3: Test SSE output manually**

Run: `cd backend-python && uvicorn app.main:app --reload --port 5001`
Then: `curl -N -X POST http://localhost:5001/api/image/create-campaign -F "image=@test.jpg" -F "text=test"`
Expected: SSE events stream

- [ ] **Step 4: Commit**

```bash
git commit -m "feat: port SSE create-campaign pipeline to FastAPI"
```

---

## Chunk 5: Integration & Final Verification

### Task 5.1: Copy Shared Assets

**Files:**
- Symlink/copy: `backend-python/assets/ref_images/` ← `backend/assets/ref_images/`
- Symlink/copy: `backend-python/assets/Ref_Footer/` ← `backend/assets/Ref_Footer/`

- [ ] **Step 1: Copy reference assets**

```bash
cp -r backend/assets/ref_images backend-python/assets/ref_images
cp -r backend/assets/Ref_Footer backend-python/assets/Ref_Footer
```

- [ ] **Step 2: Create .env from template (DO NOT copy real credentials blindly)**

```bash
# Copy structure only — verify no real secrets are committed
cp backend/.env backend-python/.env
echo "backend-python/.env" >> .gitignore  # ensure .env is gitignored
```

- [ ] **Step 3: Commit**

```bash
git commit -m "chore: copy shared assets for Python backend"
```

### Task 5.2: Request Logger Middleware

**Files:**
- Modify: `backend-python/app/main.py`

- [ ] **Step 1: Add request logging middleware** (matching Node's request logger)

```python
import time

@app.middleware("http")
async def log_requests(request: Request, call_next):
    start = time.time()
    print(f"[{datetime.now().isoformat()}] -> {request.method} {request.url.path}")
    response = await call_next(request)
    duration = int((time.time() - start) * 1000)
    print(f"[{datetime.now().isoformat()}] <- {request.method} {request.url.path} - {response.status_code} ({duration}ms)")
    return response
```

- [ ] **Step 2: Commit**

```bash
git commit -m "feat: add request logging middleware"
```

### Task 5.3: End-to-End Verification

- [ ] **Step 1: Run all tests**

Run: `cd backend-python && python -m pytest -v --tb=short`
Expected: All tests pass

- [ ] **Step 2: Start server and test with frontend**

Run: `cd backend-python && uvicorn app.main:app --reload --port 5001`
Open: `http://localhost:5173` (Vue frontend)
Test: Upload image → Generate → Create Campaign → Export SVG

- [ ] **Step 3: Verify all 6 endpoints return identical JSON shapes**

Compare Node vs Python responses for:
- `POST /api/image/generate` — `{success, data: {imageUrl, text, prompt, layers}}`
- `POST /api/image/process` — `{success, data: {original, backgroundDescription, generatedBackgroundImageUrl, textLayers, visualComponents, stackImageUrls}}`
- `POST /api/image/add-text` — `{success, data: {suggestions, components, ...}}`
- `POST /api/image/render-text` — `{success, data: {imageUrl, text, prompt}}`
- `POST /api/image/create-campaign` — SSE stream with same event names
- `POST /api/image/export-svg` — SVG file download

- [ ] **Step 4: Final commit**

```bash
git commit -m "chore: verified Python backend E2E with frontend"
```

---

## Key Python↔Node Equivalences

| Node | Python |
|---|---|
| `Buffer` | `bytes` |
| `sharp(buf).metadata()` | `Image.open(io.BytesIO(buf)).size` |
| `sharp(buf).resize().png().toBuffer()` | `img.resize((w,h)); buf=io.BytesIO(); img.save(buf, 'PNG')` |
| `sharp(buf).composite([...])` | `Image.alpha_composite(base, overlay)` |
| `sharp(buf).ensureAlpha().raw().toBuffer()` | `np.array(img.convert('RGBA'))` |
| `opentype.loadSync()` | `TTFont(path)` |
| `font.getAdvanceWidth()` | Manual hmtx glyph width calculation |
| `fs.readFileSync()` | `Path(p).read_bytes()` |
| `fs.writeFileSync()` | `Path(p).write_bytes()` |
| `express.static()` | `StaticFiles(directory=...)` |
| `multer` | `UploadFile = File(...)` |
| SSE via `res.write()` | `StreamingResponse(generator)` |
| `@google/genai` | `google-genai` (same API, Python native) |
| `@huggingface/transformers` | `transformers` (native Python, no ONNX bridge) |
| `@imgly/background-removal-node` | `rembg` (ONNX bg removal, fallback for RMBG-2.0) |

## Risk Areas

1. **Prompt strings** — Copy prompts verbatim from Node. Do NOT rephrase or "improve" them.
2. **JSON response shapes** — Frontend expects exact field names. Test with actual frontend.
3. **SSE event names** — Must match exactly (`progress`, `iteration_end`, `done`, etc.)
4. **File paths** — `uploads/` relative path must work with both `StaticFiles` and `Path` operations.
5. **RMBG model loading** — First call is slow (~10s). Warmup on startup is critical.
6. **Gemini API differences** — Python SDK uses `client.aio.models.generate_content()` vs Node's streaming API. Test response parsing carefully.
