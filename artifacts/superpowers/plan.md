# Plan: Force Kanit Font + Thai Typography System (Options A + B)

## Goal

1. **Option B (Backend):** Force `font_family: "Kanit"` ใน AI prompt + normalize ใน post-processing pipeline
2. **Option A (Frontend):** Override `getTextStyle()` ให้ใช้ Kanit เสมอ + apply Thai typography weight tokens ตาม hierarchy

## Assumptions

- Backend `vertex.service.ts` มี prompt section `FONT SELECTION RULES` บรรทัด ~512
- Controller `image.controller.ts` มี post-process block ที่ clamp text right edges (บรรทัด ~651)
- Frontend `AIRefinementPreview.vue` มี `getTextStyle()` บรรทัด 254 → ใช้ `style.font_family || "Inter, sans-serif"`
- Google Fonts import ปัจจุบันอยู่บรรทัด 495 (Inter + Outfit เท่านั้น)
- สรุป `hierarchy` values จาก AI: `"headline"`, `"body"`, `"fineprint"`, `"badge"` (ตาม prompt เดิม)

## Plan

### Step 1 — Backend: Update FONT SELECTION RULES prompt

**Files:** `backend/src/services/vertex.service.ts` (~line 512-518)
**Change:**

- ลบ option fonts อื่น (Mitr, Sriracha, Playfair Display, Inter) ออก
- เปลี่ยนเป็น hard rule: "You MUST ALWAYS use `font_family: 'Kanit'` for EVERY text element without exception."
- เพิ่ม weight guidance per hierarchy ใน prompt:
  ```
  Kanit weights by hierarchy:
  - headline → font_weight: "800"
  - body     → font_weight: "600"
  - badge    → font_weight: "700"
  - fineprint → font_weight: "400"
  - number (large promotional) → font_weight: "900"
  ```
  **Verify:** `tsc --noEmit` clean

---

### Step 2 — Backend: Normalize font_family in post-processing

**Files:** `backend/src/controllers/image.controller.ts` (~line 646-675)
**Change:**

- หลัง TextClamp block อยู่แล้ว → เพิ่ม Kanit normalize pass:
  ```typescript
  // Force Kanit for all text suggestions regardless of AI output
  textSuggestions = textSuggestions.map((s: any) => ({
    ...s,
    style: { ...s.style, font_family: "Kanit" },
  }));
  ```
  **Verify:** `tsc --noEmit` clean

---

### Step 3 — Frontend: Add Kanit to Google Fonts import

**Files:** `frontend/src/components/AIRefinementPreview.vue` (~line 495)
**Change:**

- เพิ่ม Kanit weights 400,600,700,800,900 ใน import URL:
  ```css
  @import url("https://fonts.googleapis.com/css2?family=Kanit:wght@400;600;700;800;900&family=Inter:wght@400;600;700&family=Outfit:wght@500;700&display=swap");
  ```
  **Verify:** Font loads ใน DevTools Network tab

---

### Step 4 — Frontend: Rewrite getTextStyle() with Thai Typography Tokens

**Files:** `frontend/src/components/AIRefinementPreview.vue` (line 254-275)
**Change:**

- Override `fontFamily` → always `"Kanit, sans-serif"` (ignore AI value)
- Derive `fontWeight` from `t.hierarchy` using token map (AI value used as fallback only):
  ```typescript
  const KANIT_WEIGHT: Record<string, string> = {
    headline: "800",
    body: "600",
    badge: "700",
    fineprint: "400",
    number: "900",
  };
  const weight =
    KANIT_WEIGHT[t.hierarchy?.toLowerCase()] || style.font_weight || "700";
  ```
- Add Thai-specific `letterSpacing`:
  - headline → `-0.5px`
  - body → `0px`
  - fineprint → `0px`
  - badge → `1px`
- Add `lineHeight` token: headline=1.1, body=1.4, fineprint=1.3
- Add `textShadow` improvement: if no stroke_hex AND hierarchy=headline → auto-shadow `0 1px 4px rgba(0,0,0,0.5)` for readability
  **Verify:** Canvas text shows Kanit font + correct weights in live preview

---

## Risks & Mitigations

| Risk                                                  | Mitigation                                           |
| ----------------------------------------------------- | ---------------------------------------------------- |
| Kanit ไม่ได้ render เพราะยังไม่ load                  | Step 3 ต้องทำก่อน Step 4; add `font-display: swap`   |
| AI ยังส่ง other font บ้าง                             | Step 2 (normalize) เป็น safety net 100%              |
| Fineprint ที่เล็กมาก (size 8-12) อ่านยากกับ Kanit 400 | ยอมรับได้ — fineprint by design ไม่ต้องอ่านได้ชัด    |
| letter-spacing ลบอาจทำให้ Thai ชิดเกิน                | Test ด้วย headline ท่อนยาว; ถ้าชิดเกิน revert เป็น 0 |

## Rollback Plan

- Step 1-2 (backend): `git revert` commit → AI กลับไปใช้ font อื่นได้
- Step 3-4 (frontend): revert `getTextStyle()` → กลับเป็น `style.font_family || "Inter"`

---

**Approve this plan? Reply APPROVED if it looks good.**
