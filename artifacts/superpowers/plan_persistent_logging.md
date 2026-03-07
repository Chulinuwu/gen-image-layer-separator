# Plan: Persistent Markdown Logging

## Goal

Save all AI interactions (prompts, raw responses, and system decisions) into a Markdown file on disk, so that logs are preserved even if the terminal scrollback is exceeded.

## Steps

### 1. Create a Logger Utility

- **File:** `backend/src/utils/logger.ts`
- **Logic:** Create a helper that appends content to a file in `backend/logs/ai-trace.md`.
- **Formatting:** Use Markdown syntax (fenced code blocks, headers, timestamps) to make the logs easy to read.

### 2. Update `vertex.service.ts`

- Replace `console.log` calls for `[AI-TRACE]` with calls to the new Markdown logger.
- Capture the full prompt and full raw response in grouped Markdown sections.

### 3. Update `image.controller.ts`

- Log the refinement process, geometric checks, and final decisions into the same Markdown file.

### 4. Setup Log Directory

- Ensure `backend/logs` exists.
- Add a script or log rotation logic (optional, but a timestamped filename like `trace-YYYY-MM-DD.md` is better).

## Verification Steps

- Run a campaign generation.
- Verify that a file exists at `backend/logs/ai-trace.md` (or similar).
- Open the file and confirm it contains the formatted prompts and responses.
