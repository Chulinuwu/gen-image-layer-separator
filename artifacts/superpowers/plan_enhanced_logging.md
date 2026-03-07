# Plan: Enhanced AI Debug Logging

## Goal

Improve visibility into the "AI thinking" and "system execution" by adding comprehensive logging for prompts, raw responses, and intermediate state transformations.

## Steps

### 1. Enhance `vertex.service.ts` (Core AI Logic)

Add logging for full prompts and raw responses in all critical AI methods:

- **`planLayoutStrategy`**: Log the planning prompt and the full JSON string from the AI.
- **`suggestLayoutSVG`**: Log the SVG generation prompt and the raw SVG+META response.
- **`critiqueLayout`**: Log both IMAGE 1 & IMAGE 2 context (implicitly via prompt) and the full critique JSON.
- **`refineLayoutSVG`**: Log the refinement prompt (which includes previous SVG + Critique) and the raw response.

### 2. Trace Refinement Loop in `image.controller.ts`

Improve the trace of the iterative loop:

- Log the decision to skip or enter the loop (e.g., results of the geometric pre-check).
- Log why the loop continues or stops (Confidence levels, Verdicts).

### 3. Intermediate Data Visibility

- Log the `computedTextZone` vs `effectiveTextZone` reasoning.
- Log the final SVG string before it gets sent to the frontend.

## Verification Steps

- Run a campaign generation.
- Check the backend console output for `[AI-DEBUG]` or `[PROMPT]` tags.
- Verify that for each step (Plan, Suggest, Critique, Refine), both the input (prompt) and output (raw text) are visible.
