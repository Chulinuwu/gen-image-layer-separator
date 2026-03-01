# Finish: Smart Layout Composition (Options A+B+C)

## Summary

### Option A — Component Composition (2 files)

- **Prompt**: AI told components are die-cut PNGs → recommends `suggested_position` (not just detection)
- **Composition rules in prompt**: person → right/center, mascot → bottom-right, left column for text
- **Controller**: uses `suggested_position` over detected `position` (fallback chain preserved)
- **Log**: `[Compose]` printed when AI reposition is applied

### Option B — Contrast Enforcement

- `enforceContrast()` helper using ITU-R BT.601 luminance
- Heuristic: top > 450 → dark bg → if text luma < 100 → force #FFFFFF
- Applied alongside Kanit normalize pass

### Option C — Zone Font Size Hints

- `safeZoneInstruction` now includes `headline font_size ≥ N` per zone
- Global thresholds: area>50000→≥80, area>20000→≥50, else→≥30
- sqrt(area)/10 gives per-zone minimum

## Verification

| Command                          | Result                |
| -------------------------------- | --------------------- |
| `cd backend && npx tsc --noEmit` | ✅ Clean              |
| `git log --oneline -1`           | ✅ Committed: 7582de8 |

## Manual Validation Steps

1. Generate campaign → check server logs for `[Compose]` (shows AI repositioned a component)
2. Check server logs for `[Contrast]` (shows dark text was swapped to white)
3. Headline text in large zones should be font_size ≥ 80 in next generation
4. Canvas: components should appear at AI-suggested positions (not just where they were in original)

## Follow-ups

- Validate composition rules work for right-side person (should move to right column)
- Consider adding `opacity` enforcement for fineprint hierarchy (currently 0.85 in frontend only)
- Option D (collision nudge): after suggested_position, verify no overlap and nudge if detected
