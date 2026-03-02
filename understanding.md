# System Understanding: Frontier-Driven Image Layer Separator

เอกสารนี้อธิบายแนวคิดและขั้นตอนการทำงานของระบบเรา โดยเน้นการใช้ศักยภาพของ Frontier AI Model ในการสร้างงานออกแบบที่มีคุณภาพสูง (Focus: Text Layout & Depth Layering)

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
3.  **Space Reasoning**: AI วิเคราะห์ว่า Subject มี "Gaze direction" (มองไปทางไหน) หรือ "Action" อย่างไร เพื่อตัดสินใจเปิดพื้นที่ว่างสำหรับการวางข้อความ

### **Step 2: Layer Creation & Extraction**

- ตัด Subject ออกเป็นชั้น (Layers) พร้อมค่า `z-index`
- **Interaction Zone**: ระบุพื้นที่บน Subject ที่ "อนุญาต" ให้ข้อความมาวางเกยได้ (เช่น ช่วงขาหรือไหล่) เพื่อสร้างมิติ 3D (Depth Effect)

### **Step 3: Professional Text Composition (Mastering the Layout)**

นี่คือส่วนที่เราโฟกัสมากที่สุดในปัจจุบัน:

- **Hierarchy Mapping**: AI แบ่งความสำคัญของข้อความ (อันไหนต้องใหญ่สุด/สีเด่นสุด)
- **Depth Layering Integration**: ระบบคำนวณอัตโนมัติว่าข้อความไหนควรอยู่ "หลัง" Subject เพื่อให้ดูพรีเมียมเหมือนโฆษณาแบรนด์ดัง
- **Contrast & Readability**: บังคับใช้สีข้อความและเงา (Text Stroke/Shadow) ตามความมืด-สว่างของพื้นหลังในจุดนั้นๆ

### **Step 4: Art Director Critique Loop**

- **Vision Feedback**: เรนเดอร์ภาพพรีวิวแล้วส่งกลับไปให้ AI ตรวจสอบในฐานะ Art Director
- **Aesthetic Refinement**: ปรับปรุงตำแหน่ง ขนาด และสไตล์ข้อความวนซ้ำ (Iterations) จนกว่าจะผ่านเกณฑ์ความสวยงาม (PASS)

---

## 3. Roadmap & Future Enhancements

เมื่อระบบวางข้อความได้สมบูรณ์แบบ (Robust Text Layout) เราจะพัฒนาต่อในส่วน:

- **Semantic Decorators**: ให้ AI เลือกสร้างองค์ประกอบกราฟิก (Shapes, Gradients, Textures) มาเสริมเพื่อเพิ่มความน่าสนใจตามสไตล์ของภาพ
- **Complex CSS Synthesis**: การใช้เอฟเฟกต์ CSS ขั้นสูง เช่น Blend Modes หรือ Glassmorphism ในระดับที่ซับซ้อนขึ้น

---

## 4. Key Components Summary

- **Frontier Models**: Gemini 2.5 Pro (Reasoning), Gemini 3.1 Flash (Vision), Imagen (Inpainting)
- **Backend**: TypeScript/Express (Pipeline Control)
- **Frontend**: Vue 3 / HTML Canvas (Real-time Render & Editor)
