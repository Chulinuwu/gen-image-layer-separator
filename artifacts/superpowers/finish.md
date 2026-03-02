# Finish: Composition Upgrade (2026-03-03)

## Summary

5 tasks completed, all building on the previous session's dynamic-composition work (Tasks 1-3 from dynamic-composition.md).

### Task 1 — Zone Format Bug Fix

- **What:** In-loop overlap check now handles both `{area:{top,...}}` and flat `{top,...}` zone formats
- **Why:** `if (!zone.area) continue` was silently skipping all zones from `parsedNoGoZones` (flat format), sending wrong context to critiqueLayout

### Task 2 — DesignAsCode Plan Phase ⭐

- **What:** New `planLayoutStrategy()` in AIService; called before Pass 2; output injected as `layoutHint` into `suggestCampaignLayout` prompt
- **Why:** DesignAsCode paper proves separating "plan" from "implement" significantly improves visual hierarchy. AI now brainstorms concept before committing to pixel coordinates
- **Pattern:** Plan→Implement→Reflect (mirrors DesignAsCode PIR pipeline)

### Task 3 — Visual Quality Gate

- **What:** `enforceDesignRules()` auto-boosts promotional numbers to font_size 160 when AI under-sizes them
- **Why:** Common SCB ad failure — "2 ต่อ" rendered at small size instead of being the dominant element. Gate catches this programmatically

### Task 4 — Critique Confidence Gate

- **What:** `critiqueLayout` returns `confidence` (0.0-1.0); controller logs it per iteration; both PASS branches exit loop
- **Why:** Informs logging and future differential behavior; currently confidence gates at ≥85% for "high confidence PASS" log

### Task 5 — Documentation

- `progress.md` and `understanding.md` updated with full pipeline diagram

## Verification Commands

| Command                       | Result                         |
| ----------------------------- | ------------------------------ |
| `cd backend && npm run build` | ✅ Zero TypeScript errors      |
| `git log --oneline -5`        | ✅ 5 commits from this session |

## Commits This Session

```
36ed05f docs: update progress + understanding
c3354a5 feat: critique confidence gate
bbc0145 feat: visual quality gate — auto-boost promotional number dominance
522c91d feat: layout strategy planning phase (DesignAsCode Plan step)
9897ba6 fix: in-loop zone check handles both flat and nested coordinate formats
```

## Manual Validation Steps

1. **Upload SCB-style ad** with brief like "ชวนลูกค้าแอป SCB EASY มาสนุก 2 ต่อ รับฟรี บัตร"
2. **Check backend logs for:**
   - `[Plan] Requesting layout strategy...` → AI calls plan phase
   - `[Plan] Strategy: "hero-right text-left stacked"` → strategy visible
   - `🎨 Layout strategy: "..."` → SSE event emitted
   - `[QualityGate] Boosting promo number "2 ต่อ"` → font boosted (if AI under-sized)
   - `[Compose] Iteration 1 → PASS (confidence: 87%)` → confidence logged
3. **Check canvas:** "2 ต่อ" should be the largest element; character should render in front of any overlapping text

## Review

- **Blocker:** None
- **Major:** None
- **Minor:** confidence gate both PASS branches currently use `break` — intended, as confidence is informational only for now
- **Nit:** `catch (_) {}` in `planLayoutStrategy` — harmless but could be `catch (_e) {}` for strict tsconfig

## Follow-ups

- Display confidence score in frontend progress bar (`critique_complete` SSE now includes `confidence`)
- Tune `PROMO_RE` regex for edge cases like "3× คืน", "½ ราคา"
- Consider `planLayoutStrategy` caching for same brief re-runs within session
- Long-term: explore HTML/CSS output approach (full DesignAsCode) for native layout engine
