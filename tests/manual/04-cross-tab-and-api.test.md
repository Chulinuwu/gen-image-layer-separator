# Test Suite: Cross-Tab Flows & API Integration

**Target:** Cross-tab workflows, API endpoints, general app behavior
**Total Cases:** 14 (Critical: 2, High: 5, Medium: 4, Low: 3)

## Cross-Tab Workflow Tests

### TC-051: Full end-to-end workflow (Tab 1 -> Tab 2 -> Tab 3)

**Priority:** Critical
**Type:** Functional
**Preconditions:** App running, backend running with valid AI credentials
**Test Data:** Prompt: "A clean white studio background", Brief: "MEGA SALE 80% OFF"

**Steps:**
1. Tab 1: Enter prompt "A clean white studio background"
2. Tab 1: Select aspect ratio "3:4 (Portrait)"
3. Tab 1: Click "Generate Image"
4. Wait for image generation to complete
5. Tab 1: Click "Next: Layout & Text"
6. Tab 2: Upload a product reference image
7. Tab 2: Click "Use as Editor Background" (to use generated background)
8. Tab 2: Enter brief: "MEGA SALE 80% OFF"
9. Tab 2: Select "Full (Text + Comp)" mode
10. Tab 2: Click "Create Campaign Layers"
11. Wait for pipeline to complete and finalize design
12. Tab 2: Click "Open in Layer Editor"
13. Tab 3: Edit a text layer (change color to blue)
14. Tab 3: Click "Render Image"
15. Tab 3: Click "Download as SVG"

**Expected Result:**
- Each tab transition preserves data from previous tabs
- Generated background from Tab 1 is usable in Tab 2
- Campaign data from Tab 2 loads correctly in Tab 3
- Edited layers render correctly
- SVG downloads with all layers and edits included

**Failure Indicators:**
- Data lost between any tab transition
- Background image URL broken after switching tabs
- Campaign layers missing in editor
- Final SVG missing edits or layers

---

### TC-052: Tab switching preserves state

**Priority:** High
**Type:** Functional
**Preconditions:** App running

**Steps:**
1. Tab 1: Enter prompt "Test prompt for state"
2. Switch to Tab 2
3. Tab 2: Enter brief "State test brief"
4. Switch to Tab 3
5. Switch back to Tab 1
6. Verify prompt text is still "Test prompt for state"
7. Switch to Tab 2
8. Verify brief text is still "State test brief"

**Expected Result:**
- Each tab retains its input state when switching away and back
- No data reset on tab switch

**Failure Indicators:**
- Input fields reset to defaults on tab switch
- Previously entered data is lost

---

## API Endpoint Tests

### TC-053: POST /api/image/generate - success

**Priority:** High
**Type:** Functional
**Preconditions:** Backend running at localhost:5001
**Test Data:** prompt: "A sunset", aspect_ratio: "4:3"

**Steps:**
1. Send POST to http://localhost:5001/api/image/generate with FormData:
   - prompt: "A sunset"
   - aspect_ratio: "4:3"

**Expected Result:**
- Status 200
- Response JSON: `{ success: true, data: { imageUrl: "...", text: "...", prompt: "..." } }`
- imageUrl is a valid accessible URL/path
- text contains image description

**Failure Indicators:**
- Non-200 status code
- success: false with no error message
- imageUrl is null or inaccessible

---

### TC-054: POST /api/image/process - success

**Priority:** High
**Type:** Functional
**Preconditions:** Backend running
**Test Data:** An ad image file, hintText: "SALE", mode: "full"

**Steps:**
1. Send POST to http://localhost:5001/api/image/process with FormData:
   - image: [ad image file]
   - hintText: "SALE"
   - mode: "full"

**Expected Result:**
- Status 200
- Response contains:
  - `data.original` - original image URL
  - `data.backgroundDescription` - string description
  - `data.textLayers` - array of text layer objects with part, hierarchy, position, style
  - `data.visualComponents` - array (may be empty)

**Failure Indicators:**
- Status 500 or timeout
- textLayers is null/undefined
- Position values out of image bounds

---

### TC-055: POST /api/image/render-text - success

**Priority:** High
**Type:** Functional
**Preconditions:** Backend running
**Test Data:** Background image, suggestions JSON with text layers

**Steps:**
1. Send POST to http://localhost:5001/api/image/render-text with FormData:
   - image: [background image file]
   - suggestions: `[{"part":"SALE 50%","hierarchy":"headline","position":{"left":100,"top":100,"width":400,"height":100},"style":{"font_family":"Kanit","font_weight":"700","color_hex":"#FF0000","font_size_normalized":48}}]`
   - mode: "simple"

**Expected Result:**
- Status 200
- Response contains `data.imageUrl` pointing to rendered image
- Rendered image contains the text overlay

**Failure Indicators:**
- Status 500
- imageUrl is null
- Rendered image has no text visible

---

### TC-056: POST /api/image/create-campaign - SSE stream

**Priority:** Critical
**Type:** Functional
**Preconditions:** Backend running
**Test Data:** Reference image, text: "PROMO 50%", mode: "full"

**Steps:**
1. Send POST to http://localhost:5001/api/image/create-campaign with FormData:
   - image: [reference ad image]
   - text: "PROMO 50%"
   - mode: "full"
2. Listen for SSE events on the response stream

**Expected Result:**
- Response Content-Type: text/event-stream
- Events received in order:
  1. `progress` events with step updates
  2. `background_ready` with previewUrl
  3. `iteration_start` for critique loop
  4. `critique_complete` with status and feedback
  5. `iteration_end` with svg_overlay and components
  6. `done` with full result data
- Final `done` event data.success is true

**Failure Indicators:**
- No SSE events received
- Events out of expected order
- Stream closes before `done` event
- `error` event received mid-pipeline

---

### TC-057: POST /api/image/export-svg - success

**Priority:** Medium
**Type:** Functional
**Preconditions:** Backend running
**Test Data:** SVG string with valid content

**Steps:**
1. Send POST to http://localhost:5001/api/image/export-svg with FormData:
   - svgString: `<svg xmlns="http://www.w3.org/2000/svg" width="800" height="600"><text x="100" y="100">Test</text></svg>`
   - mode: "embed-fonts"
   - includeBackground: "false"

**Expected Result:**
- Response has Content-Disposition header with filename "ad-layout-embed-fonts.svg"
- Response body is valid SVG content
- SVG contains font embedding (if mode is embed-fonts)

**Failure Indicators:**
- Status 500
- Response is not SVG content
- Missing Content-Disposition header

---

## General App Tests

### TC-058: CORS headers on API responses

**Priority:** High
**Type:** Functional
**Preconditions:** Frontend at localhost:5173, backend at localhost:5001

**Steps:**
1. Open browser dev tools Network tab
2. Perform any API call from the frontend (e.g., generate image)
3. Inspect the response headers

**Expected Result:**
- `Access-Control-Allow-Origin` header is present
- No CORS errors in browser console
- Preflight OPTIONS requests succeed

**Failure Indicators:**
- CORS error in console blocking API calls
- Missing CORS headers on responses
- Frontend requests fail silently due to CORS

---

### TC-059: Static file serving for uploaded/generated images

**Priority:** Medium
**Type:** Functional
**Preconditions:** Backend running, at least one image generated

**Steps:**
1. Generate an image via Tab 1
2. Copy the imageUrl from the response
3. Open the URL directly in browser

**Expected Result:**
- Image loads correctly in the browser
- Correct Content-Type header (image/png or image/jpeg)
- Image is not corrupted

**Failure Indicators:**
- 404 error on image URL
- Wrong content type served
- Image file is 0 bytes or corrupt

---

### TC-060: App handles concurrent users

**Priority:** Medium
**Type:** Edge Case
**Preconditions:** Backend running

**Steps:**
1. Open two browser tabs both at http://localhost:5173
2. In Tab A: start a campaign creation
3. In Tab B: start a different campaign creation simultaneously
4. Wait for both to complete

**Expected Result:**
- Both pipelines run independently
- Results in Tab A and Tab B are different (based on their inputs)
- No data crossover between sessions
- Backend handles concurrent requests without crash

**Failure Indicators:**
- One request blocks the other
- Results mix between tabs
- Backend crashes or returns 500 on concurrent requests

---

## Error Recovery Tests

### TC-061: Recover from API rate limit (429)

**Priority:** Medium
**Type:** Edge Case
**Preconditions:** Backend running, high API usage to trigger rate limits

**Steps:**
1. Rapidly generate multiple images in succession (5+ times)
2. Observe behavior when rate limit is hit

**Expected Result:**
- Backend's `with_retry()` handles 429 with exponential backoff
- Request eventually succeeds after retry
- User sees a progress/waiting message, not a crash
- If all retries fail: clear error message to user

**Failure Indicators:**
- Unhandled 429 error shown to user
- No retry attempted
- App enters permanent error state

---

### TC-062: Page refresh during operation

**Priority:** Low
**Type:** Edge Case
**Preconditions:** Any operation in progress (generation, campaign creation, etc.)

**Steps:**
1. Start a campaign creation in Tab 2
2. While pipeline is running, press F5 / Cmd+R to refresh the page
3. After page reloads, observe state

**Expected Result:**
- Page reloads to initial state (all inputs reset)
- No zombie processes on backend
- App is fully functional after refresh
- User can start a new operation

**Failure Indicators:**
- App loads in broken state after refresh
- Backend continues processing orphaned request indefinitely
- Error messages from stale SSE connections

---

### TC-063: Browser back/forward buttons

**Priority:** Low
**Type:** Edge Case
**Preconditions:** App loaded, some tab navigation done

**Steps:**
1. Navigate between tabs (Tab 1 -> Tab 2 -> Tab 3)
2. Press browser Back button
3. Press browser Forward button

**Expected Result:**
- Either: browser navigation is handled gracefully (SPA routing)
- Or: app reloads to default state without errors
- No white screen or JavaScript errors

**Failure Indicators:**
- White screen on back/forward
- JavaScript errors in console
- App enters inconsistent state

---

### TC-064: Mobile/responsive viewport

**Priority:** Low
**Type:** Edge Case
**Preconditions:** App running

**Steps:**
1. Open browser dev tools
2. Toggle device toolbar (responsive mode)
3. Set viewport to mobile (375x667 - iPhone SE)
4. Navigate through all three tabs
5. Try to interact with form inputs and buttons

**Expected Result:**
- App is usable (or gracefully shows "desktop only" message)
- No horizontal overflow or cut-off elements
- Buttons and inputs are tappable
- Canvas scales or scrolls appropriately

**Failure Indicators:**
- Elements overflow off screen with no scroll
- Buttons too small to tap
- Canvas unusable at mobile size
- Complete layout breakage
