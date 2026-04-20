# Sunny Travel Joy — MSIG x SCB Protect Travel Insurance

## 1. Visual Theme & Atmosphere

This design system captures the moment just before a trip — bags packed, passport in hand, blue sky ahead. A young woman in a white sun hat and large sunglasses leans on a teal suitcase on a sunlit beach, holding a passport with a plane ticket tucked inside, looking up-left with a broad authentic smile. The mood is **joyful, vacation-anticipating, sunny, carefree**, distinct from the family-group "we are on vacation" energy of the kids-insurance system — this is the **individual pre-trip thrill**.

Typography uses a rounded friendly Thai sans in deep purple-navy on pale sky and warm sand, with a signature purple rounded pill-box that frames the price in yellow display numerals. A clean white product card on the left carries feature bullets with orange outline-ring check-marks (distinct from the kids system's green solid-fill circles). A bright yellow pill CTA anchors the bottom-right. The palette is warmer than a pure beach scene because of the sand taking up the lower half, and the addition of purple as a chromatic anchor distinguishes this from generic sunny-travel stock art. Deep focus prevails — the traveler, the suitcase, and even the sand grains remain sharp.

**Key Characteristics:**
- Pale sky gradient in the upper half, warm sand beige in the lower half (horizontal environmental split)
- Hero lifestyle portrait: single smiling woman in white sun hat + sunglasses, leaning on teal suitcase, holding passport with ticket
- Clean white rounded product card on the left 40-45%
- Thai headline in deep purple-navy across the top sky
- **Signature purple rounded pill-box** framing the price in yellow display numerals (branded visual handle)
- Orange outline-ring check-marks (distinct stroke-style icons)
- Yellow pill CTA anchored bottom-right over sand
- Top-right co-brand logo lockup: MSIG + SCB Protect
- Travel props required: suitcase, sun hat, passport, ticket
- Deep focus across entire canvas, no shallow DoF
- Bright natural warm-sun daylight from upper-left
- No dark backgrounds, no metallic accents; purple + yellow are the chromatic punches on pale sky+sand

---

## 2. Color Palette & Roles

### Sky & Atmosphere
- **Sky Pale Top** (`#B8D9EE`) — upper band of sky, cool pale blue
- **Sky Wispy Mid** (`#D7EAF6`) — softer sky tone with cloud light scatter
- **Sky Horizon Haze** (`#EDF4F9`) — near-horizon very pale wash
- **Cloud White** (`#FFFFFF`) — wispy cloud accents

### Sand & Foreground
- **Sand Light** (`#F2DFB8`) — bright foreground sand
- **Sand Body** (`#E1C488`) — mid-tone body of sand
- **Sand Shadow** (`#B89358`) — sand in shadow under suitcase and body

### Subject — Model & Props
- **Skin Warm Golden** (`#E3B996`) — model's sun-kissed skin
- **Lip Coral** (`#D9706A`) — model's natural lip color
- **White Sun Hat** (`#F8F0E0`) — straw / woven white hat in warm daylight
- **Dark Sunglass Lens** (`#2C2A34`) — deep tinted lens
- **Teal Suitcase Body** (`#7BB9BA`) — hard-shell suitcase primary color
- **Teal Suitcase Shadow** (`#4A8385`) — shadow side of suitcase
- **Passport Blue Cover** (`#1C3A5E`) — deep navy-blue passport
- **Ticket Red Strip** (`#D62828`) — small red accent on the ticket

### Text Colors
- **Headline Purple** (`#2B1F6B`) — primary Thai headline on sky
- **Subtitle Mid Purple** (`#4B3A9C`) — subtitle line beneath headline
- **Card Title Navy-Purple** (`#2B1F6B`) — product card title
- **Card Body Mid Purple** (`#4B3A9C`) — feature-bullet body text
- **Price Label Navy-Purple** (`#2B1F6B`) — "ค่าเบี้ยประกันภัย" label
- **Fine Print Gray** (`#6B6B70`) — bottom disclaimer

### Accent & Emphasis
- **Signature Purple Box** (`#7B5BD1`) — rounded pill-box that frames the price; the system's branded chromatic handle
- **Purple Box Deep Shadow** (`rgba(43, 31, 107, 0.20)`) — soft shadow behind purple box
- **Sunny Yellow Hero** (`#FFC93C`) — CTA pill fill and price display numerals
- **Yellow Highlight Edge** (`#FFE68F`) — subtle specular on CTA and numerals

### Check-Mark Icons (Orange Ring)
- **Orange Check Ring** (`#F79C42`) — hollow circle stroke
- **Orange Check Glyph** (`#F79C42`) — the check tick glyph itself
- **Check Ring Stroke Width** — 2-3px, not solid-fill

### Card Surface
- **Card Fill** (`#FFFFFF`)
- **Card Border** (`rgba(43, 31, 107, 0.04)`) — near-invisible
- **Card Shadow** (`rgba(43, 31, 107, 0.10)`) — soft elevation shadow

### Logo Lockup (Top-Right)
- **MSIG Red** (`#D91A21`) — MSIG brand mark
- **SCB Protect Purple** (`#7B4FBA`) — SCB Protect brand mark
- **Lockup Gray Separator** (`#B4B4B8`) — thin vertical divider in lockup

### Palette Relationship
**Analogous cool-pale-sky anchored by warm-neutral sand**, with **mid-violet as the chromatic anchor** for headlines and the price callout, and **yellow as a complementary punch** reserved for CTA and price numerals inside the purple box. **Orange ring** is a unique iconographic accent used only on check-marks — nowhere else. No deep royal purple (that is the wealth system), no metallic accents, no green solid-fill icons (that is the kids system).

---

## 3. Typography Rules

### Font Family
- **Rounded friendly Thai sans** with open counters and confident weights, slightly firmer than the kids-insurance system — this version carries more authority for a travel-value message without losing warmth.
- **No secondary font**. Latin glyphs inherit the same treatment.

### Hierarchy

| Role | Weight | Size Category | Tracking | Line Height | Treatment | Color |
|------|--------|---------------|----------|-------------|-----------|-------|
| Main Headline Line 1 | 800 | Display M (~32-40px) | Normal | 1.2 | Soft drop shadow | `#2B1F6B` |
| Main Headline Line 2 | 800 | Display M | Normal | 1.2 | Soft drop shadow | `#2B1F6B` |
| Subtitle | 600 | Body-L (~18-22px) | Normal | 1.3 | Soft drop shadow | `#4B3A9C` |
| Card Bullet Heading | 700 | Body-L (~16-20px) | Normal | 1.3 | None | `#2B1F6B` |
| Card Bullet Body | 500 | Body (~14-16px) | Normal | 1.5 | None | `#4B3A9C` |
| Price Label | 500 | Body (~14-16px) | Normal | 1.3 | None (inside purple box) | `#FFFFFF` |
| Promo Numeral (Price) | 900 | Display L (~56-72px) | Normal | 1.0 | Solid yellow fill + subtle shadow | `#FFC93C` |
| Promo Unit ("บาท /5 วันเดินทาง*") | 500 | Body-S (~12-14px) | Normal | 1.3 | None | `#FFFFFF` |
| CTA Label | 800 | Body-L (~16-18px) | Normal | 1.2 | None | `#2B1F6B` |
| Fine Print | 400 | Micro (~9-10px) | Normal | 1.4 | None | `#6B6B70` |

### Principles
- **Three weight tiers**: 500 (body), 700-800 (headlines + card bullets + CTA), 900 (price promo numeral only).
- **No tracking compression** — this is a friendly-open system.
- **Subtitle tracks with its headline** — both get drop shadow for sky readability; no soft shadow inside the card or the purple box.
- **Yellow numerals are used only inside the purple box** — the purple box + yellow pairing is the branded visual handle. Do not use yellow-on-sky or yellow-on-sand for the price.

---

## 4. Component & Element Stylings

### Primary CTA — Yellow Pill (Bottom-Right)
- Background: `#FFC93C` solid with top-edge specular `#FFE68F`
- Text: `#2B1F6B` Thai sans 800, ~16-18px
- Shape: fully rounded pill
- Height: ~50-56px
- Padding: ~14px vertical, ~32-40px horizontal
- Border: none
- Shadow: `0 3 8 rgba(43, 31, 107, 0.18)`
- Position: bottom-right on sand foreground
- Label: short Thai phrase like "สมัครเลย"

### Signature Purple Price Box
- Background: `#7B5BD1` solid
- Shape: rounded rectangle with pill-like heavy radius (~16-20px corners)
- Border: none
- Shadow: soft `0 4 12 rgba(43, 31, 107, 0.20)` for elevation
- Internal layout: "ค่าเบี้ยประกันภัย" small white label on top row, then the massive yellow numeral "556" center-dominant, then "บาท /5 วันเดินทาง*" small white unit on the right or bottom row
- Size: occupies a sub-block inside the product card, roughly 85-95% of card width, ~20% of card height
- This box is **non-optional** and **unique to this system** — it is the branded visual handle

### Product Card (White Rounded Rectangle)
- Background: `#FFFFFF` solid
- Corner radius: ~16-20px
- Border: near-invisible `rgba(43, 31, 107, 0.04)` 1px
- Shadow: `0 6 16 rgba(43, 31, 107, 0.10)`
- Size: occupies left 40-45% of canvas width, vertical range ~40-75% of canvas height
- Internal padding: ~20-24px
- Content stack: 2 feature-bullet rows → signature purple price box → (disclaimer optional)

### Feature Bullet Row
- Layout: icon (left, ~28-32px) + stacked text (right)
- **Icon: orange outline ring** (`#F79C42`), 2-3px stroke, hollow interior, with an orange check glyph inside — this is a **hollow ring**, not a solid-fill circle
- Heading line: Thai sans 700 deep purple-navy (~16-20px)
- Body line: Thai sans 500 mid-purple (~14-16px)
- Vertical gap between bullets: 14-18px

### Orange Check-Ring Icon
- Circle: ~28-32px diameter
- Stroke: 2-3px, color `#F79C42`
- Fill: transparent (hollow)
- Check glyph inside: 2-3px stroke `#F79C42`, centered
- No drop shadow
- This ring style is distinctive — do not substitute with solid-fill circles

### Logo Lockup (Top-Right)
- Two brand marks side by side: MSIG on the left, SCB Protect on the right
- Thin vertical gray separator (~1-2px) between the two marks
- Small text under each or alongside identifies the brand
- Positioned with ~16-24px margin from top and right

### Model Portrait (Right Side)
- Single subject: young woman leaning on a teal suitcase at beach
- Wardrobe: large white sun hat, dark sunglasses, casual white/light top
- Pose: three-quarter view, leaning on suitcase, holding passport with ticket tucked inside raised to upper-left angle, broad genuine smile, looking up-left
- Occupies right 45-50% of canvas width
- Body scale: upper-body plus suitcase + arm visible; feet and lower body out of frame

### Travel Props
- Suitcase: hard-shell, teal color, rectangular with rounded corners, trolley handle retracted
- Sun hat: wide brim, straw-textured white or cream color
- Passport + ticket: passport cover clearly blue, ticket tucked inside with a small red accent
- All props must be visible and unambiguous — this is the travel-context anchor

---

## 5. Layout Principles

### Vertical Zone Map (1000px canvas reference)
- **Top 0-8%**: MSIG + SCB Protect lockup top-right
- **8-30%**: headline (2-line) on sky, deep-purple Thai sans with shadow
- **30-38%**: subtitle line
- **38-40%**: sky/sand horizon transition
- **40-75%**: main scene — white product card on left 45%, model + suitcase on right 50%
- **75-92%**: sand foreground (clear of content except CTA)
- **88-96%**: yellow pill CTA bottom-right
- **96-100%**: fine print disclaimer strip

### Horizontal Strategy
- Left 40-45%: white product card
- Right 45-50%: model portrait with props
- Small gap (~5% canvas width) between card edge and model

### Negative Space
- Sky region (upper ~35%) provides sparse background with only headline + subtitle + logo
- Sand foreground (lower ~15%) is clean space for the CTA
- Card content is spaced — feature bullets do not crowd the price box

### Spacing Scale
- Base unit: 8px
- Section gaps: 24-32px
- Card internal padding: 20-24px
- Between bullets and price box: 20-24px
- CTA margin from card/edge: 24-32px

### Safe Zones
- Model's face (hat, sunglasses, smile) must not be overlapped by text or card
- Passport + ticket must remain visible as a prop
- Suitcase must not be cropped — teal surface is a color anchor
- Purple price box must be fully visible, never clipped by card edge

---

## 6. Photography Rules

### Lighting
- Bright natural warm daylight from upper-left
- Soft open shade on subject's face (hat does not cast harsh shadow)
- Color temperature warm (~5500K), slightly golden

### Depth & Focus
- **Deep focus** — model, suitcase, sand grains, and sky all sharp
- No bokeh, no shallow DoF
- Slight atmospheric softness allowed on distant sky but not depth-of-field blur

### Color Grading
- Warm natural saturation
- Slight desaturation push on the sky toward pale-cool to make the purple typography and violet box pop more
- Sand pushed toward warm-gold (not grey or beige)
- Skin tones golden and warm

### Subject Direction
- Single subject, eye line up-left (toward the headline/off-canvas)
- Candid-joy expression, teeth showing, authentic
- Holding passport angled to show the blue cover and ticket's red strip

### Environment
- Outdoor beach with sand foreground + ocean/sky background
- No other people in scene
- Travel props (suitcase, hat, passport, ticket) visually clustered with the subject

### Wardrobe
- Casual summer travel attire — light top, natural tones
- Wide-brim sun hat and large dark sunglasses are signature — they are part of the visual identity
- No branded wardrobe, no logos on clothes

---

## 7. Do's and Don'ts

### Do
- Split the canvas horizontally: upper pale-sky, lower warm-sand
- Frame a single lifestyle subject in sun hat + sunglasses leaning on a teal suitcase
- Include all travel props: suitcase, hat, passport with ticket
- Use mid-violet (`#7B5BD1`) as the chromatic anchor for the price callout box
- Use orange outline-ring check-marks (hollow, 2-3px stroke) for feature bullets
- Place the yellow pill CTA on sand bottom-right
- Apply deep focus across entire canvas — no bokeh
- Use a clean white rounded product card for feature details
- Keep the model's face open (hat brim angled off-face) and smile visible
- Render the signature purple price box as a branded visual handle — non-optional

### Don't
- Don't use dark or moody backgrounds — this is bright daytime
- Don't use deep royal purple — purple here is mid-violet, not institutional
- Don't use metallic or gold accents
- Don't use green solid-fill check-marks — those belong to the kids system
- Don't omit the purple price box — it is the branded chromatic handle
- Don't place the price in yellow directly on sand or sky — it must be inside the purple box
- Don't replace the single-subject with a group or a family — this is an individual pre-trip scene
- Don't crop out the hat or the suitcase — they define the travel context
- Don't use illustration or cartoon style — lifestyle photography only
- Don't apply shallow depth of field or bokeh — deep focus is required
- Don't dress the subject in saturated primary colors — the palette is warm-neutral

---

## 8. Agent Prompt Guide

### Quick Palette Reference
```
Sky Pale Top         #B8D9EE
Sky Wispy Mid        #D7EAF6
Sky Horizon          #EDF4F9
Sand Light           #F2DFB8
Sand Body            #E1C488
Sand Shadow          #B89358
Headline Purple      #2B1F6B
Subtitle Purple      #4B3A9C
Signature Box Purple #7B5BD1   (price callout box)
Sunny Yellow         #FFC93C   (CTA + price numeral)
Orange Check Ring    #F79C42   (hollow bullet icon)
Teal Suitcase        #7BB9BA
Passport Blue        #1C3A5E
Card White           #FFFFFF
Fine Print Gray      #6B6B70
```

### Typography Quick Reference
```
Headline 2-line    Thai sans 800  ~32-40px  normal  deep-purple + soft shadow
Subtitle           Thai sans 600  ~18-22px  normal  mid-purple + shadow
Card bullet head   Thai sans 700  ~16-20px  normal  deep-purple
Card bullet body   Thai sans 500  ~14-16px  normal  mid-purple
Price label        Thai sans 500  ~14-16px  normal  white (on purple box)
Price numeral      Thai sans 900  ~56-72px  normal  yellow fill
Price unit         Thai sans 500  ~12-14px  normal  white
CTA label          Thai sans 800  ~16-18px  normal  deep-purple (on yellow pill)
Fine print         Thai sans 400  ~9-10px   normal  gray
```

### Example Generation Prompts

- "Generate a bright outdoor travel scene, vertical canvas. Upper half pale sky gradient (#B8D9EE top to #EDF4F9 horizon) with soft wispy white clouds. Lower half warm sand beige (#F2DFB8 front to #B89358 shadow). Warm natural daylight from upper-left. Deep focus — all elements sharp."

- "Position a single lifestyle subject on the right 45-50% of the canvas: young woman leaning on a teal (#7BB9BA) hard-shell suitcase on the sand. She wears a wide-brim white sun hat (cream tone) and large dark sunglasses, holding an open blue passport (#1C3A5E cover) with a small red-strip ticket visible inside. Arm raised to upper-left, broad genuine smile, looking up-left off-canvas. Three-quarter pose. Upper body visible; sand covers her lower legs/feet. No other people in scene."

- "Render a clean white rounded product card on the left 45% of the canvas, vertical range ~40-75% height. Pure white fill (#FFFFFF), 18px corner radius, soft shadow 0 6 16 rgba(43, 31, 107, 0.10). Inside: 2 feature-bullet rows at the top, each with a hollow orange ring icon (#F79C42, 2-3px stroke, transparent interior, contains a 2-3px orange check glyph, ~30px diameter) on the left and a 2-line stacked text on the right (bullet heading deep-purple Thai sans 700 ~18px, body mid-purple Thai sans 500 ~14px)."

- "Render the signature purple price box near the bottom of the card. Background solid #7B5BD1, rounded rectangle with ~18px corner radius, soft shadow 0 4 12 rgba(43, 31, 107, 0.20), size ~90% of card width. Inside, top row: small white Thai label 'ค่าเบี้ยประกันภัย' in Thai sans 500 ~14px. Below: massive yellow display numeral '556' in Thai sans 900 ~64px with fill #FFC93C and subtle shadow. To the right of the numeral: '/5 วันเดินทาง*' small white Thai sans 500."

- "Render the headline block on the sky. 2-line Thai sans 800 at ~38px in deep-purple #2B1F6B with soft drop shadow rgba(43, 31, 107, 0.20) 0 3 8. Below, subtitle in Thai sans 600 ~20px mid-purple #4B3A9C with the same shadow."

- "Render a yellow pill CTA at the bottom-right of the canvas on the sand. Background #FFC93C with top-edge specular #FFE68F. Text 'สมัครเลย' in Thai sans 800 ~17px, deep-purple #2B1F6B. Fully rounded pill, ~52px tall, ~36px horizontal padding. Soft lift shadow 0 3 8 rgba(43, 31, 107, 0.18)."

- "Render the top-right logo lockup: MSIG brand mark (#D91A21) on the left and SCB Protect brand mark (#7B4FBA) on the right, separated by a thin vertical gray line (~1-2px, #B4B4B8). Positioned ~16-24px from top and right edges."

### Iteration Guide
1. The sky should look "pale" and "wispy", not deep-blue or bright turquoise — this is not the kids-beach system
2. The purple price box is branded and non-optional — if it is missing, the layout reads generic
3. Orange outline rings on check-marks are distinctive — solid-fill green circles belong to a different system
4. The model must clearly show a passport + ticket — without them, the travel context is ambiguous
5. Deep focus is mandatory — any shallow DoF reads as "wrong system"
6. Dead-purple `#7B5BD1` — if the price box reads "royal purple", saturation/lightness is off; it should be lighter and softer than the institutional deep-purple
7. Only ONE subject — adding a family or group breaks the individual-pre-trip energy
