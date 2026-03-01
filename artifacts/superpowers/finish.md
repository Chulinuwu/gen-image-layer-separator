# Finish: Kanit Font System (Options A + B)

## Summary of Changes

### Option B — Backend (2 layers of enforcement)

1. **AI Prompt** (`vertex.service.ts`): Hard mandate — "MUST use Kanit, NEVER use other fonts" + weight by hierarchy
2. **Controller normalize** (`image.controller.ts`): Post-process pass forces `font_family: "Kanit"` on every suggestion

### Option A — Frontend (fallback + token system)

3. **Google Fonts** (`AIRefinementPreview.vue`): Added Kanit wght 400–900 to @import
4. **getTextStyle()**: Full rewrite with KANIT_TOKENS type-safe map:

| Hierarchy | Weight | Letter-spacing | Line-height | Notes                      |
| --------- | ------ | -------------- | ----------- | -------------------------- |
| headline  | 800    | -0.5px         | 1.1         | + auto-shadow if no stroke |
| body      | 600    | 0px            | 1.4         |                            |
| badge     | 700    | +1px           | 1.2         |                            |
| fineprint | 400    | 0px            | 1.3         | opacity 0.85               |
| number    | 900    | -1px           | 1.0         | large promo numbers        |

## Verification Commands

| Command                          | Result       |
| -------------------------------- | ------------ |
| `cd backend && npx tsc --noEmit` | ✅ Clean     |
| `git log --oneline -1`           | ✅ Committed |

## Manual Validation Steps

1. Generate a campaign — check SESSION LOG for "Found N text" message
2. Wait for layout → text on canvas should use Kanit (Thai glyphs look different from Inter)
3. Headline text should be heavier/bolder than body text
4. Fineprint should be slightly dimmer (opacity 0.85)
5. Check browser DevTools → Network → filter "Kanit" → font file should load

## Follow-ups

- Option D (collision nudge): auto-move text that overlaps components into nearest safe zone
- Consider adding `text-transform: uppercase` for badge hierarchy
- May want user-toggleable font override in the UI for brand customization
