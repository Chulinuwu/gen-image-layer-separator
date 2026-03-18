# Test Suite: Campaign Creator (Tab 2)

**Target:** Tab 2 - "2. Create Campaign"
**Total Cases:** 18 (Critical: 4, High: 6, Medium: 5, Low: 3)

## Smoke Tests

### TC-013: Campaign Creator tab loads correctly

**Priority:** Critical
**Type:** Smoke
**Preconditions:** App running at http://localhost:5173

**Steps:**
1. Navigate to http://localhost:5173
2. Click "2. Create Campaign" tab

**Expected Result:**
- Left panel shows: reference image upload, processing mode toggle, campaign text brief textarea
- Processing mode defaults to "Full (Text + Comp)"
- Campaign brief textarea visible with default "SUMMER SALE 50%"
- "Create Campaign Layers" button visible and enabled
- No error messages

**Failure Indicators:**
- Blank panel or missing form controls
- Console errors on tab switch
- Button missing or disabled without reason

---

### TC-014: Full pipeline campaign creation

**Priority:** Critical
**Type:** Functional
**Preconditions:** App running, backend running with valid AI credentials
**Test Data:** Any product/ad image (e.g., a photo of a product), Brief: "SUMMER SALE 50% OFF - Limited Time Only"

**Steps:**
1. Click "2. Create Campaign" tab
2. Upload a reference image via the file input
3. Verify mini preview of uploaded image appears
4. Leave mode as "Full (Text + Comp)"
5. Enter brief: "SUMMER SALE 50% OFF - Limited Time Only"
6. Click "Create Campaign Layers"

**Expected Result:**
- Button shows loading state
- Progress messages stream in real-time (SSE events)
- AI Refinement Preview modal opens showing:
  - Background image or reference on left canvas
  - "AI ART DIRECTOR" header on right sidebar
  - Iteration counter updating
  - Status messages progressing through pipeline steps
- After pipeline completes:
  - Campaign vibe section appears with description
  - Generated background preview (if applicable)
  - Text layers listed with hierarchy (Headline, Body, Fine Print)
  - Components section with extracted die-cuts
  - "Open in Layer Editor" button appears

**Failure Indicators:**
- No SSE events received (progress stuck)
- Modal never opens
- Pipeline errors out mid-way with no recovery
- Final results section empty despite "done" event

---

## Functional Tests

### TC-015: Upload reference image and see preview

**Priority:** High
**Type:** Functional
**Preconditions:** App on Tab 2
**Test Data:** Any JPG/PNG image file

**Steps:**
1. Click the reference image file input
2. Select an image file from disk
3. Observe the upload area

**Expected Result:**
- Mini preview thumbnail of selected image appears
- File name or preview is visible
- No upload errors

**Failure Indicators:**
- No preview displayed after selection
- File input doesn't respond to click
- Browser error on file selection

---

### TC-016: Switch processing modes

**Priority:** High
**Type:** Functional
**Preconditions:** App on Tab 2

**Steps:**
1. Click "Text & BG Only" mode option
2. Verify it becomes selected/active
3. Click "Inpaint & Die-cut Only" mode option
4. Verify it becomes selected/active
5. Click "Full (Text + Comp)" mode option
6. Verify it becomes selected/active

**Expected Result:**
- Each mode option is clickable and shows active state
- Only one mode is selected at a time
- Mode selection persists until changed

**Failure Indicators:**
- Multiple modes appear selected simultaneously
- Mode buttons don't respond to clicks
- Visual state doesn't update on selection

---

### TC-017: Text-only mode pipeline

**Priority:** High
**Type:** Functional
**Preconditions:** App running, backend running
**Test Data:** Any reference image, Brief: "BIG SALE 70%", Mode: "Text & BG Only"

**Steps:**
1. Upload a reference image
2. Select "Text & BG Only" mode
3. Enter brief: "BIG SALE 70%"
4. Click "Create Campaign Layers"

**Expected Result:**
- Pipeline runs without component extraction step
- Text layers are generated and displayed
- No die-cut components section (or empty)
- Background may be generated/inpainted
- Pipeline completes faster than full mode

**Failure Indicators:**
- Pipeline attempts component extraction despite text-only mode
- No text layers in results
- Error related to missing components

---

### TC-018: Inpaint & Die-cut Only mode

**Priority:** Medium
**Type:** Functional
**Preconditions:** App running, backend running
**Test Data:** Image with visible product/object, Mode: "Inpaint & Die-cut Only"

**Steps:**
1. Upload a reference image containing a visible product or object
2. Select "Inpaint & Die-cut Only" mode
3. Enter any brief text
4. Click "Create Campaign Layers"

**Expected Result:**
- Background inpainting occurs (clean background generated)
- Die-cut components are extracted
- No text layout generation
- Component images displayed with transparent backgrounds

**Failure Indicators:**
- Text layout generated despite mode selection
- No components extracted
- Inpainting fails silently

---

### TC-019: Use generated background from Tab 1

**Priority:** High
**Type:** Functional
**Preconditions:** A background was generated in Tab 1

**Steps:**
1. Generate a background in Tab 1
2. Click "Next: Layout & Text" to go to Tab 2
3. Look for "Use as Editor Background" button
4. Click "Use as Editor Background"

**Expected Result:**
- The generated background from Tab 1 is applied as the campaign background
- Background preview updates to show the generated image

**Failure Indicators:**
- "Use as Editor Background" button not visible
- Button click has no effect
- Background image URL is broken or empty

---

### TC-020: AI Refinement Preview - critique feedback display

**Priority:** High
**Type:** Functional
**Preconditions:** Campaign pipeline running (after clicking "Create Campaign Layers")

**Steps:**
1. Start a full campaign creation
2. Wait for AI Refinement Preview modal to open
3. Observe the right sidebar during pipeline execution

**Expected Result:**
- Iteration counter shows "X / 10"
- Progress bar advances with each step
- When critique completes:
  - Status shows "APPROVED" (green) or "REVISIONS REQUIRED" (amber/red)
  - AI feedback text is displayed with proper formatting
  - Refinement plan shows numbered actionable steps
- Session log updates with timestamped entries
- Pipeline step filmstrip shows thumbnails

**Failure Indicators:**
- Sidebar content never updates
- Critique status missing
- Feedback text is raw/unformatted markdown
- Session log empty despite events streaming

---

### TC-021: AI Refinement Preview - BBOX debug toggle

**Priority:** Medium
**Type:** Functional
**Preconditions:** AI Refinement Preview modal is open with layout rendered

**Steps:**
1. During campaign creation, wait for layout to render in the preview
2. Find and click "BBOX ON/OFF" toggle button
3. Observe the canvas

**Expected Result:**
- When BBOX ON: dashed border boxes appear around layout elements
- When BBOX OFF: debug borders disappear
- Canvas content (images, text) remains unchanged

**Failure Indicators:**
- Toggle button not visible
- No visual change when toggling
- Layout breaks when enabling debug view

---

### TC-022: Finalize design from preview

**Priority:** High
**Type:** Functional
**Preconditions:** Campaign pipeline has completed (critique PASSED or max iterations reached)

**Steps:**
1. Wait for campaign pipeline to complete
2. Click "FINALIZE DESIGN" button in the preview footer

**Expected Result:**
- Preview modal closes
- Results panel shows full campaign data
- "Open in Layer Editor" button is available
- All text layers and components are preserved

**Failure Indicators:**
- Button not visible after completion
- Modal closes but results are lost
- Data not passed to results panel

---

## Negative Tests

### TC-023: Create campaign without uploading image

**Priority:** Medium
**Type:** Negative
**Preconditions:** App on Tab 2, no image selected

**Steps:**
1. Do NOT upload any reference image
2. Enter brief text: "SALE 50%"
3. Click "Create Campaign Layers"

**Expected Result:**
- Either: validation prevents submission with a message like "Please upload an image"
- Or: pipeline runs with only text/background generation (graceful handling)
- App does not crash

**Failure Indicators:**
- Unhandled null/undefined error
- API 500 error with no user feedback
- App crashes or white screen

---

### TC-024: Create campaign with empty brief

**Priority:** Medium
**Type:** Negative
**Preconditions:** App on Tab 2, image uploaded

**Steps:**
1. Upload a reference image
2. Clear the campaign brief textarea completely
3. Click "Create Campaign Layers"

**Expected Result:**
- Either: validation requires brief text
- Or: pipeline runs and generates layout without custom text
- Meaningful feedback to user

**Failure Indicators:**
- Silent failure
- API error with no user message
- Pipeline hangs indefinitely

---

### TC-025: Pipeline interrupted by network error

**Priority:** Medium
**Type:** Negative
**Preconditions:** App on Tab 2, image uploaded, brief entered

**Steps:**
1. Start campaign creation pipeline
2. While SSE events are streaming, disconnect from network (toggle Wi-Fi off)
3. Wait 10 seconds
4. Reconnect network

**Expected Result:**
- Error message displayed when SSE connection drops
- App remains functional after reconnection
- User can retry the operation

**Failure Indicators:**
- App stuck in permanent loading state
- No error feedback to user
- Need to refresh entire page to recover

---

## Edge Case Tests

### TC-026: Very large image upload

**Priority:** Low
**Type:** Edge Case
**Preconditions:** App on Tab 2
**Test Data:** Image file > 10MB (e.g., high-res DSLR photo)

**Steps:**
1. Upload a very large image file (>10MB)
2. Enter a brief
3. Click "Create Campaign Layers"

**Expected Result:**
- Either: upload completes and pipeline processes (may be slow)
- Or: file size validation with clear error message
- No browser memory crash

**Failure Indicators:**
- Browser tab crashes
- Upload hangs with no progress indication
- Backend OOM error with no user feedback

---

### TC-027: Non-image file upload attempt

**Priority:** Low
**Type:** Edge Case
**Preconditions:** App on Tab 2

**Steps:**
1. Try to upload a non-image file (e.g., .pdf, .txt, .doc)
2. Observe behavior

**Expected Result:**
- File input filter (accept="image/*") prevents selection of non-image files
- If bypassed: API returns clear validation error

**Failure Indicators:**
- Non-image file accepted and causes pipeline crash
- Confusing error message

---

### TC-028: Thai text in campaign brief

**Priority:** Medium
**Type:** Edge Case
**Preconditions:** App on Tab 2, image uploaded
**Test Data:** Brief: "โปรโมชั่นพิเศษ ลดสูงสุด 50% เฉพาะวันนี้เท่านั้น"

**Steps:**
1. Upload a reference image
2. Enter Thai text brief: "โปรโมชั่นพิเศษ ลดสูงสุด 50% เฉพาะวันนี้เท่านั้น"
3. Click "Create Campaign Layers"

**Expected Result:**
- Pipeline processes Thai text correctly
- Text layers display Thai characters properly (Kanit font)
- SVG preview renders Thai text (not [] boxes)
- Critique loop can evaluate Thai text readability

**Failure Indicators:**
- Thai text rendered as [] boxes or tofu characters
- Font embedding fails
- AI misinterprets Thai characters

---

### TC-029: Multiple consecutive campaign creations

**Priority:** Low
**Type:** Edge Case
**Preconditions:** App on Tab 2

**Steps:**
1. Create a campaign with image A and brief "SALE 50%"
2. Wait for completion
3. Without refreshing, create another campaign with image B and brief "NEW PRODUCT"
4. Wait for completion

**Expected Result:**
- Second campaign replaces first campaign results cleanly
- No data mixing between campaigns
- All UI elements update to reflect second campaign
- No memory leaks or performance degradation

**Failure Indicators:**
- Results from first campaign bleed into second
- SSE connection from first run interferes
- UI shows stale data from previous run
- Browser becomes noticeably slower

---

### TC-030: Navigate away during pipeline and return

**Priority:** Medium
**Type:** Edge Case
**Preconditions:** Campaign pipeline running

**Steps:**
1. Start a campaign creation in Tab 2
2. While pipeline is running, click Tab 1 (Background Generator)
3. Wait 5 seconds
4. Click back to Tab 2

**Expected Result:**
- Either: pipeline continues in background and results are available on return
- Or: pipeline is cancelled with a message, and user can restart
- App does not enter broken state

**Failure Indicators:**
- Tab 2 shows partial/corrupt results
- SSE events lost, progress stuck
- App requires full page refresh to recover
