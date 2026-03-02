# Plan: Fix html_overlay JSON Parse Failures

**Date:** 2026-03-03  
**Priority:** BLOCKER — suggestLayoutHTML + refineLayoutHTML always fail, canvas stays blank

---

## Goal

Stop `html_overlay` from breaking JSON parsing. Root cause: AI embeds HTML
(with `"`, newlines, HTML entities) inside a JSON string — this consistently
produces malformed JSON. Solution: separate the HTML from the JSON metadata
using delimiter tags `<HTML_OVERLAY>…</HTML_OVERLAY>`, extracted via regex.

---

## Assumptions

- AI can reliably emit `<HTML_OVERLAY>` delimiter style (proven pattern with XML-style fences)
- The metadata (`background_description`, `no_go_zones`, `components`) is safe as JSON
- `refineLayoutHTML` has the same problem with the same fix
- No frontend changes needed — the html_overlay string value is the same after extraction

---

## Plan

### Step 1 — Read exact prompt + parser for suggestLayoutHTML

- **Files:** `backend/src/services/vertex.service.ts` lines ~1530-1650
- **Change:** None (read-only)
- **Verify:** Understand current return format instruction + JSON.parse call location

### Step 2 — Change suggestLayoutHTML response format

- **Files:** `backend/src/services/vertex.service.ts`
- **Change:**
  - Update the WHAT TO RETURN section of the prompt to:

    ```
    Return two parts in this EXACT format:

    <META>
    {
      "background_description": "...",
      "campaign_vibe": "...",
      "no_go_zones": [...],
      "components": [...]
    }
    </META>
    <HTML_OVERLAY>
    <div style='position:absolute;inset:0;...'>
      ...your HTML here...
    </div>
    </HTML_OVERLAY>
    ```

  - No JSON wrapping of html_overlay

- **Verify:** Read the updated prompt section

### Step 3 — Write parseHTMLResponse() helper

- **Files:** `backend/src/services/vertex.service.ts` (add as private method or inline)
- **Change:** Add helper that:
  1. Extracts `<META>…</META>` block → parse as JSON
  2. Extracts `<HTML_OVERLAY>…</HTML_OVERLAY>` block → raw string
  3. Falls back to old `{ "html_overlay": … }` JSON approach if no tags found (backward compat)
- **Verify:** Unit-test mentally against sample AI output

### Step 4 — Update suggestLayoutHTML parser

- **Files:** `backend/src/services/vertex.service.ts`
- **Change:** Replace the `JSON.parse(raw)` + truncation repair block with `parseHTMLResponse(raw)`
- **Verify:** Build passes

### Step 5 — Change refineLayoutHTML response format + parser

- **Files:** `backend/src/services/vertex.service.ts`
- **Change:** Same format change + same parser in refineLayoutHTML
  - META only has: `{ "components": [...] }` (no need for background_description etc)
- **Verify:** Build passes

### Step 6 — Verify end-to-end

- **Command:** `cd backend && npm run build`
- **Manual test:** Trigger a campaign generation, verify backend logs show:
  - `[HTML] Parsed META JSON OK`
  - `[HTML] Extracted html_overlay: XXXX chars`
  - No `SyntaxError` in logs
  - Canvas shows text overlay after pass 2

---

## Risks & Mitigations

| Risk                                              | Mitigation                                                                           |
| ------------------------------------------------- | ------------------------------------------------------------------------------------ |
| AI doesn't emit `<META>` / `<HTML_OVERLAY>` tags  | Fallback regex still tries old JSON approach; if both fail, empty overlay (graceful) |
| AI puts `</HTML_OVERLAY>` inside the HTML content | Use greedy last-match: `<HTML_OVERLAY>([\s\S]*)<\/HTML_OVERLAY>` (last occurrence)   |
| META JSON still has escape issues                 | Less likely since HTML is outside; repair logic kept as fallback                     |
| refineLayoutHTML components array breaks          | Same META extraction used; components JSON simpler (no html_overlay embedded)        |

---

## Rollback Plan

- Revert `vertex.service.ts` to previous commit: `git revert HEAD`
- The old parse-with-repair code still exists as fallback — can re-enable

---
