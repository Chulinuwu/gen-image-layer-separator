# Chain-of-Thought Flex Layout Prompt Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Add Chain-of-Thought (layout_thought + grouping) to the flex layout AI prompt so the AI reasons about design before generating the flex tree JSON, inspired by the DesignAsCode paper's Semantic Planner approach.

**Architecture:** Modify the `suggestFlexLayout()` prompt to require AI to output `<layout_thought>` and `<grouping>` tags before the JSON. Parse these from the response, log them to ai-trace, and still extract the same `flexTree` JSON for the existing pipeline. No changes to `computeFlexLayout()`, `buildFlexSVG()`, or frontend.

**Tech Stack:** TypeScript, Gemini API (existing), ai-logger (existing)

---

### Task 1: Update prompt to require CoT output format

**Files:**
- Modify: `backend/src/services/vertex.service.ts:4875-5004` (the prompt string in `suggestFlexLayout()`)

**Step 1: Replace the prompt role and output format**

Change the opening line and output format section of the prompt. The new prompt should:

1. Change the role to "master of 2D graphic design and visual composition"
2. Add a mandatory workflow section requiring:
   - `<layout_thought>` — design reasoning about background, visual hierarchy, element placement
   - `<grouping>` — semantic grouping of elements before layout
   - Then the JSON output
3. Keep all existing sections (FLEX TREE FORMAT, LAYOUT DESIGN PRINCIPLES, BACKGROUND-AWARE, FORBIDDEN/REQUIRED PATTERNS, EXAMPLES) unchanged

Replace the opening (`You are a professional graphic designer...`) through `YOUR TASK: Output a flex tree JSON...` with:

```typescript
    const prompt = `You are a master of 2D graphic design and visual composition, skilled at planning advertisement layouts.

${refSection}CAMPAIGN TEXT TO PLACE:
${targetText}

${componentsList}

CANVAS SIZE: ${canvasSize.w}px × ${canvasSize.h}px

YOUR TASK: Plan and create a flex tree layout. You MUST follow this workflow in order:

STEP 1 — DESIGN REASONING (mandatory):
Write your design thinking inside <layout_thought>...</layout_thought> tags.
You MUST cover:
- Background analysis: describe what's in the image, where are open/calm areas vs busy areas
- Visual hierarchy: which text is the hero element (biggest), which is supporting, which is fine print
- Component placement strategy: where should each component go and why
- Color strategy: what text colors will contrast well with the background
- Composition style: what kind of layout will you use (NOT a boring 50/50 split)

STEP 2 — ELEMENT GROUPING (mandatory):
Write element groupings inside <grouping>...</grouping> tags.
Group related elements that should be placed near each other:
[
  {"group_id": "G1", "children": ["headline", "subtitle"], "theme": "header block"},
  {"group_id": "G2", "children": ["key_offer", "woman_component"], "theme": "hero section"},
  {"group_id": "G3", "children": ["fine_print"], "theme": "legal footer"}
]
Use text line content or component labels as children identifiers.

STEP 3 — FLEX TREE JSON:
Output the final layout as JSON (no markdown fences):
{
  "flexTree": { ... },
  "campaign_vibe": "brief mood description",
  "background_description": "brief background description"
}
`;
```

**Step 2: Verify the rest of the prompt (FLEX TREE FORMAT through EXAMPLES) is preserved**

The sections starting from `THE FLEX TREE FORMAT:` through `KEY INSIGHT from examples:` remain exactly as they are. Only the opening role, task description, and output format change.

Remove the old output format block at the end:
```
OUTPUT FORMAT — respond with ONLY this JSON (no markdown, no explanation):
{
  "flexTree": { ... your creative layout ... },
  "campaign_vibe": "brief description of the visual mood/style",
  "background_description": "brief description of what's in the background image"
}
```

It's now covered by STEP 3 above.

**Step 3: Commit**

```bash
git add backend/src/services/vertex.service.ts
git commit -m "feat: add CoT layout_thought + grouping to flex layout prompt"
```

---

### Task 2: Update response parser to extract CoT sections before JSON

**Files:**
- Modify: `backend/src/services/vertex.service.ts:5036-5077` (the response parsing block in `suggestFlexLayout()`)

**Step 1: Add extraction functions for tagged sections**

Before the existing parse block (after `const raw = response.text ?? "";`), add extraction of `<layout_thought>` and `<grouping>`:

```typescript
    const raw = response.text ?? "";
    console.log(`[FlexLayout] Raw response length: ${raw.length} chars`);

    // ── Extract CoT sections ──
    const layoutThoughtMatch = raw.match(/<layout_thought>([\s\S]*?)<\/layout_thought>/);
    const groupingMatch = raw.match(/<grouping>([\s\S]*?)<\/grouping>/);

    const layoutThought = layoutThoughtMatch?.[1]?.trim() || "";
    const groupingText = groupingMatch?.[1]?.trim() || "";

    if (layoutThought) {
      console.log(`[FlexLayout] Layout thought (${layoutThought.length} chars): "${layoutThought.substring(0, 200)}..."`);
      traceAI("Flex Layout Thought", layoutThought.substring(0, 2000));
    } else {
      console.warn("[FlexLayout] No <layout_thought> found in response");
    }

    if (groupingText) {
      console.log(`[FlexLayout] Grouping: ${groupingText.substring(0, 200)}`);
      traceAI("Flex Layout Grouping", groupingText.substring(0, 1000));
    } else {
      console.warn("[FlexLayout] No <grouping> found in response");
    }
```

**Step 2: Update the JSON extraction to handle mixed content**

The AI response now contains `<layout_thought>`, `<grouping>`, and then JSON. Update the cleaning/parsing to strip out the tagged sections and find the JSON:

Replace the existing parse block:
```typescript
    // ── Parse response ──
    try {
      // Strip markdown code fences if present
      const cleaned = raw
        .replace(/^```(?:json)?\s*/i, "")
        .replace(/\s*```$/i, "")
        .trim();

      const parsed = JSON.parse(cleaned);
```

With:
```typescript
    // ── Parse response ──
    try {
      // Strip CoT sections and markdown fences, find the JSON object
      let jsonStr = raw
        .replace(/<layout_thought>[\s\S]*?<\/layout_thought>/g, "")
        .replace(/<grouping>[\s\S]*?<\/grouping>/g, "")
        .replace(/```(?:json)?\s*/gi, "")
        .replace(/\s*```/gi, "")
        .trim();

      // Find the JSON object (starts with { ends with })
      const jsonStart = jsonStr.indexOf("{");
      const jsonEnd = jsonStr.lastIndexOf("}");
      if (jsonStart === -1 || jsonEnd === -1) {
        throw new Error("No JSON object found in response after stripping CoT sections");
      }
      jsonStr = jsonStr.substring(jsonStart, jsonEnd + 1);

      const parsed = JSON.parse(jsonStr);
```

The rest of the parsing (flexTree validation, warnings, return) stays exactly the same.

**Step 3: Commit**

```bash
git add backend/src/services/vertex.service.ts
git commit -m "feat: parse layout_thought + grouping from flex layout AI response"
```

---

### Task 3: Update return type to include CoT data

**Files:**
- Modify: `backend/src/services/vertex.service.ts:4829-4833` (return type of `suggestFlexLayout()`)
- Modify: `backend/src/services/vertex.service.ts:5066-5071` (return statement)
- Modify: `backend/src/controllers/image.controller.ts:1599-1601` (where `suggestFlexLayout` is called)

**Step 1: Extend the return type**

Change the return type from:
```typescript
  ): Promise<{
    flexTree: FlexNode;
    campaign_vibe: string;
    background_description: string;
  }> {
```

To:
```typescript
  ): Promise<{
    flexTree: FlexNode;
    campaign_vibe: string;
    background_description: string;
    layoutThought: string;
    grouping: string;
  }> {
```

**Step 2: Add new fields to the return statement**

In the success return block, add `layoutThought` and `grouping`:
```typescript
      return {
        flexTree: parsed.flexTree as FlexNode,
        campaign_vibe: parsed.campaign_vibe || "modern advertising",
        background_description:
          parsed.background_description || "campaign background",
        layoutThought,
        grouping: groupingText,
      };
```

Also add them to the fallback return (in the catch block) with empty strings:
```typescript
        layoutThought: "",
        grouping: "",
```

**Step 3: Log CoT in the controller**

In `backend/src/controllers/image.controller.ts`, where `flexResult` is used (around line 1603), add logging:

```typescript
        const flexResult = await vertexService.suggestFlexLayout(
          imageBuffer,
          mimeType,
          targetText,
          componentLabels,
          { w: canvasW, h: canvasH },
          refImageBuffers,
        );

        console.log(`[Pass2] Flex layout: vibe="${flexResult.campaign_vibe}", tree received`);
        if (flexResult.layoutThought) {
          logEvent("Layout Design Reasoning", flexResult.layoutThought.substring(0, 1500));
        }
        if (flexResult.grouping) {
          logEvent("Layout Element Grouping", flexResult.grouping.substring(0, 500));
        }
```

**Step 4: Commit**

```bash
git add backend/src/services/vertex.service.ts backend/src/controllers/image.controller.ts
git commit -m "feat: propagate layout_thought + grouping to controller and ai-trace"
```

---

### Task 4: Send CoT data via SSE debug event to frontend

**Files:**
- Modify: `backend/src/controllers/image.controller.ts` (around the flex tree debug SSE block, ~line 1608+)

**Step 1: Include CoT in the existing debug SSE event**

Find the existing SSE debug event that sends flex tree + boxes (search for `sendSSE("debug"` near the flex tree section). Add `layoutThought` and `grouping` to it:

```typescript
        sendSSE("debug", {
          step: "flex_layout",
          message: `Flex tree computed: ${flexBoxes.length} boxes`,
          flexTree: flexResult.flexTree,
          layoutThought: flexResult.layoutThought?.substring(0, 1000) || "",
          grouping: flexResult.grouping?.substring(0, 500) || "",
          boxes: flexBoxes.map(b => ({
            id: b.id, type: b.type,
            x: Math.round(b.x), y: Math.round(b.y),
            w: Math.round(b.w), h: Math.round(b.h),
          })),
        });
```

**Step 2: Commit**

```bash
git add backend/src/controllers/image.controller.ts
git commit -m "feat: send layout_thought + grouping via SSE debug events"
```

---

### Task 5: Test end-to-end and verify ai-trace output

**Step 1: Restart backend**

```bash
cd backend && npm run dev
```

**Step 2: Generate a campaign via the frontend**

Trigger a campaign generation and check:

1. Backend console shows `[FlexLayout] Layout thought (XXX chars): "..."`
2. Backend console shows `[FlexLayout] Grouping: ...`
3. `backend/logs/ai-trace.md` contains:
   - `EVENT: Flex Layout Thought` — with design reasoning text
   - `EVENT: Flex Layout Grouping` — with element groups
   - `EVENT: Layout Design Reasoning` — from controller
   - `EVENT: Layout Element Grouping` — from controller
4. The generated SVG still renders correctly (no pipeline changes)
5. The layout should be more creative (AI was forced to think before acting)

**Step 3: Commit any fixes if needed**

```bash
git add -A
git commit -m "fix: adjust CoT parsing if needed after testing"
```

---

## Summary

| Task | What | Files |
|------|------|-------|
| 1 | Update prompt to require CoT workflow | `vertex.service.ts` (prompt) |
| 2 | Parse `<layout_thought>` + `<grouping>` from response | `vertex.service.ts` (parser) |
| 3 | Propagate CoT to return type + controller + ai-trace | `vertex.service.ts` + `image.controller.ts` |
| 4 | Send CoT via SSE debug events | `image.controller.ts` |
| 5 | End-to-end test | Manual test |

**Total files touched:** 2 (`vertex.service.ts`, `image.controller.ts`)
**No changes to:** `flexLayout.ts`, `svgBuilder.ts`, `textMeasure.ts`, any frontend files
**Output:** Still the same editable SVG — only the AI reasoning process changes
