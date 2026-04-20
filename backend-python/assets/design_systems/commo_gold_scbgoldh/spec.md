# Royal Purple Wealth — SCB Gold Fund (SCBGOLDH)

## 1. Visual Theme & Atmosphere

This is the design language of institutional wealth. A deep royal-purple radial gradient dominates the canvas, and from the right rises a 3D polished gold bar stamped "FINE GOLD 999.9 NET WT 1000g" lit with a dramatic single key light that creates hot specular highlights on its faces. Gold coins pile at the bar's base as supporting texture. The visual register is not consumer-friendly or lifestyle-aspirational; it is **institutional-serious, stable, prestigious** — the color language banks reserve for gold, bonds, and high-minimum-investment instruments.

Typography on this canvas is bold Thai sans in pure white for the headline, with the fund wordmark rendered as an all-caps condensed gold display treatment that reads as a seal of identity. A frosted translucent glass card floats over the busy scene to carry product detail without competing with the hero. One purple pill CTA sits near the bottom, and fine print occupies the very bottom edge. Negative space is generous — the hero product is given room to breathe rather than crowded.

**Key Characteristics:**
- Deep royal purple radial gradient environment (darkest at corners)
- Hero product is a 3D polished gold bar, diagonal-right, with specular drama
- Scattered gold coins pile at the base as supporting texture
- Frosted glassmorphic card carries product details over the scene
- Bold 2-line Thai sans headline top-left in pure white
- Gold all-caps condensed fund wordmark inside the card (branded seal)
- Single purple pill CTA centered-lower
- SCB corner logo top-right
- SCB EASY logo bottom-left with fine print disclaimer band
- Complementary purple + gold color pairing, no tertiary chromatic accents
- Studio product photography aesthetic, no real-world scene

---

## 2. Color Palette & Roles

### Environmental Background
- **Royal Purple Core** (`#5A2D8D`) — center of radial gradient, brightest point
- **Royal Purple Base** (`#3F1F6C`) — mid-range of gradient, body of canvas
- **Royal Purple Shadow** (`#1E0B3C`) — darkest corners, edge vignette
- **Deep Violet Tint** (`#2A1453`) — additional corner gradient step for depth

### Gold (Primary Accent)
- **Rich Gold Hero** (`#D4AF37`) — the gold bar's mid-face color
- **Gold Highlight Face** (`#F5D870`) — the sharp specular top edge of the bar
- **Gold Shadow Face** (`#9C7418`) — the bar's side face in shadow, darker gold
- **Gold Deep Core** (`#6B4A10`) — recessed inscriptions and deep reflections
- **Gold Cream Highlight** (`#F8E7C4`) — tiny specular sparkle on corners and coin edges

### Coins (Secondary Gold Texture)
- **Coin Gold Top** (`#D9B44A`) — top-lit surface of stacked coins
- **Coin Gold Mid** (`#B08628`) — mid tones in coin pile
- **Coin Gold Shadow** (`#6C4F14`) — shadow between coins, deep recesses

### Text Colors
- **Headline White** (`#FFFFFF`) — main 2-line Thai headline
- **Card Body White** (`#FFFFFF`) — product description text inside the frosted card
- **Supporting Lilac** (`#E9DAF8`) — subtitles, risk tag, SCB EASY label
- **Fine Print Lilac** (`#D0BCF0`) — bottom disclaimer text
- **Deep Plum** (`#3B1F66`) — reserved dark text color if any text on a light surface

### Fund Wordmark (Gold Gradient Display)
- **Wordmark Gradient Top** (`#F5D870`)
- **Wordmark Gradient Mid** (`#D4AF37`)
- **Wordmark Gradient Bottom** (`#9C7418`)
- **Wordmark Inner Shadow** (`#6B4A10`) — subtle darker inset on letter interiors

### Card Surface (Glassmorphism)
- **Card Fill Translucent** (`rgba(255, 255, 255, 0.10)`) — base frosted fill
- **Card Border** (`rgba(255, 255, 255, 0.18)`) — thin 1px edge
- **Card Inner Highlight** (`rgba(255, 255, 255, 0.25)`) — top edge catch light
- **Card Shadow** (`rgba(30, 10, 60, 0.35)`) — soft elevation shadow cast into purple

### CTA & UI
- **CTA Purple Fill** (`#7B4FBA`) — primary CTA pill background
- **CTA Purple Hover Hint** (`#8F64C9`) — inferred hover/active state
- **CTA Text White** (`#FFFFFF`)

### Edge Vignette & Shadow
- **Bar Ground Shadow** (`rgba(30, 10, 60, 0.50)`) — deep purple cast pool under bar and coins
- **Canvas Edge Vignette** (`rgba(10, 5, 25, 0.30)`) — subtle darkening at canvas corners

### Palette Relationship
**Complementary pairing** — deep violet-purple with rich gold. Zero tertiary chromatic accents. The palette is institutionally disciplined: if a color is not purple, white, gold, or a neutral lilac derivation, it does not belong in this system.

---

## 3. Typography Rules

### Font Family
- **Primary Thai sans**: bold display family, slight condensation, structured letterforms. Used for the headline and body copy.
- **Fund wordmark typography**: all-caps condensed display, slightly serif-influenced for letterpress weight. This is a distinct stylistic treatment, not a different font family — it is the same family pushed to its heaviest display weight with custom gold-gradient fill.
- **No third typeface**. Latin glyphs inherit the same treatment.

### Hierarchy

| Role | Weight | Size Category | Tracking | Line Height | Treatment | Color |
|------|--------|---------------|----------|-------------|-----------|-------|
| Main Headline (2-line) | 700 | Display M (~36-44px) | Tight (-1.5%) | 1.15 | Soft drop shadow | `#FFFFFF` |
| Fund Wordmark ("SCBGOLDH") | 800 condensed caps | Display L (~56-72px) | Wide (+3%) | 1.0 | Gold vertical gradient fill + subtle inner shadow + outer gold glow | Gradient (top `#F5D870` → bot `#9C7418`) |
| Risk Tag ("ความเสี่ยง 8") | 500 | Body (~14-16px) | Normal | 1.2 | Parentheses + small size, sits inline | `#E9DAF8` |
| Card Product Description | 500 | Body (~14-16px) | Normal | 1.5 | None | `#FFFFFF` |
| CTA Label ("ลงทุนเลย") | 700 | Body (~14-16px) | Normal | 1.2 | None | `#FFFFFF` |
| SCB EASY Brand Line | 600 | Caption (~12-13px) | Normal | 1.3 | None | `#E9DAF8` |
| Fine Print Disclaimer | 400 | Micro (~9-10px) | Normal | 1.4 | None | `#D0BCF0` |

### Principles
- **Weight discipline**: three tiers — 500 (body), 700 (headline + CTA), 800 condensed caps (wordmark only). No lightweight 300 or italic variants.
- **Wordmark tracking is the opposite of headline tracking**: the headline compresses, the wordmark opens up to carry weight across the card. This contrast is part of the branded feel.
- **Gold fill is exclusive to the wordmark**. Headline and body text never borrow the gold gradient — that would dilute the fund-name seal.
- **No drop shadow on card body text**. The card's glassmorphic surface provides contrast directly.

---

## 4. Component & Element Stylings

### Gold Bar Hero (3D Product)
- Rendered as a high-quality 3D product shot of a stamped gold ingot
- Stamp text: "FINE GOLD" (condensed bold display), "999.9" (smaller below), brand seal, and at the bottom edge "NET WT 1000g"
- Orientation: tilted three-quarter with the front face visible, angled to rise from bottom-right toward upper-right
- Surface: hyper-polished, single key specular catch on the top edge, soft rim from ambient gold reflection
- Grounding: soft elliptical deep-purple shadow beneath on the background field
- Size: occupies ~40% of canvas width, ~50% of canvas height
- Position: right-center, slightly crossing vertical midline

### Coin Pile
- Scattered loose coins stacked at the base of the gold bar
- Each coin shows visible embossed detail and a highlight rim
- Coins are partially in front of the bar's base (lower foreground) and partially behind (background texture)
- Count: ~20-30 visible coin edges
- Size variance: mix of larger foreground coins and smaller scattered coins for depth
- Some coins bleed off the bottom edge intentionally

### Frosted Product Card (Glassmorphism)
- Shape: rounded rectangle with generous corner radius (~20-24px)
- Fill: `rgba(255, 255, 255, 0.10)` with a subtle backdrop blur (~8-12px equivalent)
- Border: thin 1px `rgba(255, 255, 255, 0.18)` on all edges
- Shadow: soft outer shadow `0 8 24 rgba(30, 10, 60, 0.35)` for elevation
- Inner content: vertical stack — fund wordmark at top, risk tag parenthetical below, then 3 lines of product description
- Size: ~40-45% canvas width, fits on left third without crowding
- Content padding: ~20-24px inner gutter

### Fund Wordmark (Gold Display Treatment)
- All-caps condensed display, vertical gold gradient fill
- Subtle inner shadow on letter interior faces for letterpress weight
- Soft gold ambient glow behind the letters (~8px blur, gold-shadow color)
- Slight tracking open (+3%) for weight
- Baseline positioned at the top of the card, just below the top padding

### Risk Tag
- Small parenthetical text, plain Thai sans, body weight
- Sits inline on the line below the wordmark, slightly indented
- Color: supporting lilac (`#E9DAF8`)
- No pill, no background — it's just inline label text

### Primary CTA — Purple Pill
- Background: `#7B4FBA` solid
- Text: `#FFFFFF` Thai sans 700
- Shape: fully rounded pill, radius = half height
- Height: ~48-52px
- Padding: ~14px vertical, ~40-48px horizontal (wider than typical for wealth-product gravitas)
- Border: none
- Shadow: very subtle `0 2 6 rgba(30, 10, 60, 0.25)` for lift, optional
- Placement: centered horizontally below the card, or right-aligned to card edge

### SCB Logo (Top-Right Corner)
- Small brand mark, ~32-40px tall
- Positioned with ~16-24px margin from canvas edges
- Not on a contrasting background panel — sits directly on the purple

### SCB EASY Brand Row (Bottom-Left)
- Small SCB EASY logo + a one-line descriptor in supporting lilac
- Acts as a "powered by" or channel-attribution tag
- Sits just above the fine print strip

### Fine Print Disclaimer Band
- Bottom-aligned strip with 3-5 lines of micro-size disclaimer text
- Full canvas width but constrained side padding
- Justified or left-aligned body
- Color: pale lilac (`#D0BCF0`)

### Background Radial Gradient
- Center point slightly left of canvas center
- Three stops: core (`#5A2D8D`) → mid (`#3F1F6C`) → edge (`#1E0B3C`)
- Subtle additional vignette at the very corners for frame drama

---

## 5. Layout Principles

### Vertical Zone Map (1000px canvas reference)
- **Top 0-10%**: SCB corner logo top-right; headline begins at ~5%
- **10-35%**: 2-line headline block, left-aligned, Thai sans 700
- **25-75%**: hero zone — frosted card occupies left 40-45%, gold bar occupies right 50% (they share this vertical range with the bar extending both above and below the card)
- **75-88%**: CTA pill + bottom of coin pile
- **88-94%**: SCB EASY brand row + thin separator
- **94-100%**: fine print disclaimer strip

### Horizontal Strategy
- Left third: product card + headline
- Right two-thirds: gold bar hero + coin pile
- Slight overlap zone where coins bleed in front of the card bottom

### Negative Space
- ~30% of canvas is uncontested deep purple field — the product gets room to breathe
- No element within 24px of a canvas edge (except the deliberate bottom-coin bleed)
- Headline has clear breathing room above it (upper-left corner stays open)

### Spacing Scale
- Base unit: 8px
- Section gaps: 32-48px between major zones
- Inside card: 20-24px gutter
- Between card and CTA: 24-32px
- Fine print line height: tight 1.4 to fit multi-line disclaimer compactly

### Safe Zones
- Gold bar face must not be obscured by text or CTA
- "FINE GOLD 999.9 1000g" stamp must remain legible
- Headline may overlap with card left edge but not with card content
- CTA must sit on uncontested background, not over coins

---

## 6. Photography / Product Rendering Rules

### Rendering Approach
- High-quality 3D product render (not a real photograph)
- The gold bar is a CGI asset with PBR material (gold IOR, high specular, moderate roughness)
- Coins are 3D as well, or a hybrid with photographic coin references composited in

### Lighting
- Single dramatic key light from upper-right, narrow spot
- Soft ambient fill from below-front in warm gold tint
- Key creates crisp specular highlights on top edge and top face of bar
- No multi-point softbox setup; this is dramatic not clinical

### Material Properties
- Gold metal: very polished (low roughness), high metallic (fully metal), warm-yellow hue
- Coin metal: slightly less polished, more textured, same warm-yellow hue
- Background purple: flat non-physical color field, not a lit surface

### Color Grading
- Entire render color-graded toward purple + gold complementary
- Highlights on gold are pushed toward cream
- Shadows on gold pushed toward deep warm brown
- Purple backdrop remains saturated — not desaturated toward neutral

### No Real Environment
- There is no floor, no wall, no table, no gallery context — just a flat purple field
- This is a product-as-icon aesthetic, not a product-in-context photo

---

## 7. Do's and Don'ts

### Do
- Build every layout on deep royal purple with gold as the only chromatic accent
- Treat the gold product as a hero-scale 3D element with dramatic specular lighting
- Stack supporting coins at the base for wealth-texture — they are not optional
- Use a frosted glassmorphic card for product detail over the busy scene
- Render the fund wordmark in gold condensed caps as a branded seal
- Use generous negative space — product-as-icon needs room to breathe
- Apply a radial purple gradient to the background, not a flat color
- Reserve gold fill exclusively for the wordmark; headline and body stay white

### Don't
- Don't introduce warm pastels, teals, greens, or low-saturation neutrals
- Don't use flat front-lighting on the gold — specular drama is the signature
- Don't put the main headline inside the card — card is for product detail only
- Don't pair gold with any other chromatic accent (no red, no blue, no green)
- Don't use lifestyle photography — this is an institutional product aesthetic
- Don't use a solid-color card — it must be glassmorphic/translucent
- Don't let coins crowd into the CTA zone — CTA needs clear background
- Don't use tight negative space; ~30% breathing room is required
- Don't render the bar front-on symmetric — it must be tilted for drama
- Don't apply gold gradient to the headline or any body text

---

## 8. Agent Prompt Guide

### Quick Palette Reference
```
Royal Purple Core        #5A2D8D   (gradient center)
Royal Purple Base        #3F1F6C   (gradient mid)
Royal Purple Shadow      #1E0B3C   (gradient edge / vignette)
Rich Gold Hero           #D4AF37   (bar face)
Gold Highlight           #F5D870   (specular top)
Gold Shadow              #9C7418   (side face)
Gold Deep                #6B4A10   (recessed inscription)
Coin Gold                #D9B44A   (coin tops)
Coin Shadow              #6C4F14   (between coins)
Headline White           #FFFFFF
Supporting Lilac         #E9DAF8
Fine Print Lilac         #D0BCF0
Card Fill                rgba(255,255,255,0.10)  (frosted)
Card Border              rgba(255,255,255,0.18)
CTA Purple               #7B4FBA
```

### Typography Quick Reference
```
Main headline            Thai sans 700  ~36-44px  tight -1.5%  white + soft shadow
Fund wordmark            Thai sans 800 condensed caps ~56-72px  wide +3%  gold gradient fill
Card product description Thai sans 500  ~14-16px  normal      white
Risk tag                 Thai sans 500  ~14px     normal      lilac, inline parenthetical
CTA label                Thai sans 700  ~14-16px  normal      white
SCB EASY line            Thai sans 600  ~12-13px  normal      lilac
Fine print               Thai sans 400  ~9-10px   normal      pale lilac
```

### Example Generation Prompts

- "Generate a vertical ad canvas with a radial deep-purple gradient background (center #5A2D8D, base #3F1F6C, edge #1E0B3C). Render on the right side a 3D polished gold bar (gold IOR ~1.5, high specular, low roughness, warm-yellow hue) stamped 'FINE GOLD 999.9 NET WT 1000g'. Tilt the bar three-quarter to rise from bottom-right toward upper-right. Light with a single dramatic key from upper-right that creates crisp specular highlights on the top edge. Pile 20-30 loose gold coins at the base with some bleeding off the bottom edge. Ground the bar with a soft deep-purple elliptical shadow. No environment, no floor, no real-world context — just flat purple field."

- "Render a frosted glassmorphic product card on the left third of the canvas. Card fill: rgba(255, 255, 255, 0.10) with 10px backdrop blur. Thin 1px border rgba(255, 255, 255, 0.18). Soft outer shadow 0 8 24 rgba(30, 10, 60, 0.35). Rounded corners ~22px. Inside the card, top row: all-caps condensed gold display wordmark 'SCBGOLDH' with vertical gold gradient fill (#F5D870 top → #9C7418 bottom) and a subtle inner shadow. Below the wordmark: small parenthetical risk tag 'ความเสี่ยง 8' in lilac. Below: 3 lines of product description in white Thai sans 500."

- "Generate a 2-line Thai sans 700 white headline positioned top-left: 'ทำงาน ทำงาน เก็บเงิน เก็บเงิน ในกองทุน..'. Apply a soft drop shadow of rgba(30, 10, 60, 0.35) 0 4 12. Tight tracking. Keep the headline inside the left 60% of the canvas so it does not collide with the top-right SCB logo."

- "Render a solid purple pill CTA at the bottom, aligned roughly below the product card. Background #7B4FBA, text 'ลงทุนเลย' in white Thai sans 700, ~14-16px. Fully rounded pill shape, height ~50px, padding ~14px vertical and 44px horizontal. Subtle lift shadow rgba(30, 10, 60, 0.25) 0 2 6."

### Iteration Guide
1. If the gold looks "flat" or "yellow", the issue is likely material roughness — push it down toward 0.05-0.1 and increase metallic to 1.0
2. If specular highlights are not crisp, the key light is too soft — narrow it and increase intensity
3. If the palette reads "dusty" or "muted", saturation on purple is too low — push `#3F1F6C` toward `#4A1F80` range
4. Gold gradient on the wordmark should have visible steps from top to bottom — if it looks like a single flat gold, the gradient stops are too close
5. Card must feel translucent, not opaque — if the gold bar doesn't show through at all behind the card, the backdrop blur is too high or the opacity too low
6. Coins must look loose and piled, not placed on a grid — randomize rotation and elevation
7. Headline and card content compete if not separated — keep the headline above the card vertically, not overlapping
