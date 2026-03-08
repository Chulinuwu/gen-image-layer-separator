# Project Journal: gen-image-layer-separator

> Evolution of an Automated Ad Generation System — From Inception to the Present

---

## Phase 1: "Full LLM Image + Text Generation"

**Concept:** Use an LLM (image generation model) to create the entire ad, including text. If a designer wants changes, they adjust the prompt and regenerate.

**Outcome:** Failed

- **Poor Thai Text Rendering:** Image models significantly struggled with Thai characters—wrong strokes, misspellings, and bizarre fonts.
- **Inherent Rendering Issues:** Even for English, text rendering was inconsistent.
- **Prohibitive Costs:** Regenerating the entire image for minor text tweaks was expensive.
- **AI Creativity:** However, the AI's ability to brainstorm layouts and compositions remained a core strength.

**Lesson Learned:** Image generation and text placement must be decoupled.

---

## Phase 2: "Decoupled Image & Text — AI-Driven Copy"

**Concept:** Generate text-free background images → A separate worker generates copy and placement → Overlay text on the image with user editing capabilities.

**Mechanism:**

- AI outputted **Absolute JSON Coordinates** (top, left, width, height) indicating where to place specific text.
- The frontend rendered text based on these coordinates.
- User could manually fine-tune layers in an editor.

**Outcome:** Improved, but still problematic:

- **Lack of Dynamism:** Layouts felt stiff and repetitive.
- **Blind Placement:** AI dictated coordinates without "seeing" the final render—leading to text overlapping subjects or bleeding out of bounds.

---

## Phase 3: "Component Separation"

**Concept:** Beyond text, extract visual components (people, mascots, objects) as die-cut PNGs to allow re-composition and greater flexibility.

**Mechanism:**

- Background removal using RMBG-2.0 (running locally).
- Flood-fill extraction to separate individual subjects.
- AI placed both components and text using the same absolute JSON coordinates.

**Outcome:**

- **Successful Extraction:** Subject separation worked efficiently.
- **Layout Failures Persistent:** Absolute coordinates still resulted in text overlapping subjects or cluttered compositions.

---

## Phase 4: "Reflective Loop — AI Self-Correction"

**Concept:** Since initial placement was poor, implement a critique loop where the AI reviews its own work and refines it.

**Mechanism (DesignAsCode-inspired):**

1. **Plan Phase:** AI brainstorms a layout strategy (composition concept, hierarchy, etc.).
2. **Layout Phase:** AI generates text and component placements.
3. **Critique Phase:** A professional designer-persona AI reviews the preview image → PASS/FAIL.
4. **Refine Phase:** If FAIL, feedback is sent back to the layout stage (up to 3 iterations).
5. **Confidence Gate:** The loop exits once the AI achieves ≥85% confidence.

**Outcome:** Marginal improvement, but:

- **Inaccurate Feedback:** The AI gave feedback, but the fundamental issue (spatial math) persisted.
- **Lack of Convergence:** Fixing one area often broke another; the loop didn't predictably lead to quality.

---

## Phase 5: "HTML/CSS — A New Paradigm"

**Concept:** Since AI models are natively proficient in HTML/CSS, leverage that knowledge instead of raw JSON coordinates. Use flexbox, percentage units, and text-shadows.

**Mechanism:**

- `suggestLayoutHTML()`: AI outputs an HTML overlay string using `%` positions and `cqw` responsive font units.
- Frontend renders via `v-html` with DOMPurify sanitization.
- Removed the "visual container" (dark box) system as CSS handled contrast via shadows/strokes.

**Outcome:**

- **Significant Visual Boost:** HTML previews looked professional and well-balanced!
- **Format Mismatch:** The final result needed to be an editable SVG for professional editors (Illustrator/Photoshop), not just a web render.

---

## Phase 6: "SVG Overlay — The CSS Analogy"

**Concept:** Translate HTML/CSS logic into SVG syntax to bridge the gap between quality and format:

- `position:absolute` → `<g transform="translate(x,y)">`
- `padding` → `x` offset
- `line-height` → `<tspan dy>`

**Mechanism:**

- `suggestLayoutSVG()`: AI outputs an SVG overlay string.
- `refineLayoutSVG()`: Iterative refinement based on critique.
- `clipPath` used to strictly contain text within designated zones.

**Outcome:** Disaster

- **Text Clipping:** "SCB EASY" became "SCB EA..." as the clip path brutally sliced overflows.
- **Overlapping Faces:** AI failed to respect "No-Go Zones."
- **Coordinate Chaos:** Attempting to put 200px text into 350px zones resulted in massive overflows.
- **Critique Blindness:** The critique AI often "saw" no text in the preview due to rendering issues, providing useless feedback.

**Root Cause Analysis:**
SVG lacks a layout engine—it has no flexbox, no auto-wrap, and no intelligent overflow. "Thinking like CSS" in a format that doesn't support CSS features is a broken analogy. It's like teaching a person to think in GPS coordinates but forcing them to walk blindfolded—knowledge of the destination isn't enough to prevent tripping.

---

## Phase 7 (Upcoming): "Measure → SVG"

**Concept:** The fundamental flaw in every phase was the **lack of actual text measurement**. You cannot layout what you haven't measured.

**The Plan:**

1. **AI for Creative Decisions:** The AI decides hierarchy, mood, colors, and approximate sizes.
2. **Server-Side Measurement:** The server calculates the **actual pixel width/height** of the text using real font files (Kanit).
3. **Server-Side Layout Logic:** The server handles wrapping, resizing (auto-fit), and vertical stacking based on real numbers.
4. **Native SVG Generation:** The server builds the SVG with precise, measured `<text>` and `<tspan>` elements.

**Status:** Implementation ready.

---

## Timeline Summary

```
Phase 1   "Full AI Generation"        → ❌ Poor Thai text + High cost
Phase 2   "Decoupled JSON coords"      → ⚠️ Blind placement
Phase 3   "Component separation"       → ⚠️ Good subjects, Bad layout
Phase 4   "Reflective loop"            → ⚠️ Iteration without convergence
Phase 5   "HTML/CSS output"            → ✅ Beautiful but non-editable format
Phase 6   "SVG + CSS analogy"          → ❌ No layout engine
Phase 7   "Measure → SVG"              → 🔜 Next generation
```

---

## Key Insight

> Every previous phase shared the same missing link: **Actual Text Measurement.**
>
> HTML works because the browser engine measures every glyph before rendering. SVG has no such engine. LLMs have no access to font metrics. Everyone was guessing—and everyone was wrong.
>
> Phase 7 will be the first pipeline stage to incorporate **ground-truth measurements.**

---

## Known Gaps & Future Work

### Gap 1: AI Design Quality — "Functional but Not SOTA"

**Priority:** Lower than text measurement, but important for production quality.

**Observation:** The current general-purpose LLM (Gemini) produces _functional_ ad layouts — correct hierarchy, reasonable color choices, sensible composition. However, compared to **SOTA research using fine-tuned ad-specific LLMs**, the output is visibly basic:

- Lacks the visual flair and "wow factor" of professional Thai advertising
- Compositions are safe/predictable rather than creative/bold
- Color palettes and typography pairing are generic
- Missing advanced techniques: dynamic text lockups, branded visual systems, emotional design cues

The HTML/CSS output from Phase 5 was decent but noticeably below the quality seen in papers/journals where researchers fine-tuned models specifically on advertising datasets.

**Root cause:** A general-purpose LLM has broad knowledge but shallow expertise in advertising design. It knows _rules_ (hierarchy, contrast, safe zones) but doesn't have the _taste_ that comes from training on thousands of award-winning Thai ads.

**Potential future approaches:**

1. **Few-shot prompting with curated examples** — Include 3-5 high-quality ad screenshots in the prompt as visual references. Cheapest approach, moderate improvement.
2. **Fine-tuned layout model** — Train/fine-tune on a dataset of professional Thai advertising layouts. Significant effort but largest quality jump.
3. **Design token library** — Build a curated library of proven layout patterns (text lockups, color palettes, composition templates) that the AI selects from rather than inventing from scratch. Middle ground between prompting and fine-tuning.
4. **Retrieval-Augmented Generation (RAG) for design** — Index a library of professional ads → at generation time, retrieve visually similar high-quality references → feed them to the LLM as context. Gets close to fine-tuning quality without the training cost.

**Recommended approach: Option 4 (RAG for Design)** — most cost-effective path:

- No fine-tuning needed (saves time + money)
- Curate 50-100 high-quality reference ads + tag metadata (colors, layout type, industry, mood)
- At generation time → retrieve 3-5 references matching the campaign brief → send to AI as visual context
- AI shifts from "invent from scratch" to **"study great examples, then adapt"** — which is exactly how human designers work
- It's essentially giving the AI a **mood board** before it starts, instead of a blank canvas

This mirrors the professional design workflow: no designer starts from zero — they always begin with references.

**Note:** This gap is _secondary_ to the text measurement problem. A beautifully designed layout that clips text is still unusable. Fix measurement first (Phase 7), then elevate design quality.
