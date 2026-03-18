# Test Suite: Background Generator (Tab 1)

**Target:** Tab 1 - "1. Background Generator"
**Total Cases:** 12 (Critical: 3, High: 4, Medium: 3, Low: 2)

## Smoke Tests

### TC-001: Background Generator tab loads correctly

**Priority:** Critical
**Type:** Smoke
**Preconditions:** App running at http://localhost:5173

**Steps:**
1. Navigate to http://localhost:5173
2. Click "1. Background Generator" tab if not already active
3. Wait for page to fully load

**Expected Result:**
- Text prompt textarea visible with default text "An office group photo of people looking stressed"
- Aspect ratio dropdown visible, defaulting to "4:3 (Standard)"
- "Generate Image" button visible and enabled
- No error messages displayed

**Failure Indicators:**
- Blank page or infinite spinner
- Missing input fields or button
- Console errors on load

---

### TC-002: Generate image with default settings

**Priority:** Critical
**Type:** Functional
**Preconditions:** App running, backend running at port 5001, valid Vertex AI credentials configured
**Test Data:** Default prompt: "An office group photo of people looking stressed", Aspect ratio: 4:3

**Steps:**
1. Navigate to Tab 1
2. Leave default prompt text as-is
3. Leave aspect ratio as "4:3 (Standard)"
4. Click "Generate Image"

**Expected Result:**
- Button text changes to "Generating..."
- Button becomes disabled during generation
- After generation completes, an image preview appears below the form
- Image description text is displayed
- "Open Full Image" link is visible
- "Next: Layout & Text" button appears

**Failure Indicators:**
- Button stays in "Generating..." state indefinitely (>60s)
- Error message displayed instead of image
- Image preview area remains empty after button returns to normal
- Network error in console (e.g., CORS, 500, 429)

---

## Functional Tests

### TC-003: Generate image with custom prompt

**Priority:** High
**Type:** Functional
**Preconditions:** App running, backend running
**Test Data:** Prompt: "A tropical beach sunset with palm trees"

**Steps:**
1. Navigate to Tab 1
2. Clear the prompt textarea
3. Type "A tropical beach sunset with palm trees"
4. Click "Generate Image"

**Expected Result:**
- Image generates successfully
- Generated image visually relates to the prompt (beach/sunset theme)
- Image description text reflects the generated content

**Failure Indicators:**
- Error response from API
- Generated image completely unrelated to prompt
- Empty or broken image URL

---

### TC-004: Change aspect ratio and generate

**Priority:** High
**Type:** Functional
**Preconditions:** App running, backend running
**Test Data:** Prompt: "A modern office interior", Aspect ratio: 9:16 (Vertical)

**Steps:**
1. Navigate to Tab 1
2. Enter prompt: "A modern office interior"
3. Select aspect ratio: "9:16 (Vertical)"
4. Click "Generate Image"

**Expected Result:**
- Image generates successfully
- Generated image appears in portrait/vertical orientation
- Image dimensions reflect approximately 9:16 ratio

**Failure Indicators:**
- Image generates in wrong aspect ratio (e.g., landscape instead of portrait)
- API returns error for the selected ratio

---

### TC-005: All aspect ratio options are selectable

**Priority:** Medium
**Type:** Functional
**Preconditions:** App running

**Steps:**
1. Navigate to Tab 1
2. Click the aspect ratio dropdown
3. Verify each option is listed:
   - 1:1 (Square)
   - 4:3 (Standard)
   - 3:4 (Portrait)
   - 16:9 (Widescreen)
   - 9:16 (Vertical)
   - 21:9 (Ultra Wide)
   - 3:2 (Photo)
   - 2:3 (Portrait Photo)
   - 5:4 (Classic)
   - 4:5 (Instagram)
4. Select each option one by one

**Expected Result:**
- All 10 options are present in the dropdown
- Each option is selectable without errors
- Selected value displays correctly in the dropdown

**Failure Indicators:**
- Missing options
- Dropdown fails to open
- Selection doesn't update the displayed value

---

### TC-006: Open Full Image in new tab

**Priority:** High
**Type:** Functional
**Preconditions:** An image has been generated successfully in Tab 1

**Steps:**
1. Generate an image (or use a previously generated one)
2. Click "Open Full Image" link

**Expected Result:**
- A new browser tab opens
- The full-resolution generated image is displayed
- Image loads without errors

**Failure Indicators:**
- Link doesn't open a new tab
- New tab shows 404 or broken image
- Image URL is malformed

---

### TC-007: Navigate to Tab 2 after generation

**Priority:** High
**Type:** Functional
**Preconditions:** An image has been generated successfully in Tab 1

**Steps:**
1. Generate an image in Tab 1
2. Click "Next: Layout & Text" button

**Expected Result:**
- App switches to Tab 2 (Create Campaign)
- The generated background image is available in Tab 2 (via "Use as Editor Background" or pre-loaded)

**Failure Indicators:**
- Tab doesn't switch
- Generated image is lost / not passed to Tab 2
- Tab 2 loads in error state

---

## Negative Tests

### TC-008: Generate with empty prompt

**Priority:** Medium
**Type:** Negative
**Preconditions:** App running, backend running

**Steps:**
1. Navigate to Tab 1
2. Clear the prompt textarea completely (empty string)
3. Click "Generate Image"

**Expected Result:**
- Either: validation prevents submission and shows an error message
- Or: API returns a meaningful error message displayed to user
- App does not crash

**Failure Indicators:**
- App crashes or shows unhandled exception
- Silent failure with no feedback to user
- Infinite loading state

---

### TC-009: Generate when backend is offline

**Priority:** Medium
**Type:** Negative
**Preconditions:** App running, backend NOT running (stopped)

**Steps:**
1. Stop the backend server
2. Navigate to Tab 1
3. Enter any prompt
4. Click "Generate Image"

**Expected Result:**
- An error message is displayed to the user (e.g., "Failed to connect" or "Server unavailable")
- Button returns to normal state after error
- App remains functional (no white screen)

**Failure Indicators:**
- Unhandled network error
- Button stuck in "Generating..." forever
- White screen or app crash

---

## Edge Case Tests

### TC-010: Very long prompt text

**Priority:** Low
**Type:** Edge Case
**Preconditions:** App running, backend running
**Test Data:** A prompt with 2000+ characters

**Steps:**
1. Navigate to Tab 1
2. Paste a very long text (2000+ characters) into the prompt textarea
3. Click "Generate Image"

**Expected Result:**
- Either: prompt is accepted and image generates (possibly truncated by API)
- Or: validation warns about max length
- App handles gracefully without crash

**Failure Indicators:**
- App freezes or crashes
- Unhandled 400 error from API
- Textarea breaks layout

---

### TC-011: Special characters in prompt

**Priority:** Low
**Type:** Edge Case
**Preconditions:** App running, backend running
**Test Data:** Prompt: "A scene with <script>alert('xss')</script> & \"quotes\" and Thai text: สวัสดี"

**Steps:**
1. Navigate to Tab 1
2. Enter the test data prompt with special characters, HTML tags, and Thai text
3. Click "Generate Image"

**Expected Result:**
- Image generates without errors (special chars handled gracefully)
- No XSS or script execution occurs
- Thai text does not break the UI

**Failure Indicators:**
- JavaScript alert popup (XSS vulnerability)
- HTML rendering in unexpected places
- API error due to unescaped characters

---

### TC-012: Rapid repeated clicks on Generate

**Priority:** Medium
**Type:** Edge Case
**Preconditions:** App running, backend running

**Steps:**
1. Navigate to Tab 1
2. Enter any prompt
3. Click "Generate Image" rapidly 5 times in succession

**Expected Result:**
- Button becomes disabled after first click, preventing duplicate requests
- Only one API request is sent
- Image generates normally

**Failure Indicators:**
- Multiple simultaneous API requests sent
- App enters broken state with overlapping responses
- Multiple images appear or flicker
