# Auto Page Capture to PDF - Chrome Extension Specification

You are Claude Code acting as a senior Chrome Extension engineer. Build a Chrome extension (Manifest V3) that automates page turning and captures screenshots, then combines all screenshots into 1 PDF for download to local storage or optional upload to a remote server. This must be designed for content the user has permission to capture. Do not implement DRM bypass or site-specific hacks for protected readers. If capture returns blank or fails due to restrictions, stop and show an error.

## Extension Name
Auto Page Capture to PDF

## Minimum Requirements
- Chrome version: Latest stable minus 2 versions
- Manifest V3
- Languages: English and Japanese (i18n)

## High-Level Behavior

User opens a permitted web reader or paginated document, starts capture from the extension popup, the extension:
1. Navigates to the next page
2. Waits until the page is ready
3. Captures a screenshot of the visible tab
4. Repeats until stop conditions are met
5. Builds a single PDF containing all captured pages
6. Downloads the PDF, and optionally uploads it if the user configures an upload endpoint

## Hard Safety and Compliance Requirements

1. The extension must only operate on an allowlist of domains set in an options page
2. Each session requires the user to check a confirmation box: "I confirm I have rights to capture this content"
   - Confirmation is remembered **per domain permanently** in chrome.storage
3. The extension must refuse to run on a **hardcoded, non-editable** blocklist (read.amazon.com only)
4. If chrome.tabs.captureVisibleTab fails or returns a blank image, stop and show a clear error
5. **No telemetry or analytics** - extension is completely offline except for user-configured upload endpoint

---

## User Experience

### Popup UI

**Status Indicators:**
- Allowlisted status indicator (Enabled or Disabled on this site)
- Session confirmation checkbox (remembered per domain permanently)

**Mode Selector:**
- A) **Keyboard mode**: send a key to advance (default ArrowRight)
  - Focus the current activeElement before dispatching the key event
- B) **Click mode**: click a CSS selector for a Next button
  - If multiple elements match, click the **first match** (querySelector behavior)
- C) **Scroll mode**: scroll down by 1 viewport height and detect new content
  - End detection: stop when `scrollTop + innerHeight >= scrollHeight`

**Control Buttons:**
- Start button
- Stop button
  - On Stop: **prompt user** "Build PDF from N captured pages, or discard?"

**Progress Display (text only, no thumbnails):**
- Pages captured count
- Elapsed time
- Average seconds per page (**rolling average of last 10 pages**)
- Estimated remaining if max pages is set

**Advanced Toggles:**
- Max pages (default 200)
- Delay after page turn in ms (default 700)
- Wait for selector (optional CSS selector that must appear before capture)
  - If selector never appears within 10s timeout: **continue anyway** with warning logged
- End selector (optional CSS selector indicating end reached)
- Duplicate tolerance (stop after 3 consecutive duplicates)
- Output quality slider 0.5 to 1.0 (default 0.8)
  - Quality affects **both resolution AND compression** (lower quality = smaller dimensions + higher compression)
- Page size mode: auto fit to image, or A4, or Letter

**Export Actions:**
- Download PDF (auto-save to downloads folder, no Save As dialog)
- Upload PDF (only if configured)

**UI State Persistence:**
- All popup settings are **remembered** in chrome.storage.local between sessions

**Popup Lifecycle:**
- Capture **continues in background** if popup is closed
- Reopening popup shows current progress
- Single capture session only (no concurrent captures)

**No Hotkeys:**
- All interaction through popup UI buttons only

**No Badge Changes:**
- Extension icon stays static, all status shown in popup

### Options Page

**Layout: Tabbed interface** with tabs for:
1. Capture settings
2. Output settings
3. Upload settings
4. Domain lists

**Domain Allowlist Editor:**
- Add, remove domains
- **Includes subdomains automatically** (example.com also allows sub.example.com)

**Blocklist:**
- **Hardcoded, non-editable**: read.amazon.com only
- Users cannot remove default blocklist entries, only add custom ones

**Default Capture Settings:**
- Mode, delays, selectors, max pages, quality

**Upload Settings:**
- Upload enabled toggle
- Endpoint URL
  - **Validate URL format and test connectivity** when user saves settings
- Auth header name and token (optional)
  - Stored in **plaintext** in chrome.storage (relies on Chrome's isolation)
- File name template with variables: `{title}`, `{date}`, `{time}`, `{domain}`, `{pageCount}`
  - Default: `capture_{date}_{time}.pdf`
- Upload method: POST multipart form or PUT raw body

---

## Implementation Details

### Architecture and Files

```
/
├── manifest.json
├── _locales/
│   ├── en/messages.json
│   └── ja/messages.json
├── service_worker.js
├── content_script.js
├── popup.html
├── popup.js
├── popup.css
├── options.html
├── options.js
├── options.css
├── lib/
│   ├── pdf-lib.min.js (pre-bundled)
│   └── idb.js (pre-bundled IndexedDB wrapper)
└── utils/
    ├── image_utils.js
    ├── hash_utils.js
    ├── time_utils.js
    └── storage_utils.js
```

**Dependencies:** Pre-bundled .min.js files in /lib are allowed. No npm or build tooling required.

### Content Script Injection
- **On-demand only**: inject via `scripting.executeScript` when Start is clicked
- Do not use manifest `content_scripts` for automatic injection

### Service Worker Lifecycle
- Use **explicit keep-alive mechanism** (chrome.alarms or periodic self-messaging) to prevent termination during long captures

### Capture Loop Logic (Service Worker)

**StartCapture message from popup contains:**
- mode, key, nextSelector, waitSelector, endSelector
- maxPages, delayMs, quality, pageSizeMode

**Validation:**
- Current tab URL is allowlisted
- Current tab URL is not blocklisted
- Session confirmation is checked (per domain permanent)

**Tab Focus Handling:**
- If user switches to a different tab: **pause capture automatically**
- Resume when user returns to the capture tab

**For pageIndex from 1 to maxPages:**

1. Ask content script to advance page according to mode

2. Wait for readiness:
   - Always wait delayMs
   - If waitSelector provided, poll for it up to 10 seconds
     - If not found, **continue anyway** with warning
   - Ensure images are loaded
   - DOM stability: use MutationObserver, require 300ms quiet period
     - **Filter text-only changes** (ignore text node mutations, watch structural changes only)

3. Call `chrome.tabs.captureVisibleTab`
   - Capture at **device pixel ratio** (native resolution for HiDPI/Retina displays)

4. **Double-capture verification:**
   - Capture twice with 200ms gap
   - Only proceed if both captures match (prevents transition animation issues)

5. **Blank detection via entropy check:**
   - Calculate image entropy
   - Reject if below threshold (near-uniform color indicates blank/failed capture)

6. Downscale and recompress based on quality setting:
   - Quality affects both dimensions and JPEG compression
   - Always output as **JPEG** format

7. Compute dHash, compare to previous hash:
   - If duplicate (Hamming distance <= 5), increment duplicateCount
   - If duplicateCount >= 3, stop with reason "duplicate"
   - If not duplicate, reset duplicateCount

8. Store image blob in IndexedDB (avoid keeping all in memory)

9. Update popup progress via runtime messaging

10. If endSelector provided, check if it exists; if yes, stop with reason "end"
    - For Scroll mode: also check `scrollTop + innerHeight >= scrollHeight`

**On Stop:**
- If user-initiated: **prompt** "Build PDF from N pages, or discard?"
- Build PDF by streaming images from IndexedDB in order
- Add 1 image per PDF page (**no page numbers**)
- PDF page orientation: **match viewport aspect ratio** of each capture
- Allow varying page sizes if user resized browser mid-capture
- Preserve captured colors as-is (no dark mode inversion)
- Embed PDF metadata: creation date, "Auto Page Capture" as creator, **source URL**
- Generate final PDF blob
- Download via `chrome.downloads.download` with `saveAs: false`
- If upload enabled:
  - Single attempt, on failure **save locally and show error** (fail fast)
- **Cleanup IndexedDB after PDF download completes**

### Crash Recovery
- If session interrupted (browser crash): **retain partial captures in IndexedDB**
- On next extension load, offer "Resume" or "Build partial PDF" option

### Content Script Responsibilities

**advancePage(mode, config):**
- **Keyboard mode:**
  - Focus the current `document.activeElement`
  - Dispatch KeyboardEvent for the key (default ArrowRight)
- **Click mode:**
  - `querySelector(nextSelector)` and click
  - If multiple matches, click **first match**
  - Error if not found
- **Scroll mode:**
  - `window.scrollBy(0, innerHeight)`
  - Wait for scroll to settle

**Readiness Checks:**
- `document.readyState` is complete or interactive
- Wait for all images in viewport to be complete
- DOM stability: MutationObserver, 300ms quiet period
  - **Filter text-only mutations** to avoid issues with blinking cursors, live clocks

**Selector Checks (standard DOM only, no Shadow DOM traversal):**
- waitSelectorExists
- endSelectorExists

**Important:** Never attempt to bypass overlays or protected rendering. If page advance fails, return an error.

### PDF Generation

- Use **pdf-lib** (bundled)
- Always embed images as **JPEG**
- Page sizing:
  - Auto fit: each PDF page **matches image aspect ratio**
  - A4 or Letter: scale image to fit within margins
- **No page numbers** in output
- PDF metadata includes source URL

### Duplicate Detection (dHash)

- Downscale to grayscale 9x8 image
- Compute 64-bit difference hash
- Compare Hamming distance, treat as duplicate if distance <= 5
- Prevents saving identical pages when page turn fails

### Error Messages
- **Technical by default**: show selector names, error codes, timestamps
- Examples: "waitSelector '.content' not found after 10000ms at page 42"

---

## Testing Support

### Demo Page (`/demo/index.html`)

Include a local demo HTML page with:
- Paginated content (10+ pages)
- A Next button with class `.next-button`
- An end marker with class `.end-marker`
- **Simulated delays**: artificial loading delays and fade-in animations to test readiness detection

Document how to:
1. Load unpacked extension in Chrome
2. Add `file://` or localhost to allowlist
3. Test capture on the demo page

---

## Deliverables

1. All source files with comments
2. README with:
   - Install steps
   - How to configure allowlist and selectors
   - Troubleshooting for common issues:
     - Selector not found
     - Blank captures
     - Duplicate stops
     - Shadow DOM limitations (selectors only work on light DOM)
     - Sticky header/footer overlap in scroll mode (user responsibility)
3. Pre-bundled dependencies in /lib (no npm required)
4. i18n files for English and Japanese

---

## Summary of Key Decisions

| Topic | Decision |
|-------|----------|
| Key dispatch | Focus activeElement first |
| Storage cleanup | After PDF download |
| Duplicate verification | Double-capture with 200ms gap |
| Upload failure | Fail fast, keep local |
| Blocklist | Hardcoded, non-editable (Amazon only) |
| Blank detection | Entropy check |
| Sticky elements | User handles it |
| Popup lifecycle | Continue in background |
| Confirmation | Per domain permanent |
| Service worker | Explicit keep-alive |
| Tab focus | Pause automatically |
| Filename | Template variables |
| Shadow DOM | Standard DOM only |
| Page numbers | None |
| Wait timeout | Continue anyway |
| Quality | Affects resolution + compression |
| Orientation | Match viewport aspect |
| Demo | With simulated delays |
| Token storage | Plaintext |
| Resize | Allow varying sizes |
| Allowlist | Include subdomains |
| DOM stability | Filter text-only changes |
| Analytics | Completely offline |
| PDF images | Always JPEG |
| Multi-match click | First match |
| Dependencies | Pre-bundled libs OK |
| HiDPI | Device pixel ratio |
| Endpoint validation | Validate on save |
| Crash recovery | Retain for recovery |
| Scroll end | scrollHeight comparison |
| Preview | Text only |
| Average calc | Rolling (last 10) |
| Hotkeys | None |
| Stop behavior | Prompt user |
| Concurrency | Single session |
| Script injection | On-demand |
| Dark mode | Preserve as captured |
| Errors | Technical by default |
| UI persistence | Remember last used |
| Options layout | Tabbed interface |
| Badge | No changes |
| Download | Auto to downloads |
| i18n | English + Japanese |
| PDF metadata | Include source URL |
| Chrome version | Latest stable minus 2 |

---

Start implementing now with these specifications.
