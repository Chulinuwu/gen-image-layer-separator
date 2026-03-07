# Finish: Persistent Markdown Logging

## Summary of Changes

Implemented a persistent logging system that saves all AI interactions and system events into a structured Markdown file. This ensures logs are preserved even when the terminal scrollback is exceeded.

### 1. `backend/src/utils/ai-logger.ts` (New Utility)

- **`traceAI(stage, prompt, response, details)`**: Appends a formatted Markdown entry with timestamps, stage headers, and fenced code blocks for prompts and raw LLM responses.
- **`logEvent(event, message, data)`**: Appends system orchestration milestones (e.g., component placement, critique results) with JSON context.
- Files are saved to `backend/logs/ai-trace.md`.

### 2. Service & Controller Integration

- **`vertex.service.ts`**: All `[AI-TRACE]` console logs now also trigger `traceAI()`, capturing the full context of Plan, Suggest, Critique, and Refine phases.
- **`image.controller.ts`**: Logical milestones like "Component Placement" and "Critique Result" are now logged to the Markdown file with their full JSON payloads.

## Verification

1. Run a campaign generation from the UI.
2. Check the folder `backend/logs/`.
3. Open `ai-trace.md`. You will find a beautifully formatted history of exactly what the AI saw (prompts) and what it said (raw output).

## Benefits

- **No data loss**: Terminal buffer size no longer matters.
- **Improved Readability**: Markdown formatting makes it easy to read long prompts and SVG code.
- **Easier Benchmarking**: You can copy-paste exact prompts into Google AI Studio for testing.
