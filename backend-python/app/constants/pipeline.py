from __future__ import annotations

# ── Image processing ──
PROCESSING_MAX_W = 1500
PROCESSING_QUALITY = 90
STRATEGY_RESIZE_W = 800
STRATEGY_RESIZE_QUALITY = 80

# ── RMBG ──
RMBG_MODEL_SIZE = 1024
FULL_BG_MAX_DIM = 1500

# ── Die-cut ──
DIECUT_CHAR_PAD = 0.1
DIECUT_DEFAULT_PAD = 0.04
DIECUT_MIN_DIM = 40
DIECUT_MIN_OPAQUE_RATIO = 0.05
DIECUT_API_SLEEP_S = 3
WHITE_BG_THRESHOLD = 250
ALPHA_EROSION_ITERATIONS = 2
CROP_ALPHA_CUTOFF = 25
QUALITY_ALPHA_CUTOFF = 20

# ── Grid ──
GRID_THUMBNAIL_SIZE = 256
GRID_MAX_COLS = 3

# ── Flood fill ──
FLOOD_FILL_ALPHA_THRESH = 10

# ── Inpaint ──
INPAINT_FG_ALPHA_THRESH = 30
INPAINT_MASK_DILATION = 0.03

# ── Bbox detection ──
BBOX_ALPHA_THRESH = 50
STROKE_BBOX_ALPHA_THRESH = 30

# ── Foreground detection ──
FG_DETECT_ALPHA_THRESH = 20
FG_DETECT_RATIO_THRESH = 0.05

# ── Keyword lists (shared between services + controller) ──
CHARACTER_KEYWORDS = [
    "woman", "man", "girl", "boy", "mascot",
    "character", "person", "figure", "human",
]
PROP_KEYWORDS = [
    "phone", "smartphone", "mobile", "tablet",
    "gun", "pistol", "weapon", "rifle", "water gun", "squirt",
    "bag", "purse", "handbag", "backpack",
    "bottle", "cup", "mug", "drink",
    "hat", "cap", "helmet", "glasses", "sunglasses",
    "umbrella", "fan", "flag",
]
GRAPHICAL_KEYWORDS = [
    "pattern", "hexagon", "geometric", "background", "texture",
    "gradient", "border", "decoration", "ornament", "abstract",
    "shape", "wave", "frame", "watermark",
]

# ── Image generation ──
NO_TEXT_PREFIX = (
    "IMPORTANT: Do NOT include any text, typography, letters, words, numbers, "
    "logos with text, watermarks, or any written content in the generated image. "
    "The image must be completely free of any text elements. Only generate visual/graphical elements.\n\n"
)

# ── Promo regex ──
PROMO_RE_PATTERN = r"^[\d๐-๙%+×\s]{1,6}$|^[\d๐-๙.]+\s*(ต่อ|เท่า|ครั้ง|คืน|%|×)\s*$"

# ── StyleSpec library ──
STYLE_SPEC_DIR = "assets/design_systems"
STYLE_EMBED_MODEL = "gemini-embedding-001"
STYLE_SPEC_TOP_K = 1
