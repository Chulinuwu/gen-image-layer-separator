# Dreamy Pastel Aspiration — FWD x SCB Kids Insurance

## 1. Visual Theme & Atmosphere

This design system speaks the emotional language of a parent imagining their child's future. It is a softly lit bedroom scene tinted uniformly in pale lavender, with a mother and small daughter in a graduation cap sharing a close, intimate moment on a bed. Floating around them are translucent dream-bubbles carrying icons of life goals — travel, a home, healthcare. The atmosphere is not loud or aspirational in the corporate-achievement sense; it is **tender, interior, dreamy** — the visual equivalent of a thought one has about one's child at bedtime.

The composition is built on warm diffuse window light, shallow depth of field, and a uniform purple-to-lilac color grading that binds photography, overlay bubbles, and flat typography into one coherent space. Gold is used sparingly as a warm emphasis color on the product term, creating a gentle chromatic punch inside the analogous purple system. The overall energy register is gentle-optimistic, maternal, hopeful, and protective.

**Key Characteristics:**
- Uniformly pastel-lavender environmental tint across photograph, bokeh, and overlay zones
- Warm diffuse natural window light from upper-right, no studio flash
- Shallow depth of field with background melting into violet haze
- Three translucent floating dream-bubbles (stethoscope for health, house for home, airplane for travel) arranged diagonally on the left
- Mother-and-child lifestyle photography, right-weighted, intimate candid pose
- Heavy Thai sans typography in pure white with soft drop shadows
- Gold vertical-gradient display numerals reserved exclusively for the product term ("[product-term numeric identifier]")
- Solid yellow numerals used inline within benefit columns for promo percentages ("[promo percentage numeral]")
- Yellow pill primary CTA and deep-purple pill secondary CTA in a bottom strip
- Two-brand logo strip (FWD insurance + SCB) on a thin white horizontal band at the top
- Near-uniform violet light tint; no warm orange or cool cyan contamination of the palette

---

## 2. Color Palette & Roles

### Environmental & Background Tint
- **Lavender Wash** (`#A98DD9`) — dominant environmental tint across the photograph, floor fabric, and overlay haze. This IS the canvas.
- **Deep Violet Haze** (`#7A5FB8`) — mid-tone shadow regions of the photo, bokeh background
- **Soft Lilac Glow** (`#C7B1EA`) — highlight rims on bubbles and bright bokeh spots
- **Pale Lilac Mist** (`#E7DFF5`) — the lightest decorative tint, used in bubble interiors

### Subject / Skin & Wardrobe
- **Warm Skin Midtone** (`#E8C5AE`) — mother's and child's skin under the purple tint
- **Soft Pink Blouse Tint** (`#E7B6C6`) — mother's top reading under the lavender wash
- **Pale Patterned Fabric** (`#F3E9F2`) — child's pajama top, near-white under tint

### Text Colors
- **Primary Headline White** (`#FFFFFF`) — all major headline copy floating over the scene
- **Body Supporting Lilac** (`#E7DFF5`) — secondary supporting copy (subheads under product term)
- **Deep Plum Disclaimer** (`#5D3E9A`) — fine-print footer text on light background strip
- **Dark Plum CTA Label (secondary)** (`#3B1F66`) — text inside the purple secondary CTA pill
- **Dark Violet CTA Label (primary)** (`#3B1F66`) — also used as the primary-CTA text color on yellow background for WCAG-safe contrast

### Accent & Emphasis
- **Gold Gradient Top** (`#F4C744`) — top of vertical gradient fill on the product term "[product-term numeric identifier]"
- **Gold Gradient Bottom** (`#B88A28`) — bottom of the same gradient, darker richer gold
- **Solid Yellow Emphasis** (`#FFD862`) — promo percentage numerals inline in benefit columns, and primary CTA pill background
- **Soft Cream Accent** (`#F8E7C4`) — highlight face on gradient numerals where light catches

### Bubble & Decorative
- **Bubble Rim Pink** (`#E8B4D0`) — soft warm rim on translucent bubble edges
- **Bubble Rim Gold** (`#D9B86A`) — alternate warm rim on secondary bubbles
- **Bubble Interior Haze** (`rgba(231,223,245,0.35)`) — translucent fill of bubble interiors

### Shadow & Vignette
- **Text Shadow Deep Purple** (`rgba(30, 10, 60, 0.35)`) — soft drop behind white headline text
- **Edge Vignette** (`#3B1F66`) — subtle darkening at corners of the canvas (very low opacity)

### Logo Strip
- **Pure White Strip** (`#FFFFFF`) — solid white horizontal band at the very top
- **FWD Brand Orange-Red** (`#E8303E`) — small brand mark only, not a system color
- **SCB Purple** (`#7B4FBA`) — brand mark only

### Palette Relationship
**Analogous** across violet → lavender → lilac → pink with a **warm gold complementary accent** used only for emphasis. No greens, no cool blues, no cyans, no saturated oranges or reds in the layout system (brand marks are an exception).

---

## 3. Typography Rules

### Font Family
- **Primary display and body**: a heavy rounded Thai sans with compact letterforms and friendly-rounded corners, used across all typographic weights — headline, product term, body, fine print. Latin glyphs inherit the same treatment.
- **No secondary font**. The system is monotypal to keep the pastel-calm register; introducing a serif or a second sans would break the uniformity.

### Hierarchy

| Role | Weight | Size Category | Tracking | Line Height | Treatment | Color |
|------|--------|---------------|----------|-------------|-----------|-------|
| Main Headline | 800 | Display L (~48-56px) | Tight (-2 to -3%) | 1.15 | Soft drop shadow | `#FFFFFF` |
| Product Term (Display Numerals) | 800 display | XXL (~90-110px) | Tight | 1.0 | Gold vertical gradient fill + soft drop shadow | Gradient `#F4C744` → `#B88A28` |
| Product Term Label ("[product-term label]") | 700 | Medium (~24-28px) | Normal | 1.2 | Soft drop shadow | `#FFFFFF` |
| Benefit Column Headline | 700 | Body-L (~18-22px) | Normal | 1.3 | None | `#FFFFFF` |
| Promo Percentage Numeral | 900 | Display M (~44-52px) | Normal | 1.0 | Solid yellow fill + soft shadow | `#FFD862` |
| Promo Support Line | 700 | Body (~14-16px) | Normal | 1.4 | None | `#FFFFFF` |
| Benefit Detail Line | 500 | Body-S (~12-14px) | Normal | 1.4 | None | `#E7DFF5` |
| Primary CTA Label | 700 | Body (~14-16px) | Normal | 1.2 | None | `#3B1F66` |
| Secondary CTA Label | 700 | Body (~14-16px) | Normal | 1.2 | None | `#FFFFFF` |
| Footer Brand Line | 600 | Caption (~12px) | Normal | 1.4 | None | `#FFFFFF` |
| Fine Print Disclaimer | 400 | Micro (~9-10px) | Normal | 1.4 | None | `#5D3E9A` or `#FFFFFF` (depending on background) |

### Principles
- **Weight discipline**: three functional weight tiers — 500 (body), 700 (emphasis / column heads / CTAs), 800-900 (display and promo numerals). No use of 300, 400 italic, or lighter-than-500 body weights.
- **Tracking scales with size**: display numerals compress at -2 to -3%; body sits at 0. No positive tracking anywhere.
- **Gold is never used for running text**: only for the headline product term numerals. Yellow solid is used for promo numerals within the benefit columns — these are distinct emphasis colors serving distinct purposes.
- **Drop shadow is universal for white text over the photo** so copy never relies purely on background contrast.

---

## 4. Component & Element Stylings

### Primary CTA — Yellow Pill
- Background: `#FFD862` solid
- Text: `#3B1F66` (dark violet) for readability contrast
- Shape: fully rounded pill (radius = full height / 2)
- Padding: comfortable, ~14px vertical, ~24px horizontal
- Height: ~48-56px
- Border: none
- Shadow: none, or very subtle `0 2 4 rgba(30,10,60,0.15)` if elevation is needed
- Label: 2-line allowed, centered, wraps softly
- Used for: primary action ("[primary CTA label, detail-link style]")

### Secondary CTA — Purple Pill
- Background: `#7B4FBA` (mid purple, solid)
- Text: `#FFFFFF`
- Shape: pill, same height as primary
- Padding + height: same as primary
- Border: none
- Shadow: none
- Used for: appointment-booking / secondary action, placed at equal visual weight to primary

### Floating Dream-Bubble
- Shape: soft circle, not perfectly round — has subtle organic wobble
- Fill: `rgba(231,223,245,0.35)` translucent lilac
- Rim: thin 1-2px warm gradient ring (pink to gold to pale)
- Inner glow: soft white radial highlight top-left (~15-25% opacity)
- Icon inside: thin-line illustrated, pastel color matching bubble interior (stethoscope, house, airplane)
- Size: variable — bubbles vary from ~80px to ~150px in diameter for rhythm
- Placement: arranged on a loose diagonal on the left third, drifting upward
- Count: 3 bubbles per layout

### Benefit Column (text-only feature block)
- Two columns, split 50/50 across the middle-lower band
- Each column: a column headline + a promo numeral + supporting copy underneath
- No card, no box, no divider — columns sit directly on the photo
- Column header text and body text both rely on the photo's purple tint for contrast

### Top Logo Strip
- Pure white horizontal band, ~50-70px tall, full canvas width
- Left-aligned: co-brand mark (FWD) with short text descriptor
- Right-aligned: partner-brand mark (SCB)
- No other content in this strip — it is reserved space
- Separates cleanly from the photographic content below

### Emphasis Numerals (Product Term)
- Vertical gradient fill from `#F4C744` (top) to `#B88A28` (bottom)
- Soft highlight face `#F8E7C4` where light catches the top of letterforms
- Drop shadow behind: soft `0 4 12 rgba(30,10,60,0.35)`
- No stroke, no outline
- Placed on its own row inline with a label ("[product-term headline with numeric identifier]") — label is white sans

---

## 5. Layout Principles

### Vertical Zone Map (1000px tall canvas reference)
- **Top 0-5%**: white logo strip
- **5-20%**: main headline band — single centered line of white Thai sans on the photo's upper pastel region
- **20-40%**: product term row — white label + oversized gold gradient numerals, centered
- **40-65%**: subject photography zone — mother and child right-weighted, bubbles left-weighted
- **65-85%**: benefit columns split 50/50, each with a column headline + promo numeral + support line
- **85-95%**: two-pill CTA row — yellow pill left, purple pill right, roughly equal widths
- **95-100%**: fine-print disclaimer strip, small, multiple lines

### Horizontal / Column Strategy
- Single column for headline band and product term
- Two columns (50/50) for benefit strip
- Two pills side-by-side for CTA, each ~45% width with a small gap

### Negative Space
- Approximately 25% of the canvas is low-content space (bokeh, sky above subjects, top logo strip whitespace)
- No element crowds within 16px of a canvas edge

### Spacing Scale (estimated)
- Base unit: 8px
- Section gaps: 24-32px between vertical zones
- Column gutter: 16-24px between benefit columns
- CTA inner padding: 14-16px vertical, 24-32px horizontal

### Safe Zones
- No text placed over subjects' faces, eyes, or hands
- Bubbles do not overlap the main headline — they drift below it
- CTAs sit on an unbusy region of the photo (lower sheet/floor), never over patterned fabric

---

## 6. Photography Rules

### Lighting
- Warm diffuse natural window light from upper-right
- Soft falloff — no sharp shadow edges
- Color temperature: slightly warm (~4500-5000K) before the purple tint is applied

### Depth & Focus
- Shallow depth of field, f/2.8 equivalent
- Subjects sharp, everything 1-2m behind them is a creamy violet bokeh

### Color Grading
- Strong violet-lavender tint applied uniformly in post
- Skin retains warm cast underneath tint — not cool/clinical
- Highlights have a subtle pink bloom; shadows fall into deep plum

### Subject Direction
- Candid intimate pose — both subjects lying horizontal, faces close, genuine expression (not stiff-portrait)
- Mother looking at child with affection; child smiling outward
- Eye level roughly horizontal to camera

### Environment
- Soft bedroom setting: bed sheets, pillows, hints of plants or soft fabric in background
- No text props, no labels, no signage in scene
- No branded clothing

### Wardrobe
- Soft-pink top for mother, light patterned pajama for child
- Clothing tones fall within or adjacent to the pastel palette — nothing saturated

---

## 7. Do's and Don'ts

### Do
- Keep the pastel lavender environmental tint uniform across the entire photograph
- Use warm diffuse natural window lighting
- Frame intimate candid family photography with unscripted genuine emotion
- Use gold vertical-gradient numerals ONLY for the product term, nothing else
- Use solid yellow ONLY for promo percentage numerals and the primary CTA pill
- Apply soft drop shadow behind every white headline text so it reads over the photo
- Include translucent dream-bubbles on the left third with thin warm rim gradients
- Keep the two-pill CTA row at equal visual weight (yellow + purple, same height)
- Place the co-brand logo strip on a pure white band at the top
- Maintain analogous violet-lavender-lilac palette with only gold + yellow as warm accents

### Don't
- Don't use saturated, neon, or cool-blue environmental palettes
- Don't use hard shadows, ring-light flash, or high-contrast studio lighting
- Don't put headline text over subjects' faces, eyes, or hands
- Don't let the photograph dominate the bubbles — they are visual co-heroes
- Don't introduce green, teal, cyan, red, or orange into the design system (brand marks excepted)
- Don't use gold for body text or column headlines — gold is exclusively the product term
- Don't use solid yellow for display-scale numerals — yellow is for promo percentages only
- Don't crop subjects tight-portrait; preserve the lying-together intimate pose
- Don't use fully opaque cards for copy overlay — the tint provides contrast directly
- Don't mix serif typography or introduce a second font family
- Don't use positive tracking anywhere; display numerals always compress
- Don't make the bubbles sharp vectors — they are soft, organic, slightly imperfect

---

## 8. Agent Prompt Guide

### Quick Palette Reference
```
Lavender Wash        #A98DD9   (environmental tint)
Deep Violet Haze     #7A5FB8   (mid-shadow bokeh)
Soft Lilac Glow      #C7B1EA   (bubble highlight rim)
Pale Lilac Mist      #E7DFF5   (bubble interior)
Gold Gradient Top    #F4C744   (product term top)
Gold Gradient Bottom #B88A28   (product term bottom)
Solid Yellow         #FFD862   (promo numeral + primary CTA bg)
Dark Violet          #3B1F66   (CTA text + shadows)
Primary White        #FFFFFF   (all headline text)
Secondary Lilac      #E7DFF5   (support copy)
```

### Typography Quick Reference
```
Main headline           Thai sans 800  ~48-56px  tight -2%  white + soft shadow
Product term numerals   Thai sans 800 ~100px    tight     gold vertical gradient
Promo numerals          Thai sans 900  ~48px     normal    solid yellow + shadow
Benefit col head        Thai sans 700  ~20px     normal    white
Body / support          Thai sans 500  ~14px     normal    pale lilac or white
CTA label               Thai sans 700  ~15px     normal    dark-violet / white
Fine print              Thai sans 400  ~10px     normal    pale lilac / white
```

### Example Generation Prompts

- "Generate a vertical ad canvas tinted uniformly in pale lavender (#A98DD9). Warm diffuse window light from upper-right. Shallow depth of field, creamy violet bokeh background. Right-weighted: an intimate candid photograph of a mother and young daughter lying close on a bed, the daughter in a graduation cap, both smiling genuinely. Left-weighted: three translucent dream-bubbles on a loose diagonal, each carrying a thin-line icon (stethoscope, house, airplane), soft warm rim gradient on bubble edges. No text overlays — pure background scene."

- "Render a product-term headline row. Thai sans display, weight 800, compressed tracking. Label text '[product-term label]' in white, soft drop shadow. Followed by a massive display numeral '[product-term numeric identifier]' filled with a vertical gold gradient from #F4C744 at the top to #B88A28 at the bottom, with a soft cream highlight #F8E7C4 on the upper letter faces, and a deep purple drop shadow (0 4 12 rgba(30,10,60,0.35)). Centered horizontally."

- "Render a two-pill CTA row for the bottom of the ad. Left pill: background #FFD862, text '#3B1F66' Thai sans 700. Right pill: background #7B4FBA, text white Thai sans 700. Both pills are fully rounded, roughly 48px tall, 45% canvas width each, separated by a 16px gap."

### Iteration Guide
1. Uniform environmental tint is non-negotiable — if photography looks "neutral" or "clinical", push lavender saturation until it bleeds into skin and fabric
2. The gold gradient is vertical (top lighter, bottom darker), never horizontal or diagonal
3. Promo yellow and product-term gold are distinct — if they look the same, the product-term gold is too flat; add the vertical gradient
4. White headline text without a drop shadow fails readability — the shadow is part of the identity, not an afterthought
5. Three bubbles, not four or two — three is the rhythm
6. Bubbles drift, do not align — if they sit on a perfect horizontal, the "dream" quality is lost
7. Subject faces must remain clear of text; if copy lands on a face, rework the zone map, not the photo
