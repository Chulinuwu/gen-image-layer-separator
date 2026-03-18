# Test Suite: Layer Editor (Tab 3)

**Target:** Tab 3 - "3. Layer Editor"
**Total Cases:** 20 (Critical: 3, High: 7, Medium: 6, Low: 4)

## Smoke Tests

### TC-031: Layer Editor tab loads correctly

**Priority:** Critical
**Type:** Smoke
**Preconditions:** App running at http://localhost:5173

**Steps:**
1. Navigate to http://localhost:5173
2. Click "3. Layer Editor" tab

**Expected Result:**
- Top control panel visible with:
  - Main Image upload input labeled "Main Image (with text)"
  - Background Image upload input labeled "Background Image (optional)"
  - Intended Text Hint input field
- "Separate Layers" button visible
- Canvas area visible (may be empty initially)
- No error messages

**Failure Indicators:**
- Blank panel or missing controls
- Console errors on tab switch
- Layout broken or overlapping elements

---

### TC-032: Separate layers from uploaded image

**Priority:** Critical
**Type:** Functional
**Preconditions:** App running, backend running with valid AI credentials
**Test Data:** An ad image containing text (e.g., a poster with "SALE 50%")

**Steps:**
1. Click "3. Layer Editor" tab
2. Upload an ad image via "Main Image" file input
3. Enter hint text: "SALE 50%"
4. Click "Separate Layers"

**Expected Result:**
- Button text changes to "Separating Layers..."
- Button becomes disabled during processing
- After processing:
  - Canvas shows the background image
  - Text layers appear as editable overlays on the canvas
  - Components appear as image overlays (if detected)
  - Layer property panel is accessible

**Failure Indicators:**
- Button stuck in loading state (>120s)
- Canvas remains empty after processing
- No layers detected despite visible text in image
- API error with no user feedback

---

## Functional Tests

### TC-033: Select a text layer on canvas

**Priority:** High
**Type:** Functional
**Preconditions:** Layers have been separated and are visible on canvas

**Steps:**
1. Separate layers from an image (TC-032)
2. Click on a text layer on the canvas

**Expected Result:**
- Selection box (border/handles) appears around the clicked layer
- Property bar appears showing:
  - Text content field
  - Font selection dropdown
  - Font size controls
  - Font weight controls
  - Text color picker
  - Letter spacing controls
  - Line height input
  - Alignment radio buttons (Left, Center, Right)
  - Rotation controls
  - Delete button (red)

**Failure Indicators:**
- Click does not select the layer
- No selection indicator visible
- Property bar does not appear
- Property bar shows wrong values

---

### TC-034: Edit text content of a layer

**Priority:** Critical
**Type:** Functional
**Preconditions:** A text layer is selected on canvas

**Steps:**
1. Select a text layer
2. In the property bar, find the text content input
3. Change the text from its current value to "NEW TEXT HERE"
4. Click elsewhere on the canvas

**Expected Result:**
- Text on canvas updates in real-time as you type
- Canvas reflects "NEW TEXT HERE" on the layer
- Layer position and style remain unchanged

**Failure Indicators:**
- Text doesn't update on canvas
- Typing causes canvas to re-render erratically
- Other layer properties reset

---

### TC-035: Change font family

**Priority:** High
**Type:** Functional
**Preconditions:** A text layer is selected

**Steps:**
1. Select a text layer
2. Open font selection dropdown
3. Select "Kanit (Thai)"
4. Observe text on canvas

**Expected Result:**
- Font family changes to Kanit
- Text on canvas re-renders with Kanit font
- Thai characters (if any) display correctly

**Failure Indicators:**
- Font doesn't change visually
- Font reverts after deselecting
- Kanit font fails to load (shows fallback)

---

### TC-036: Adjust font size with controls

**Priority:** High
**Type:** Functional
**Preconditions:** A text layer is selected with font size visible in property bar

**Steps:**
1. Select a text layer
2. Note current font size value
3. Click the "+" button (increases by 5)
4. Observe text size on canvas
5. Click the "-" button twice
6. Observe text size on canvas

**Expected Result:**
- "+" click: font size increases by 5, text visually grows
- "-" clicks: font size decreases by 5 each, text visually shrinks
- Number input updates to reflect new value
- Canvas updates in real-time

**Failure Indicators:**
- Size value changes but canvas doesn't update
- Size goes below 0 or to unreasonable values
- Text disappears when too small

---

### TC-037: Change text color

**Priority:** High
**Type:** Functional
**Preconditions:** A text layer is selected

**Steps:**
1. Select a text layer
2. Find the text color picker in the property bar
3. Change color to red (#FF0000)
4. Observe text on canvas

**Expected Result:**
- Color picker shows the new color
- Text on canvas changes to red
- Hex value displays "#FF0000" (or equivalent)

**Failure Indicators:**
- Color picker doesn't respond
- Canvas text color doesn't update
- Invalid hex values accepted without validation

---

### TC-038: Change text alignment

**Priority:** Medium
**Type:** Functional
**Preconditions:** A text layer is selected

**Steps:**
1. Select a text layer
2. Click "Center" alignment radio button
3. Observe text on canvas
4. Click "Right" alignment
5. Observe text on canvas
6. Click "Left" alignment
7. Observe text on canvas

**Expected Result:**
- Each alignment option visually aligns text accordingly
- Only one alignment option is active at a time
- Canvas updates immediately on each click

**Failure Indicators:**
- No visual change on alignment switch
- Multiple alignment options appear selected
- Text position breaks or overlaps other layers

---

### TC-039: Rotate a text layer

**Priority:** Medium
**Type:** Functional
**Preconditions:** A text layer is selected

**Steps:**
1. Select a text layer
2. Click the rotation "+" button (increases by 5 degrees)
3. Observe the layer on canvas
4. Click "+" two more times (total 15 degrees)
5. Click "-" once (back to 10 degrees)

**Expected Result:**
- Text rotates visually on canvas by the specified degrees
- Rotation value in input field updates correctly
- Selection box rotates with the text

**Failure Indicators:**
- No visual rotation
- Rotation value updates but canvas doesn't reflect it
- Layer jumps to unexpected position after rotation

---

### TC-040: Drag a layer to reposition

**Priority:** High
**Type:** Functional
**Preconditions:** Layers visible on canvas

**Steps:**
1. Select a text layer or component layer
2. Click and hold on the selected layer
3. Drag it to a different position on the canvas
4. Release mouse button

**Expected Result:**
- Layer follows the mouse during drag
- Layer stays at the new position after release
- Other layers are not affected
- Position values update in property bar (if visible)

**Failure Indicators:**
- Layer snaps back to original position
- Layer disappears during drag
- Other layers move unexpectedly
- Canvas scrolls instead of layer moving

---

### TC-041: Mouse wheel resize on text layer

**Priority:** Medium
**Type:** Functional
**Preconditions:** Text layers visible on canvas

**Steps:**
1. Hover mouse over a text layer (without clicking)
2. Scroll mouse wheel up
3. Observe font size change
4. Scroll mouse wheel down
5. Observe font size change

**Expected Result:**
- Scroll up: font size increases
- Scroll down: font size decreases
- Changes are smooth and proportional
- Font size value in property bar updates accordingly

**Failure Indicators:**
- Page scrolls instead of resizing text
- No size change on scroll
- Size changes are erratic or too fast

---

### TC-042: Delete a layer

**Priority:** High
**Type:** Functional
**Preconditions:** A text layer is selected on canvas

**Steps:**
1. Select a text layer
2. Find the red "Delete" button in the property bar
3. Click "Delete"

**Expected Result:**
- Selected layer is removed from canvas
- Layer no longer appears in any layer list
- Other layers remain unaffected
- Property bar closes or clears

**Failure Indicators:**
- Layer remains on canvas after delete
- Wrong layer is deleted
- App crashes after deletion
- Undo is not possible (note: may be expected)

---

### TC-043: Double-click to edit text inline

**Priority:** High
**Type:** Functional
**Preconditions:** Text layers visible on canvas

**Steps:**
1. Double-click directly on a text layer on the canvas
2. Type new text: "EDITED INLINE"
3. Click elsewhere on canvas to finish editing

**Expected Result:**
- Text becomes editable in-place on the canvas (contenteditable activates)
- Cursor appears in the text
- Typed text replaces or appends to existing text
- After clicking away, text is committed to the layer

**Failure Indicators:**
- Double-click doesn't activate editing
- Text input goes to wrong element
- Edited text is lost after clicking away

---

## Export & Render Tests

### TC-044: Render image with edited layers

**Priority:** High
**Type:** Functional
**Preconditions:** Layers separated and at least one text layer edited (content/style changed)

**Steps:**
1. Separate layers from an image
2. Edit a text layer (change text, color, or size)
3. Click "Render Image" button

**Expected Result:**
- Button shows loading state during rendering
- Rendered image appears or updates on canvas
- Rendered image reflects the edited text/styles
- API call to `/api/image/render-text` succeeds

**Failure Indicators:**
- Render fails with API error
- Rendered image doesn't reflect edits
- Old/original image shown instead

---

### TC-045: Download as SVG

**Priority:** Medium
**Type:** Functional
**Preconditions:** Layers are loaded on canvas (from separation or campaign)

**Steps:**
1. Ensure layers are on the canvas
2. Click "Download as SVG" button

**Expected Result:**
- Browser downloads a file named "ad-layout.svg"
- Downloaded SVG opens correctly in a browser or SVG viewer
- SVG contains:
  - Background image embedded as base64
  - All text layers with correct positioning
  - All component images embedded as base64
  - Kanit font embedded for Thai text support

**Failure Indicators:**
- No download triggered
- Downloaded file is empty or corrupt
- SVG missing background or text layers
- Thai text renders as boxes in the SVG

---

### TC-046: Export SVG with font embedding

**Priority:** Medium
**Type:** Functional
**Preconditions:** Layers loaded on canvas

**Steps:**
1. Ensure layers on canvas
2. Click "Export SVG" button (if available)
3. If modal appears, select "embed-fonts" mode
4. Confirm export

**Expected Result:**
- SVG file downloads with embedded Kanit fonts
- File contains @font-face declarations with base64 font data
- Text renders correctly when opened independently (no system font dependency)

**Failure Indicators:**
- Export produces SVG without font data
- Downloaded SVG shows wrong fonts
- Modal doesn't appear or has broken controls

---

## Negative Tests

### TC-047: Separate layers without uploading image

**Priority:** Medium
**Type:** Negative
**Preconditions:** Tab 3 loaded, no image selected

**Steps:**
1. Navigate to Tab 3
2. Do NOT upload any image
3. Click "Separate Layers"

**Expected Result:**
- Button should be disabled (no file selected)
- Or: validation message appears
- No API call made without an image

**Failure Indicators:**
- API called with null image causing 500 error
- App crashes
- Button is enabled but does nothing

---

### TC-048: Upload non-ad image (photo without text)

**Priority:** Medium
**Type:** Negative
**Preconditions:** Tab 3 loaded
**Test Data:** A plain photo with no text (e.g., landscape photo)

**Steps:**
1. Upload a photo with no text content
2. Enter hint text: "SALE"
3. Click "Separate Layers"

**Expected Result:**
- Processing completes without error
- Result shows background but no/minimal text layers
- App handles gracefully (no crash)
- Possible message: "No text layers detected"

**Failure Indicators:**
- App crashes trying to extract nonexistent text
- Hallucinated text layers appear
- Error with no explanation

---

## Edge Case Tests

### TC-049: Load campaign data from Tab 2

**Priority:** Low
**Type:** Edge Case
**Preconditions:** Campaign created in Tab 2 with text layers and components

**Steps:**
1. Complete a full campaign creation in Tab 2
2. Click "Open in Layer Editor"

**Expected Result:**
- Tab 3 opens with all campaign data pre-loaded:
  - Background image on canvas
  - Text layers positioned correctly
  - Component images overlaid
- All layers are editable (selectable, movable, property bar works)

**Failure Indicators:**
- Editor opens empty despite campaign data
- Layers positioned incorrectly (offset or scaled wrong)
- Components missing or broken image URLs
- Text layers not editable

---

### TC-050: Edit many layers simultaneously

**Priority:** Low
**Type:** Edge Case
**Preconditions:** Canvas with 5+ layers loaded

**Steps:**
1. Load an image that produces 5+ layers
2. Select and edit each layer one by one:
   - Change text content
   - Change font size
   - Move position
3. Click "Render Image"

**Expected Result:**
- All edits are preserved across layer switches
- Render reflects all changes made
- No performance degradation with many layers
- Canvas remains responsive

**Failure Indicators:**
- Edits to earlier layers lost when editing later ones
- Canvas becomes sluggish
- Render only applies last edit
