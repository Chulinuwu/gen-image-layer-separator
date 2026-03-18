# Manual Test Suites

QA test plan for the AI Image Layer Separator & Campaign Generator.

## Test Suites

| File | Feature | Cases | Critical | High | Medium | Low |
|------|---------|-------|----------|------|--------|-----|
| [01-background-generator.test.md](./01-background-generator.test.md) | Tab 1: Background Generator | 12 | 3 | 4 | 3 | 2 |
| [02-campaign-creator.test.md](./02-campaign-creator.test.md) | Tab 2: Campaign Creator & AI Refinement | 18 | 4 | 6 | 5 | 3 |
| [03-layer-editor.test.md](./03-layer-editor.test.md) | Tab 3: Layer Editor & Export | 20 | 3 | 7 | 6 | 4 |
| [04-cross-tab-and-api.test.md](./04-cross-tab-and-api.test.md) | Cross-Tab Flows & API Integration | 14 | 2 | 5 | 4 | 3 |

**Total: 64 test cases** (Critical: 12, High: 22, Medium: 18, Low: 12)

## Priority Guide

- **Critical** -- Must pass before any release. App unusable if these fail.
- **High** -- Core feature functionality. Should pass for a quality release.
- **Medium** -- Important but not blocking. Can ship with known issues here.
- **Low** -- Nice-to-have edge cases. Fix when time allows.

## Recommended Test Order

1. Smoke tests from each suite (TC-001, TC-013, TC-031)
2. All Critical tests
3. All High tests
4. Full end-to-end workflow (TC-051)
5. Remaining Medium and Low tests

## Prerequisites

- Frontend running at http://localhost:5173
- Backend running at http://localhost:5001
- Valid Google Vertex AI credentials configured in `.env`
- Test images: at least one product/ad image with visible text
