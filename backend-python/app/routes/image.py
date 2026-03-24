from fastapi import APIRouter, File, Form, Request, UploadFile

from app.controllers.image import (
    create_campaign,
    create_campaign_integrated,
    export_svg_handler,
    generate_and_separate,
    generate_integrated,
    process_image,
    render_campaign,
    suggest_campaign,
)

router = APIRouter()


@router.post("/process")
async def route_process(
    request: Request,
    image: UploadFile = File(...),
    background: UploadFile | None = File(None),
    hintText: str = Form(""),
    mode: str = Form(""),
):
    return await process_image(request, image, background, hintText, mode)


@router.post("/generate")
async def route_generate(
    request: Request,
    prompt: str | None = Form(None),
    aspect_ratio: str = Form("3:4"),
    resolution: str | None = Form(None),
    images: list[UploadFile] = File(default=[]),
):
    body = None
    if not prompt:
        try:
            body = await request.json()
            prompt = body.get("prompt")
        except Exception:
            pass
    return await generate_and_separate(request, prompt, aspect_ratio, resolution, images, body)


@router.post("/add-text")
async def route_add_text(
    request: Request,
    image: UploadFile | None = File(None),
    text: str | None = Form(None),
):
    body = None
    if not image or not image.size:
        try:
            body = await request.json()
        except Exception:
            pass
    return await suggest_campaign(request, image, text, body)


@router.post("/render-text")
async def route_render_text(
    request: Request,
    image: UploadFile | None = File(None),
    background: UploadFile | None = File(None),
    rendered_image: UploadFile | None = File(None),
    suggestions: str | None = Form(None),
    mode: str = Form("ai"),
):
    body = None
    if not image and not rendered_image:
        try:
            body = await request.json()
        except Exception:
            pass
    return await render_campaign(request, image, background, rendered_image, suggestions, mode, body)


@router.post("/create-campaign")
async def route_create_campaign(
    request: Request,
    image: UploadFile | None = File(None),
    background: UploadFile | None = File(None),
    text: str | None = Form(None),
    mode: str = Form(""),
    noGoZones: str | None = Form(None),
    textZoneHints: str | None = Form(None),
):
    body = None
    if not image or not image.size:
        try:
            body = await request.json()
        except Exception:
            pass
    return await create_campaign(request, image, background, text, mode, noGoZones, body, textZoneHints)


@router.post("/generate-integrated")
async def route_generate_integrated(request: Request):
    return await generate_integrated(request)


@router.post("/create-campaign-integrated")
async def route_create_campaign_integrated(request: Request):
    body = await request.json()
    return await create_campaign_integrated(request, body)


@router.post("/export-svg")
async def route_export_svg(
    request: Request,
    background: UploadFile | None = File(None),
    svgString: str | None = Form(None),
    mode: str = Form("embed-fonts"),
    includeBackground: str = Form("false"),
):
    return await export_svg_handler(request, background, svgString, mode, includeBackground)
