# Cheerful Beach Family — SCB Protect PA Kids Plus

## 1. Visual Theme & Atmosphere

This design system translates the emotional promise of children's accident insurance into the visual language of a bright family beach day. A broad turquoise sky and sunlit sand fill the canvas. A young family — father kneeling, small boy pointing upward, mother standing — are framed mid-candid-joy on the beach, their faces genuinely smiling. The mood is **daytime-carefree, family-protective, summer-safe** — children play, parents watch, insurance quietly enables both.

Typography is rounded, navy-on-sky, with yellow used surgically on emotional phrases and promo numerals to punch energy into otherwise calm copy. Product details live inside a clean white rounded card on the left half of the canvas, decorated with green check-mark circles. A bright yellow pill CTA anchors the bottom. The entire composition is bathed in crisp natural daytime light with deep focus — every grain of sand and every cloud wisp is sharp and visible. Nothing is dreamy or shallow-focused here; this is a **bright, present, optimistic** aesthetic.

**Key Characteristics:**
- Bright turquoise sky + pale aqua cloud gradient
- Warm sandy beach foreground with loose sand castle prop
- Candid family photograph, right-weighted (right 45-50% of canvas)
- Clean white rounded product card, left-weighted
- Bold navy Thai headline across the top sky with selective yellow highlighted phrases
- Green solid-fill check-mark circles for feature bullets inside the card
- Big yellow display numeral for price emphasis
- Yellow pill CTA bottom-right on sand
- SCB Protect logo top-right corner
- Deep focus throughout — no shallow depth of field
- Warm natural daytime sun from upper-left, no studio artifacts
- No dark backgrounds, no purple accents, no metallic surfaces

---

## 2. Color Palette & Roles

### Sky & Atmosphere
- **Sky Aqua Top** (`#5FBAD9`) — the mid-upper band of sky, deepest blue
- **Sky Cloud Wisp** (`#8AD1EA`) — softer sky tone where clouds scatter light
- **Sky Low Wash** (`#C8E8F2`) — horizon-close pale blue where sky meets sea
- **Sky Cloud Fluff** (`#FFFFFF`) — white cloud accents

### Sand & Foreground
- **Warm Sand Light** (`#F3E1BE`) — brightest sand grains, sun-hit foreground
- **Sand Mid** (`#E6C98E`) — body color of dry sand
- **Sand Shadow** (`#B89764`) — sand in shadow under the sand castle and figures

### Ocean
- **Ocean Teal** (`#5DBBB9`) — middle ocean band
- **Ocean Deeper** (`#3B8F91`) — distant ocean shadow
- **Ocean Foam White** (`#F8FCFD`) — breaking wave tops

### Subject Skin & Wardrobe
- **Skin Warm Midtone** (`#E0B89A`) — family skin color under sunny daylight
- **White Cotton Shirts** (`#FFFFFF`) — mother and child tops
- **Light Denim / Khaki** (`#B9B09A`) — father's shirt tone
- **Bright Boy Tee** (`#4FA6E6`) — child's bright blue t-shirt pop

### Text Colors
- **Headline Navy** (`#1C2858`) — all title and subtitle text on sky
- **Body Navy** (`#2E4E7E`) — card product descriptions and mid-weight body
- **Card Title Navy** (`#1C2858`) — "[product name line]"
- **Fine Print Gray** (`#6B6B70`) — bottom disclaimer lines
- **CTA Text Navy** (`#1C2858`) — text inside the yellow pill CTA

### Accent & Emphasis
- **Sunny Yellow Hero** (`#FFC93C`) — primary CTA fill, highlight phrase backdrop, price numerals
- **Yellow Highlight Band** (`#FFD75E`) — slightly softer fill for in-line highlighted words
- **Yellow Glow Edge** (`#FFE68F`) — subtle specular on pill CTA top edge

### Check-Mark Icons
- **Green Check Solid** (`#47B680`) — the filled circle background of feature bullets
- **Green Check Deep** (`#2F8056`) — slightly darker shadow tone inside check circle
- **White Check Glyph** (`#FFFFFF`) — the check tick itself on the green circle

### Card Surface
- **Card Fill** (`#FFFFFF`) — pure white
- **Card Border** (`rgba(28, 40, 88, 0.05)`) — near-invisible edge, only for separation
- **Card Shadow** (`rgba(28, 40, 88, 0.08)`) — soft elevation shadow

### Logo & Brand
- **SCB Protect Purple** (`#7B4FBA`) — brand mark only, not a layout color
- **SCB Logo Red** (`#D11E2F`) — brand mark, not a layout color

### Palette Relationship
**Analogous cool blues** anchored by a single **warm yellow complementary accent** and a **teal-green iconographic accent** for check-marks. No purple, no gold, no metallic surfaces, no dark backgrounds. The palette is fundamentally daytime-outdoor-cheerful.

---

## 3. Typography Rules

### Font Family
- **Rounded friendly Thai sans** with open counters and softer corner radii than a standard geometric sans. Used for all text — headline, card, body, CTA, fine print.
- **No secondary font**. Latin glyphs inherit the same treatment.

### Hierarchy

| Role | Weight | Size Category | Tracking | Line Height | Treatment | Color |
|------|--------|---------------|----------|-------------|-----------|-------|
| Main Headline Line 1 | 800 | Display M (~32-40px) | Tight (-1%) | 1.2 | Soft drop shadow | `#1C2858` |
| Main Headline Line 2 (highlighted phrase) | 800 | Display M | Tight | 1.2 | Solid yellow fill behind words | `#1C2858` on `#FFC93C` band |
| Subtitle Line | 600 | Body-L (~18-22px) | Normal | 1.3 | Soft drop shadow | `#1C2858` |
| Card Title | 700 | Display S (~22-28px) | Normal | 1.25 | None | `#1C2858` |
| Card Bullet Heading | 700 | Body (~14-16px) | Normal | 1.4 | None | `#1C2858` |
| Card Bullet Body | 500 | Body (~14-16px) | Normal | 1.5 | None | `#2E4E7E` |
| Promo Numeral Price | 900 | Display L (~56-72px) | Normal | 1.0 | Solid yellow fill + subtle shadow | `#FFC93C` |
| Promo Currency + Unit | 600 | Body-L (~18-22px) | Normal | 1.2 | None | `#1C2858` |
| CTA Label | 800 | Body-L (~16-18px) | Normal | 1.2 | None | `#1C2858` |
| Fine Print | 400 | Micro (~9-10px) | Normal | 1.4 | None | `#6B6B70` or `#1C2858` |

### Principles
- **Three weight tiers**: 500 (body), 700-800 (headlines + card titles + CTA), 900 (promo display numerals).
- **Yellow highlight behind text** is used sparingly — only on one emotional phrase inside the headline. It is not used on the price numerals (the price uses yellow as fill, not as a band behind dark text).
- **Drop shadow is reserved for text over the photograph** (headline + subtitle on sky). Text inside the card does not need shadow — the white card provides contrast.
- **No tracking compression below -1%** — this is a friendly-open system, not an institutional-compressed one.

---

## 4. Component & Element Stylings

### Primary CTA — Yellow Pill
- Background: `#FFC93C` solid with very subtle top-edge highlight `#FFE68F`
- Text: `#1C2858` Thai sans 800, ~16-18px
- Shape: fully rounded pill
- Height: ~50-56px
- Padding: ~14px vertical, ~32-40px horizontal
- Border: none
- Shadow: soft `0 3 8 rgba(28, 40, 88, 0.15)` for lift
- Placement: bottom-right, sits on sand foreground
- Label: single short Thai word/phrase like "[short CTA action label, 1-3 words]"

### Product Card (White Rounded Rectangle)
- Background: `#FFFFFF` solid
- Corner radius: ~16-20px
- Border: near-invisible `rgba(28, 40, 88, 0.05)` 1px (optional)
- Shadow: soft `0 6 16 rgba(28, 40, 88, 0.08)` for elevation
- Size: occupies left 40-45% of canvas width, vertical range ~45-75% of canvas height
- Internal padding: ~20-24px all sides
- Content stack: card title → 3 feature-bullet rows → price block → optional disclaimer line

### Feature Bullet Row
- Layout: icon (left, ~28-32px) + stacked text (right) in horizontal flex
- Icon: green solid-fill circle (`#47B680`) with a white check glyph inside, no stroke
- Heading line: Thai sans 700 navy, short phrase (e.g. "[bullet heading, short feature descriptor]")
- Body line: Thai sans 500 mid-navy, supporting detail (e.g. "[bullet body, detailed benefit with numeric amount and unit]")
- Vertical gap between bullets: 12-16px

### Price Block (Inside Card)
- "[price label]" small label line, Thai sans 500 mid-navy
- "[starting-from prefix label]" left-aligned small text
- Big yellow promo numeral: Thai sans 900 display, fill `#FFC93C`
- "[currency + period unit]" unit to the right of numeral, smaller, navy
- Subtle star-rocket flourish or small prefix label ("[price label]") that introduces the numeral
- Small asterisk footnote link

### Yellow Highlight Band (Inline Phrase Emphasis)
- Applied only to a specific emotional emphasis phrase in the headline
- Fill: `#FFC93C` solid, rounded rectangle shape that hugs the text
- Text remains navy inside the band for contrast
- The band extends slightly beyond the text glyphs (padding ~6-10px horizontal)
- Only one such band per layout — do not repeat

### Headline (on Sky)
- 3 lines maximum: primary message → highlighted emotional phrase → supporting tagline
- All navy, with drop shadow
- Tight line-height (1.2) to keep block compact
- Middle line gets the yellow highlight band treatment

### Sand Castle Prop
- Small sand castle structure sits in the foreground sand
- Naturalistic, not stylized
- Sometimes partially hidden by foreground elements
- Adds to the "beach scene" credibility without being a focal point

### Logo Strip (Top-Right)
- Small SCB Protect brand lockup
- Positioned with ~16-24px margin from top and right edges
- Sits directly on sky, no panel or background

### Ocean & Horizon Line
- Horizon sits at approximately 30-40% of canvas height
- Ocean band occupies a thin strip (~10% canvas height)
- Gentle wave texture visible but not foamy

---

## 5. Layout Principles

### Vertical Zone Map (1000px canvas reference)
- **Top 0-8%**: SCB Protect logo top-right
- **8-30%**: headline block (3 lines) on sky + subtitle beneath
- **30-40%**: horizon / ocean transition
- **40-75%**: main scene — product card on left 45%, family photo on right 50%
- **75-88%**: sand foreground with sand castle + yellow CTA pill
- **88-100%**: fine print strip + secondary "[channel-attribution tagline]" line

### Horizontal Strategy
- Left 40-45%: white product card
- Right 50%: family photograph
- Small gap between card and photo (~3-5% canvas width)
- Headline spans nearly full width at the top

### Negative Space
- Sky region provides ~30% breathing room above the main content block
- Card content is spacious, not dense — bullets have 12-16px vertical gaps
- Sand foreground is clean space for the CTA

### Spacing Scale
- Base unit: 8px
- Section gaps: 24-32px
- Card internal padding: 20-24px
- Between bullets inside card: 12-16px
- CTA margin from card and edge: ~24-32px

### Safe Zones
- Family faces must not be covered by text
- Sand castle can overlap with the edge of the card as long as card content is clear
- Yellow highlight band must be a single line, not wrap

---

## 6. Photography Rules

### Lighting
- Bright natural daytime sun from upper-left
- Open shade balance — no harsh face shadows
- Color temperature warm (~5500K)
- All subjects evenly lit, no rim-light drama

### Depth & Focus
- **Deep focus** — every element from foreground sand to distant horizon is sharp
- No bokeh, no shallow DoF, no blur
- This is a key distinguishing trait: the system is crisp, not dreamy

### Color Grading
- Natural saturation, slightly warm
- Sky pushed toward turquoise-aqua (not grey or pure blue)
- Sand pushed toward warm yellow-cream (not grey or pure beige)

### Subject Direction
- Candid family pose, mid-action
- At least one subject pointing or looking upward (toward the headline or sky)
- Another subject may be kneeling or crouching lower for compositional variety
- Eye line varies — not everyone looking at camera

### Environment
- Sandy beach, ocean horizon, clear sky with some wispy clouds
- Natural sand castle or other beach props OK as supporting texture
- No branding, no signage, no text props in scene

### Wardrobe
- Family dressed in casual beach or summer clothes
- Mother in white/cream, father in light casual shirt, child in bright primary color for pop
- Nothing saturated or neon outside the bright-child-tee

---

## 7. Do's and Don'ts

### Do
- Use bright turquoise-aqua sky and warm sand as the canvas
- Frame a candid family photograph with genuine unscripted emotion
- Apply deep focus — everything sharp across the canvas
- Use a clean white rounded product card for all product details
- Use green solid-fill check-mark circles as feature-bullet icons
- Apply a single yellow highlight band to one emotional phrase per layout
- Use big yellow promo numerals for the price
- Place a yellow pill CTA on sand foreground with subtle lift shadow
- Keep lighting warm natural daytime, no studio flash
- Dress the child in one bright primary-color accent for visual pop

### Don't
- Don't use dark or moody backgrounds — this is a daytime system
- Don't introduce purple, gold, or metallic accents
- Don't apply shallow depth of field — every element must be sharp
- Don't use card backgrounds other than pure white
- Don't use stroke-outline check-marks — they must be solid-fill circles
- Don't apply yellow highlight bands to more than one phrase per layout
- Don't crop subjects tight-portrait — full-body in environment is required
- Don't place text over the family's faces or the sand castle if it is a focal prop
- Don't use neon greens or saturated pinks — the palette is warm-friendly not electric
- Don't replace the family photography with illustration or stock-cartoon
- Don't compress tracking below -1% — the system is friendly-open

---

## 8. Agent Prompt Guide

### Quick Palette Reference
```
Sky Aqua Top          #5FBAD9   (mid-upper sky)
Sky Cloud Wisp        #8AD1EA   (cloud-scattered sky)
Sky Low Wash          #C8E8F2   (horizon)
Sand Light            #F3E1BE   (sun-hit sand)
Sand Mid              #E6C98E   (body sand)
Sand Shadow           #B89764   (shadowed sand)
Ocean Teal            #5DBBB9
Ocean Deeper          #3B8F91
Headline Navy         #1C2858   (all headline text)
Body Navy             #2E4E7E   (body text)
Sunny Yellow          #FFC93C   (CTA + promo numerals + highlight band)
Green Check Solid     #47B680   (bullet icons)
Green Check Deep      #2F8056   (icon shadow)
Card White            #FFFFFF
Fine Print Gray       #6B6B70
```

### Typography Quick Reference
```
Headline line 1         Thai sans 800  ~32-40px  tight -1%  navy + soft shadow
Highlighted phrase      Thai sans 800  ~32-40px  tight     navy on yellow band
Subtitle                Thai sans 600  ~18-22px  normal    navy + shadow
Card title              Thai sans 700  ~22-28px  normal    navy
Bullet heading          Thai sans 700  ~14-16px  normal    navy
Bullet body             Thai sans 500  ~14-16px  normal    mid-navy
Promo numeral           Thai sans 900  ~56-72px  normal    yellow fill + shadow
CTA label               Thai sans 800  ~16-18px  normal    navy (on yellow pill)
Fine print              Thai sans 400  ~9-10px   normal    gray
```

### Example Generation Prompts

- "Generate a bright outdoor family beach scene on a vertical canvas. Turquoise sky gradient from #5FBAD9 at top to pale #C8E8F2 at horizon with wispy white clouds. Sandy beach foreground from #F3E1BE (front) to #E6C98E (back) with a small natural sand castle prop. Ocean band mid-canvas with teal #5DBBB9 water. Warm bright natural daylight from upper-left. Deep focus — every grain of sand, every cloud, every subject sharp. No shallow DoF."

- "Position a candid family on the right 50% of the canvas: father kneeling on the sand pointing up, small boy in a bright blue t-shirt mid-pointing-gesture smiling, mother standing on the right in a white top observing. Genuine unscripted expressions. Family occupies ~40% of canvas height. Full body visible for all three."

- "Render a clean white rounded product card on the left 45% of the canvas, vertical range from ~40% to ~75% height. Pure white fill, 18px corner radius, soft shadow 0 6 16 rgba(28,40,88,0.08). Inside the card: card title '[product name line]' in Thai sans 700 navy, ~26px. Below it, 3 feature-bullet rows — each bullet has a green solid-fill circle (#47B680) with a white check glyph on the left, and 2-line stacked text on the right (bullet heading navy Thai sans 700, body mid-navy Thai sans 500)."

- "Render a price block inside the bottom of the card. Small '[small label line above price block]' label in Thai sans 500 navy, then '[starting-from prefix label]' small label, then a massive yellow display numeral '[price display numeral]' in Thai sans 900 (~64px) filled with #FFC93C and a very soft shadow. Unit '[currency + period unit]' in Thai sans 600 navy ~20px right of the numeral."

- "Render a yellow pill CTA at the bottom-right on the sand. Background #FFC93C with a subtle highlight on the top edge #FFE68F. Text '[short CTA action label, 1-3 words]' in Thai sans 800 ~16-18px, navy #1C2858. Fully rounded pill, ~52px tall, padding ~14px vertical and 36px horizontal. Soft lift shadow 0 3 8 rgba(28, 40, 88, 0.15)."

- "Render the headline block on the sky above the main scene. Three lines, all Thai sans navy #1C2858 with soft drop shadow rgba(28,40,88,0.15) 0 3 8. Line 1: primary message in Thai sans 800, ~36px. Line 2: an emotional emphasis phrase ('[short emotional emphasis phrase, 2-4 Thai words]') with a solid yellow #FFC93C rounded-rectangle highlight band hugging the text, 6-10px horizontal padding around glyphs. Line 3: supporting tagline in Thai sans 600, ~20px."

### Iteration Guide
1. If the sky looks "flat blue" or "grey", it's not turquoise enough — push the saturation toward aqua-green
2. Deep focus is non-negotiable — any bokeh or blur signals "wrong system"
3. Yellow highlight bands belong on ONE phrase only — multiple bands degrade impact
4. Green check circles must be solid-fill, not outline — outlines read as the wrong system (travel or a cooler ad)
5. The child should wear one bright pop color (blue, red, yellow) — muted child wardrobe kills the family-cheer feel
6. Headline drop shadow must be soft and subtle — if it looks like a harsh stroke, reduce blur and opacity
7. Card must be pure white — any tint (cream, ivory, grey) reads as the wrong visual system
