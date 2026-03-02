# System Understanding: Frontier-Driven Image Layer Separator

เอกสารนี้อธิบายแนวคิดและขั้นตอนการทำงานของระบบเรา โดยเน้นการใช้ศักยภาพของ Frontier AI Model ในการสร้างงานออกแบบที่มีคุณภาพสูง

---

## 1. ปรัชญาการออกแบบ: Reasoning over Training

ต่างจากงานวิจัยที่ใช้การ Fine-tune model กับข้อมูลดีไซน์ (เช่น DesignAsCode) ระบบของเราเลือกทางเดินของ **"AI Reasoning"**:

- **Zero-shot Design sense**: ใช้ความฉลาดในการเข้าใจภาพและบริบทของ Frontier Models (Gemini 2.5/3.1) มาประยุกต์ใช้กับหลักการออกแบบ (Design Principles)
- **Text-First Priority**: ระบบให้ความสำคัญกับการวางข้อความ (Headline, Sub-headline, CTA) ให้มีระดับความสำคัญ (Hierarchy) และอ่านง่ายที่สุดก่อนจะเพิ่มส่วนประกอบอื่นๆ
- **Dynamic Layout**: เน้นการวางองค์ประกอบรอบๆ Subject ที่มีอยู่จริงในภาพ เพื่อให้งานดูเป็นเนื้อเดียวกัน

---

## 2. ขั้นตอนการทำงาน (Build-Up Pipeline)

### **Step 1: Context Awareness (Subject & Space)**

1.  **RMBG Analysis**: ตรวจหา Subject (คน/สินค้า) เพื่อหาพื้นที่ว่างและพิกัดที่แม่นยำ
2.  **Inpaint Plate**: เคลียร์พื้นที่หลัง Subject ให้สะอาดเพื่อนำไปซ้อน Layer ใหม่ได้อิสระ
3.  **Die-cut + Safe Zones**: ตัด Subject ออกเป็นชั้น (Layers) พร้อมค่า `z_index` และ `interaction_zone`

### **Step 2: Layout Strategy Planning (DesignAsCode-Inspired Plan Phase)** 🆕

ก่อนที่จะสร้างพิกัดข้อความจริง ระบบจะเรียก `planLayoutStrategy()` ก่อน:

- **Input**: ภาพ + text brief + labels ของ components
- **Output**: `layout_concept`, `dominant_element`, `text_hierarchy`, `composition_notes`
- **Why**: DesignAsCode paper พิสูจน์ว่าการแยก "คิดก่อน" ออกจาก "implement พิกัด" ทำให้ AI วางองค์ประกอบได้ดีขึ้นมาก โดยเฉพาะ visual hierarchy ที่ AI มักจะ improvise ผิดพลาดในครั้งเดียว

### **Step 3: Professional Text Composition (Pass 2)**

- AI ได้รับ strategy hint จาก Step 2 → วางข้อความตาม strategy แทนที่จะ improvise
- `fixedComponentPositions` บอก AI ว่า character อยู่ตรงไหนแล้ว
- **ไม่มี forbidden zones**: Character depth (`interaction_zone` z-index) จัดการการแสดงผลแทน

### **Step 4: Visual Quality Gate** 🆕

หลัง AI ส่ง layout กลับมา ระบบรัน `enforceDesignRules()`:

- ตรวจหา promotional numbers (เช่น "2 ต่อ", "50%")
- ถ้า font_size ไม่ dominant (< 80% ของ max) → auto-boost เป็น 160
- `enforceContrast()`: ตรวจสีข้อความ vs พื้นหลัง → swap dark-on-dark เป็นขาว

### **Step 5: Art Director Critique Loop (Reflect Phase)**

- **Vision Feedback**: เรนเดอร์ภาพพรีวิวแล้วส่งกลับไปให้ AI ตรวจสอบในฐานะ Art Director
- **Full Vision Critique**: `critiqueLayout` ดู BOTH ภาพ (original + preview) ทุก iteration
- **Confidence Gate** 🆕: critique ส่งคืน `confidence` field (0.0-1.0) → loop หยุดเร็วเมื่อ AI มั่นใจ ≥85%
- **Aesthetic Refinement**: `refineLayout` prompt อนุญาตให้ปรับ font_size, colors, z-index, visual_container — ไม่ใช่แค่ย้ายกล่อง

---

## 3. Depth Layering System

`interaction_zone` คือพื้นที่บน character ที่ข้อความสามารถซ้อนลงไปได้ (แต่ character render ทับอยู่ด้านหน้า):

```
Canvas z-index structure:
  Background image  → z: 0
  Text (normal)     → z: 20
  Text (in iz)      → z: char_z - 5 (ต่ำกว่า character)
  Character         → z: 15 (สูงกว่า text ที่ซ้อนกัน)
  Logo/Badge        → z: 25+
```

---

## 4. Roadmap & Future Enhancements

เมื่อระบบวางข้อความได้สมบูรณ์แบบ (Robust Text Layout) เราจะพัฒนาต่อในส่วน:

- **Semantic Decorators**: ให้ AI เลือกสร้างองค์ประกอบกราฟิก (Shapes, Gradients, Textures) มาเสริมเพื่อเพิ่มความน่าสนใจตามสไตล์ของภาพ
- **HTML/CSS Output** (จาก DesignAsCode idea): แทนที่จะ output JSON coordinates → ให้ AI generate HTML/CSS snippet แทน เพื่อใช้ browser layout engine จัดการ (ได้ grid, flex, blend-mode ฟรี)
- **Complex CSS Synthesis**: การใช้เอฟเฟกต์ CSS ขั้นสูง เช่น Blend Modes หรือ Glassmorphism ในระดับที่ซับซ้อนขึ้น

---

## 5. Key Components Summary

- **Frontier Models**: Gemini 2.5 Pro (Reasoning), Gemini 3.1 Flash (Vision), Imagen (Inpainting)
- **Backend**: TypeScript/Express (Pipeline Control)
- **Frontend**: Vue 3 / HTML Canvas (Real-time Render & Editor)
- **Plan Phase**: `planLayoutStrategy()` in `vertex.service.ts` — lightweight brainstorm call before layout
- **Quality Gate**: `enforceDesignRules()` + `enforceContrast()` in `image.controller.ts`
