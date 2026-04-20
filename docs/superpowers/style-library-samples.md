# Style Library — Sample Briefs for Testing

Five curated design systems live under `backend-python/assets/design_systems/`. Below are realistic Thai campaign briefs that should semantically match each system when fed into `/create-campaign-integrated` (Flow B) or `/create-campaign` (Flow A).

Each brief is written in the tone and vocabulary of an actual SCB / insurance / fund ad so that `plan_target_overview` can produce a coherent target paragraph and the cosine search can lock onto the right spec.

---

## 1. `858_apr_graduate` — Dreamy Pastel Aspiration (FWD Kids Life Insurance)

**Campaign brief:**

> ประกันชีวิตสำหรับลูกน้อย FWD 85/8 คุ้มครองยาวถึงอายุ 85 ปี รับเงินคืนสูงสุด 12% ของเบี้ย ฟรีความคุ้มครองอุบัติเหตุ ยกเว้นการชำระเบี้ยเมื่อเหตุไม่คาดคิดกับผู้ชำระเบี้ยฯ เติมเต็มทุกความฝันของลูกตั้งแต่วันนี้

**Mood to match:** hopeful, nurturing, dreamy, tender, aspirational — a mother imagining her child's future
**Expected visual DNA:** uniform lavender tint, warm diffuse window light, mother-and-child intimate lifestyle photo, translucent dream-bubbles, gold gradient product-term numerals, yellow + purple two-pill CTA

---

## 2. `commo_gold_scbgoldh` — Royal Purple Wealth (SCB Gold Fund)

**Campaign brief:**

> กองทุน SCBGOLDH โอกาสคว้าผลตอบแทนตามการเคลื่อนไหวของราคาทองคำแท่ง ความเสี่ยงระดับ 8 เปิดบัญชีและลงทุนง่าย ๆ ผ่านแอป SCB EASY ทำงาน ทำงาน เก็บเงิน เก็บเงิน ในกองทุน

**Mood to match:** institutional, prestigious, stable, wealth-aspirational, serious
**Expected visual DNA:** deep royal purple radial gradient, dramatic 3D gold bar hero, coin pile base, frosted glassmorphic product card, gold condensed wordmark, single purple pill CTA

---

## 3. `pa_kidsplus_m` — Cheerful Beach Family (SCB Protect PA Kids Plus)

**Campaign brief:**

> ประกันอุบัติเหตุ PA คิดส์ พลัส สำหรับลูกน้อยอายุ 1-15 ปี คุ้มครองค่ารักษาพยาบาลจากอุบัติเหตุ 3,000 บาท/อุบัติเหตุ คุ้มครองโรคยอดฮิต 5,000 บาท/โรค ค่าชดเชยรายวัน 500 บาท/วัน เบี้ยเริ่มต้นเพียง 1,900 บาท/ปี ลูกน้อยสนุกได้ไร้กังวล แม้เจ็บป่วยก็ยิ้มได้

**Mood to match:** cheerful, outdoor-carefree, family-safe, sunny, optimistic
**Expected visual DNA:** bright turquoise sky + warm sand, candid family-on-beach lifestyle photo, white rounded product card, green solid-fill check-mark circles, yellow highlighted emotional phrase, yellow pill CTA

---

## 4. `ta_inter_msig_dp_1` — Sunny Travel Joy (MSIG x SCB Protect Travel Insurance)

**Campaign brief:**

> ประกันเดินทางต่างประเทศ Easy Visa Plus Worldwide จาก MSIG คุ้มครองค่ารักษาพยาบาลต่างประเทศ 2 ล้านบาท คุ้มครองเที่ยวบินล่าช้า กระเป๋าเดินทางสูญหายหรือเสียหาย ค่าเบี้ยเพียง 556 บาท สำหรับ 5 วันเดินทาง แพ็กกระเป๋าแล้ว อย่าลืมแพ็กความคุ้มครองไปด้วย

**Mood to match:** joyful, vacation-anticipating, sunny, carefree, light — individual pre-trip thrill
**Expected visual DNA:** pale sky + warm sand horizontal split, single smiling woman with white sun hat + sunglasses + teal suitcase + passport, white product card, orange outline-ring check-marks, signature purple rounded price box with yellow numerals, yellow pill CTA

---

## 5. `ssme_doctorppg_connect` — Chrome Purple Prestige (SCB Business Lending for Doctors)

**Campaign brief:**

> สินเชื่อธุรกิจเพื่อผู้ประกอบการวิชาชีพแพทย์ วงเงินรวมสูงสุด 50 ล้านบาท ผ่อนชำระนานสูงสุด 10 ปี อัตราดอกเบี้ยเริ่มต้น MRR-1.25% ต่อปี สำหรับผู้ประกอบการที่มียอดขายน้อยกว่า 75 ล้านบาทต่อปี กู้เท่าที่จำเป็น และชำระคืนไหว

**Mood to match:** prestigious, professional-authority, premium-credit, serious, institutional
**Expected visual DNA:** monochromatic deep purple gradient, 3D chrome purple extruded wordmark and numerals as hero, blurred doctor backdrop in white coats, line-art framed CTA (not pill), flat white Thai sans body, no warm accents

---

## Usage

For Flow B testing (`/create-campaign-integrated`):
- Paste the brief verbatim into the `text_brief` field
- Leave `visual_concept` empty or give a generic scene cue
- Pick an aspect ratio (`3:4` or `4:5` for social)
- Hit "Generate Full Campaign"

Expected pipeline behavior:
1. SSE `progress { step: "style_planning" }` — Step 0 starts
2. SSE `progress { step: "style_selection", message: "Matched style: <id> (score ...)" }` — cosine hit
3. SSE `debug { step: "style_spec", id, overview, source_image_url }` — frontend chip populates
4. BG generation uses the matched spec's source image as anchor + translated Imagen prompt
5. Flex layout + critique consume the matched `spec.md`

If billing is blocked on the GCP project, Step 0 will fail at `plan_target_overview` (generate-content call) and the pipeline falls through the graceful "no style library" branch — SSE `style_selection { message: "No style library -- running without StyleSpec" }`. Enable billing to exercise the full pipeline.
