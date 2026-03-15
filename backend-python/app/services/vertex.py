from __future__ import annotations

import asyncio
import base64
import json
import re
import tempfile
from io import BytesIO
from pathlib import Path

from PIL import Image
from google import genai
from google.genai import types as genai_types
from google.oauth2 import service_account

from app.config import get_settings
from app.utils.ai_logger import trace_ai
from app.utils.flex_layout import FlexNode

# ---------------------------------------------------------------------------
# RMBG-2.0 model singleton
# ---------------------------------------------------------------------------
_rmbg2_model = None
_rmbg2_processor = None
_rmbg2_loading: asyncio.Lock | None = None

SAFETY_OFF = [
    genai_types.SafetySetting(category="HARM_CATEGORY_HATE_SPEECH", threshold="OFF"),
    genai_types.SafetySetting(category="HARM_CATEGORY_DANGEROUS_CONTENT", threshold="OFF"),
    genai_types.SafetySetting(category="HARM_CATEGORY_SEXUALLY_EXPLICIT", threshold="OFF"),
    genai_types.SafetySetting(category="HARM_CATEGORY_HARASSMENT", threshold="OFF"),
]


def _img_to_bytes(img: Image.Image, fmt: str = "PNG", **kwargs) -> bytes:
    buf = BytesIO()
    img.save(buf, format=fmt, **kwargs)
    return buf.getvalue()


def _open_image(data: bytes) -> Image.Image:
    return Image.open(BytesIO(data))


def _resize_for_processing(data: bytes, max_w: int = 1500, quality: int = 90) -> tuple[bytes, str]:
    img = _open_image(data)
    w, h = img.size
    if w > max_w:
        ratio = max_w / w
        img = img.resize((max_w, int(h * ratio)), Image.LANCZOS)
    img = img.convert("RGB")
    return _img_to_bytes(img, "JPEG", quality=quality), "image/jpeg"


def _b64(data: bytes) -> str:
    return base64.b64encode(data).decode()


def _inline_data(data: bytes, mime: str) -> dict:
    return {"inline_data": {"data": _b64(data), "mime_type": mime}}


def _clean_json(raw: str) -> str:
    return raw.replace("```json", "").replace("```", "").strip()


def _repair_json(raw: str) -> dict:
    cleaned = _clean_json(raw)
    try:
        return json.loads(cleaned or "{}")
    except json.JSONDecodeError:
        repaired = re.sub(r",\s*$", "", cleaned)
        opens = repaired.count("{") - repaired.count("}")
        repaired += "}" * max(0, opens)
        brackets = repaired.count("[") - repaired.count("]")
        repaired += "]" * max(0, brackets)
        cleaned2 = repaired.replace("\\'", "'")
        cleaned2 = re.sub(r"\\([^\"\\\/bfnrtu])", r"\1", cleaned2)
        cleaned2 = re.sub(r"[\x00-\x1f\x7f]", " ", cleaned2)
        return json.loads(cleaned2)


# ---------------------------------------------------------------------------
# Retry helper (module-level for testability)
# ---------------------------------------------------------------------------
async def with_retry(operation, retries: int = 3, delay: float = 2.0):
    try:
        return await operation()
    except Exception as e:
        msg = str(e)
        is_rate = "429" in msg or "Resource exhausted" in msg
        is_timeout = "TIMEOUT" in msg.upper() or "ETIMEDOUT" in msg
        if (is_rate or is_timeout) and retries > 0:
            reason = "429 Resource exhausted" if is_rate else "Timeout"
            print(f"⚠️ [GenAI] {reason}. Retrying in {delay}s... ({retries} left)")
            await asyncio.sleep(delay)
            return await with_retry(operation, retries - 1, delay * 2)
        raise


# ---------------------------------------------------------------------------
# VertexService
# ---------------------------------------------------------------------------
class VertexService:
    def __init__(self):
        self._client: genai.Client | None = None

    @property
    def client(self) -> genai.Client:
        if self._client is None:
            self._client = self._create_client()
        return self._client

    def _create_client(self) -> genai.Client:
        s = get_settings()
        creds_info = {
            "type": s.google_service_account_type,
            "project_id": s.google_service_account_project_id,
            "private_key_id": s.google_service_account_private_key_id,
            "private_key": s.google_service_account_private_key.replace("\\n", "\n"),
            "client_email": s.google_service_account_client_email,
            "client_id": s.google_service_account_client_id,
            "auth_uri": "https://accounts.google.com/o/oauth2/auth",
            "token_uri": "https://oauth2.googleapis.com/token",
            "auth_provider_x509_cert_url": "https://www.googleapis.com/oauth2/v1/certs",
            "universe_domain": "googleapis.com",
        }
        if not creds_info["client_email"] or not creds_info["private_key"]:
            raise ValueError("Missing required Google Cloud credentials for Vertex AI.")
        creds = service_account.Credentials.from_service_account_info(
            creds_info,
            scopes=["https://www.googleapis.com/auth/cloud-platform"],
        )
        client = genai.Client(
            vertexai=True,
            project=s.google_service_account_project_id,
            location=s.google_cloud_location,
            credentials=creds,
        )
        print(f"✅ Google GenAI client initialized (Vertex AI, location={s.google_cloud_location})")
        return client

    # ── helpers ──────────────────────────────────────────────────────────

    def _text_model(self) -> str:
        s = get_settings()
        return s.gemini_model_endpoint_2 or s.gemini_model_endpoint or "gemini-3-flash-preview"

    def _text_model_best(self) -> str:
        s = get_settings()
        return s.gemini_text_endpoint or s.gemini_model_endpoint or "gemini-2.5-flash"

    async def _generate_content(self, model: str, parts: list, config: dict | None = None):
        return await with_retry(lambda: self.client.aio.models.generate_content(
            model=model,
            contents=[{"role": "user", "parts": parts}],
            config=config,
        ))

    async def _generate_content_stream(self, model: str, parts: list, config: dict | None = None):
        return await with_retry(lambda: self.client.aio.models.generate_content_stream(
            model=model,
            contents=[{"role": "user", "parts": parts}],
            config=config,
        ))

    # ── Image Generation ────────────────────────────────────────────────

    async def generate_image(
        self,
        prompt: str,
        aspect_ratio: str = "1:1",
        resolution: str = "1K",
        input_images: list[dict] | None = None,
        model: str | None = None,
    ) -> dict:
        s = get_settings()
        primary = model or s.gemini_image_endpoint_2 or s.gemini_image_endpoint or "gemini-2.5-flash-image"
        fallback = s.gemini_image_endpoint if primary == s.gemini_image_endpoint_2 else None

        async def execute_gen(target_model: str) -> dict:
            parts = []
            if input_images:
                for img in input_images:
                    parts.append(_inline_data(img["buffer"], img["mime_type"]))
            clean_prompt = (
                "IMPORTANT: Do NOT include any text, typography, letters, words, numbers, "
                "logos with text, watermarks, or any written content in the generated image. "
                "The image must be completely free of any text elements. Only generate visual/graphical elements.\n\n"
                + prompt
            )
            parts.append({"text": clean_prompt})
            print(f"[GenAI] Generating image with model: {target_model}")

            config = {
                "temperature": 1,
                "top_p": 0.95,
                "response_modalities": ["TEXT", "IMAGE"],
                "image_config": {
                    "aspect_ratio": aspect_ratio,
                    "image_size": resolution,
                },
                "safety_settings": SAFETY_OFF,
            }

            print(f"[GenAI] Image generation config: aspect_ratio={aspect_ratio}, image_size={resolution}, model={target_model}")
            stream = await self._generate_content_stream(target_model, parts, config)
            generated_buffer = None
            response_text = ""
            async for chunk in stream:
                if chunk.text:
                    response_text += chunk.text
                if chunk.candidates and chunk.candidates[0].content and chunk.candidates[0].content.parts:
                    for part in chunk.candidates[0].content.parts:
                        if part.inline_data and part.inline_data.data:
                            generated_buffer = part.inline_data.data
                            if isinstance(generated_buffer, str):
                                generated_buffer = base64.b64decode(generated_buffer)
            return {"buffer": generated_buffer, "text": response_text, "prompt": prompt}

        try:
            return await execute_gen(primary)
        except Exception:
            if fallback and primary != fallback:
                print(f"⚠️ [GenAI] Primary model {primary} failed. Fallback to {fallback}...")
                return await execute_gen(fallback)
            raise

    async def render_campaign_image(
        self,
        image_buffer: bytes,
        mime_type: str,
        suggestions: list[dict],
        background_buffer: bytes | None = None,
    ) -> dict:
        text_desc = "\n".join(
            f'LINE {i+1}: "{s.get("part", "")}"\n'
            f'       - Style: {s.get("style", {}).get("font_family", "")}, '
            f'{s.get("style", {}).get("font_weight", "")}, Color {s.get("style", {}).get("color_hex", "")}\n'
            f'       - Container: {s.get("visual_container", "none")}\n'
            f'       - Size: {s.get("style", {}).get("font_size_normalized", 40)}\n'
            f'       - Position: {s.get("position", {}).get("explanation", "")}'
            for i, s in enumerate(suggestions)
        )
        input_images = [{"buffer": image_buffer, "mime_type": mime_type}]
        if background_buffer:
            input_images.append({"buffer": background_buffer, "mime_type": mime_type})
        base_inst = (
            "USE THE SECOND IMAGE AS YOUR CLEAN BACKGROUND CANVAS. Do NOT leave any ghosting of original text."
            if background_buffer else "Use the provided image as background."
        )
        prompt = f"""Create a high-quality, professional advertisement.
REFERENCE IMAGE 1: Desired layout, quality, and graphic style.
{"REFERENCE IMAGE 2: Clean background canvas to work on." if background_buffer else ""}

TASK:
1. {base_inst}
2. There are EXACTLY {len(suggestions)} text elements. Each one MUST appear on its OWN VISUAL LINE:
{text_desc}

CRITICAL DESIGN INSTRUCTIONS:
- Each LINE above is a SEPARATE visual line. Do NOT combine any two LINEs into one horizontal string.
- MATCH THE TEXT LAYOUT from Reference Image 1 exactly.
- If a 'Container' like 'yellow_ribbon' or 'red_banner' is mentioned, RECREATE that graphic element professionally.
- Text must be crisp, perfectly spelled, and high-contrast.
- Final result must look like a single, cohesive, high-end production."""
        return await self.generate_image(prompt=prompt, input_images=input_images)

    # ── Layout Planning ─────────────────────────────────────────────────

    async def plan_layout_strategy(
        self,
        image_buffer: bytes,
        mime_type: str,
        target_text: str,
        component_labels: list[str],
        component_positions: list[dict] | None = None,
    ) -> dict:
        proc_buf, proc_mime = _resize_for_processing(image_buffer, 800, 80)
        model = self._text_model()
        components_available = ", ".join(component_labels) if component_labels else "none detected yet"

        comp_pos_block = ""
        if component_positions:
            lines = [f"- {c['label']}: top={c['top']}, left={c['left']}, width={c['width']}, height={c['height']}"
                     for c in component_positions]
            comp_pos_block = "\nCURRENT COMPONENT POSITIONS (normalized 0-1000):\n" + "\n".join(lines)

        text_lines = [l for l in target_text.split("\n") if l.strip()]
        has_promo = bool(re.search(r"\d", target_text))
        est_promo_h = 180 if has_promo else 0
        est_other_h = (len(text_lines) - (1 if has_promo else 0)) * 65
        est_text_h = round(est_promo_h + est_other_h + 40)
        total_comp_area = sum(c.get("width", 0) * c.get("height", 0) for c in (component_positions or []))
        comp_pct = round(total_comp_area / (1000 * 1000) * 100)

        prompt = f"""You are a senior Thai advertising Art Director at a top Bangkok agency.
Look at this campaign image and text brief. Output a UNIFIED LAYOUT STRATEGY in JSON only.
CRITICAL: Plan WHERE COMPONENTS GO and WHERE TEXT GOES **together** as ONE layout.
{comp_pos_block}
TEXT SPACE ANALYSIS:
- Text items: {len(text_lines)} lines
- Contains promotional number: {"YES" if has_promo else "NO"}
- Estimated text zone height: ~{est_text_h} units
- Component area: {comp_pct}%

TEXT BRIEF:
\"\"\"{target_text}\"\"\"

VISUAL COMPONENTS: {components_available}

Respond with ONLY this JSON:
{{
  "layout_concept": "one short phrase",
  "dominant_element": "the SINGLE most important text/number",
  "text_zone": {{"top": 0, "left": 0, "width": 0, "height": 0}},
  "component_layout": [{{"label": "name", "top": 0, "left": 0, "width": 0, "height": 0}}],
  "recommended_text_zone": "left | right | bottom | full",
  "composition_notes": "1-2 sentence design decision",
  "text_hierarchy": ["ordered text parts"]
}}"""

        try:
            response = await self._generate_content(model, [_inline_data(proc_buf, proc_mime), {"text": prompt}], {"temperature": 0.7})
            raw = (response.text or "").strip()
            trace_ai("Plan Strategy", prompt, raw)
            strategy = _repair_json(raw)

            result = {
                "layout_concept": strategy.get("layout_concept", "default"),
                "dominant_element": strategy.get("dominant_element", ""),
                "text_hierarchy": strategy.get("text_hierarchy", []) if isinstance(strategy.get("text_hierarchy"), list) else [],
                "composition_notes": strategy.get("composition_notes", ""),
                "recommended_text_zone": strategy.get("recommended_text_zone", "left"),
            }
            if isinstance(strategy.get("text_zone"), dict):
                result["text_zone"] = strategy["text_zone"]
            if isinstance(strategy.get("component_layout"), list) and strategy["component_layout"]:
                result["component_layout"] = strategy["component_layout"]
            return result
        except Exception as err:
            print(f"[Plan] Strategy planning failed: {err}")
            return {"layout_concept": "default", "dominant_element": "", "text_hierarchy": [],
                    "composition_notes": "", "recommended_text_zone": "left"}

    async def suggest_campaign_layout(
        self,
        image_buffer: bytes,
        mime_type: str,
        target_text: str,
        mode: str = "full",
        external_no_go_zones: list | None = None,
        safe_zones: list | None = None,
        fixed_component_positions: list | None = None,
        text_zone: dict | None = None,
        layout_hint: dict | None = None,
    ) -> dict:
        proc_buf, proc_mime = _resize_for_processing(image_buffer)
        model = self._text_model()

        no_go_inst = ""
        if external_no_go_zones:
            zone_list = "\n".join(
                f"- {z.get('label', f'Zone {i+1}')}: [top:{z.get('top',0)}, left:{z.get('left',0)}, "
                f"width:{z.get('width',100)}, height:{z.get('height',100)}]"
                for i, z in enumerate(external_no_go_zones)
            )
            no_go_inst = f"\n🚫 STRICT FORBIDDEN ZONES:\n{zone_list}\n"

        safe_inst = ""
        if safe_zones:
            zone_list = "\n".join(
                f"  Zone {i+1} [{z.get('label','')}]: top={z['top']}, left={z['left']}, "
                f"width={z['width']}, height={z['height']} (area={z.get('area',0)})"
                for i, z in enumerate(safe_zones[:6])
            )
            safe_inst = f"\n✅ VERIFIED SAFE PLACEMENT ZONES:\n{zone_list}\n"

        fixed_comp_note = ""
        if fixed_component_positions:
            comp_list = "\n".join(
                f'  - "{c["label"]}": occupies left={c["left"]} to {c["left"]+c["width"]}, '
                f'top={c["top"]} to {c["top"]+c["height"]}'
                for c in fixed_component_positions
            )
            zone_desc = (
                f"top={text_zone['top']}, left={text_zone['left']}, width={text_zone['width']}, height={text_zone['height']}"
                if text_zone else "the open area not occupied by components"
            )
            fixed_comp_note = f"\nCOMPONENT POSITIONS FIXED:\n{comp_list}\nTEXT ZONE: {zone_desc}\n"

        hint_block = ""
        if layout_hint and layout_hint.get("layout_concept") != "default":
            hint_block = (
                f'\nART DIRECTOR STRATEGY:\nConcept: {layout_hint["layout_concept"]}\n'
                f'Dominant: "{layout_hint.get("dominant_element", "")}"\n'
                f'Hierarchy: {" › ".join(layout_hint.get("text_hierarchy", []))}\n'
                f'Notes: {layout_hint.get("composition_notes", "")}\n'
            )

        is_comp_only = mode == "only_bg_comp"

        prompt = f"""Act as a professional graphic designer.
Use 0-1000 normalized coordinates.

AD BRIEF:
\"\"\"{target_text}\"\"\"
{fixed_comp_note}{safe_inst or no_go_inst}{hint_block}

TASKS:
{"1. COMPONENT COMPOSITION: Detect visual components that ACTUALLY EXIST in the provided image. CRITICAL: Only list components you can visually SEE in the image pixels. Do NOT hallucinate components mentioned in the ad brief text that are not visible in the image. If the brief mentions a logo, phone mockup, or other element that is NOT visible in the image, do NOT include it in components. Components array must ONLY contain elements you can point to in the image." if is_comp_only else "1. PLACEMENT STRATEGY + TEXT EXTRACTION + COMPONENT COMPOSITION. CRITICAL: components array must ONLY contain elements visually present in the image, NOT elements mentioned in the brief text."}

Return as STRICT JSON:
{{
  "background_description": "...",
  "campaign_vibe": "...",
  "composition_text_zone": {{"top": 0, "left": 0, "width": 400, "height": 1000}},
  "spatial_analysis": {{"safe_zone": "LEFT|CENTER|RIGHT", "blocked_zones": [], "strategy": "..."}},
  "no_go_zones": [{{"priority": "HIGH", "label": "...", "area": {{"top": 0, "left": 0, "width": 0, "height": 0}}, "reason": "..."}}],
  "suggestions": [{{"part": "text", "preferred_zone": "zone-label", "position": {{"top": 0, "left": 0, "width": 0, "height": 0}},
    "style": {{"font_family": "Kanit", "font_weight": "bold", "color_hex": "#FFF", "font_size_normalized": 40,
      "text_align": "left", "shadow": "strong", "stroke_hex": "#000", "stroke_width": 4}},
    "hierarchy": "Headline|Body|FinePrint"}}],
  "components": [{{"label": "...", "description": "...", "position": {{"top": 0, "left": 0, "width": 0, "height": 0}},
    "suggested_position": {{"top": 0, "left": 0, "width": 0, "height": 0}}, "z_index": 15,
    "interaction_zone": {{"enabled": false}}}}]
}}

FONT RULES: font_family MUST be "Kanit" for ALL elements. font_weight: headline="800", body="600", fineprint="400", promo="900".
STROKE+SHADOW MANDATORY on all text. visual_container always "none"."""

        config = {"temperature": 1, "top_p": 0.95, "safety_settings": SAFETY_OFF}
        try:
            response = await self._generate_content(model, [_inline_data(proc_buf, proc_mime), {"text": prompt}], config)
            raw = (response.text or "").strip()
            return _repair_json(raw)
        except Exception as e:
            print(f"[GenAI] Suggest Layout Error: {e}")
            raise

    # ── Layout Preview & Critique ───────────────────────────────────────

    async def generate_layout_preview(
        self,
        base_image_buffer: bytes,
        suggestions: list[dict],
        components: list[dict],
        no_go_zones: list[dict] | None = None,
    ) -> bytes:
        img = _open_image(base_image_buffer)
        width, height = img.size

        def esc(s: str) -> str:
            return s.replace("&", "&amp;").replace("<", "&lt;").replace(">", "&gt;").replace("'", "&apos;").replace('"', "&quot;")

        font_style = ""
        font_dir = Path(__file__).parent.parent.parent / "assets" / "fonts"
        for weight, filename in [("400", "Kanit-Regular.ttf"), ("700", "Kanit-Bold.ttf"), ("900", "Kanit-Black.ttf")]:
            font_path = font_dir / filename
            if font_path.exists():
                font_b64 = _b64(font_path.read_bytes())
                font_style += f"@font-face{{font-family:'Kanit';font-weight:{weight};src:url('data:font/ttf;base64,{font_b64}') format('truetype');}}"

        svg = f'<svg width="{width}" height="{height}" viewBox="0 0 {width} {height}" xmlns="http://www.w3.org/2000/svg">'
        svg += f"""<defs>
<style>{font_style}</style>
<filter id="shadow-subtle" x="-5%" y="-5%" width="110%" height="110%"><feDropShadow dx="1" dy="1" stdDeviation="2" flood-color="#000" flood-opacity="0.5"/></filter>
<filter id="shadow-strong" x="-10%" y="-10%" width="120%" height="120%"><feDropShadow dx="2" dy="2" stdDeviation="4" flood-color="#000" flood-opacity="0.8"/></filter>
</defs>"""

        if no_go_zones:
            for z in no_go_zones:
                a = z.get("area", {})
                if not a:
                    continue
                zt = a.get("top", 0) / 1000 * height
                zl = a.get("left", 0) / 1000 * width
                zw = a.get("width", 0) / 1000 * width
                zh = a.get("height", 0) / 1000 * height
                svg += f'<rect x="{zl}" y="{zt}" width="{zw}" height="{zh}" fill="rgba(0,255,0,0.15)" stroke="#0F0" stroke-width="2" stroke-dasharray="6,3"/>'

        for c in components:
            pos = c.get("position", {})
            if not pos or "top" not in pos:
                continue
            ct = pos["top"] / 1000 * height
            cl = pos["left"] / 1000 * width
            cw = pos.get("width", 0) / 1000 * width
            ch = pos.get("height", 0) / 1000 * height
            svg += f'<rect x="{cl}" y="{ct}" width="{cw}" height="{ch}" fill="rgba(0,255,0,0.15)" stroke="#0F0" stroke-width="2"/>'
            svg += f'<text x="{cl+5}" y="{ct+15}" fill="#0F0" font-size="12">{esc(c.get("label", ""))}</text>'

        for idx, s in enumerate(suggestions):
            pos = s.get("position", {})
            if not pos or "top" not in pos:
                continue
            st = pos["top"] / 1000 * height
            sl = pos["left"] / 1000 * width
            sw = pos.get("width", 0) / 1000 * width
            sh = pos.get("height", 0) / 1000 * height
            fs = s.get("style", {}).get("font_size_normalized", 40)
            color = s.get("style", {}).get("color_hex", "#FFF")
            lh = s.get("style", {}).get("line_height", 1.2)
            ff = s.get("style", {}).get("font_family", "sans-serif")
            fw = s.get("style", {}).get("font_weight", "normal")
            shadow = s.get("style", {}).get("shadow", "none")
            filt = f'filter="url(#shadow-strong)"' if shadow == "strong" else (f'filter="url(#shadow-subtle)"' if shadow == "subtle" else "")
            stroke = ""
            if s.get("style", {}).get("stroke_hex"):
                stroke = f'stroke="{s["style"]["stroke_hex"]}" stroke-width="{s["style"].get("stroke_width", 2)*2}" paint-order="stroke" stroke-linejoin="round"'

            for i, line in enumerate((s.get("part", "")).split("\n")):
                ly = st + (i + 1) * fs * lh
                svg += f'<text x="{sl}" y="{ly}" fill="{color}" {stroke} font-family="{ff}" font-size="{fs}px" font-weight="{fw}" {filt}>{esc(line)}</text>'

        svg += "</svg>"

        # Composite SVG over base image using Pillow
        # We need cairosvg or similar for proper SVG rendering. For now, return the SVG as PNG via simple overlay.
        # In production, use cairosvg. For the preview, we'll composite using Pillow.
        try:
            import cairosvg
            svg_png = cairosvg.svg2png(bytestring=svg.encode(), output_width=width, output_height=height)
            overlay = _open_image(svg_png).convert("RGBA")
            base = img.convert("RGBA")
            composite = Image.alpha_composite(base, overlay)
            return _img_to_bytes(composite, "PNG")
        except ImportError:
            # Fallback: return base image (preview won't have overlays)
            print("[Preview] cairosvg not available, returning base image")
            return _img_to_bytes(img.convert("RGBA"), "PNG")

    async def critique_layout(
        self,
        original_buffer: bytes,
        preview_buffer: bytes,
        mime_type: str,
        target_text: str,
        style_only: bool = False,
    ) -> dict:
        model = self._text_model()
        prompt = f"""You are the STRICTEST ART DIRECTOR in the advertising industry.
IMAGE 1: ORIGINAL reference. IMAGE 2: PREVIEW with text overlays.
AD BRIEF: "{target_text}"

CRITIQUE CRITERIA: Check text overlap with faces, readability, contrast, composition.
{"Focus ONLY on visual style — positions verified by code." if style_only else "Check positions AND style."}

Return as STRICT JSON:
{{"status": "PASS" | "FAIL", "confidence": 0.0-1.0, "feedback": "...", "actionable_steps": ["fix 1", "fix 2"]}}"""

        try:
            parts = [
                _inline_data(original_buffer, mime_type),
                _inline_data(preview_buffer, "image/png"),
                {"text": prompt},
            ]
            response = await self._generate_content(model, parts)
            text = response.text or ""
            trace_ai("Critique Layout", prompt, text)
            json_match = re.search(r"\{[\s\S]*\}", text)
            if json_match:
                try:
                    return json.loads(json_match.group(0))
                except json.JSONDecodeError:
                    pass
            return {"status": "FAIL", "feedback": "Could not parse critique response", "actionable_steps": []}
        except Exception as e:
            print(f"[GenAI] Critique error: {e}")
            return {"status": "FAIL", "feedback": "Critique failed", "actionable_steps": []}

    # ── Layer Separation & Analysis ─────────────────────────────────────

    async def separate_layers(
        self,
        image_buffer: bytes,
        mime_type: str,
        background_buffer: bytes | None = None,
        hint_text: str | None = None,
    ) -> dict:
        model = self._text_model()
        parts: list = [_inline_data(image_buffer, mime_type)]
        comparison = ""
        if background_buffer:
            parts.append(_inline_data(background_buffer, mime_type))
            comparison = "TWO images provided: 1) composite, 2) original background. Identify ONLY added text."
        hint = f'HINT: User used this text: "{hint_text}"' if hint_text else ""

        prompt = f"""{comparison} {hint}
Analyze the image(s) and identify all individual text layers.
Return as STRICT JSON:
{{"layers": [{{"type": "text", "content": "...", "position": {{"top": 0, "left": 0, "width": 0, "height": 0}},
  "style": {{"font_family": "Kanit", "font_weight": "bold", "color_hex": "#FFF", "font_size_normalized": 40}}}}],
 "background": {{"description": "..."}}}}"""

        try:
            parts.append({"text": prompt})
            response = await self._generate_content(model, parts)
            raw = (response.text or "").strip()
            return _repair_json(raw)
        except Exception as e:
            print(f"[GenAI] Separate Layers Error: {e}")
            raise

    async def analyze_components(
        self,
        image_buffer: bytes,
        mime_type: str,
        background_buffer: bytes | None = None,
    ) -> dict:
        model = self._text_model()
        parts: list = [_inline_data(image_buffer, mime_type)]
        if background_buffer:
            parts.append(_inline_data(background_buffer, mime_type))

        prompt = """Analyze the image and identify all NON-TEXT visual components overlaid on the background.
Include: ribbons, banners, stickers, mascots, characters, logos, icons, person cutouts.
EXCLUDE: text, background scene itself.

GROUPING: If a person holds an object, it's ONE component (not separate).

Return as STRICT JSON:
{"components": [{"label": "short label", "description": "detailed visual description",
  "position": {"top": 0, "left": 0, "width": 0, "height": 0, "rotation": 0},
  "z_index": 15, "interaction_zone": {"enabled": false}}]}"""

        try:
            parts.append({"text": prompt})
            response = await self._generate_content(model, parts)
            raw = (response.text or "").strip()
            return _repair_json(raw)
        except Exception as e:
            print(f"[GenAI] Analyze Components Error: {e}")
            return {"components": []}

    # ── Background Removal ──────────────────────────────────────────────

    async def _remove_bg_rmbg2(self, image_buffer: bytes) -> bytes | None:
        global _rmbg2_model, _rmbg2_processor, _rmbg2_loading
        try:
            if _rmbg2_model is None or _rmbg2_processor is None:
                if _rmbg2_loading is None:
                    _rmbg2_loading = asyncio.Lock()
                async with _rmbg2_loading:
                    if _rmbg2_model is None:
                        print("[RMBG-2.0] Initializing model & processor...")
                        import torch
                        from transformers import AutoModelForImageSegmentation, AutoProcessor
                        _rmbg2_processor = AutoProcessor.from_pretrained("briaai/RMBG-2.0", trust_remote_code=True)
                        _rmbg2_model = AutoModelForImageSegmentation.from_pretrained(
                            "briaai/RMBG-2.0", trust_remote_code=True
                        )
                        _rmbg2_model.eval()
                        print("[RMBG-2.0] Model ready ✅")

            if not _rmbg2_model or not _rmbg2_processor:
                return None

            import torch
            import numpy as np

            MODEL_SIZE = 1024
            img = _open_image(image_buffer).convert("RGB")
            orig_w, orig_h = img.size
            resized = img.resize((MODEL_SIZE, MODEL_SIZE), Image.LANCZOS)

            inputs = _rmbg2_processor(resized, return_tensors="pt")
            with torch.no_grad():
                output = _rmbg2_model(**inputs)

            # Get the prediction mask
            pred = output[0].sigmoid().cpu()
            if pred.ndim == 4:
                pred = pred.squeeze(0).squeeze(0)
            elif pred.ndim == 3:
                pred = pred.squeeze(0)

            mask = (pred.numpy() * 255).astype(np.uint8)
            mask_img = Image.fromarray(mask, mode="L").resize((MODEL_SIZE, MODEL_SIZE), Image.LANCZOS)

            # Apply mask to resized original
            rgba = resized.copy().convert("RGBA")
            rgba.putalpha(mask_img)

            print(f"[RMBG-2.0] ✅ Done ({MODEL_SIZE}x{MODEL_SIZE})")
            return _img_to_bytes(rgba, "PNG")
        except Exception as e:
            print(f"[RMBG-2.0] Runtime failure: {e}")
            return None

    async def _remove_bg_full_image(self, image_buffer: bytes) -> bytes | None:
        try:
            img = _open_image(image_buffer)
            w, h = img.size
            max_dim = 1500
            if w > max_dim or h > max_dim:
                ratio = min(max_dim / w, max_dim / h)
                img = img.resize((int(w * ratio), int(h * ratio)), Image.LANCZOS)
            png_buf = _img_to_bytes(img.convert("RGBA"), "PNG")

            print("[Diecut/FullML] Sending full image to rembg...")
            from rembg import remove
            result = remove(png_buf)
            print(f"[Diecut/FullML] rembg done")
            return result
        except Exception as e:
            print(f"[Diecut/FullML] Full-image removal failed: {e}")
            return None

    async def warmup_rmbg2(self) -> None:
        try:
            print("[RMBG-2.0] Warming up model (256x256)...")
            dummy = Image.new("RGB", (256, 256), (255, 255, 255))
            await self._remove_bg_rmbg2(_img_to_bytes(dummy, "PNG"))
        except Exception as e:
            print(f"[RMBG-2.0] Warmup skip/fail: {e}")

    # ── Die-cut Generation ──────────────────────────────────────────────

    async def _extract_component_by_flood_fill(
        self, masked_full_buffer: bytes, position: dict, orig_w: int, orig_h: int, label: str = ""
    ) -> bytes | None:
        try:
            import numpy as np
            masked_img = _open_image(masked_full_buffer).convert("RGBA")
            mw, mh = masked_img.size
            scale_x = mw / orig_w
            scale_y = mh / orig_h

            cx = int((position["left"] + position["width"] / 2) / 1000 * orig_w * scale_x)
            cy = int((position["top"] + position["height"] / 2) / 1000 * orig_h * scale_y)

            pixels = np.array(masked_img)
            alpha = pixels[:, :, 3]
            THRESH = 10

            visited = np.zeros((mh, mw), dtype=bool)
            queue = []

            if alpha[cy, cx] >= THRESH:
                queue.append((cy, cx))
                visited[cy, cx] = True
            else:
                bl = max(0, int(position["left"] / 1000 * orig_w * scale_x))
                bt = max(0, int(position["top"] / 1000 * orig_h * scale_y))
                br = min(mw - 1, int((position["left"] + position["width"]) / 1000 * orig_w * scale_x))
                bb = min(mh - 1, int((position["top"] + position["height"]) / 1000 * orig_h * scale_y))
                found = False
                for y in range(bt, bb + 1):
                    for x in range(bl, br + 1):
                        if alpha[y, x] >= THRESH:
                            queue.append((y, x))
                            visited[y, x] = True
                            found = True
                            break
                    if found:
                        break
                if not found:
                    return None

            head = 0
            while head < len(queue):
                y, x = queue[head]
                head += 1
                for dy in range(-2, 3):
                    for dx in range(-2, 3):
                        if dy == 0 and dx == 0:
                            continue
                        ny, nx = y + dy, x + dx
                        if 0 <= ny < mh and 0 <= nx < mw and not visited[ny, nx] and alpha[ny, nx] >= THRESH:
                            visited[ny, nx] = True
                            queue.append((ny, nx))

            out = np.zeros_like(pixels)
            min_x, max_x, min_y, max_y = mw, 0, mh, 0
            for y, x in queue:
                out[y, x] = pixels[y, x]
                min_x = min(min_x, x)
                max_x = max(max_x, x)
                min_y = min(min_y, y)
                max_y = max(max_y, y)

            if min_x > max_x:
                return None

            cropped = Image.fromarray(out[min_y:max_y+1, min_x:max_x+1])
            print(f'[FloodFill] ✅ "{label}": {len(queue)} px → {max_x-min_x+1}x{max_y-min_y+1}')
            return _img_to_bytes(cropped, "PNG")
        except Exception as e:
            print(f'[FloodFill] Error for "{label}": {e}')
            return None

    async def _crop_and_diecut(
        self, image_buffer: bytes, position: dict, label: str = "", masked_full: bytes | None = None
    ) -> bytes | None:
        try:
            CHARACTER_KW = ["woman", "man", "girl", "boy", "mascot", "character", "person", "figure", "human", "chibi"]
            is_char = any(kw in label.lower() for kw in CHARACTER_KW)
            PAD = 0.1 if is_char else 0.04

            img = _open_image(image_buffer)
            orig_w, orig_h = img.size

            top_n = max(0, position["top"] / 1000 - PAD)
            left_n = max(0, position["left"] / 1000 - PAD)
            bottom_n = min(1, (position["top"] + position["height"]) / 1000 + PAD)
            right_n = min(1, (position["left"] + position["width"]) / 1000 + PAD)

            if masked_full:
                extracted = await self._extract_component_by_flood_fill(masked_full, position, orig_w, orig_h, label)
                if extracted:
                    target_w = round((right_n - left_n) * orig_w)
                    target_h = round((bottom_n - top_n) * orig_h)
                    ex_img = _open_image(extracted)
                    ex_img.thumbnail((target_w, target_h), Image.LANCZOS)
                    result = Image.new("RGBA", (target_w, target_h), (0, 0, 0, 0))
                    offset_x = (target_w - ex_img.width) // 2
                    offset_y = (target_h - ex_img.height) // 2
                    result.paste(ex_img, (offset_x, offset_y), ex_img)
                    return _img_to_bytes(result, "PNG")

            crop_left = round(left_n * orig_w)
            crop_top = round(top_n * orig_h)
            crop_w = round((right_n - left_n) * orig_w)
            crop_h = round((bottom_n - top_n) * orig_h)
            if crop_w < 10 or crop_h < 10:
                return None

            cropped = img.crop((crop_left, crop_top, crop_left + crop_w, crop_top + crop_h))
            cropped_buf = _img_to_bytes(cropped.convert("RGBA"), "PNG")

            result_buf = await self._remove_bg_rmbg2(cropped_buf)
            if not result_buf:
                from rembg import remove
                result_buf = remove(cropped_buf)

            if not result_buf:
                return None

            result_img = _open_image(result_buf).convert("RGBA")
            import numpy as np
            arr = np.array(result_img)
            arr[:, :, 3] = np.where(arr[:, :, 3] < 25, 0, arr[:, :, 3])
            result_img = Image.fromarray(arr)

            if not is_char:
                bbox = result_img.getbbox()
                if bbox:
                    result_img = result_img.crop(bbox)
            return _img_to_bytes(result_img, "PNG")
        except Exception as e:
            print(f"[Diecut/Crop] Error: {e}")
            return None

    async def _generate_single_diecut(
        self, image_buffer: bytes, mime_type: str, component: dict
    ) -> bytes | None:
        s = get_settings()
        model = s.gemini_image_endpoint_2 or s.gemini_image_endpoint or "gemini-3-pro-image-preview"
        label_lower = component.get("label", "").lower()
        CHARACTER_KW = ["woman", "man", "girl", "boy", "mascot", "character", "person", "figure", "human"]
        is_char = any(kw in label_lower for kw in CHARACTER_KW)

        prompt = (
            f'Recreate "{component["label"]}" as a HIGH-RESOLUTION CUTOUT on PURE WHITE BACKGROUND. '
            f'{component.get("description", "")} '
            f'{"FULL BODY from head to toes. No cropping." if is_char else "OBJECT ONLY, no hands/arms holding it."} '
            f'No text, no borders, no shadows. Centered with generous padding.'
        )
        parts = [_inline_data(image_buffer, mime_type), {"text": prompt}]
        config = {
            "temperature": 1,
            "top_p": 0.95,
            "response_modalities": ["TEXT", "IMAGE"],
            "safety_settings": SAFETY_OFF,
        }
        stream = await self._generate_content_stream(model, parts, config)
        img_buf = None
        async for chunk in stream:
            if chunk.candidates and chunk.candidates[0].content and chunk.candidates[0].content.parts:
                for part in chunk.candidates[0].content.parts:
                    if part.inline_data and part.inline_data.data and not img_buf:
                        data = part.inline_data.data
                        img_buf = base64.b64decode(data) if isinstance(data, str) else data
        if not img_buf:
            return None

        # Flood-fill white background removal
        import numpy as np
        img = _open_image(img_buf).convert("RGBA")
        arr = np.array(img)
        w, h = img.size
        WHITE_THRESH = 250

        bg = np.zeros((h, w), dtype=bool)
        queue = []

        def is_bg(x, y):
            r, g, b = arr[y, x, :3]
            return r >= WHITE_THRESH and g >= WHITE_THRESH and b >= WHITE_THRESH

        for x in range(w):
            for y in [0, h - 1]:
                if is_bg(x, y) and not bg[y, x]:
                    bg[y, x] = True
                    queue.append((x, y))
        for y in range(1, h - 1):
            for x in [0, w - 1]:
                if is_bg(x, y) and not bg[y, x]:
                    bg[y, x] = True
                    queue.append((x, y))

        head = 0
        while head < len(queue):
            cx, cy = queue[head]
            head += 1
            for dx, dy in [(-1, 0), (1, 0), (0, -1), (0, 1)]:
                nx, ny = cx + dx, cy + dy
                if 0 <= nx < w and 0 <= ny < h and not bg[ny, nx] and is_bg(nx, ny):
                    bg[ny, nx] = True
                    queue.append((nx, ny))

        arr[bg, 3] = 0

        # Alpha erosion (2 iterations)
        for _ in range(2):
            alpha_copy = arr[:, :, 3].copy()
            for y in range(1, h - 1):
                for x in range(1, w - 1):
                    if alpha_copy[y, x] > 0:
                        if alpha_copy[y, x-1] == 0 or alpha_copy[y, x+1] == 0 or alpha_copy[y-1, x] == 0 or alpha_copy[y+1, x] == 0:
                            arr[y, x, 3] = 0

        result = Image.fromarray(arr)
        bbox = result.getbbox()
        if bbox:
            result = result.crop(bbox)
        return _img_to_bytes(result, "PNG")

    @staticmethod
    def _diecut_quality_ok(buf: bytes, label: str, min_dim: int = 40, min_opaque_ratio: float = 0.05) -> bool:
        try:
            import numpy as np
            img = _open_image(buf).convert("RGBA")
            w, h = img.size
            if w < min_dim or h < min_dim:
                print(f'[Diecut QA] "{label}" too small: {w}x{h}')
                return False
            alpha = np.array(img)[:, :, 3]
            opaque_ratio = (alpha > 20).sum() / alpha.size
            if opaque_ratio < min_opaque_ratio:
                print(f'[Diecut QA] "{label}" nearly transparent: {opaque_ratio:.1%} opaque')
                return False
            return True
        except Exception:
            return True

    async def generate_diecut_components(
        self,
        image_buffer: bytes,
        mime_type: str,
        components: list[dict],
    ) -> dict:
        if not components:
            return {"results": [], "grid_images": [], "masked_full_buffer": None}

        all_results = []
        has_valid = any(
            c.get("position") and isinstance(c["position"].get("top"), (int, float)) and (c["position"].get("width", 0)) > 20
            for c in components
        )

        masked_full = None
        if has_valid:
            print("[Diecut] Running bg removal on full source image...")
            masked_full = await self._remove_bg_full_image(image_buffer)

        for i, comp in enumerate(components):
            pos = comp.get("position", {})
            has_pos = pos and isinstance(pos.get("top"), (int, float)) and pos.get("width", 0) > 20
            try:
                buf = None
                if has_pos:
                    buf = await self._crop_and_diecut(image_buffer, pos, comp.get("label", ""), masked_full)
                if not buf:
                    buf = await self._generate_single_diecut(image_buffer, mime_type, comp)
                    if i < len(components) - 1:
                        await asyncio.sleep(3)
                if buf and self._diecut_quality_ok(buf, comp.get("label", "")):
                    all_results.append({"label": comp.get("label", ""), "buffer": buf})
                elif buf:
                    print(f'[Diecut] Rejected "{comp.get("label")}" — failed quality check')
            except Exception as e:
                print(f'[Diecut] Failed for "{comp.get("label")}": {e}')

        # Build grid
        grid_images = []
        if all_results:
            try:
                THUMB = 256
                cols = min(3, len(all_results))
                rows = -(-len(all_results) // cols)
                grid = Image.new("RGBA", (cols * THUMB, rows * THUMB), (255, 255, 255, 255))
                for idx, r in enumerate(all_results):
                    col, row = idx % cols, idx // cols
                    thumb = _open_image(r["buffer"]).convert("RGBA")
                    thumb.thumbnail((THUMB - 10, THUMB - 10), Image.LANCZOS)
                    grid.paste(thumb, (col * THUMB + 5, row * THUMB + 5), thumb)
                grid_images.append(_img_to_bytes(grid, "PNG"))
            except Exception as e:
                print(f"[GenAI] Grid build failed: {e}")

        return {"results": all_results, "grid_images": grid_images, "masked_full_buffer": masked_full}

    # ── Inpainting ──────────────────────────────────────────────────────

    async def inpaint_background(
        self,
        image_buffer: bytes,
        masked_full_buffer: bytes,
        analysis: dict,
        on_mask_ready=None,
    ) -> dict:
        try:
            import numpy as np
            masked_img = _open_image(masked_full_buffer).convert("RGBA")
            arr = np.array(masked_img)
            mw, mh = masked_img.size

            # Binarize alpha → B&W inpaint mask
            bw = np.zeros((mh, mw, 4), dtype=np.uint8)
            bw[:, :, 3] = 255
            fg = arr[:, :, 3] > 30
            bw[fg, 0] = 255
            bw[fg, 1] = 255
            bw[fg, 2] = 255

            mask_png = _img_to_bytes(Image.fromarray(bw), "PNG")

            if on_mask_ready:
                preview = _open_image(mask_png).resize((mw // 4, mh // 4), Image.LANCZOS)
                on_mask_ready(_b64(_img_to_bytes(preview, "PNG")))

            s = get_settings()
            edit_model = s.imagen_edit_endpoint or "imagen-3.0-capability-001"
            print(f"[Inpaint] Calling Imagen 3 ({edit_model})")

            mask_ref = genai_types.MaskReferenceImage(
                reference_id=1,
                reference_image=genai_types.Image(image_bytes=mask_png, mime_type="image/png"),
                config=genai_types.MaskReferenceConfig(
                    mask_mode="MASK_MODE_USER_PROVIDED",
                    mask_dilation=0.03,
                ),
            )
            raw_ref = genai_types.RawReferenceImage(
                reference_id=0,
                reference_image=genai_types.Image(image_bytes=image_buffer, mime_type="image/png"),
            )

            response = await with_retry(lambda: self.client.aio.models.edit_image(
                model=edit_model,
                prompt="",
                reference_images=[raw_ref, mask_ref],
                config=genai_types.EditImageConfig(
                    edit_mode="EDIT_MODE_INPAINT_REMOVAL",
                    number_of_images=1,
                    output_mime_type="image/png",
                    person_generation="ALLOW_ALL",
                ),
            ))

            if response.generated_images and response.generated_images[0].image:
                img_bytes = response.generated_images[0].image.image_bytes
                if img_bytes:
                    print("[Inpaint] ✅ Successfully inpainted background")
                    return {"buffer": img_bytes if isinstance(img_bytes, bytes) else base64.b64decode(img_bytes)}
            return {"buffer": None}
        except Exception as e:
            print(f"[Inpaint] Error: {e}")
            return {"buffer": None}

    # ── RMBG + Bboxes ──────────────────────────────────────────────────

    async def run_rmbg_and_get_bboxes(self, image_buffer: bytes) -> dict:
        try:
            import numpy as np
            masked = await self._remove_bg_rmbg2(image_buffer)
            if not masked:
                return {"masked_buffer": None, "bboxes": []}

            img = _open_image(masked).convert("RGBA")
            arr = np.array(img)
            w, h = img.size
            alpha = arr[:, :, 3]
            fg = alpha > 50
            if not fg.any():
                return {"masked_buffer": masked, "bboxes": []}

            ys, xs = np.where(fg)
            bbox = {
                "label": "Detected Subject",
                "top": round(int(ys.min()) / h * 1000),
                "left": round(int(xs.min()) / w * 1000),
                "width": round(int(xs.max() - xs.min()) / w * 1000),
                "height": round(int(ys.max() - ys.min()) / h * 1000),
            }
            return {"masked_buffer": masked, "bboxes": [bbox]}
        except Exception as e:
            print(f"[RMBG-2.0] Bbox detection failed: {e}")
            return {"masked_buffer": None, "bboxes": []}

    async def extract_component_stroke_bboxes(self, components: list[dict]) -> list[dict]:
        import numpy as np
        results = []
        for comp in components:
            if not comp.get("buffer") or not comp.get("position"):
                continue
            try:
                img = _open_image(comp["buffer"]).convert("RGBA")
                arr = np.array(img)
                w, h = img.size
                alpha = arr[:, :, 3]
                fg = alpha > 30
                if not fg.any():
                    continue
                ys, xs = np.where(fg)
                pos = comp["position"]
                cl = pos["left"] / 1000
                ct = pos["top"] / 1000
                cw = pos["width"] / 1000
                ch = pos["height"] / 1000
                nl = cl + (int(xs.min()) / w) * cw
                nt = ct + (int(ys.min()) / h) * ch
                nr = cl + ((int(xs.max()) + 1) / w) * cw
                nb = ct + ((int(ys.max()) + 1) / h) * ch
                results.append({
                    "label": comp["label"],
                    "top": round(nt * 1000),
                    "left": round(nl * 1000),
                    "width": round((nr - nl) * 1000),
                    "height": round((nb - nt) * 1000),
                })
            except Exception:
                if comp.get("position"):
                    results.append({
                        "label": comp.get("label", ""),
                        "top": comp["position"].get("top", 0),
                        "left": comp["position"].get("left", 0),
                        "width": comp["position"].get("width", 0),
                        "height": comp["position"].get("height", 0),
                    })
        return results

    # ── Rendering ───────────────────────────────────────────────────────

    async def render_simple_composite(self, base_image_buffer: bytes, suggestions: list[dict]) -> bytes:
        base = _open_image(base_image_buffer).convert("RGBA")
        width, height = base.size

        for s in suggestions:
            pos = s.get("position", {})
            if not pos or "top" not in pos:
                continue
            if s.get("type") == "image" and s.get("imageUrl"):
                try:
                    filename = s["imageUrl"].split("/")[-1]
                    local_path = Path(__file__).parent.parent.parent / "uploads" / filename
                    if local_path.exists():
                        comp_img = Image.open(local_path).convert("RGBA")
                        cw = round(pos.get("width", 0) / 1000 * width)
                        ch = round(pos.get("height", 0) / 1000 * height)
                        comp_img = comp_img.resize((cw, ch), Image.LANCZOS)
                        ct = round(pos["top"] / 1000 * height)
                        cl = round(pos["left"] / 1000 * width)
                        base.paste(comp_img, (cl, ct), comp_img)
                except Exception as e:
                    print(f"[SimpleRender] Failed: {e}")
                continue
            # Text rendering via SVG would need cairosvg; for now skip text overlay in simple mode
            # The controller typically uses the SVG builder for text rendering

        return _img_to_bytes(base, "PNG")

    # ── SVG Export ──────────────────────────────────────────────────────

    async def export_svg(
        self,
        svg_overlay: str,
        background_buffer: bytes | None,
        mode: str = "embed-fonts",
    ) -> str:
        vb_match = re.search(r'viewBox="0 0 (\d+) (\d+)"', svg_overlay)
        w = int(vb_match.group(1)) if vb_match else 1080
        h = int(vb_match.group(2)) if vb_match else 1080

        bg_layer = ""
        if background_buffer:
            bg_b64 = _b64(background_buffer)
            bg_layer = f'<image id="background" href="data:image/jpeg;base64,{bg_b64}" x="0" y="0" width="{w}" height="{h}" preserveAspectRatio="xMidYMid slice"/>'

        if mode == "embed-fonts":
            font_dir = Path(__file__).parent.parent.parent / "assets" / "fonts"
            font_defs = ""
            variants = [
                ("400", "Kanit-Regular.ttf"),
                ("700", "Kanit-Bold.ttf"),
                ("900", "Kanit-Black.ttf"),
            ]
            for weight, filename in variants:
                font_path = font_dir / filename
                if font_path.exists():
                    font_b64 = _b64(font_path.read_bytes())
                    font_defs += f"@font-face{{font-family:'Kanit';font-weight:{weight};src:url('data:font/ttf;base64,{font_b64}') format('truetype');}}"

            if "<defs>" in svg_overlay:
                result = svg_overlay.replace("<defs>", f"<defs><style>{font_defs}</style>")
            else:
                result = re.sub(r"(<svg[^>]*>)", rf"\1<defs><style>{font_defs}</style></defs>", svg_overlay)
            return re.sub(r"(<svg[^>]*>)", rf"\1{bg_layer}", result)

        return svg_overlay

    # ── Flex Layout ─────────────────────────────────────────────────────

    def _validate_flex_tree(self, node: dict, component_labels: list[str], path: str = "root") -> list[str]:
        warnings = []
        if not node.get("id"):
            warnings.append(f"{path}: missing id")
        is_container = "direction" in node or isinstance(node.get("children"), list)
        if is_container:
            if not node.get("direction"):
                warnings.append(f"{path}: container missing direction")
            children = node.get("children", [])
            if not children:
                warnings.append(f"{path}: container has no children")
            for i, child in enumerate(children):
                warnings.extend(self._validate_flex_tree(child, component_labels, f"{path}.children[{i}]"))
        else:
            if node.get("type") == "component":
                if not node.get("label"):
                    warnings.append(f"{path}: component missing label")
                elif node["label"] not in component_labels:
                    warnings.append(f'{path}: label "{node["label"]}" not in {component_labels}')
            elif node.get("type") == "text" and not node.get("text"):
                warnings.append(f"{path}: text leaf missing text")
        return warnings

    def _strip_component_nodes(self, node: dict) -> None:
        children = node.get("children")
        if not isinstance(children, list):
            return
        filtered = []
        for child in children:
            if child.get("type") == "component":
                print(f'[FlexLayout] Stripped hallucinated component node: "{child.get("label", child.get("id", "?"))}"')
                continue
            self._strip_component_nodes(child)
            filtered.append(child)
        node["children"] = filtered

    async def suggest_flex_layout(
        self,
        image_buffer: bytes,
        mime_type: str,
        target_text: str,
        component_labels: list[str],
        canvas_size: dict,
        ref_images: list[bytes] | None = None,
        footer_text: str | None = None,
    ) -> dict:
        proc_buf, proc_mime = _resize_for_processing(image_buffer)
        model = self._text_model_best()
        components_list = (
            "Available die-cut components:\n" + "\n".join(f'  - "{l}"' for l in component_labels)
            if component_labels
            else "No die-cut components available. CRITICAL: Do NOT create any component nodes in the flex tree. ALL elements must be type \"text\". Even if the brief mentions logos, phone mockups, or other visual elements — they do not exist as die-cut images so you MUST NOT include them as component leaves."
        )
        ref_section = (
            f"REFERENCE IMAGES:\nThe first {len(ref_images)} images are examples of well-designed layouts.\n"
            "Study their composition. THE LAST IMAGE is the actual background.\n\n"
            if ref_images else ""
        )
        footer_section = (
            f'FOOTER TEXT (MUST be at bottom): "{footer_text}"\n' if footer_text else ""
        )

        prompt = f"""You are a master of 2D graphic design and visual composition.

{ref_section}CAMPAIGN TEXT:
{target_text}

{components_list}
{footer_section}
CANVAS: {canvas_size["w"]}x{canvas_size["h"]}px

STEP 1 — DESIGN REASONING in <layout_thought>...</layout_thought>
STEP 2 — ELEMENT GROUPING in <grouping>...</grouping>
STEP 3 — FLEX TREE JSON:
{{"flexTree": {{...}}, "campaign_vibe": "...", "background_description": "..."}}

FLEX TREE FORMAT:
Container: {{"id":"...", "direction":"row|column", "children":[...], "height":"40%", "width":"60%", "gap":16, "padding":20}}
Text leaf: {{"id":"...", "type":"text", "text":"...", "height":"30%", "style":{{"fontSize":"xlarge|large|medium|small|xsmall", "fontWeight":"900|700|400", "color":"#FFD700", "strokeColor":"#000", "strokeWidth":2, "align":"center|left|right", "backgroundColor":"#4B0082"}}}}
Component leaf: {{"id":"...", "type":"component", "label":"must match available labels", "height":"50%"}}

RULES:
- Every text line MUST appear as a text leaf.
- ONLY create component leaves for labels listed in "Available die-cut components" above. If none are listed, use ZERO component nodes.
- Do NOT invent component nodes for elements mentioned in the brief text (logos, mockups, etc.) unless they appear in the available components list.
- Root is always "column" with padding. Use "row" inside for horizontal groupings.
- Hero/promo number = LARGEST element (fontSize "xlarge", fontWeight "900").
- Group related elements together. Use strokeColor for readability on busy backgrounds."""

        parts = []
        if ref_images:
            for ref in ref_images:
                parts.append(_inline_data(ref, "image/jpeg"))
        parts.append(_inline_data(proc_buf, proc_mime))
        parts.append({"text": prompt})

        print(f"[FlexLayout] Calling {model} (canvas: {canvas_size['w']}x{canvas_size['h']}, components: {len(component_labels)})")

        try:
            response = await self._generate_content(model, parts, {"temperature": 0.7})
            raw = response.text or ""

            thought_match = re.search(r"<layout_thought>([\s\S]*?)</layout_thought>", raw)
            grouping_match = re.search(r"<grouping>([\s\S]*?)</grouping>", raw)
            layout_thought = (thought_match.group(1).strip()) if thought_match else ""
            grouping_text = (grouping_match.group(1).strip()) if grouping_match else ""

            if layout_thought:
                trace_ai("Flex Layout Thought", layout_thought[:2000])

            json_str = re.sub(r"<layout_thought>[\s\S]*?</layout_thought>", "", raw)
            json_str = re.sub(r"<grouping>[\s\S]*?</grouping>", "", json_str)
            json_str = re.sub(r"```(?:json)?\s*", "", json_str)
            json_str = re.sub(r"\s*```", "", json_str)
            json_str = json_str.strip()

            start = json_str.find("{")
            end = json_str.rfind("}")
            if start == -1 or end == -1:
                raise ValueError("No JSON object found")
            json_str = json_str[start:end + 1]
            parsed = json.loads(json_str)

            if not isinstance(parsed.get("flexTree"), dict):
                raise ValueError("No flexTree object")

            if not component_labels:
                self._strip_component_nodes(parsed["flexTree"])

            warnings = self._validate_flex_tree(parsed["flexTree"], component_labels)
            if warnings:
                print(f"[FlexLayout] Warnings: {warnings}")

            return {
                "flexTree": parsed["flexTree"],
                "campaign_vibe": parsed.get("campaign_vibe", "modern advertising"),
                "background_description": parsed.get("background_description", "campaign background"),
                "layoutThought": layout_thought,
                "grouping": grouping_text,
            }
        except Exception as err:
            print(f"[FlexLayout] Parse failed, using fallback: {err}")
            text_lines = [l.strip() for l in target_text.split("\n") if l.strip()]
            text_children = [
                {"id": f"text-{i}", "type": "text", "text": line,
                 "height": f"{80 // max(1, len(text_lines))}%",
                 "style": {"fontSize": "large" if i == 0 else "medium", "fontWeight": "900" if i == 0 else "400",
                           "color": "#FFFFFF", "strokeColor": "#000000", "strokeWidth": 2, "align": "center"}}
                for i, line in enumerate(text_lines)
            ]
            comp_children = [
                {"id": f"comp-{i}", "type": "component", "label": label,
                 "height": f"{100 // max(1, len(component_labels))}%"}
                for i, label in enumerate(component_labels)
            ]
            root_children = []
            if text_children:
                root_children.append({"id": "text-col", "direction": "column", "children": text_children,
                                       "width": "60%" if comp_children else "100%"})
            if comp_children:
                root_children.append({"id": "comp-col", "direction": "column", "children": comp_children,
                                       "width": "40%" if text_children else "100%"})
            return {
                "flexTree": {"id": "root", "direction": "row", "padding": 30, "gap": 20,
                             "children": root_children or [{"id": "fb", "type": "text", "text": target_text,
                                                            "style": {"fontSize": "large", "fontWeight": "700", "color": "#FFF"}}]},
                "campaign_vibe": "default",
                "background_description": "campaign background",
                "layoutThought": "",
                "grouping": "",
            }

    # ── Describe & Embed ────────────────────────────────────────────────

    async def describe_and_embed(self, image_buffer: bytes, mime_type: str) -> dict:
        proc_buf, proc_mime = _resize_for_processing(image_buffer, 800, 80)
        model = self._text_model_best()

        desc_resp = await self._generate_content(
            model,
            [_inline_data(proc_buf, proc_mime),
             {"text": "Describe this image for ad-layout similarity matching in 2-3 sentences. Cover: layout areas, dominant colors, visual style, mood."}],
            {"temperature": 0.3},
        )
        description = (desc_resp.text or "").strip() or "Generic advertisement background"

        embed_resp = await with_retry(lambda: self.client.aio.models.embed_content(
            model="gemini-embedding-001",
            contents=description,
            config={"task_type": "RETRIEVAL_QUERY", "output_dimensionality": 1536},
        ))
        embedding = []
        if hasattr(embed_resp, "embeddings") and embed_resp.embeddings:
            embedding = list(embed_resp.embeddings[0].values)
        return {"description": description, "embedding": embedding}


vertex_service = VertexService()
