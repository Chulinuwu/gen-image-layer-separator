import time
from contextlib import asynccontextmanager
from datetime import datetime, timezone
from pathlib import Path

from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles

UPLOAD_DIR = Path(__file__).parent.parent / "uploads"
UPLOAD_DIR.mkdir(exist_ok=True)
ASSETS_DIR = Path(__file__).parent.parent / "assets"


@asynccontextmanager
async def lifespan(app: FastAPI):
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
app.mount("/assets", StaticFiles(directory=str(ASSETS_DIR)), name="assets")


@app.middleware("http")
async def log_requests(request: Request, call_next):
    start = time.time()
    print(f"[{datetime.now().isoformat()}] -> {request.method} {request.url.path}")
    response = await call_next(request)
    duration = int((time.time() - start) * 1000)
    print(f"[{datetime.now().isoformat()}] <- {request.method} {request.url.path} - {response.status_code} ({duration}ms)")
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


from app.routes.image import router as image_router  # noqa: E402

app.include_router(image_router, prefix="/api/image")
