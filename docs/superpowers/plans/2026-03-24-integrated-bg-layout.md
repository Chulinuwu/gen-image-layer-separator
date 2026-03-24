# Integrated BG + Layout Generation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Enable background generation with text layout awareness, so backgrounds naturally leave clean space for text placement.

**Architecture:** Add a "text zone pre-planner" that analyzes the text brief and visual concept to determine where text needs space. The BG generation prompt is enriched with spatial constraints (e.g., "leave top 25% as clean sky for headline"). The existing campaign pipeline then works on a background that was designed to accommodate text from the start. This is an additive feature -- existing flow (generate BG separately, then add text) remains unchanged.

**Tech Stack:** FastAPI, Google Vertex AI (Gemini), Vue 3, TypeScript

---

## Phase 1: Backend Text Zone Pre-Planner

### Task 1: Create text zone planner prompt

**Files:** `backend-python/app/prompts/text_zone_planner.py` (create)

**What it does:** Defines the prompt for a lightweight AI call that analyzes the text brief and visual concept, then decides WHERE in the frame text will need clean space before the background is generated.

- [ ] Write the failing test first:

  ```
  # backend-python/tests/test_text_zone_planner.py
  from app.prompts.text_zone_planner import build_text_zone_prompt

  def test_build_text_zone_prompt_contains_brief():
      prompt = build_text_zone_prompt(
          text_brief="SUMMER SALE 50% OFF\nLimited time offer",
          visual_concept="a beach scene at sunset",
          aspect_ratio="3:4",
      )
      assert "SUMMER SALE 50% OFF" in prompt
      assert "beach scene at sunset" in prompt
      assert "3:4" in prompt

  def test_build_text_zone_prompt_requests_json():
      prompt = build_text_zone_prompt(
          text_brief="Headline\nBody",
          visual_concept="city skyline",
          aspect_ratio="16:9",
      )
      assert "text_zones" in prompt
      assert "bg_constraints" in prompt
      assert "JSON" in prompt

  def test_build_text_zone_prompt_includes_role_guidance():
      prompt = build_text_zone_prompt(
          text_brief="BIG PROMO 999",
          visual_concept="product shot",
          aspect_ratio="1:1",
      )
      # Should mention designer roles for zones
      assert "headline" in prompt.lower()
      assert "region" in prompt.lower()
  ```

  Run (expect failure):
  ```bash
  cd /Users/chulinxz/gen-image-layer-separator/backend-python
  source venv/bin/activate && python -m pytest tests/test_text_zone_planner.py -v
  ```

- [ ] Create `backend-python/app/prompts/text_zone_planner.py`:

  ```python
  def build_text_zone_prompt(
      text_brief: str,
      visual_concept: str,
      aspect_ratio: str,
  ) -> str:
      return f"""You are a senior advertising art director planning a background image composition.
  Your job is to analyze the TEXT BRIEF and VISUAL CONCEPT, then decide WHERE in the frame text elements need clean, readable space.
  The background image has NOT been generated yet -- your output will shape how it is generated.

  ASPECT RATIO: {aspect_ratio}
  VISUAL CONCEPT: {visual_concept}

  TEXT BRIEF:
  \"\"\"{text_brief}\"\"\"

  YOUR TASK:
  1. Identify the text elements: headline (largest, most important), body copy, promo numbers, brand/CTA.
  2. Based on the visual concept and aspect ratio, decide the OPTIMAL placement for each group.
     Think like a designer: where would a clean sky, solid wall, blur, or empty space naturally exist in this scene?
  3. Describe spatial constraints in natural language that will be appended to the image generation prompt.

  RULES:
  - Headline needs the most prominent clean zone (min 20-30% of frame height).
  - Body copy needs a secondary clean zone (min 15-20% of frame height).
  - Brand/CTA can share space or occupy a small area.
  - Zones should NOT overlap significantly.
  - Consider the aspect ratio: tall (portrait) images have more vertical stack room; wide images favor side-by-side.
  - The bottom 10% of the frame is reserved for footer/disclaimer -- do NOT allocate zones there.
  - Describe each zone so the image generator will produce a NATURAL scene element in that area (sky, gradient, blur, solid surface).

  OUTPUT JSON only (no markdown, no explanation):
  {{
    "text_zones": [
      {{
        "role": "headline",
        "region": "top-center",
        "height_pct": 25,
        "description": "clean open sky or softly blurred background area"
      }},
      {{
        "role": "body",
        "region": "bottom-left",
        "height_pct": 20,
        "description": "soft gradient fade to dark, suitable for light text"
      }}
    ],
    "bg_constraints": "natural language spatial constraints to append to the image generation prompt, e.g.: Leave the top 25% of the frame as clear open sky or a softly blurred neutral area suitable for a headline. The bottom-left 20% should have a soft dark gradient or shadowed surface for body text. Place the main subject in the center-right."
  }}
  """
  ```

- [ ] Run tests (expect pass):
  ```bash
  cd /Users/chulinxz/gen-image-layer-separator/backend-python
  source venv/bin/activate && python -m pytest tests/test_text_zone_planner.py -v
  ```

- [ ] Commit:
  ```bash
  git add backend-python/app/prompts/text_zone_planner.py backend-python/tests/test_text_zone_planner.py
  git commit -m "feat: add text zone planner prompt for integrated BG generation"
  ```

---

### Task 2: Add plan_text_zones() service method

**Files:** `backend-python/app/services/vertex.py` (modify)

**What it does:** Lightweight AI call using the standard text model (not best -- this is a planning step, not final output) that takes text brief + visual concept and returns structured zone data.

- [ ] Write the failing test first:

  ```
  # backend-python/tests/test_text_zone_planner.py  (append to existing file)
  from unittest.mock import AsyncMock, MagicMock, patch
  import pytest

  @pytest.mark.asyncio
  @patch("app.services.vertex.VertexAIService._generate_content")
  async def test_plan_text_zones_parses_response(mock_gen):
      from app.services.vertex import VertexAIService
      svc = VertexAIService.__new__(VertexAIService)

      mock_response = MagicMock()
      mock_response.text = """{
        "text_zones": [
          {"role": "headline", "region": "top-center", "height_pct": 25, "description": "clear sky"}
        ],
        "bg_constraints": "Leave the top 25% as clear sky."
      }"""
      mock_gen.return_value = mock_response

      result = await svc.plan_text_zones(
          text_brief="BIG PROMO 50%",
          visual_concept="beach sunset",
          aspect_ratio="3:4",
      )
      assert "text_zones" in result
      assert len(result["text_zones"]) == 1
      assert result["text_zones"][0]["role"] == "headline"
      assert "bg_constraints" in result

  @pytest.mark.asyncio
  @patch("app.services.vertex.VertexAIService._generate_content")
  async def test_plan_text_zones_strips_markdown_fences(mock_gen):
      from app.services.vertex import VertexAIService
      svc = VertexAIService.__new__(VertexAIService)

      mock_response = MagicMock()
      mock_response.text = "```json\n{\"text_zones\": [], \"bg_constraints\": \"none\"}\n```"
      mock_gen.return_value = mock_response

      result = await svc.plan_text_zones(
          text_brief="Hello",
          visual_concept="forest",
          aspect_ratio="1:1",
      )
      assert result["bg_constraints"] == "none"
  ```

  Run (expect failure):
  ```bash
  cd /Users/chulinxz/gen-image-layer-separator/backend-python
  source venv/bin/activate && python -m pytest tests/test_text_zone_planner.py::test_plan_text_zones_parses_response -v
  ```

- [ ] Add `plan_text_zones()` to `VertexAIService` in `backend-python/app/services/vertex.py`.

  Locate the class body (after `suggest_campaign_layout` or near the end of service methods) and insert:

  ```python
  async def plan_text_zones(
      self,
      text_brief: str,
      visual_concept: str,
      aspect_ratio: str,
  ) -> dict:
      from app.prompts.text_zone_planner import build_text_zone_prompt
      model = self._text_model()
      prompt = build_text_zone_prompt(text_brief, visual_concept, aspect_ratio)
      response = await self._generate_content(model, [{"text": prompt}], {"temperature": 0.5})
      raw = (response.text or "").strip()
      # Strip markdown fences if present
      if raw.startswith("```"):
          raw = raw.split("```")[1]
          if raw.startswith("json"):
              raw = raw[4:]
          raw = raw.strip()
      import json
      data = json.loads(raw)
      trace_ai("Text Zone Planner", prompt, raw)
      return data
  ```

- [ ] Run tests (expect pass):
  ```bash
  cd /Users/chulinxz/gen-image-layer-separator/backend-python
  source venv/bin/activate && python -m pytest tests/test_text_zone_planner.py -v
  ```

- [ ] Commit:
  ```bash
  git add backend-python/app/services/vertex.py backend-python/tests/test_text_zone_planner.py
  git commit -m "feat: add plan_text_zones service method with JSON parsing and trace logging"
  ```

---

### Task 3: Add generate_integrated() controller function

**Files:** `backend-python/app/controllers/image.py` (modify)

**What it does:** Orchestrates the two-step integrated flow: (1) call `plan_text_zones()` to get spatial constraints, (2) enrich the visual concept prompt with `bg_constraints`, (3) call `generate_image()` with enriched prompt, (4) return image URL plus zone metadata for use in the campaign pipeline.

- [ ] Write the failing test first:

  ```
  # backend-python/tests/test_integrated_generate.py
  from unittest.mock import AsyncMock, patch
  import pytest


  @patch("app.controllers.image.vertex_service")
  def test_generate_integrated_enriches_prompt(mock_vs, client):
      mock_vs.plan_text_zones = AsyncMock(return_value={
          "text_zones": [
              {"role": "headline", "region": "top-center", "height_pct": 25, "description": "clear sky"}
          ],
          "bg_constraints": "Leave the top 25% as clear open sky.",
      })
      mock_vs.generate_image = AsyncMock(return_value={
          "buffer": b"\x89PNG fake",
          "text": "ok",
          "prompt": "beach scene. Leave the top 25% as clear open sky.",
      })

      resp = client.post("/api/image/generate-integrated", json={
          "text_brief": "SUMMER SALE 50%",
          "visual_concept": "beach scene at sunset",
          "aspect_ratio": "3:4",
      })
      assert resp.status_code == 200
      data = resp.json()
      assert data["success"] is True
      assert "imageUrl" in data["data"]
      assert "textZones" in data["data"]
      assert len(data["data"]["textZones"]) == 1
      assert "bgConstraints" in data["data"]

      # Verify the prompt sent to generate_image was enriched
      call_kwargs = mock_vs.generate_image.call_args
      sent_prompt = call_kwargs.kwargs.get("prompt") or call_kwargs.args[0]
      assert "Leave the top 25%" in sent_prompt


  @patch("app.controllers.image.vertex_service")
  def test_generate_integrated_requires_text_brief(mock_vs, client):
      resp = client.post("/api/image/generate-integrated", json={
          "visual_concept": "forest",
          "aspect_ratio": "1:1",
      })
      assert resp.status_code == 400


  @patch("app.controllers.image.vertex_service")
  def test_generate_integrated_requires_visual_concept(mock_vs, client):
      resp = client.post("/api/image/generate-integrated", json={
          "text_brief": "Hello",
          "aspect_ratio": "1:1",
      })
      assert resp.status_code == 400
  ```

  Run (expect failure):
  ```bash
  cd /Users/chulinxz/gen-image-layer-separator/backend-python
  source venv/bin/activate && python -m pytest tests/test_integrated_generate.py -v
  ```

- [ ] Add `generate_integrated()` to `backend-python/app/controllers/image.py`.

  Add near `generate_and_separate` (after it):

  ```python
  async def generate_integrated(request: Request, body: dict):
      text_brief = body.get("text_brief", "").strip()
      visual_concept = body.get("visual_concept", "").strip()
      aspect_ratio = body.get("aspect_ratio", "3:4")

      if not text_brief:
          return JSONResponse({"error": "text_brief is required"}, status_code=400)
      if not visual_concept:
          return JSONResponse({"error": "visual_concept is required"}, status_code=400)

      zone_data = await vertex_service.plan_text_zones(text_brief, visual_concept, aspect_ratio)
      bg_constraints = zone_data.get("bg_constraints", "")
      text_zones = zone_data.get("text_zones", [])

      enriched_prompt = visual_concept
      if bg_constraints:
          enriched_prompt = f"{visual_concept}. {bg_constraints}"

      result = await vertex_service.generate_image(
          prompt=enriched_prompt,
          aspect_ratio=aspect_ratio,
      )

      if not result.get("buffer"):
          return JSONResponse(
              {"success": False, "message": "Failed to generate image", "text": result.get("text")},
              status_code=500,
          )

      url = _save_upload(result["buffer"], "generated")
      return JSONResponse({
          "success": True,
          "data": {
              "imageUrl": url,
              "textZones": text_zones,
              "bgConstraints": bg_constraints,
              "text": result.get("text"),
              "prompt": enriched_prompt,
          },
      })
  ```

- [ ] Run tests (expect pass):
  ```bash
  cd /Users/chulinxz/gen-image-layer-separator/backend-python
  source venv/bin/activate && python -m pytest tests/test_integrated_generate.py -v
  ```

- [ ] Commit:
  ```bash
  git add backend-python/app/controllers/image.py backend-python/tests/test_integrated_generate.py
  git commit -m "feat: add generate_integrated controller that enriches BG prompt with text zone constraints"
  ```

---

### Task 4: Add route /api/image/generate-integrated

**Files:** `backend-python/app/routes/image.py` (modify)

**What it does:** Exposes the integrated generate endpoint. Accepts JSON body only (no multipart -- this is a concept-to-image flow, no input images).

- [ ] Write the failing test first (route-level, append to `test_integrated_generate.py`):

  ```python
  def test_route_generate_integrated_exists(client):
      # Without body -> 422 validation or 400 from controller
      resp = client.post("/api/image/generate-integrated", json={})
      # Should not be 404 (route must exist)
      assert resp.status_code != 404
  ```

  Run (expect 404 failure before route is added):
  ```bash
  cd /Users/chulinxz/gen-image-layer-separator/backend-python
  source venv/bin/activate && python -m pytest tests/test_integrated_generate.py::test_route_generate_integrated_exists -v
  ```

- [ ] Add the import and route to `backend-python/app/routes/image.py`:

  In the import block at the top, add `generate_integrated` to the imports from `app.controllers.image`:
  ```python
  from app.controllers.image import (
      create_campaign,
      export_svg_handler,
      generate_and_separate,
      generate_integrated,
      process_image,
      render_campaign,
      suggest_campaign,
  )
  ```

  Add the route after the existing `/generate` route:
  ```python
  @router.post("/generate-integrated")
  async def route_generate_integrated(request: Request):
      try:
          body = await request.json()
      except Exception:
          body = {}
      return await generate_integrated(request, body)
  ```

- [ ] Run full test suite to confirm no regressions:
  ```bash
  cd /Users/chulinxz/gen-image-layer-separator/backend-python
  source venv/bin/activate && python -m pytest tests/ -v
  ```

- [ ] Commit:
  ```bash
  git add backend-python/app/routes/image.py
  git commit -m "feat: add POST /api/image/generate-integrated route"
  ```

---

## Phase 2: Frontend Integrated Mode

### Task 5: Add sharedTextBrief and sharedTextZones to App.vue

**Files:** `frontend/src/App.vue` (modify)

**What it does:** App.vue owns all cross-tab shared state. We add `sharedTextBrief` (the text brief the user typed in Tab 1) and `sharedTextZones` (zone metadata returned by the integrated API) so Tab 2 can pre-fill the brief and receive zone hints.

- [ ] Modify `frontend/src/App.vue`.

  In the `<script setup>` block, after `sharedCampaignData`:
  ```typescript
  const sharedTextBrief = ref<string | undefined>(undefined);
  const sharedTextZones = ref<any[]>([]);
  const sharedBgConstraints = ref<string | undefined>(undefined);

  const onIntegratedGenerated = (payload: { url: string; textBrief: string; textZones: any[]; bgConstraints: string }) => {
    sharedBackgroundUrl.value = payload.url;
    sharedTextBrief.value = payload.textBrief;
    sharedTextZones.value = payload.textZones;
    sharedBgConstraints.value = payload.bgConstraints;
  };
  ```

  Update the `<ImageGenerator>` usage in the template:
  ```html
  <ImageGenerator
    v-if="activeTab === 'generate'"
    @generated="onBackgroundGenerated"
    @integrated-generated="onIntegratedGenerated"
    @proceed="activeTab = 'campaign'"
  />
  ```

  Update the `<CampaignLayout>` usage:
  ```html
  <CampaignLayout
    v-if="activeTab === 'campaign'"
    :initialBackgroundUrl="sharedBackgroundUrl"
    :initialTextBrief="sharedTextBrief"
    :initialTextZones="sharedTextZones"
    @created="onCampaignCreated"
    @proceed="activeTab = 'editor'"
  />
  ```

- [ ] Commit:
  ```bash
  git add frontend/src/App.vue
  git commit -m "feat: add sharedTextBrief and sharedTextZones state to App.vue for integrated mode"
  ```

---

### Task 6: Add integrated mode UI to ImageGenerator.vue

**Files:** `frontend/src/components/ImageGenerator.vue` (modify)

**What it does:** Adds an "Integrated Mode" checkbox. When checked, a text brief textarea appears. On generate, calls `/api/image/generate-integrated` instead of `/api/image/generate`, then emits both the image URL and the zone metadata upstream.

- [ ] Modify `frontend/src/components/ImageGenerator.vue`.

  In `<script setup>`, add after `const emit = defineEmits(...)`:
  ```typescript
  const integratedMode = ref(false);
  const textBrief = ref("");
  ```

  Replace `generateImage` with a mode-aware version:
  ```typescript
  const generateImage = async () => {
    loading.value = true;
    error.value = "";
    result.value = null;

    try {
      if (integratedMode.value) {
        if (!textBrief.value.trim()) {
          error.value = "Text brief is required for integrated mode";
          return;
        }
        const response = await fetch("http://localhost:5001/api/image/generate-integrated", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            text_brief: textBrief.value,
            visual_concept: prompt.value,
            aspect_ratio: aspectRatio.value,
          }),
        });
        const data = await response.json();
        if (data.success) {
          result.value = data.data;
          emit("generated", data.data.imageUrl);
          emit("integrated-generated", {
            url: data.data.imageUrl,
            textBrief: textBrief.value,
            textZones: data.data.textZones || [],
            bgConstraints: data.data.bgConstraints || "",
          });
        } else {
          error.value = data.error || "Failed to generate image";
        }
      } else {
        const formData = new FormData();
        formData.append("prompt", prompt.value);
        formData.append("aspect_ratio", aspectRatio.value);
        const response = await fetch("http://localhost:5001/api/image/generate", {
          method: "POST",
          body: formData,
        });
        const data = await response.json();
        if (data.success) {
          result.value = data.data;
          emit("generated", data.data.imageUrl);
        } else {
          error.value = data.error || "Failed to generate image";
        }
      }
    } catch (err: any) {
      error.value = err.message;
    } finally {
      loading.value = false;
    }
  };
  ```

  In `<template>`, add after the aspect ratio section and before the generate button:
  ```html
  <div class="mb-4">
    <label class="label">
      <input type="checkbox" v-model="integratedMode" style="margin-right: 8px;" />
      Integrated Mode (plan text layout with background)
    </label>
    <p v-if="integratedMode" class="hint">
      The background will be generated with clean zones reserved for your text.
    </p>
  </div>

  <div v-if="integratedMode" class="mb-4">
    <label class="label">Text Brief</label>
    <textarea
      v-model="textBrief"
      rows="4"
      placeholder="Paste your ad copy here, e.g.:&#10;SUMMER SALE 50% OFF&#10;Limited time offer&#10;Shop now at example.com"
    ></textarea>
    <p class="hint">Describe your full text content. The AI will plan clean zones in the background for each element.</p>
  </div>
  ```

  Add `.hint` style in `<style scoped>`:
  ```css
  .hint {
    font-size: 0.8rem;
    color: var(--secondary);
    margin-top: 4px;
  }
  ```

- [ ] Commit:
  ```bash
  git add frontend/src/components/ImageGenerator.vue
  git commit -m "feat: add integrated mode checkbox and text brief input to ImageGenerator"
  ```

---

### Task 7: Accept text brief in CampaignLayout.vue

**Files:** `frontend/src/components/CampaignLayout.vue` (modify)

**What it does:** When the user used integrated mode in Tab 1, their text brief auto-fills in Tab 2 so they don't have to type it again. The zone hints are stored locally for passing to the campaign API in Task 8.

- [ ] Modify `frontend/src/components/CampaignLayout.vue`.

  In `defineProps`, add new props:
  ```typescript
  const props = defineProps({
    initialBackgroundUrl: String,
    initialTextBrief: String,
    initialTextZones: {
      type: Array as () => any[],
      default: () => [],
    },
  });
  ```

  Add a local ref for text zones (received from integrated mode):
  ```typescript
  const integratedTextZones = ref<any[]>([]);
  ```

  In `onMounted`, after the existing background loading block, add:
  ```typescript
  if (props.initialTextBrief) {
    targetText.value = props.initialTextBrief;
  }
  if (props.initialTextZones && props.initialTextZones.length > 0) {
    integratedTextZones.value = props.initialTextZones;
  }
  ```

  In the `createCampaign` function, when building the FormData or JSON body (inside the SSE call), include zone hints if available. Find where `formData.append("text", ...)` is set and after it add:
  ```typescript
  if (integratedTextZones.value.length > 0) {
    formData.append("textZoneHints", JSON.stringify(integratedTextZones.value));
  }
  ```

  Add a subtle indicator in the template so the user knows zones are active. Find the text brief textarea section and add below it:
  ```html
  <p v-if="integratedTextZones.length > 0" class="zone-hint-badge">
    {{ integratedTextZones.length }} pre-planned text zones from background generation active
  </p>
  ```

  Add style:
  ```css
  .zone-hint-badge {
    font-size: 0.78rem;
    color: #067a47;
    background: #ecfdf5;
    border: 1px solid #a7f3d0;
    border-radius: 4px;
    padding: 4px 8px;
    margin-top: 4px;
  }
  ```

- [ ] Commit:
  ```bash
  git add frontend/src/components/CampaignLayout.vue
  git commit -m "feat: pre-fill text brief from integrated mode and store zone hints in CampaignLayout"
  ```

---

## Phase 3: Feed Zone Hints to Campaign Pipeline

### Task 8: Accept text_zone_hints in create_campaign SSE endpoint

**Files:** `backend-python/app/controllers/image.py` (modify)

**What it does:** The `create_campaign` function currently ignores zone hints. We add optional parsing of `textZoneHints` from the request body so downstream steps can use them.

- [ ] Write the failing test first (append to `test_integrated_generate.py`):

  ```python
  import json as _json

  @patch("app.controllers.image.vertex_service")
  def test_create_campaign_accepts_text_zone_hints(mock_vs, client):
      import io
      fake_image = io.BytesIO(b"\x89PNG\r\n" + b"\x00" * 100)
      fake_image.name = "test.png"

      mock_vs.run_rmbg_and_get_bboxes = AsyncMock(return_value=(b"\x00" * 100, [], 0.01))
      mock_vs.plan_layout_strategy = AsyncMock(return_value={
          "layout_concept": "top-bottom split",
          "dominant_element": "headline",
          "image_analysis": {"subject_position": "center", "clean_areas": [], "busy_areas": []},
          "text_zones": [],
          "component_layout": [],
          "layout_type": "single-column",
          "composition_notes": "test",
      })

      zone_hints = [{"role": "headline", "region": "top-center", "height_pct": 25}]
      resp = client.post(
          "/api/image/create-campaign",
          data={
              "text": "TEST BRIEF",
              "mode": "full",
              "textZoneHints": _json.dumps(zone_hints),
          },
          files={"image": ("test.png", fake_image, "image/png")},
      )
      # Just verifying the route accepts the param without 422
      assert resp.status_code != 422
  ```

  Run (expect failure):
  ```bash
  cd /Users/chulinxz/gen-image-layer-separator/backend-python
  source venv/bin/activate && python -m pytest tests/test_integrated_generate.py::test_create_campaign_accepts_text_zone_hints -v
  ```

- [ ] In `backend-python/app/controllers/image.py`, locate the `create_campaign` function signature and add `text_zone_hints_raw` parameter:

  ```python
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
  ```

  Inside `event_generator()`, after parsing `no_go_zones_raw` (find the block that parses it, typically `json.loads`), add:
  ```python
  text_zone_hints: list[dict] = []
  raw_hints = text_zone_hints_raw or (body.get("textZoneHints") if body else None)
  if raw_hints:
      try:
          text_zone_hints = json.loads(raw_hints) if isinstance(raw_hints, str) else raw_hints
      except Exception:
          text_zone_hints = []
  ```

- [ ] Update the route in `backend-python/app/routes/image.py` to pass the new form param:

  ```python
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
  ```

- [ ] Run tests:
  ```bash
  cd /Users/chulinxz/gen-image-layer-separator/backend-python
  source venv/bin/activate && python -m pytest tests/ -v
  ```

- [ ] Commit:
  ```bash
  git add backend-python/app/controllers/image.py backend-python/app/routes/image.py backend-python/tests/test_integrated_generate.py
  git commit -m "feat: accept optional textZoneHints in create_campaign endpoint"
  ```

---

### Task 9: Enrich layout strategy with zone hints

**Files:** `backend-python/app/prompts/layout_strategy.py` (modify)

**What it does:** When the background was generated with integrated mode, the layout strategy prompt receives the pre-planned zone information so the Art Director AI knows which areas of the background were designed for text.

- [ ] Write the failing test first:

  ```
  # backend-python/tests/test_layout_strategy_zones.py
  from app.prompts.layout_strategy import build_layout_strategy_prompt

  def test_layout_strategy_without_zones_unchanged():
      prompt = build_layout_strategy_prompt(
          target_text="HELLO",
          comp_pos_block="",
          components_available="none",
          text_lines_count=1,
          has_promo=False,
          est_text_h=100,
          comp_pct=0,
      )
      assert "PRE-PLANNED" not in prompt

  def test_layout_strategy_with_zones_injects_hint():
      prompt = build_layout_strategy_prompt(
          target_text="HELLO",
          comp_pos_block="",
          components_available="none",
          text_lines_count=1,
          has_promo=False,
          est_text_h=100,
          comp_pct=0,
          text_zone_hints=[
              {"role": "headline", "region": "top-center", "height_pct": 25, "description": "clear sky"},
          ],
      )
      assert "PRE-PLANNED TEXT ZONES" in prompt
      assert "headline" in prompt
      assert "top-center" in prompt

  def test_layout_strategy_zone_hint_prioritizes_placement():
      prompt = build_layout_strategy_prompt(
          target_text="PROMO",
          comp_pos_block="",
          components_available="none",
          text_lines_count=1,
          has_promo=True,
          est_text_h=80,
          comp_pct=0,
          text_zone_hints=[
              {"role": "body", "region": "bottom-left", "height_pct": 20, "description": "dark gradient"},
          ],
      )
      assert "PRIORITIZE" in prompt
  ```

  Run (expect failure):
  ```bash
  cd /Users/chulinxz/gen-image-layer-separator/backend-python
  source venv/bin/activate && python -m pytest tests/test_layout_strategy_zones.py -v
  ```

- [ ] Modify `backend-python/app/prompts/layout_strategy.py`.

  Update the function signature to accept an optional parameter:
  ```python
  def build_layout_strategy_prompt(
      target_text: str,
      comp_pos_block: str,
      components_available: str,
      text_lines_count: int,
      has_promo: bool,
      est_text_h: int,
      comp_pct: int,
      text_zone_hints: list[dict] | None = None,
  ) -> str:
  ```

  Build a zone hints section at the top of the function body:
  ```python
  zone_hints_section = ""
  if text_zone_hints:
      lines = ["PRE-PLANNED TEXT ZONES (from background generation):"]
      lines.append("The background image was generated with these clean zones designed specifically for text.")
      lines.append("PRIORITIZE placing text elements in these pre-designed zones -- they were built into the image.")
      for z in text_zone_hints:
          lines.append(
              f'  - {z.get("role", "text")}: region "{z.get("region", "")}", '
              f'{z.get("height_pct", 0)}% height, '
              f'background: "{z.get("description", "")}"'
          )
      lines.append("")
      zone_hints_section = "\n".join(lines) + "\n"
  ```

  Inject `zone_hints_section` into the returned f-string, just before `IMPORTANT RULES:`:
  ```python
  return f"""You are a senior Thai advertising Art Director...
  ...
  {zone_hints_section}IMPORTANT RULES:
  ...
  ```

- [ ] Run tests:
  ```bash
  cd /Users/chulinxz/gen-image-layer-separator/backend-python
  source venv/bin/activate && python -m pytest tests/test_layout_strategy_zones.py -v
  ```

- [ ] Update the call site in `backend-python/app/controllers/image.py` where `build_layout_strategy_prompt` is called (or where `plan_layout_strategy` is invoked) to pass `text_zone_hints`. Search for `plan_layout_strategy` calls and thread the parameter through. The service method `plan_layout_strategy` in `vertex.py` will need a matching update -- add `text_zone_hints: list[dict] | None = None` to its signature and pass it to `build_layout_strategy_prompt`.

- [ ] Run full test suite:
  ```bash
  cd /Users/chulinxz/gen-image-layer-separator/backend-python
  source venv/bin/activate && python -m pytest tests/ -v
  ```

- [ ] Commit:
  ```bash
  git add backend-python/app/prompts/layout_strategy.py backend-python/app/services/vertex.py backend-python/app/controllers/image.py backend-python/tests/test_layout_strategy_zones.py
  git commit -m "feat: inject pre-planned text zone hints into layout strategy prompt"
  ```

---

### Task 10: Enrich flex layout thought with zone hints

**Files:** `backend-python/app/prompts/flex_layout.py` (modify), `backend-python/app/services/vertex.py` (modify)

**What it does:** The flex layout thought prompt (Call 1 of the two-call flex layout) also receives zone hints so the AI knows where the background has clean space. This is the final placement decision point before the SVG is rendered.

- [ ] Write the failing test first:

  ```
  # backend-python/tests/test_flex_layout_zones.py
  from app.prompts.flex_layout import build_flex_thought_prompt

  def test_flex_thought_without_zone_hints_no_section():
      prompt = build_flex_thought_prompt(
          target_text="HELLO",
          components_list="No die-cut components available.",
          ref_section="",
          canvas_size={"w": 800, "h": 1000},
      )
      assert "PRE-PLANNED ZONES" not in prompt

  def test_flex_thought_with_zone_hints_injects_section():
      prompt = build_flex_thought_prompt(
          target_text="SALE 50%",
          components_list="No die-cut components available.",
          ref_section="",
          canvas_size={"w": 800, "h": 1000},
          zone_hints=[
              {"role": "headline", "region": "top-center", "height_pct": 25, "description": "clear sky"},
              {"role": "body", "region": "bottom-left", "height_pct": 20, "description": "dark gradient"},
          ],
      )
      assert "PRE-PLANNED ZONES" in prompt
      assert "headline" in prompt
      assert "top-center" in prompt
      assert "clear sky" in prompt
  ```

  Run (expect failure):
  ```bash
  cd /Users/chulinxz/gen-image-layer-separator/backend-python
  source venv/bin/activate && python -m pytest tests/test_flex_layout_zones.py -v
  ```

- [ ] Modify `build_flex_thought_prompt` in `backend-python/app/prompts/flex_layout.py`.

  Add `zone_hints: list[dict] | None = None` to the signature.

  Build the section in the function body:
  ```python
  zone_hints_section = ""
  if zone_hints:
      lines = ["PRE-PLANNED ZONES (background was generated with these clean areas):"]
      for z in zone_hints:
          lines.append(
              f'  - {z.get("role", "text")} zone: region "{z.get("region", "")}", '
              f'approx {z.get("height_pct", 0)}% of frame height, '
              f'background type: "{z.get("description", "")}"'
          )
      lines.append("Use these zones as your PRIMARY text placement targets. They are already clean in the background.")
      lines.append("")
      zone_hints_section = "\n".join(lines) + "\n"
  ```

  Inject `zone_hints_section` into the returned string, just before `a) SCAN THE IMAGE`:
  ```python
  return f"""You are a graphic designer...
  ...
  {zone_hints_section}a) SCAN THE IMAGE: ...
  ```

- [ ] Update the call to `build_flex_thought_prompt` in `suggest_flex_layout()` in `backend-python/app/services/vertex.py`.

  Add `zone_hints: list[dict] | None = None` to the `suggest_flex_layout` signature and pass it to `build_flex_thought_prompt`:
  ```python
  thought_prompt = build_flex_thought_prompt(
      target_text, components_list, ref_section, canvas_size,
      style_guide=style_guide or "",
      layout_strategy_section=layout_strategy_section,
      no_go_zones_section=no_go_zones_section,
      image_description_section=image_description_section,
      zone_hints=zone_hints,
  )
  ```

- [ ] Update the call to `suggest_flex_layout()` in `backend-python/app/controllers/image.py` to pass `zone_hints=text_zone_hints` (from Task 8's parsed variable).

- [ ] Run tests:
  ```bash
  cd /Users/chulinxz/gen-image-layer-separator/backend-python
  source venv/bin/activate && python -m pytest tests/test_flex_layout_zones.py tests/test_flex_layout.py -v
  ```

- [ ] Run full test suite:
  ```bash
  cd /Users/chulinxz/gen-image-layer-separator/backend-python
  source venv/bin/activate && python -m pytest tests/ -v
  ```

- [ ] Commit:
  ```bash
  git add backend-python/app/prompts/flex_layout.py backend-python/app/services/vertex.py backend-python/app/controllers/image.py backend-python/tests/test_flex_layout_zones.py
  git commit -m "feat: inject pre-planned zone hints into flex layout thought prompt"
  ```

---

## Phase 4: Quality Gate

### Task 11: Add validate_bg_constraints() service method

**Files:** `backend-python/app/services/vertex.py` (modify)

**What it does:** After the background is generated, a quick vision AI check confirms the image actually has clean zones matching the constraints. This prevents propagating a bad background into the campaign pipeline.

- [ ] Write the failing test first:

  ```
  # backend-python/tests/test_bg_validation.py
  from unittest.mock import AsyncMock, MagicMock, patch
  import pytest


  @pytest.mark.asyncio
  @patch("app.services.vertex.VertexAIService._generate_content")
  async def test_validate_bg_constraints_pass(mock_gen):
      from app.services.vertex import VertexAIService
      svc = VertexAIService.__new__(VertexAIService)

      mock_response = MagicMock()
      mock_response.text = '{"result": "PASS", "notes": "Top area is clear sky as requested."}'
      mock_gen.return_value = mock_response

      result = await svc.validate_bg_constraints(
          image_buffer=b"\x89PNG fake",
          text_zones=[{"role": "headline", "region": "top-center", "height_pct": 25, "description": "clear sky"}],
      )
      assert result["result"] == "PASS"
      assert "notes" in result


  @pytest.mark.asyncio
  @patch("app.services.vertex.VertexAIService._generate_content")
  async def test_validate_bg_constraints_fail(mock_gen):
      from app.services.vertex import VertexAIService
      svc = VertexAIService.__new__(VertexAIService)

      mock_response = MagicMock()
      mock_response.text = '{"result": "FAIL", "notes": "Top area is crowded with objects.", "suggestions": "Try a cleaner sky area."}'
      mock_gen.return_value = mock_response

      result = await svc.validate_bg_constraints(
          image_buffer=b"\x89PNG fake",
          text_zones=[{"role": "headline", "region": "top-center", "height_pct": 25, "description": "clear sky"}],
      )
      assert result["result"] == "FAIL"
      assert "suggestions" in result


  @pytest.mark.asyncio
  @patch("app.services.vertex.VertexAIService._generate_content")
  async def test_validate_bg_constraints_returns_pass_on_parse_error(mock_gen):
      from app.services.vertex import VertexAIService
      svc = VertexAIService.__new__(VertexAIService)

      mock_response = MagicMock()
      mock_response.text = "I cannot analyze this."
      mock_gen.return_value = mock_response

      result = await svc.validate_bg_constraints(
          image_buffer=b"\x89PNG fake",
          text_zones=[],
      )
      # On parse failure, default to PASS so pipeline is not blocked
      assert result["result"] == "PASS"
  ```

  Run (expect failure):
  ```bash
  cd /Users/chulinxz/gen-image-layer-separator/backend-python
  source venv/bin/activate && python -m pytest tests/test_bg_validation.py -v
  ```

- [ ] Add `validate_bg_constraints()` to `VertexAIService` in `backend-python/app/services/vertex.py`:

  ```python
  async def validate_bg_constraints(
      self,
      image_buffer: bytes,
      text_zones: list[dict],
  ) -> dict:
      if not text_zones:
          return {"result": "PASS", "notes": "No zones to validate."}

      proc_buf, proc_mime = _resize_for_processing(image_buffer)
      model = self._text_model()

      zones_desc = "\n".join(
          f'- {z.get("role", "text")} zone: region "{z.get("region", "")}", '
          f'{z.get("height_pct", 0)}% height, expected: "{z.get("description", "")}"'
          for z in text_zones
      )
      prompt = f"""You are a quality inspector for advertisement background images.
  Look at this image and check whether it has CLEAN, TEXT-READY zones matching these requirements:
  {zones_desc}

  For each zone: does the image have a suitably clean, low-contrast, readable area in that region?
  A zone PASSES if the area is: open sky, solid color, soft blur, gradient, or other clean surface.
  A zone FAILS if the area is: crowded with objects, high-detail textures, busy patterns, or strong visual noise.

  Respond with JSON only:
  {{"result": "PASS" or "FAIL", "notes": "brief explanation", "suggestions": "optional: what to change if FAIL"}}"""

      parts = [_inline_data(proc_buf, proc_mime), {"text": prompt}]
      try:
          response = await self._generate_content(model, parts, {"temperature": 0.3})
          raw = (response.text or "").strip()
          if raw.startswith("```"):
              raw = raw.split("```")[1]
              if raw.startswith("json"):
                  raw = raw[4:]
              raw = raw.strip()
          import json
          data = json.loads(raw)
          trace_ai("BG Constraint Validation", prompt, raw)
          return data
      except Exception as e:
          print(f"[BG Validation] Parse error, defaulting to PASS: {e}")
          return {"result": "PASS", "notes": f"Validation skipped due to parse error: {e}"}
  ```

- [ ] Run tests:
  ```bash
  cd /Users/chulinxz/gen-image-layer-separator/backend-python
  source venv/bin/activate && python -m pytest tests/test_bg_validation.py -v
  ```

- [ ] Commit:
  ```bash
  git add backend-python/app/services/vertex.py backend-python/tests/test_bg_validation.py
  git commit -m "feat: add validate_bg_constraints service method with vision AI quality check"
  ```

---

### Task 12: Add retry loop in generate_integrated

**Files:** `backend-python/app/controllers/image.py` (modify)

**What it does:** After generating the background, validate it against the zone constraints. If it fails, re-generate with a stronger constraint prompt (max 2 retries). Log results so the AI trace captures the validation outcome.

- [ ] Write the failing test first (append to `test_integrated_generate.py`):

  ```python
  @patch("app.controllers.image.vertex_service")
  def test_generate_integrated_retries_on_validation_fail(mock_vs, client):
      call_count = {"n": 0}

      async def gen_image(**kwargs):
          call_count["n"] += 1
          return {"buffer": b"\x89PNG fake", "text": "ok", "prompt": kwargs.get("prompt", "")}

      async def validate(image_buffer, text_zones):
          if call_count["n"] < 2:
              return {"result": "FAIL", "notes": "top area is busy", "suggestions": "need clearer top"}
          return {"result": "PASS", "notes": "ok"}

      mock_vs.plan_text_zones = AsyncMock(return_value={
          "text_zones": [{"role": "headline", "region": "top-center", "height_pct": 25, "description": "clear sky"}],
          "bg_constraints": "Leave top 25% clear.",
      })
      mock_vs.generate_image = AsyncMock(side_effect=gen_image)
      mock_vs.validate_bg_constraints = AsyncMock(side_effect=validate)

      resp = client.post("/api/image/generate-integrated", json={
          "text_brief": "BIG SALE",
          "visual_concept": "beach",
          "aspect_ratio": "3:4",
      })
      assert resp.status_code == 200
      assert call_count["n"] == 2  # retried once


  @patch("app.controllers.image.vertex_service")
  def test_generate_integrated_gives_up_after_max_retries(mock_vs, client):
      mock_vs.plan_text_zones = AsyncMock(return_value={
          "text_zones": [{"role": "headline", "region": "top-center", "height_pct": 25, "description": "sky"}],
          "bg_constraints": "Leave top clear.",
      })
      mock_vs.generate_image = AsyncMock(return_value={"buffer": b"\x89PNG", "text": "ok", "prompt": "x"})
      mock_vs.validate_bg_constraints = AsyncMock(return_value={
          "result": "FAIL", "notes": "still busy", "suggestions": "more clear"
      })

      resp = client.post("/api/image/generate-integrated", json={
          "text_brief": "TEST",
          "visual_concept": "forest",
          "aspect_ratio": "1:1",
      })
      # Should still return success (best effort) even after max retries
      assert resp.status_code == 200
      assert mock_vs.generate_image.call_count <= 3  # plan + max 2 retries
  ```

  Run (expect failure):
  ```bash
  cd /Users/chulinxz/gen-image-layer-separator/backend-python
  source venv/bin/activate && python -m pytest tests/test_integrated_generate.py::test_generate_integrated_retries_on_validation_fail -v
  ```

- [ ] Replace the `generate_integrated` function in `backend-python/app/controllers/image.py` with the retry-aware version:

  ```python
  async def generate_integrated(request: Request, body: dict):
      text_brief = body.get("text_brief", "").strip()
      visual_concept = body.get("visual_concept", "").strip()
      aspect_ratio = body.get("aspect_ratio", "3:4")

      if not text_brief:
          return JSONResponse({"error": "text_brief is required"}, status_code=400)
      if not visual_concept:
          return JSONResponse({"error": "visual_concept is required"}, status_code=400)

      zone_data = await vertex_service.plan_text_zones(text_brief, visual_concept, aspect_ratio)
      bg_constraints = zone_data.get("bg_constraints", "")
      text_zones = zone_data.get("text_zones", [])

      MAX_RETRIES = 2
      enriched_prompt = f"{visual_concept}. {bg_constraints}" if bg_constraints else visual_concept
      result = None
      validation = {"result": "PASS"}

      for attempt in range(MAX_RETRIES + 1):
          current_prompt = enriched_prompt
          if attempt > 0:
              suggestions = validation.get("suggestions", "")
              current_prompt = (
                  f"{visual_concept}. CRITICAL: {bg_constraints} "
                  f"The previous attempt failed validation: {suggestions}. "
                  f"Ensure the zones are clearly clean and unobstructed."
              )
              print(f"[IntegratedGen] Retry {attempt}/{MAX_RETRIES} with stronger constraint prompt")

          result = await vertex_service.generate_image(
              prompt=current_prompt,
              aspect_ratio=aspect_ratio,
          )

          if not result.get("buffer"):
              break

          if text_zones:
              validation = await vertex_service.validate_bg_constraints(result["buffer"], text_zones)
              print(f"[IntegratedGen] Attempt {attempt + 1} validation: {validation.get('result')} -- {validation.get('notes', '')}")
              if validation.get("result") == "PASS":
                  enriched_prompt = current_prompt
                  break
          else:
              break

      if not result or not result.get("buffer"):
          return JSONResponse(
              {"success": False, "message": "Failed to generate image", "text": result.get("text") if result else ""},
              status_code=500,
          )

      url = _save_upload(result["buffer"], "generated")
      return JSONResponse({
          "success": True,
          "data": {
              "imageUrl": url,
              "textZones": text_zones,
              "bgConstraints": bg_constraints,
              "validationResult": validation.get("result", "PASS"),
              "text": result.get("text"),
              "prompt": enriched_prompt,
          },
      })
  ```

- [ ] Run full test suite:
  ```bash
  cd /Users/chulinxz/gen-image-layer-separator/backend-python
  source venv/bin/activate && python -m pytest tests/ -v
  ```

- [ ] Commit:
  ```bash
  git add backend-python/app/controllers/image.py backend-python/tests/test_integrated_generate.py
  git commit -m "feat: add validation retry loop to generate_integrated (max 2 retries on FAIL)"
  ```

---

## Summary

| Phase | Tasks | Touches |
|-------|-------|---------|
| 1 - Backend Pre-Planner | 1-4 | new prompt, new service method, new controller fn, new route |
| 2 - Frontend | 5-7 | App.vue state, ImageGenerator UI, CampaignLayout pre-fill |
| 3 - Campaign Pipeline | 8-10 | SSE endpoint accepts hints, layout strategy prompt, flex layout prompt |
| 4 - Quality Gate | 11-12 | validation service method, retry loop in controller |

**Key design decisions:**
- Zone hints are optional everywhere. If `text_zone_hints` is empty or absent, all existing behavior is identical. This is strictly additive.
- Validation defaults to PASS on parse error so a bad API response never blocks the user.
- Maximum 2 regeneration retries (3 total attempts) to avoid excessive latency and API cost.
- `bg_constraints` is natural language appended to the visual concept, not a structured field -- this works with the existing `generate_image()` signature without modification.
- All new AI calls use `_text_model()` (not best) since planning and validation are lightweight tasks, preserving `_text_model_best()` quota for flex layout.
