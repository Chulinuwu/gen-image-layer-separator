# Brainstorm: SVG Layout Engine — ปัญหา "HTML/CSS concept on SVG" ที่ไม่ work

**Date:** 2026-03-08
**Task:** วิเคราะห์ปัญหา end-to-end result ของ SVG overlay layout ที่ user พบ — พิจารณาว่าแนวคิด "ยืม HTML/CSS layout มาทำ SVG" ทำไมไม่ออกมาตามหวัง และแนวทางที่ควรไปต่อ

---

## Goal

เข้าใจ **root causes** ที่ทำให้ผลลัพธ์ SVG overlay ออกมาแย่ ทั้ง text ถูกตัด / ทับ component / ล้นออกนอก canvas — แล้วหาแนวทางแก้ไขที่จะทำให้ output มีคุณภาพระดับ "Thai advertising agency"

---

## Constraints

1. **End result ต้องเป็น SVG** — user ต้องการ SVG ไม่ใช่ HTML ตรงๆ (เพราะต้องเอาไป composite กับ PNG component layers)
2. **AI ถนัด HTML/CSS ไม่ใช่ SVG** — LLM มีความรู้ HTML/CSS มากกว่า SVG layout มาก
3. **Canvas ขนาด 1024×1024** — fixed canvas, absolute coordinates
4. **Component images (die-cut PNGs)** ต้องวางร่วมกับ text overlay — z-index layering สำคัญ
5. **ต้องรองรับ Thai text** ที่มี multi-line wrapping ยากกว่า Latin
6. **Iteration loop** (critique → refine → critique) ต้องยังทำงานได้

---

## Known Context

### สิ่งที่พยายามทำไปแล้ว (จาก system logs + progress.md):

1. **Plan Phase (DesignAsCode):** AI brainstorm layout strategy → dominant element, text hierarchy, composition concept ✅ ใช้ได้ดี
2. **SVG "Box Model" Prompt:** พยายามสอน AI ให้คิดแบบ HTML/CSS แล้วเขียนเป็น SVG:
   - `position:absolute; left:X; top:Y` → `<g transform="translate(X,Y)">`
   - `background: rgba()` → `<rect>`
   - `padding` → `x` offset ใน `<text>`
   - `font-size` → attribute
   - `line-height` → `<tspan dy="1.35em">`

3. **HTML/CSS Migration (Task B):** มี `suggestLayoutHTML()` + `refineLayoutHTML()` ที่ output HTML fragment ด้วย `%` และ `cqw` units — **แต่ดูเหมือนยังไม่ได้ใช้ pathway นี้ในตอนที่ run test ครั้งนี้** (เพราะ ai-trace แสดง SVG output ไม่ใช่ HTML)

4. **Critique Loop results:**
   - Iteration 1: FAIL — "IMAGE 2 ไม่มี text overlay เลย" (critique AI เห็นแค่ bounding box labels)
   - Iteration 2: FAIL — เหมือนเดิม ไม่เห็น text
   - Iteration 3: FAIL — คราวนี้เห็น text แต่ทับหน้า woman + ออกนอก safe zone

### ปัญหาจาก User Comments (แปลสรุป):

1. **ไม่มั่นใจว่า AI ได้รับภาพ background** — text วางไม่อิงพื้นหลัง เหมือนวางเหมือนกันไม่ว่ายังไง
2. **Element ออกนอก canvas** — คำนวณผิดหรือทำอะไรผิดบางอย่าง
3. **ITR 2: text อยู่หลัง component** — ทับกันแบบโง่ๆ
4. **แนวคิด "HTML/CSS flexbox ทำด้วย SVG"** — ถ้าทำถูก ไม่ควรเป็นแบบนี้ เหมือนเอา beginner เขียน absolute positioning ไปเรื่อย
5. **ITR 3: text ถูกตัดเนื้อหา** — ไม่ใช่ wrap แต่ตัดกลางคำ (clip path ตัด) ยอมรับไม่ได้

---

## Risks

### R1: SVG ไม่มี Layout Engine จริง

SVG ไม่มี flexbox, grid, auto-wrap เหมือน HTML. ทุกอย่างเป็น absolute coordinates. AI ต้อง **คำนวณ positions ด้วยตัวเอง** ซึ่ง LLM ทำได้แย่มาก (ระบบตัวเลข / spatial reasoning ไม่แม่น)

### R2: Clip Path ตัด Text

ระบบใช้ `<clipPath>` เพื่อจำกัด text ให้อยู่ใน text zone → เมื่อ AI วาง text ที่กว้างเกินหรือตำแหน่งผิด text จะถูก **ตัดกลางคำ** แทนที่จะ wrap — ผลร้ายแรงกว่าไม่มี clip

### R3: Critique AI ไม่เห็น Text บน Preview

ใน ITR 1-2 critique AI บอก "ไม่เห็น text" — ทั้งที่ SVG ถูก generate แล้ว. **Preview rendering อาจไม่ render SVG text ให้ critique เห็น** → critique loop ไม่ช่วยแก้ปัญหาจริง เพราะ feedback ผิด

### R4: AI ทำซ้ำ Mistake เดิม

Refine prompt ส่ง critique feedback กลับไปแก้ แต่ AI ยังทำ mistake เหมือนเดิม (text ล้น, ทับ component) → ระบบ iterate แต่ไม่ converge

### R5: Font Metric Mismatch

AI ประมาณ text width ของ Thai font (Kanit) ไม่ได้ถูก → font-size 200 กับ "2 ต่อ" จริงๆ กว้างเท่าไหร่ AI ไม่รู้ → ล้น canvas

---

## Options (4)

### Option A: **Fix SVG approach — ปรับ prompt + validation**

ยังใช้ SVG output เหมือนเดิม แต่:

- ลด font-size range ลง (ปัจจุบัน max 245px สูงเกิน → ล้น canvas กว้างแค่ 544px)
- ลบ clipPath (ใช้ post-validation แทน) → ไม่ตัดกลางคำ
- เพิ่ม **server-side SVG dimension validation** — คำนวณ text width จริง (ด้วย lib เช่น `opentype.js`) แล้ว clamp อัตโนมัติ
- Fix preview rendering ให้ critique AI เห็น text จริงๆ

**Pros:** แก้เร็วที่สุด ไม่ต้องเปลี่ยน architecture
**Cons:** ยังพึ่ง AI ให้คำนวณ spatial ซึ่ง fundamentally ไม่แม่น, patch-over-patch

### Option B: **HTML/CSS generation → Server-side convert to SVG** ⭐ RECOMMENDED

ให้ AI generate HTML/CSS (ซึ่งถนัดกว่า) → ใช้ headless browser (Puppeteer) render HTML ลง SVG/PNG:

- AI output HTML fragment ด้วย flexbox, %, cqw units
- Server render ใน headless browser → screenshot / SVG export
- ได้ประโยชน์จาก **real CSS layout engine** (auto-wrap, flexbox, overflow hidden ที่ทำงานถูก)

**Pros:** ใช้ strengths ของทั้ง AI (HTML/CSS knowledge) และ browser (layout engine), text wrap ทำงานจริง
**Cons:** ต้องมี Puppeteer dependency, เพิ่ม latency rendering, complexity ในการ manage headless browser

### Option C: **Hybrid — AI provides layout JSON, server builds SVG deterministically**

AI ออก **high-level layout intent** (JSON: text hierarchy + relative positions เป็น %) → **server-side layout engine** (TypeScript) แปลงเป็น SVG coordinates:

- Server วัด text width จริง (opentype.js/canvas API)
- Server จัด layout ด้วย algorithm (simple constraint-based: no overlap, within bounds, snap-to-grid)
- AI ยังเลือก composition style / hierarchy / สี → server ทำ pixel-perfect placement

**Pros:** ไม่พึ่ง AI ทำ spatial math, deterministic output, ไม่ต้อง Puppeteer
**Cons:** ต้องเขียน layout engine เอง (effort สูง), ยืดหยุ่นน้อยกว่า HTML/CSS

### Option D: **Two-stage: HTML/CSS for preview + final SVG conversion**

เอา Task B (HTML/CSS output) ที่มีอยู่แล้วมาใช้จริง:

- Stage 1: AI generates HTML/CSS overlay → render ใน frontend iframe/container → critique loop ทำบน HTML preview
- Stage 2: เมื่อ approved → convert HTML overlay positions เป็น SVG ด้วย JavaScript (อ่าน computed styles → map ลง SVG elements)
- อาจใช้ `foreignObject` ใน SVG เพื่อ embed HTML ตรงๆ (แต่ compatibility อาจมีปัญหา)

**Pros:** ใช้ code ที่มีอยู่แล้ว (Task B), critique loop ทำบน visual ที่ถูกต้อง, AI ถนัด HTML
**Cons:** `foreignObject` rendering ไม่ consistent ทุก renderer, conversion step อาจ lossy

---

## Recommendation

**Option B (HTML/CSS → Server-side convert to SVG)** เป็นแนวทางที่ดีที่สุด

**เหตุผล:**

1. **User เองก็บอก** ว่า HTML/CSS ทำได้สวยมากเพราะ "มันมีความเป็น layout สูง" — AI เก่ง HTML/CSS อยู่แล้ว แต่ SVG ไม่มี layout engine จึงต้อง hardcode absolute positions ซึ่ง AI ทำแย่

2. **Root cause ที่แท้จริง** คือ SVG ไม่มี:
   - Text wrapping (ต้อง manual `<tspan>` splitting)
   - Flexbox/Grid (ทุกอย่างเป็น absolute x,y)
   - Overflow control (ต้องใช้ clipPath ที่ตัดกลางคำ)

   HTML/CSS มี**ทั้งหมด** built-in.

3. **มี infrastructure ready แล้ว** — Task B ใน plan-containers-htmlcss.md ได้ implement `suggestLayoutHTML()` + `refineLayoutHTML()` + frontend `v-html` rendering แล้ว. แค่ต้องเพิ่ม Puppeteer conversion step.

4. **Critique loop จะดีขึ้นทันที** — เพราะ HTML preview จะ render text ให้เห็นจริงๆ (ปัจจุบัน critique AI ไม่เห็น SVG text บน preview)

5. **ถ้าต้องการ SVG output สุดท้าย** → Puppeteer `page.screenshot()` ให้ PNG หรือใช้ library แปลง DOM → SVG ได้ (e.g., `html-to-image`, `dom-to-svg`)

**แต่ถ้าต้องการ quick fix ก่อน** → Option A (fix clip path + font size validation) เป็น hotfix แล้วค่อยทำ Option B เป็น architectural upgrade

---

## Acceptance Criteria

1. ✅ Text **ไม่ถูกตัดกลางคำ** — ต้อง wrap หรือ resize ก่อนถึงขอบ
2. ✅ Text **ไม่ทับ component faces** — text ต้องอยู่ในเขตที่กำหนดจริงๆ
3. ✅ Text **ไม่ออกนอก canvas** — ทุก element อยู่ใน safe zone
4. ✅ Critique AI **เห็น text จริงบน preview image** — ไม่ใช่เห็นแค่ bounding boxes
5. ✅ **Visual hierarchy ถูกต้อง** — promotional number ใหญ่สุด, fine print เล็กสุด
6. ✅ **End result เป็น SVG** (หรือ format ที่ composite ได้) — ตามที่ user ต้องการ
7. ✅ **Iteration loop converges** — แต่ละ iteration ควรดีขึ้น ไม่ใช่วนซ้ำ

---

## Visual Evidence Summary

| Iteration | Key Problems                                                                                              |
| --------- | --------------------------------------------------------------------------------------------------------- |
| **ITR 1** | "2 ต่อ" ถูกตัดออกด้านล่าง, ไม่มี text อื่นเลย                                                             |
| **ITR 2** | "2 ต่อ" ถูกตัดด้านขวา, text ทุกบรรทัดทับ component โดยตรง, ทับ mascot face                                |
| **ITR 3** | "2 ต่อ" ถูกตัดด้านขวาหนักขึ้น, clip path ตัด text กลางคำ ("SCB EA..." / "รับฟ..."), text ยังทับ component |

**Pattern ที่เห็น:** ทุก iteration AI พยายามวาง text ที่ font-size ใหญ่มาก (200px) ลงใน zone ที่แคบ (~350px wide) → ล้นทุกครั้ง + clip ตัดได้ผลเลวร้าย. Refine loop ไม่ช่วยเพราะ critique ไม่เห็น text จริง.
