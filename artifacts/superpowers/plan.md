# Plan: Smart Layout Composition (A + B + C)

## Goal

1. **Option A** — Component Composition: AI แนะนำ `suggested_position` สำหรับ place die-cut components ใหม่ (ไม่ใช่แค่ detected position จากภาพเดิม)
2. **Option B** — Contrast Enforcement: ตรวจ color_hex vs background → auto-fix สี text ที่กลืนกับ bg
3. **Option C** — Zone-relative Font Sizing: ส่ง safe zone area ให้ AI → scale font_size ให้สมกับพื้นที่จริง

## Assumptions

- Component JSON ปัจจุบันมีแค่ `position` (detected from image) — ไม่มี `suggested_position`
- Controller picks `matched?.position` (line 890) → place component ที่ detected position เดิม
- `textSuggestions` normalize pass อยู่ใน controller ~line 677
- `safeZones` ถูกส่งเข้า `suggestCampaignLayout()` แล้ว (as context for text)
- Background ของ image ส่วน purple มี hex ≈ #6B21A8 (dark purple)

## Plan

### Step 1 — Option A Part 1: Add `suggested_position` to component JSON schema in prompt

**Files:** `backend/src/services/vertex.service.ts` (~line 499-506)  
**Change:**

- เพิ่ม `suggested_position` field ใน component JSON schema:
  ```json
  {
    "label": "Thai boy mascot",
    "description": "...",
    "position": { "top": 0, "left": 0, "width": 0, "height": 0 },
    "suggested_position": {
      "top": 0,
      "left": 0,
      "width": 0,
      "height": 0,
      "rotation": 0,
      "rationale": "Moved right to leave text zone clear"
    },
    "z_index": 1
  }
  ```
- เพิ่มคำอธิบายใน prompt ว่า: "Die-cut components CAN be repositioned. `suggested_position` is your composition recommendation — where SHOULD this component go for optimal layout?"
- เพิ่ม composition rules: "Primary subject → upper-right or upper-center; Mascot → bottom-right; Leave left column clear for text"

**Verify:** `tsc --noEmit` clean; AI response JSON มี `suggested_position` key

---

### Step 2 — Option A Part 2: Controller uses `suggested_position` when available

**Files:** `backend/src/controllers/image.controller.ts` (~line 884-896)  
**Change:**

```typescript
// Before:
position: matched?.position || { top: 0, left: 0, width: 200, height: 200 };

// After:
position: matched?.suggested_position ||
  matched?.position || { top: 0, left: 0, width: 200, height: 200 };
```

- ใช้ `suggested_position` ก่อน → fallback to detected `position`

**Verify:** `tsc --noEmit` clean; component renders ที่ suggested position ใน canvas

---

### Step 3 — Option B: Contrast enforcement in text normalize pass

**Files:** `backend/src/controllers/image.controller.ts` (~line 677-683)  
**Change:**

- เพิ่ม helper `ensureContrast(colorHex, bgZone)`:
  - Dark bg (purple/dark) + dark text → swap to `#FFFFFF` or `#FFE000`
  - Light bg (white/light) + light text → swap to `#1A1A1A`
- Apply ใน Kanit normalize pass:
  ```typescript
  textSuggestions = textSuggestions.map((s: any) => {
    const color = enforceContrast(s.style?.color_hex, s.position);
    return {
      ...s,
      style: { ...s.style, font_family: "Kanit", color_hex: color },
    };
  });
  ```
- Logic `enforceContrast`: ถ้า text อยู่ใน bottom half (top > 500) → bg น่าจะ dark purple → enforce light text (white/yellow)

**Verify:** "รับฟรี" และ text อื่นใน purple zone ควรเป็นสีสว่าง; `tsc --noEmit` clean

---

### Step 4 — Option C: Pass zone area as font_size hint to AI

**Files:** `backend/src/services/vertex.service.ts` (~line 370-381 safeZoneInstruction)  
**Change:**

- เพิ่ม font_size guidance ใน safeZoneInstruction โดยคำนวณ recommended minimum font_size ต่อ zone:
  ```typescript
  // Rough heuristic: larger zone → larger minimum font for headlines
  const minFontForZone = Math.round(Math.sqrt(z.area) / 10);
  ```
- ใส่ใน instruction: "Zone area = ${z.area} units² → Recommended headline font_size ≥ ${minFontForZone}"
- เพิ่ม overall instruction: "SCALE TEXT TO OWN THE SPACE. If a zone is large, use big fonts (80-150). Never use font_size < 20 for headlines in large zones."

**Verify:** `tsc --noEmit` clean; next generation มี font_size ≥ 60 สำหรับ headline ใน large zones

---

## Risks & Mitigations

| Risk                                            | Mitigation                                                    |
| ----------------------------------------------- | ------------------------------------------------------------- |
| AI ไม่ส่ง `suggested_position` ในทุก response   | Fallback to detected `position` (Step 2 already handles this) |
| `suggested_position` อาจ overlap กับ safe zones | จะต้องเพิ่ม validation ใน future iteration                    |
| Contrast enforcement spam สีทุกอย่างเป็นขาว     | Check top/bottom threshold ก่อน swap; log ทุก swap            |
| Font size hint ใหญ่เกิน → text ล้น canvas       | AI ยังรับ constraint อื่นด้วย; hint เป็น minimum ไม่ใช่ max   |

## Rollback Plan

- Steps 1-2 (component position): revert → ใช้ detected position เดิม
- Step 3 (contrast): ลบ enforceContrast call → กลับไปใช้ AI color โดยตรง
- Step 4 (font hint): ลบ font guidance จาก safeZoneInstruction string

---

**Approve this plan? Reply APPROVED if it looks good.**
