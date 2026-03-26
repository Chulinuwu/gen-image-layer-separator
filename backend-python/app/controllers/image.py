from __future__ import annotations

import asyncio
import base64
import json
import re
import time
from io import BytesIO
from pathlib import Path

from fastapi import Request, UploadFile
from fastapi.responses import JSONResponse, Response, StreamingResponse
from PIL import Image

from app.constants.pipeline import (
    CHARACTER_KEYWORDS, PROP_KEYWORDS, GRAPHICAL_KEYWORDS,
    FG_DETECT_ALPHA_THRESH, FG_DETECT_RATIO_THRESH, PROMO_RE_PATTERN,
)
from app.services.vertex import vertex_service
from app.utils.ai_logger import log_event, trace_ai
from app.utils.flex_layout import compute_flex_layout, LayoutBox, FlexNodeStyle
from app.utils.ref_image_search import find_similar_refs, extract_style_guide
from app.utils.safe_zones import BBox, compute_safe_zones
from app.utils.contrast import check_text_contrast
from app.utils.svg_builder import build_flex_svg, FlexSVGInput

UPLOAD_DIR = Path(__file__).parent.parent.parent / "uploads"
UPLOAD_DIR.mkdir(exist_ok=True)

PROMO_RE = re.compile(PROMO_RE_PATTERN)


def _save_upload(data: bytes, prefix: str = "file", ext: str = ".png") -> str:
    filename = f"{prefix}-{int(time.time() * 1000)}{ext}"
    (UPLOAD_DIR / filename).write_bytes(data)
    return f"/uploads/{filename}"


async def _read_upload(file: UploadFile) -> bytes:
    return await file.read()


def _decode_base64_image(b64: str) -> tuple[bytes, str]:
    match = re.match(r"^data:(image/\w+);base64,", b64)
    mime = match.group(1) if match else "image/png"
    clean = re.sub(r"^data:image/\w+;base64,", "", b64)
    return base64.b64decode(clean), mime


def _compute_iou(a_pos: dict, b_pos: dict) -> float:
    x_a = max(a_pos.get("left", 0), b_pos.get("left", 0))
    y_a = max(a_pos.get("top", 0), b_pos.get("top", 0))
    x_b = min(
        a_pos.get("left", 0) + a_pos.get("width", 0),
        b_pos.get("left", 0) + b_pos.get("width", 0),
    )
    y_b = min(
        a_pos.get("top", 0) + a_pos.get("height", 0),
        b_pos.get("top", 0) + b_pos.get("height", 0),
    )
    if x_b <= x_a or y_b <= y_a:
        return 0
    inter = (x_b - x_a) * (y_b - y_a)
    a_area = a_pos.get("width", 0) * a_pos.get("height", 0)
    b_area = b_pos.get("width", 0) * b_pos.get("height", 0)
    union = a_area + b_area - inter
    return inter / union if union > 0 else 0


def _dedup_components(components: list[dict]) -> list[dict]:
    filtered = [
        c for c in components
        if not (
            any(kw in c.get("label", "").lower() for kw in GRAPHICAL_KEYWORDS)
            and not any(kw in c.get("label", "").lower() for kw in CHARACTER_KEYWORDS)
        )
    ]

    has_char = any(
        any(kw in c.get("label", "").lower() for kw in CHARACTER_KEYWORDS)
        for c in filtered
    )
    if has_char:
        filtered = [
            c for c in filtered
            if not (
                any(kw in c.get("label", "").lower() for kw in PROP_KEYWORDS)
                and not any(kw in c.get("label", "").lower() for kw in CHARACTER_KEYWORDS)
            )
        ]

    deduped: list[dict] = []
    for comp in filtered:
        pos = comp.get("position", {})
        comp_area = pos.get("width", 0) * pos.get("height", 0)
        is_dup = False
        for kept in deduped:
            if _compute_iou(kept.get("position", {}), pos) > 0.7:
                is_dup = True
                break
            k_pos = kept.get("position", {})
            k_area = k_pos.get("width", 0) * k_pos.get("height", 0)
            if k_area == 0 or comp_area == 0:
                continue
            x_a = max(pos.get("left", 0), k_pos.get("left", 0))
            y_a = max(pos.get("top", 0), k_pos.get("top", 0))
            x_b = min(
                pos.get("left", 0) + pos.get("width", 0),
                k_pos.get("left", 0) + k_pos.get("width", 0),
            )
            y_b = min(
                pos.get("top", 0) + pos.get("height", 0),
                k_pos.get("top", 0) + k_pos.get("height", 0),
            )
            if x_b > x_a and y_b > y_a:
                inter = (x_b - x_a) * (y_b - y_a)
                smaller = min(comp_area, k_area)
                if inter / smaller > 0.6:
                    is_dup = True
                    break
        if not is_dup:
            deduped.append(comp)

    return deduped


def _clamp_to_safe_zone(pos: dict) -> dict:
    if not pos:
        return pos
    pad = 50
    max_dim = 1000 - pad * 2
    w = min(pos.get("width", 300), max_dim)
    h = min(pos.get("height", 400), max_dim)
    left = max(pad, min(pos.get("left", pad), 1000 - pad - w))
    top = max(pad, min(pos.get("top", pad), 1000 - pad - h))
    return {**pos, "top": top, "left": left, "width": w, "height": h}


def _enforce_design_rules(suggestions: list[dict]) -> list[dict]:
    if not suggestions:
        return suggestions
    max_font = max(
        (s.get("font_size_normalized", 0) or s.get("style", {}).get("font_size_normalized", 0))
        for s in suggestions
    )
    result = []
    for s in suggestions:
        part = (s.get("part") or "").strip()
        fs = s.get("font_size_normalized", 0) or s.get("style", {}).get("font_size_normalized", 0)
        if PROMO_RE.match(part) and fs < max_font * 0.8 and max_font > 0:
            s = {**s, "font_size_normalized": 160}
        result.append(s)
    return result


# ─────────────────────────────────────────────────────────────────
# Endpoint handlers
# ─────────────────────────────────────────────────────────────────


async def process_image(
    request: Request,
    image: UploadFile,
    background: UploadFile | None,
    hint_text: str,
    mode: str,
):
    image_buffer = await _read_upload(image)
    mime_type = image.content_type or "image/png"

    background_buffer: bytes | None = None
    if background and background.size:
        background_buffer = await _read_upload(background)

    # Step 1: Analyze + separate in parallel
    tasks = [vertex_service.analyze_components(image_buffer, mime_type, background_buffer)]
    if mode != "only_bg_comp":
        tasks.append(vertex_service.separate_layers(image_buffer, mime_type, background_buffer, hint_text))

    results = await asyncio.gather(*tasks, return_exceptions=True)

    analysis_data = results[0] if not isinstance(results[0], Exception) else {"components": []}
    if isinstance(results[0], Exception):
        print(f"Worker (Analyze) failed: {results[0]}")

    layers_data: dict = {"layers": []}
    if mode != "only_bg_comp" and len(results) > 1:
        if not isinstance(results[1], Exception):
            layers_data = results[1]
        else:
            print(f"Worker (Text) failed: {results[1]}")

    # Step 1.5: Inpaint background if not provided
    generated_bg_url: str | None = None
    if not background_buffer and (
        analysis_data.get("components")
        or analysis_data.get("background_description")
        or layers_data.get("layers")
    ):
        try:
            components_desc = "\n".join(
                f'- COMPONENT: "{c["label"]}" at [top: {c["position"]["top"]}, left: {c["position"]["left"]}, '
                f'width: {c["position"]["width"]}, height: {c["position"]["height"]}]'
                for c in (analysis_data.get("components") or [])
            )
            text_desc = "\n".join(
                f'- TEXT: "{t["content"]}" at [top: {t["position"]["top"]}, left: {t["position"]["left"]}, '
                f'width: {t["position"]["width"]}, height: {t["position"]["height"]}]'
                for t in (layers_data.get("layers") or [])
            )
            bg_resp = await vertex_service.generate_image(
                prompt=f"""Act as a professional image INPAINTER.
TASK: Remove all identified foreground components, characters, and ALL text from the provided image to create a clean background plate.

ELEMENTS TO REMOVE (Coordinates 0-1000):
{components_desc}
{text_desc}

INSTRUCTIONS:
- Delete the listed components and text, then seamlessly fill/reconstruct the background behind them.
- Match the exact atmosphere, textures, and lighting of the reference.
- Result MUST be a CLEAN empty background plate of the original scene.
- Do NOT add new elements.""",
                aspect_ratio="3:4",
                input_images=[{"buffer": image_buffer, "mimeType": mime_type}],
            )
            if bg_resp.get("buffer"):
                generated_bg_url = _save_upload(bg_resp["buffer"], "bg-inpaint")
        except Exception as err:
            print(f"Background inpainting failed: {err}")

    # Step 2: Die-cut components
    raw_components = analysis_data.get("components") or []
    components = _dedup_components(raw_components)
    visual_components: list[dict] = []
    stack_image_urls: list[str] = []

    if components:
        diecut_result = await vertex_service.generate_diecut_components(
            image_buffer, mime_type, components
        )
        diecut_results = diecut_result["results"]
        grid_images = diecut_result.get("gridImages") or []

        for idx, img in enumerate(grid_images):
            stack_image_urls.append(_save_upload(img, f"stack-{idx}"))

        for i, res in enumerate(diecut_results):
            url = _save_upload(res["buffer"], f"component-{i}")
            comp = components[i] if i < len(components) else {}
            pos = comp.get("suggested_position") or comp.get("position") or {
                "top": 0, "left": 0, "width": 200, "height": 200
            }
            visual_components.append({
                "label": res["label"],
                "imageUrl": url,
                "position": pos,
                "z_index": comp.get("z_index", 15),
                "interaction_zone": comp.get("interaction_zone"),
            })

    return JSONResponse({
        "success": True,
        "data": {
            "original": f"/uploads/{image.filename}",
            "backgroundDescription": (
                analysis_data.get("background_description")
                or layers_data.get("background_description")
                or ""
            ),
            "generatedBackgroundImageUrl": generated_bg_url,
            "textLayers": layers_data.get("layers", []),
            "visualComponents": visual_components,
            "stackImageUrls": stack_image_urls,
        },
    })


async def generate_and_separate(
    request: Request,
    prompt: str | None,
    aspect_ratio: str,
    resolution: str | None,
    images: list[UploadFile],
    body: dict | None,
):
    if not prompt and body:
        prompt = body.get("prompt")
    if not prompt:
        return JSONResponse({"error": "Prompt is required"}, status_code=400)

    print(f"[Backend Controller] Received request: prompt='{prompt[:50]}...', aspect_ratio={aspect_ratio}, resolution={resolution}, hasImages={len(images) > 0}")

    input_images: list[dict] = []
    if images:
        for f in images:
            buf = await _read_upload(f)
            input_images.append({"buffer": buf, "mimeType": f.content_type or "image/png"})
    elif body and isinstance(body.get("images"), list):
        for b64 in body["images"]:
            buf, mime = _decode_base64_image(b64)
            input_images.append({"buffer": buf, "mimeType": mime})

    result = await vertex_service.generate_image(
        prompt=prompt,
        aspect_ratio=aspect_ratio or "3:4",
        resolution=resolution,
        input_images=input_images if input_images else None,
    )

    if not result.get("buffer"):
        return JSONResponse(
            {"success": False, "message": "Failed to generate image buffer", "text": result.get("text")},
            status_code=500,
        )

    url = _save_upload(result["buffer"], "generated")
    return JSONResponse({
        "success": True,
        "data": {
            "imageUrl": url,
            "text": result.get("text"),
            "prompt": result.get("prompt"),
            "layers": [],
        },
    })


async def generate_integrated(request: Request):
    body = await request.json()
    text_brief = body.get("text_brief")
    visual_concept = body.get("visual_concept")
    if not text_brief:
        return JSONResponse({"error": "text_brief is required"}, status_code=400)
    if not visual_concept:
        return JSONResponse({"error": "visual_concept is required"}, status_code=400)
    aspect_ratio = body.get("aspect_ratio", "3:4")

    plan = await vertex_service.plan_text_zones(text_brief, visual_concept, aspect_ratio)
    bg_constraints = plan.get("bg_constraints", "")
    text_zones = plan.get("text_zones", [])

    cohesion = "The entire image must look like ONE cohesive photograph with smooth, natural transitions between all elements. No hard edges, no collage effect, no pasted-on sections."
    enriched_prompt = f"{visual_concept}. {cohesion} {bg_constraints}" if bg_constraints else visual_concept

    # Generate BG with enriched prompt (no validation/retry for now)
    result = await vertex_service.generate_image(prompt=enriched_prompt, aspect_ratio=aspect_ratio)

    if not result or not result.get("buffer"):
        return JSONResponse(
            {"success": False, "message": "Failed to generate image buffer"},
            status_code=500,
        )

    url = _save_upload(result["buffer"], "generated")
    return JSONResponse({
        "success": True,
        "data": {
            "imageUrl": url,
            "textZones": text_zones,
            "bgConstraints": bg_constraints,
            "validationResult": "SKIPPED",
        },
    })


async def suggest_campaign(
    request: Request,
    image: UploadFile | None,
    text: str | None,
    body: dict | None,
):
    if image and image.size:
        image_buffer = await _read_upload(image)
        mime_type = image.content_type or "image/png"
    elif body and body.get("image"):
        image_buffer, mime_type = _decode_base64_image(body["image"])
    else:
        return JSONResponse({"error": "Image (file or base64) and text are required"}, status_code=400)

    if not text and body:
        text = body.get("text")
    if not text:
        return JSONResponse({"error": "Text is required for campaign analysis"}, status_code=400)

    analysis = await vertex_service.suggest_campaign_layout(image_buffer, mime_type, text)
    return JSONResponse({"success": True, "data": analysis})


async def render_campaign(
    request: Request,
    image: UploadFile | None,
    background: UploadFile | None,
    rendered_image: UploadFile | None,
    suggestions_raw: str | None,
    mode: str,
    body: dict | None,
):
    # Parse suggestions
    if not suggestions_raw and body:
        suggestions_raw = body.get("suggestions") or (body.get("data", {}) or {}).get("suggestions")

    if not suggestions_raw:
        return JSONResponse({
            "error": "suggestions are required.",
            "hint": "In form-data, use key 'suggestions'. Or send JSON body with a 'suggestions' array.",
        }, status_code=400)

    try:
        suggestions = json.loads(suggestions_raw) if isinstance(suggestions_raw, str) else suggestions_raw
        if isinstance(suggestions, dict):
            suggestions = (
                suggestions.get("data", {}).get("suggestions")
                or suggestions.get("suggestions")
                or suggestions
            )
    except (json.JSONDecodeError, TypeError):
        return JSONResponse({"error": "Invalid suggestions JSON format"}, status_code=400)

    if not isinstance(suggestions, list):
        return JSONResponse({
            "error": "suggestions must be an array (or a response object containing a suggestions array)"
        }, status_code=400)

    # Get image buffer
    image_buffer: bytes = b""
    mime_type = "image/png"
    background_buffer: bytes | None = None

    if mode == "pre-rendered" or (rendered_image and rendered_image.size):
        image_buffer = b""
    elif image and image.size:
        image_buffer = await _read_upload(image)
        mime_type = image.content_type or "image/png"
        if background and background.size:
            background_buffer = await _read_upload(background)
    elif body and body.get("image"):
        image_buffer, mime_type = _decode_base64_image(body["image"])
    else:
        return JSONResponse({"error": "Image and suggestions are required"}, status_code=400)

    # Render based on mode
    if mode == "pre-rendered" and rendered_image and rendered_image.size:
        buf = await _read_upload(rendered_image)
        result = {"buffer": buf, "text": "Client-side render saved", "prompt": "none"}
    elif mode == "simple":
        buf = await vertex_service.render_simple_composite(
            background_buffer or image_buffer, suggestions
        )
        result = {"buffer": buf, "text": "Simple render completed", "prompt": "none"}
    else:
        result = await vertex_service.render_campaign_image(
            image_buffer, mime_type, suggestions, background_buffer
        )

    if result.get("buffer"):
        url = _save_upload(result["buffer"], "rendered")
        return JSONResponse({
            "success": True,
            "data": {"imageUrl": url, "text": result.get("text"), "prompt": result.get("prompt")},
        })
    return JSONResponse({"error": "Failed to render image"}, status_code=500)


async def export_svg_handler(
    request: Request,
    background: UploadFile | None,
    svg_string: str | None,
    mode: str,
    include_background: str,
):
    if not svg_string or not isinstance(svg_string, str):
        body = await request.json()
        svg_string = body.get("svgString")
        mode = body.get("mode", mode)
        include_background = body.get("includeBackground", include_background)

    if not svg_string:
        return JSONResponse({"error": "svgString is required"}, status_code=400)
    if mode not in ("embed-fonts", "paths"):
        return JSONResponse({"error": "mode must be 'embed-fonts' or 'paths'"}, status_code=400)

    bg_buffer: bytes | None = None
    if include_background in ("true", True) and background and background.size:
        bg_buffer = await _read_upload(background)

    processed = await vertex_service.export_svg(svg_string, bg_buffer, mode)
    return Response(
        content=processed,
        media_type="image/svg+xml",
        headers={"Content-Disposition": f'attachment; filename="ad-layout-{mode}.svg"'},
    )


# ─────────────────────────────────────────────────────────────────
# create_campaign SSE pipeline — decomposed into helper functions
# ─────────────────────────────────────────────────────────────────


def _has_extractable_foreground(masked_buf: bytes | None, threshold: float = FG_DETECT_RATIO_THRESH) -> bool:
    if not masked_buf:
        return False
    try:
        import numpy as np
        img = Image.open(BytesIO(masked_buf)).convert("RGBA")
        alpha = np.array(img)[:, :, 3]
        opaque_ratio = (alpha > FG_DETECT_ALPHA_THRESH).sum() / alpha.size
        print(f"[RMBG Gate] Foreground opaque ratio: {opaque_ratio:.1%} (threshold: {threshold:.0%})")
        return opaque_ratio >= threshold
    except Exception:
        return False


async def _step_rmbg_prescan(
    image_bytes: bytes,
    send_sse,
) -> tuple[bytes | None, list[dict]]:
    send_sse("progress", {"step": "rmbg_analysis", "message": "Running background removal to detect subject positions..."})
    try:
        result = await vertex_service.run_rmbg_and_get_bboxes(image_bytes)
        masked_buf = result.get("maskedBuffer")
        bboxes = result.get("bboxes", [])
        no_go = [
            {
                "label": b["label"],
                "top": b["top"], "left": b["left"],
                "width": b["width"], "height": b["height"],
                "area": {"top": b["top"], "left": b["left"], "width": b["width"], "height": b["height"]},
            }
            for b in bboxes
        ]
        return masked_buf, no_go
    except Exception as e:
        print(f"[Pipeline] RMBG pre-scan failed: {e}")
        return None, []


async def _step_component_placement(
    image_bytes: bytes,
    mime: str,
    text: str,
    no_go_zones: list[dict],
    send_sse,
) -> dict:
    send_sse("progress", {"step": "initial_analysis", "message": "AI art director is composing component placement..."})
    analysis = await vertex_service.suggest_campaign_layout(
        image_bytes, mime, text, "only_bg_comp", no_go_zones
    )
    log_event("Component Placement", "Initial art director placement", analysis)
    return analysis


async def _step_diecut_and_inpaint(
    image_bytes: bytes,
    mime: str,
    component_suggestions: list[dict],
    precomputed_masked: bytes | None,
    analysis: dict,
    upload_dir: Path,
    ref_image_url: str,
    send_sse,
) -> tuple[list[dict], str | None, list[str], list[dict]]:
    visual_components: list[dict] = []
    generated_bg_url: str | None = None
    stack_urls: list[str] = []
    stroke_bboxes: list[dict] = []
    full_mask: bytes | None = None

    if not component_suggestions:
        return visual_components, generated_bg_url, stack_urls, stroke_bboxes

    # Die-cut
    try:
        send_sse("progress", {
            "step": "diecut_generation",
            "message": f"Generating {len(component_suggestions)} die-cut components...",
        })
        diecut_result = await vertex_service.generate_diecut_components(
            image_bytes, mime, component_suggestions,
        )
        diecut_results = diecut_result["results"]
        grid_images = diecut_result.get("gridImages") or []
        full_mask = diecut_result.get("maskedFullImageBuffer")

        for idx, img in enumerate(grid_images):
            stack_urls.append(_save_upload(img, f"stack-{idx}"))

        for i, res in enumerate(diecut_results):
            url = _save_upload(res["buffer"], f"component-{i}")
            matched = component_suggestions[i] if i < len(component_suggestions) else {}
            raw_pos = matched.get("suggested_position") or matched.get("position") or {
                "top": 50, "left": 50, "width": 300, "height": 400
            }
            pos = _clamp_to_safe_zone(raw_pos)
            visual_components.append({
                "label": res["label"],
                "imageUrl": url,
                "position": pos,
                "z_index": matched.get("z_index", 15),
                "interaction_zone": matched.get("interaction_zone"),
            })

        send_sse("progress", {
            "step": "diecut_complete",
            "message": f"✅ {len(visual_components)} components ready!",
        })

        # Stroke bboxes for safe zones
        try:
            diecut_with_pos = [
                {"label": r["label"], "buffer": r["buffer"],
                 "position": component_suggestions[i].get("position") if i < len(component_suggestions) else None}
                for i, r in enumerate(diecut_results)
            ]
            stroke_bboxes = await vertex_service.extract_component_stroke_bboxes(diecut_with_pos)
        except Exception:
            pass

    except Exception as err:
        print(f"[Build-Up] Die-cut failed: {err}")
        send_sse("progress", {"step": "diecut_error", "message": "⚠️ Die-cut generation failed."})

    # Inpaint background
    try:
        send_sse("progress", {"step": "inpaint_background", "message": "AI is cleaning the background..."})

        bg_result: bytes | None = None
        current_source = image_bytes

        if full_mask:
            inpaint_res = await vertex_service.inpaint_background(
                current_source, full_mask, analysis,
                lambda b64: send_sse("inpaint_mask", {"imageBase64": b64}),
            )
            if inpaint_res.get("buffer"):
                bg_result = inpaint_res["buffer"]
                iter_url = _save_upload(bg_result, "bg-inpaint-iter1")
                send_sse("inpaint_iteration", {
                    "iteration": 1, "totalIterations": 1,
                    "previewUrl": iter_url,
                })

        if bg_result:
            generated_bg_url = _save_upload(bg_result, "bg-inpaint")
            send_sse("background_ready", {"previewUrl": generated_bg_url, "message": "Background cleaned!"})
        else:
            send_sse("background_ready", {
                "previewUrl": ref_image_url,
                "message": "⚠️ Background inpainting could not complete. Using original image.",
            })
    except Exception as err:
        print(f"[Build-Up] BG inpaint failed: {err}")
        send_sse("background_ready", {
            "previewUrl": ref_image_url,
            "message": "⚠️ Background cleaning failed. Using original image.",
        })

    send_sse("progress", {
        "step": "assets_ready",
        "message": f"Assets: BG {'✅' if generated_bg_url else '❌'} | Components: {len(visual_components)}",
    })

    return visual_components, generated_bg_url, stack_urls, stroke_bboxes


async def _step_flex_layout(
    image_bytes: bytes,
    mime: str,
    target_text: str,
    visual_components: list[dict],
    canvas_w: int,
    canvas_h: int,
    ref_image_buffers: list[bytes],
    footer_text: str | None,
    generated_bg_url: str | None,
    ref_image_url: str,
    origin: str,
    send_sse,
    ref_descriptions: list[str] | None = None,
    style_guide: str | None = None,
    layout_strategy: dict | None = None,
    no_go_zones: list[dict] | None = None,
    image_description: str | None = None,
    zone_hints: list[dict] | None = None,
) -> tuple[str, dict | None, list[dict], list]:
    # Reserve bottom 10% for footer (code-controlled, not AI)
    footer_reserve_ratio = 0.10 if footer_text else 0.0
    content_h = round(canvas_h * (1 - footer_reserve_ratio))

    component_labels = [c["label"] for c in visual_components]
    try:
        flex_result = await vertex_service.suggest_flex_layout(
            image_bytes, mime, target_text, component_labels,
            {"w": canvas_w, "h": content_h},  # AI sees only content area
            ref_image_buffers, None,  # No footer sent to AI
            ref_descriptions=ref_descriptions,
            style_guide=style_guide,
            layout_strategy=layout_strategy,
            no_go_zones=no_go_zones,
            image_description=image_description,
            zone_hints=zone_hints,
        )
    except RuntimeError as err:
        send_sse("error", {"error": str(err)})
        return

    if flex_result.get("layoutThought"):
        log_event("Layout Design Reasoning", flex_result["layoutThought"][:1500])

    flex_boxes = compute_flex_layout(flex_result["flexTree"], canvas_w, content_h)

    # Add code-controlled footer box
    if footer_text:
        footer_y = content_h + 4
        footer_h = canvas_h - footer_y - 10
        flex_boxes.append(LayoutBox(
            id="footer_text", type="text",
            x=20, y=footer_y,
            w=canvas_w - 40, h=max(40, footer_h),
            text=footer_text,
            style=FlexNodeStyle(
                fontSize="10", fontWeight="400", color="#FFFFFF",
                align="left", lineHeight=1.1, maxLines=6,
            ),
        ))

    computed_boxes = [
        {"id": b.id, "type": b.type, "x": round(b.x), "y": round(b.y),
         "w": round(b.w), "h": round(b.h), "text": b.text, "label": b.label,
         "style": {
             "fontSize": b.style.fontSize,
             "fontWeight": b.style.fontWeight,
             "color": b.style.color,
             "strokeColor": b.style.strokeColor,
             "strokeWidth": b.style.strokeWidth,
             "align": b.style.align,
             "backgroundColor": b.style.backgroundColor,
             "lineHeight": b.style.lineHeight,
             "letterSpacing": b.style.letterSpacing,
             "textShadow": b.style.textShadow,
             "opacity": b.style.opacity,
             "skewX": b.style.skewX,
             "skewY": b.style.skewY,
             "perspective": b.style.perspective,
             "rotateX": b.style.rotateX,
             "rotateY": b.style.rotateY,
             "warpType": b.style.warpType,
             "warpIntensity": b.style.warpIntensity,
             "warpHDistortion": b.style.warpHDistortion,
             "warpVDistortion": b.style.warpVDistortion,
         } if b.style else None}
        for b in flex_boxes
    ]

    component_images = {}
    for vc in visual_components:
        if vc.get("imageUrl"):
            component_images[vc["label"]] = f"{origin}{vc['imageUrl']}"

    svg_bg_url = (
        f"{origin}{generated_bg_url}" if generated_bg_url
        else f"{origin}{ref_image_url}" if ref_image_url
        else None
    )

    bg_effects = flex_result.get("backgroundEffects", []) if flex_result else []
    # Auto-add bottom fade for footer readability
    if footer_text:
        bg_effects.append({
            "type": "linear-fade", "from": "bottom",
            "color": "rgba(0,0,0,0.7)", "size": "15%",
        })

    svg_result = build_flex_svg(FlexSVGInput(
        boxes=flex_boxes,
        canvas_w=canvas_w,
        canvas_h=canvas_h,  # Full canvas for SVG
        bg_image_url=svg_bg_url,
        component_images=component_images,
        background_effects=bg_effects if bg_effects else None,
    ))

    send_sse("debug", {
        "step": "flex_layout",
        "message": "Flex tree computed",
        "flexTree": flex_result["flexTree"],
        "boxes": computed_boxes,
    })

    return svg_result.svg, flex_result, computed_boxes, flex_boxes, bg_effects


async def _step_refinement_loop(
    image_bytes: bytes,
    mime: str,
    target_text: str,
    svg_overlay: str,
    visual_components: list[dict],
    component_suggestions: list[dict],
    analysis: dict,
    canvas_w: int,
    canvas_h: int,
    ref_image_buffers: list[bytes],
    footer_text: str | None,
    generated_bg_url: str | None,
    ref_image_url: str,
    origin: str,
    mode: str,
    send_sse,
    max_iter: int = 1,
    ref_descriptions: list[str] | None = None,
    style_guide: str | None = None,
    layout_thought: str | None = None,
    flex_boxes: list | None = None,
) -> tuple[str, dict]:
    current_svg = svg_overlay
    last_critique: dict = {"status": "FAIL"}
    iteration = 0

    if mode == "only_bg_comp":
        send_sse("progress", {"step": "refinement_skipped", "message": "Refinement skipped (Component Only Mode)."})
        return current_svg, {"status": "PASS", "feedback": "Skipped"}

    while iteration < max_iter and last_critique.get("status") != "PASS":
        iteration += 1
        send_sse("iteration_start", {
            "iteration": iteration, "maxIterations": max_iter,
            "message": f"Iteration {iteration}/{max_iter}: Generating preview...",
        })

        # Generate preview by compositing SVG onto base
        try:
            base_img = Image.open(BytesIO(image_bytes)).convert("RGBA")
            if current_svg and len(current_svg) > 50:
                try:
                    import cairosvg
                    svg_png = cairosvg.svg2png(
                        bytestring=current_svg.encode("utf-8"),
                        output_width=base_img.width,
                        output_height=base_img.height,
                    )
                    svg_layer = Image.open(BytesIO(svg_png)).convert("RGBA")
                    base_img = Image.alpha_composite(base_img, svg_layer)
                except ImportError:
                    pass
            preview_buf = BytesIO()
            base_img.save(preview_buf, format="PNG")
            preview_bytes = preview_buf.getvalue()
        except Exception:
            preview_bytes = image_bytes

        preview_url = _save_upload(preview_bytes, f"preview-iter{iteration}")
        send_sse("debug_preview", {
            "iteration": iteration, "previewUrl": preview_url,
            "message": "Preview generated, checking for overlaps...",
        })

        # Measure text contrast against the base image.
        # NOTE: Intentionally conservative -- measures against original image WITHOUT
        # gradient overlays. If a gradient overlay fixes contrast, the checker may still
        # report a failure. Acceptable for v1.
        contrast_summary = ""
        current_boxes = flex_boxes or []
        text_boxes_for_contrast = []
        for b in current_boxes:
            if b.type == "text" and b.style and b.style.color:
                text_boxes_for_contrast.append({
                    "id": b.id,
                    "x": round(b.x), "y": round(b.y),
                    "w": round(b.w), "h": round(b.h),
                    "color": b.style.color,
                })
        if text_boxes_for_contrast:
            contrast_results = check_text_contrast(image_bytes, text_boxes_for_contrast)
            failing = [r for r in contrast_results if not r["pass_aa"]]
            if failing:
                lines = [f"  - {r['id']}: ratio {r['ratio']}:1 (fg={r['fg']}, bg={r['bg']}) FAIL AA" for r in failing]
                contrast_summary = "CONTRAST FAILURES (WCAG AA < 4.5:1):\n" + "\n".join(lines)

        # AI critique
        critique = await vertex_service.critique_layout(
            image_bytes, preview_bytes, mime, target_text, False,
            has_components=bool(visual_components),
            style_guide=style_guide,
            layout_thought=layout_thought,
            contrast_data=contrast_summary,
        )
        last_critique = critique

        send_sse("critique_complete", {
            "iteration": iteration,
            "status": critique.get("status"),
            "confidence": critique.get("confidence"),
            "feedback": critique.get("feedback"),
            "actionableSteps": critique.get("actionable_steps", []),
            "message": (
                f"✅ Layout approved! (confidence: {int((critique.get('confidence', 0.5)) * 100)}%)"
                if critique.get("status") == "PASS"
                else f"❌ Issues found: {critique.get('feedback')}"
            ),
        })

        confidence = critique.get("confidence", 0.5)
        if critique.get("status") == "PASS":
            send_sse("progress", {"step": "refinement_complete", "message": "Layout approved!"})
            break

        if iteration >= max_iter:
            send_sse("progress", {"step": "max_iterations_reached", "message": "⚠️ Max iterations reached."})
            break

        # Refine
        send_sse("refining", {"iteration": iteration, "message": "Refining SVG layout based on feedback..."})

        try:
            feedback = critique.get("feedback", "")
            steps = critique.get("actionable_steps", [])
            if steps:
                feedback += "\nActionable steps: " + "; ".join(steps)
            refined_text = f"{target_text}\n\n[REFINEMENT FEEDBACK]:\n{feedback}"

            component_labels = [c["label"] for c in visual_components]
            refined_flex = await vertex_service.suggest_flex_layout(
                image_bytes, mime, refined_text, component_labels,
                {"w": canvas_w, "h": canvas_h},
                ref_image_buffers, footer_text or None,
                ref_descriptions=ref_descriptions,
                style_guide=style_guide,
            )

            refined_boxes = compute_flex_layout(refined_flex["flexTree"], canvas_w, canvas_h)
            flex_boxes = refined_boxes

            comp_imgs = {}
            for vc in visual_components:
                if vc.get("imageUrl"):
                    comp_imgs[vc["label"]] = f"{origin}{vc['imageUrl']}"

            svg_bg = (
                f"{origin}{generated_bg_url}" if generated_bg_url
                else f"{origin}{ref_image_url}" if ref_image_url
                else None
            )

            refined_svg_result = build_flex_svg(FlexSVGInput(
                boxes=refined_boxes, canvas_w=canvas_w, canvas_h=canvas_h,
                bg_image_url=svg_bg, component_images=comp_imgs,
            ))

            if refined_svg_result.svg and len(refined_svg_result.svg) > 50:
                current_svg = refined_svg_result.svg
                analysis["svg_overlay"] = current_svg
                analysis["flexTree"] = refined_flex["flexTree"]
            else:
                send_sse("refine_rejected", {
                    "iteration": iteration,
                    "message": "Refinement returned empty overlay — keeping previous layout.",
                })
        except Exception as e:
            print(f"[Refine] Refinement failed: {e}")

        send_sse("iteration_end", {
            "iteration": iteration,
            "message": f"SVG layout refined (iteration {iteration}).",
            "svg_overlay": current_svg,
            "componentCount": len(component_suggestions),
            "components": component_suggestions,
            "visualComponents": visual_components,
            "flexTree": analysis.get("flexTree"),
            "canvasSize": {"w": canvas_w, "h": canvas_h},
        })

    analysis["critique_iterations"] = iteration
    analysis["final_critique_status"] = last_critique.get("status")
    analysis["final_critique_feedback"] = last_critique.get("feedback")
    return current_svg, last_critique


async def create_campaign(
    request: Request,
    image: UploadFile | None,
    background: UploadFile | None,
    text: str | None,
    mode: str,
    no_go_zones_raw: str | None,
    body: dict | None,
    text_zone_hints_raw: str | None = None,
):
    async def event_generator():
        events: list[str] = []

        def send_sse(event: str, data: dict):
            events.append(f"event: {event}\ndata: {json.dumps(data, default=str)}\n\n")

        try:
            # Parse inputs
            if body and body.get("image"):
                image_buffer, mime_type = _decode_base64_image(body["image"])
                target_text = body.get("text") or text
                nonlocal mode, no_go_zones_raw
                mode = body.get("mode", mode or "")
                no_go_zones_raw = body.get("noGoZones", no_go_zones_raw)
            elif image and image.size:
                image_buffer = await _read_upload(image)
                mime_type = image.content_type or "image/png"
                target_text = text
            else:
                send_sse("error", {"error": "Reference image is required"})
                for e in events:
                    yield e
                return

            if not target_text:
                send_sse("error", {"error": "Text brief is required"})
                for e in events:
                    yield e
                return

            background_buffer: bytes | None = None
            if background and background.size:
                background_buffer = await _read_upload(background)

            # Parse no-go zones
            parsed_no_go: list[dict] = []
            if no_go_zones_raw:
                try:
                    parsed_no_go = json.loads(no_go_zones_raw) if isinstance(no_go_zones_raw, str) else no_go_zones_raw
                except Exception:
                    pass

            # Parse text zone hints
            text_zone_hints: list[dict] = []
            raw_hints = text_zone_hints_raw or (body.get("textZoneHints") if body else None)
            if raw_hints:
                try:
                    text_zone_hints = json.loads(raw_hints) if isinstance(raw_hints, str) else raw_hints
                except Exception:
                    text_zone_hints = []

            # Save reference image
            ref_url = _save_upload(image_buffer, "ref")

            # Flush initial events
            for e in events:
                yield e
            events.clear()

            # Step 1A: RMBG prescan
            masked_buf, rmbg_no_go = await _step_rmbg_prescan(image_buffer, send_sse)
            parsed_no_go = rmbg_no_go + parsed_no_go
            has_foreground = _has_extractable_foreground(masked_buf)
            for e in events:
                yield e
            events.clear()

            # Step 1B: Component placement (skip if no extractable foreground)
            if has_foreground:
                comp_analysis = await _step_component_placement(
                    image_buffer, mime_type, target_text, parsed_no_go, send_sse
                )
                component_suggestions = _dedup_components(comp_analysis.get("components", []))
            else:
                print("[Pipeline] No extractable foreground — skipping component detection & die-cut")
                send_sse("progress", {"step": "component_skip", "message": "Background-only image detected — skipping component extraction."})
                comp_analysis = await _step_component_placement(
                    image_buffer, mime_type, target_text, parsed_no_go, send_sse
                )
                component_suggestions = []
            analysis = {**comp_analysis, "suggestions": [], "components": component_suggestions}

            for e in events:
                yield e
            events.clear()

            # Step 1.5 + 2: Die-cut + inpaint
            visual_components, generated_bg_url, stack_urls, stroke_bboxes = await _step_diecut_and_inpaint(
                image_buffer, mime_type, component_suggestions,
                masked_buf, analysis, UPLOAD_DIR, ref_url, send_sse,
            )
            for e in events:
                yield e
            events.clear()

            # Get canvas dimensions
            img = Image.open(BytesIO(image_buffer))
            canvas_w, canvas_h = img.size

            # Get origin for absolute URLs
            origin = f"{request.url.scheme}://{request.headers.get('host', 'localhost:5001')}"

            svg_overlay = ""
            flex_tree = None
            flex_result: dict | None = None

            if mode != "only_bg_comp":
                # Plan layout strategy
                send_sse("progress", {"step": "text_layout", "message": "AI is planning layout strategy..."})

                current_positions = [
                    {"label": c["label"], **c["position"]}
                    for c in visual_components
                ]
                layout_hint: dict = {}
                try:
                    layout_hint = await vertex_service.plan_layout_strategy(
                        image_buffer, mime_type, target_text,
                        [c["label"] for c in visual_components],
                        current_positions,
                        text_zone_hints=text_zone_hints or None,
                    )
                    # Apply plan's component positions
                    if layout_hint.get("component_layout"):
                        for planned in layout_hint["component_layout"]:
                            comp = next((c for c in visual_components if c["label"] == planned["label"]), None)
                            if comp:
                                comp["position"] = {
                                    **comp["position"],
                                    "top": planned["top"], "left": planned["left"],
                                    "width": planned["width"], "height": planned["height"],
                                }

                    send_sse("progress", {
                        "step": "layout_strategy",
                        "message": f'🎨 Layout strategy: "{layout_hint.get("layout_concept", "")}"',
                    })
                except Exception as e:
                    print(f"[Pass2] Plan phase failed: {e}")

                for e in events:
                    yield e
                events.clear()

                # Reference image lookup
                ref_image_buffers: list[bytes] = []
                ref_descriptions: list[str] = []
                style_guide: str = ""
                desc_result: dict = {}
                try:
                    desc_result = await vertex_service.describe_and_embed(image_buffer, mime_type)
                    refs = find_similar_refs(desc_result["embedding"], 3)
                    if refs:
                        ref_image_buffers = [Path(r["filepath"]).read_bytes() for r in refs]
                        ref_descriptions = [r["description"] for r in refs]
                        style_guide = extract_style_guide(refs)
                        send_sse("debug", {
                            "step": "ref_images",
                            "message": f"Found {len(refs)} similar reference ads",
                            "style_guide_preview": style_guide[:200] if style_guide else "",
                        })
                except Exception as e:
                    print(f"[Pass2] Reference image search failed: {e}")

                # Footer text
                footer_path = Path(__file__).parent.parent.parent / "assets" / "Ref_Footer" / "footer.txt"
                footer_text = ""
                try:
                    if footer_path.exists():
                        footer_text = footer_path.read_text().strip()
                except Exception:
                    pass

                send_sse("progress", {"step": "text_layout", "message": "AI is generating layout intent..."})
                for e in events:
                    yield e
                events.clear()

                # Flex tree pipeline
                image_description: str | None = desc_result.get("description") or None

                all_no_go = (parsed_no_go or []) + [
                    {"top": b.get("top", 0), "left": b.get("left", 0),
                     "width": b.get("width", 0), "height": b.get("height", 0)}
                    for b in (stroke_bboxes or [])
                ]

                flex_boxes = []
                computed_boxes = []
                bg_effects_result: list = []
                try:
                    svg_overlay, flex_result, computed_boxes, flex_boxes, bg_effects_result = await _step_flex_layout(
                        image_bytes=image_buffer, mime=mime_type,
                        target_text=target_text,
                        visual_components=visual_components,
                        canvas_w=canvas_w, canvas_h=canvas_h,
                        ref_image_buffers=ref_image_buffers,
                        footer_text=footer_text or None,
                        generated_bg_url=generated_bg_url,
                        ref_image_url=ref_url,
                        origin=origin,
                        send_sse=send_sse,
                        ref_descriptions=ref_descriptions,
                        style_guide=style_guide,
                        layout_strategy=layout_hint if layout_hint else None,
                        no_go_zones=all_no_go or None,
                        image_description=image_description,
                        zone_hints=text_zone_hints or None,
                    )
                    analysis["svg_overlay"] = svg_overlay
                    flex_tree = flex_result.get("flexTree")
                    analysis["flexTree"] = flex_tree
                    analysis["background_description"] = flex_result.get("background_description") or analysis.get("background_description")
                    analysis["campaign_vibe"] = flex_result.get("campaign_vibe") or analysis.get("campaign_vibe")
                except Exception as e:
                    import traceback; traceback.print_exc()
                    print(f"[Pass2] Layout intent pipeline failed: {e}")

                for e in events:
                    yield e
                events.clear()

                send_sse("progress", {
                    "step": "initial_analysis_complete",
                    "message": f"SVG layout ready. Components: {len(visual_components)}",
                    "componentCount": len(visual_components),
                })

            # Send initial layout
            send_sse("iteration_end", {
                "iteration": 0,
                "message": "Initial layout mapped to canvas.",
                "svg_overlay": svg_overlay,
                "componentCount": len(component_suggestions),
                "components": component_suggestions,
                "visualComponents": visual_components,
                "flexTree": flex_tree,
                "computedBoxes": computed_boxes,
                "canvasSize": {"w": canvas_w, "h": canvas_h},
            })
            for e in events:
                yield e
            events.clear()

            # Refinement loop
            layout_thought = flex_result.get("layoutThought") if flex_result else None
            try:
                svg_overlay, last_critique = await _step_refinement_loop(
                    image_bytes=image_buffer, mime=mime_type,
                    target_text=target_text,
                    svg_overlay=svg_overlay,
                    visual_components=visual_components,
                    component_suggestions=component_suggestions,
                    analysis=analysis,
                    canvas_w=canvas_w, canvas_h=canvas_h,
                    ref_image_buffers=ref_image_buffers if mode != "only_bg_comp" else [],
                    footer_text=footer_text if mode != "only_bg_comp" else None,
                    generated_bg_url=generated_bg_url,
                    ref_image_url=ref_url,
                    origin=origin,
                    mode=mode or "",
                    send_sse=send_sse,
                    ref_descriptions=ref_descriptions if mode != "only_bg_comp" else None,
                    style_guide=style_guide if mode != "only_bg_comp" else None,
                    layout_thought=layout_thought if mode != "only_bg_comp" else None,
                    flex_boxes=flex_boxes if mode != "only_bg_comp" else None,
                )
            except Exception as e:
                send_sse("error", {
                    "step": "refinement_loop",
                    "message": "Feedback loop failed, continuing with initial analysis",
                    "error": str(e),
                })

            for e in events:
                yield e
            events.clear()

            # Extract text layers from flex tree for frontend
            text_layers = []
            if flex_tree:
                def _extract_text_nodes(node):
                    if not isinstance(node, dict):
                        return
                    if node.get("type") == "text" and node.get("text"):
                        text_layers.append({
                            "text": node["text"],
                            "position": {
                                "top": node.get("top", 0),
                                "left": node.get("left", 0),
                                "width": node.get("width", 0),
                                "height": node.get("height", 0),
                            },
                            "style": node.get("style", {}),
                        })
                    for child in node.get("children", []):
                        _extract_text_nodes(child)
                _extract_text_nodes(flex_tree)

            # Final result
            send_sse("done", {
                "success": True,
                "data": {
                    "referenceImage": ref_url,
                    "backgroundDescription": analysis.get("background_description", ""),
                    "generatedBackgroundImageUrl": generated_bg_url,
                    "campaignVibe": analysis.get("campaign_vibe", ""),
                    "svg_overlay": svg_overlay,
                    "flexTree": flex_tree,
                    "computedBoxes": computed_boxes,
                    "canvasSize": {"w": canvas_w, "h": canvas_h},
                    "textLayers": text_layers,
                    "visualComponents": visual_components,
                    "stackImageUrls": stack_urls,
                    "critiqueIterations": analysis.get("critique_iterations"),
                    "finalCritiqueStatus": analysis.get("final_critique_status"),
                    "finalCritiqueFeedback": analysis.get("final_critique_feedback"),
                    "backgroundEffects": bg_effects_result,
                },
            })
            for e in events:
                yield e

        except Exception as error:
            send_sse("error", {"error": str(error)})
            for e in events:
                yield e

    return StreamingResponse(
        event_generator(),
        media_type="text/event-stream",
        headers={"Cache-Control": "no-cache", "Connection": "keep-alive"},
    )


async def create_campaign_integrated(request: Request, body: dict):
    async def event_generator():
        events: list[str] = []

        def send_sse(event: str, data: dict):
            events.append(f"event: {event}\ndata: {json.dumps(data, default=str)}\n\n")

        try:
            text_brief = body.get("text_brief")
            visual_concept = body.get("visual_concept")
            aspect_ratio = body.get("aspect_ratio", "3:4")
            footer_text = body.get("footer_text", "")

            if not text_brief:
                send_sse("error", {"error": "text_brief is required"})
                for e in events:
                    yield e
                return
            if not visual_concept:
                send_sse("error", {"error": "visual_concept is required"})
                for e in events:
                    yield e
                return

            # Step 1: Plan text zones
            send_sse("progress", {"step": "planning_zones", "message": "Planning text zones..."})
            for e in events:
                yield e
            events.clear()

            plan = await vertex_service.plan_text_zones(text_brief, visual_concept, aspect_ratio)
            bg_constraints = plan.get("bg_constraints", "")
            text_zones = plan.get("text_zones", [])

            send_sse("progress", {
                "step": "zones_planned",
                "message": f"Planned {len(text_zones)} text zones",
                "textZones": text_zones,
                "bgConstraints": bg_constraints,
            })
            for e in events:
                yield e
            events.clear()

            # Step 2: Generate BG image
            send_sse("progress", {"step": "generating_bg", "message": "Generating background image..."})
            for e in events:
                yield e
            events.clear()

            cohesion = "The entire image must look like ONE cohesive photograph with smooth, natural transitions between all elements. No hard edges, no collage effect, no pasted-on sections."
            enriched_prompt = f"{visual_concept}. {cohesion} {bg_constraints}" if bg_constraints else visual_concept

            result = await vertex_service.generate_image(prompt=enriched_prompt, aspect_ratio=aspect_ratio)
            if not result or not result.get("buffer"):
                send_sse("error", {"error": "Failed to generate background image"})
                for e in events:
                    yield e
                return

            image_buffer = result["buffer"]
            mime_type = "image/png"
            bg_url = _save_upload(image_buffer, "integrated-bg")

            send_sse("progress", {"step": "bg_generated", "message": "Background generated", "imageUrl": bg_url})
            for e in events:
                yield e
            events.clear()

            # Step 3: Describe image + reference lookup
            img = Image.open(BytesIO(image_buffer))
            canvas_w, canvas_h = img.size
            origin = f"{request.url.scheme}://{request.headers.get('host', 'localhost:5001')}"

            ref_image_buffers: list[bytes] = []
            ref_descriptions: list[str] = []
            style_guide: str = ""
            desc_result: dict = {}
            image_description: str | None = None
            try:
                desc_result = await vertex_service.describe_and_embed(image_buffer, mime_type)
                image_description = desc_result.get("description")
                refs = find_similar_refs(desc_result["embedding"], 3)
                if refs:
                    ref_image_buffers = [Path(r["filepath"]).read_bytes() for r in refs]
                    ref_descriptions = [r["description"] for r in refs]
                    style_guide = extract_style_guide(refs)
            except Exception as e:
                print(f"[Integrated] Reference image search failed: {e}")

            # Footer text from file if not provided
            if not footer_text:
                footer_path = Path(__file__).parent.parent.parent / "assets" / "Ref_Footer" / "footer.txt"
                try:
                    if footer_path.exists():
                        footer_text = footer_path.read_text().strip()
                except Exception:
                    pass

            # Step 4: Plan layout strategy
            send_sse("progress", {"step": "planning_strategy", "message": "AI is planning layout strategy..."})
            for e in events:
                yield e
            events.clear()

            layout_hint: dict = {}
            try:
                layout_hint = await vertex_service.plan_layout_strategy(
                    image_buffer, mime_type, text_brief,
                    [],  # no component labels
                    [],  # no current positions
                    text_zone_hints=text_zones or None,
                )
                send_sse("progress", {
                    "step": "strategy_planned",
                    "message": f'Layout strategy: "{layout_hint.get("layout_concept", "")}"',
                })
            except Exception as e:
                print(f"[Integrated] Plan phase failed: {e}")

            for e in events:
                yield e
            events.clear()

            # Step 5: Flex layout (thought + tree -> compute -> SVG)
            send_sse("progress", {"step": "generating_layout", "message": "AI is generating layout..."})
            for e in events:
                yield e
            events.clear()

            visual_components: list[dict] = []
            component_suggestions: list[dict] = []
            svg_overlay = ""
            flex_tree = None
            flex_result: dict | None = None
            computed_boxes: list[dict] = []
            flex_boxes: list = []
            bg_effects_result: list = []

            try:
                svg_overlay, flex_result, computed_boxes, flex_boxes, bg_effects_result = await _step_flex_layout(
                    image_bytes=image_buffer, mime=mime_type,
                    target_text=text_brief,
                    visual_components=visual_components,
                    canvas_w=canvas_w, canvas_h=canvas_h,
                    ref_image_buffers=ref_image_buffers,
                    footer_text=footer_text or None,
                    generated_bg_url=bg_url,
                    ref_image_url=bg_url,
                    origin=origin,
                    send_sse=send_sse,
                    ref_descriptions=ref_descriptions,
                    style_guide=style_guide,
                    layout_strategy=layout_hint if layout_hint else None,
                    no_go_zones=None,
                    image_description=image_description,
                    zone_hints=text_zones or None,
                )
                flex_tree = flex_result.get("flexTree") if flex_result else None
            except Exception as e:
                import traceback; traceback.print_exc()
                print(f"[Integrated] Layout pipeline failed: {e}")

            for e in events:
                yield e
            events.clear()

            send_sse("progress", {
                "step": "layout_generated",
                "message": "Layout generated",
            })

            # Send initial layout
            send_sse("iteration_end", {
                "iteration": 0,
                "message": "Initial layout mapped to canvas.",
                "svg_overlay": svg_overlay,
                "componentCount": 0,
                "components": [],
                "visualComponents": [],
                "flexTree": flex_tree,
                "computedBoxes": computed_boxes,
                "canvasSize": {"w": canvas_w, "h": canvas_h},
            })
            for e in events:
                yield e
            events.clear()

            # Step 6: Critique (one pass)
            analysis = {
                "svg_overlay": svg_overlay,
                "flexTree": flex_tree,
                "background_description": flex_result.get("background_description") if flex_result else "",
                "campaign_vibe": flex_result.get("campaign_vibe") if flex_result else "",
            }
            layout_thought = flex_result.get("layoutThought") if flex_result else None

            try:
                svg_overlay, last_critique = await _step_refinement_loop(
                    image_bytes=image_buffer, mime=mime_type,
                    target_text=text_brief,
                    svg_overlay=svg_overlay,
                    visual_components=visual_components,
                    component_suggestions=component_suggestions,
                    analysis=analysis,
                    canvas_w=canvas_w, canvas_h=canvas_h,
                    ref_image_buffers=ref_image_buffers,
                    footer_text=footer_text or None,
                    generated_bg_url=bg_url,
                    ref_image_url=bg_url,
                    origin=origin,
                    mode="",
                    send_sse=send_sse,
                    max_iter=1,
                    ref_descriptions=ref_descriptions,
                    style_guide=style_guide,
                    layout_thought=layout_thought,
                    flex_boxes=flex_boxes,
                )
            except Exception as e:
                send_sse("error", {
                    "step": "refinement_loop",
                    "message": "Feedback loop failed, continuing with initial layout",
                    "error": str(e),
                })

            for e in events:
                yield e
            events.clear()

            # Extract text layers from flex tree
            text_layers = []
            if flex_tree:
                def _extract_text_nodes(node):
                    if not isinstance(node, dict):
                        return
                    if node.get("type") == "text" and node.get("text"):
                        text_layers.append({
                            "text": node["text"],
                            "position": {
                                "top": node.get("top", 0),
                                "left": node.get("left", 0),
                                "width": node.get("width", 0),
                                "height": node.get("height", 0),
                            },
                            "style": node.get("style", {}),
                        })
                    for child in node.get("children", []):
                        _extract_text_nodes(child)
                _extract_text_nodes(flex_tree)

            # Final result
            send_sse("done", {
                "success": True,
                "data": {
                    "referenceImage": bg_url,
                    "backgroundDescription": analysis.get("background_description", ""),
                    "generatedBackgroundImageUrl": bg_url,
                    "campaignVibe": analysis.get("campaign_vibe", ""),
                    "svg_overlay": svg_overlay,
                    "flexTree": flex_tree,
                    "computedBoxes": computed_boxes,
                    "canvasSize": {"w": canvas_w, "h": canvas_h},
                    "textLayers": text_layers,
                    "visualComponents": [],
                    "stackImageUrls": [],
                    "critiqueIterations": analysis.get("critique_iterations"),
                    "finalCritiqueStatus": analysis.get("final_critique_status"),
                    "finalCritiqueFeedback": analysis.get("final_critique_feedback"),
                    "textZones": text_zones,
                    "bgConstraints": bg_constraints,
                    "backgroundEffects": bg_effects_result,
                },
            })
            for e in events:
                yield e

        except Exception as error:
            send_sse("error", {"error": str(error)})
            for e in events:
                yield e

    return StreamingResponse(
        event_generator(),
        media_type="text/event-stream",
        headers={"Cache-Control": "no-cache", "Connection": "keep-alive"},
    )
