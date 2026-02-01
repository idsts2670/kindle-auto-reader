# Error Log

## 2026-01-27: Kindle reader page navigation not working

**Error Messages:**
- "Stopped: 3 consecutive duplicate pages detected"
- "End of content reached"

**Context:** Extension running on https://read.amazon.co.jp/?asin=B000W94CZ8

**Symptoms:**
- Extension starts but doesn't actually navigate to next page
- All three modes (keyboard, click, scroll) fail to advance the reader
- Duplicate detection triggers because the same page is captured repeatedly

**Root Cause Analysis:**
1. Kindle Cloud Reader uses a custom rendering system (likely canvas-based or iframe)
2. Keyboard events dispatched to document.activeElement may not reach the reader
3. The reader content may be in a shadow DOM or iframe that's not accessible
4. Scroll mode doesn't work because the reader has its own scroll container

**Findings:**
- Kindle uses `#kr-renderer` as the main container
- Pages are rendered as blob images: `<img src="blob:...">`
- Issue happens in non-fullscreen mode (reader may not have focus)

**Potential Solutions:**
1. Focus `#kr-renderer` before dispatching keyboard events
2. Dispatch events directly to `#kr-renderer` instead of activeElement

---

## 2026-01-27: PDF Download not working

**Error:** Clicking "Download PDF" does nothing - no feedback, no download

**Context:** After capturing pages, the Download PDF button doesn't trigger a download

**Root Cause Analysis:**
1. No user feedback when clicking download button
2. No error handling - failures were silent
3. Possible sessionId not being preserved after capture stops
4. No console logging to debug the issue

**Fix Applied (v1.0.4):**
- Added `showMessage('info', 'Building PDF...')` feedback when download starts
- Added console.log statements for debugging
- Added try/catch with error display
- Added check for missing sessionId with user feedback

**Code Changed:** popup.js - btnDownload click handler

---

## 2026-01-27: Kindle reader keyboard navigation not working

**Error:**
- "Stopped: 3 consecutive duplicate pages detected"
- Pages don't advance despite keyboard mode being selected

**Context:** Extension on https://read.amazon.co.jp with Kindle Cloud Reader

**Root Cause Analysis:**
1. Keyboard events dispatched to `document.activeElement` which may not be the reader
2. Kindle reader element is `#kr-renderer` - events need to target this specifically
3. Events need `view: window` property for better compatibility
4. Should dispatch to both target element AND document for fallback

**Fix Applied (v1.0.4):**
- Added list of known reader selectors to try: `#kr-renderer`, `#kindleReader_content`, etc.
- Focus the reader element before dispatching events
- Dispatch events to both the target element and document
- Added `view: window` to KeyboardEvent options

**Code Changed:** content_script.js - advanceKeyboard function

**Additional Notes:**
- User confirmed ArrowRight works manually when using DevTools
- Issue more prominent in non-fullscreen mode (focus issues)
- Kindle uses blob images for page rendering: `<img src="blob:...">`

---

## 2026-01-27: Auto-scroll stops on pages with minimal text

**Error:**
- "Stopped: 3 consecutive duplicate pages detected"
- "End of content reached"

**Context:** Book pages with only 1-2 short sentences look similar and trigger duplicate detection

**Root Cause Analysis:**
1. Duplicate detection threshold (Hamming distance <= 5) too lenient - catches similar but different pages
2. Duplicate detection applied to all modes, but keyboard/click modes always advance pages
3. Blank image entropy threshold (1.0) might flag sparse text pages
4. Only 3 consecutive duplicates needed to stop

**Fix Applied (v1.0.5):**
1. **Disabled duplicate detection for keyboard/click modes** - only applies to scroll mode now
   - Keyboard/click actively advance pages; duplicates would mean navigation failed
   - Scroll mode needs duplicate detection to know when bottom is reached
2. **Made duplicate threshold much stricter** - changed from 5 to 2 bits
   - Only truly identical pages (2 bits or less difference) count as duplicates
3. **Lowered blank detection threshold** - changed from 1.0 to 0.3
   - Only completely blank/white pages will trigger this
   - Pages with minimal text will pass

**Code Changed:** service_worker.js
- Line ~377: Added `mode === 'scroll'` condition to duplicate check
- Line ~382: Changed `isDuplicate(...)` to `isDuplicate(..., 2)` for stricter threshold
- Line ~368: Changed `isBlankImage(finalCapture)` to `isBlankImage(finalCapture, 0.3)`

---

## 2026-01-27: Capture stops on dedication/minimal text pages (no error shown)

**Error:** Capture stops silently on pages with very little text (e.g., "For Nina Thank you for changing my life.")

**Context:** No error message displayed, but capture stops on nearly-empty pages

**Root Cause:**
- Blank image detection was still active for keyboard/click modes
- Pages with 99% white background and minimal text have very low entropy
- Even 0.3 threshold was too high for dedication pages, chapter breaks, etc.

**Fix Applied (v1.0.6):**
- **Disabled blank detection for keyboard/click modes** entirely
- Blank detection now only runs in scroll mode
- For book capture, pages with minimal text are valid content

**Code Changed:** service_worker.js
- Line ~367: Added `captureState.config.mode === 'scroll'` condition around blank image check

---

## 2026-01-27: pdf-lib dynamic import error in Service Worker

**Error Message:**
```
Failed to load pdf-lib: TypeError: import() is disallowed on ServiceWorkerGlobalScope by the HTML specification.
See https://github.com/w3c/ServiceWorker/issues/1356.
```

**Context:** service_worker.js attempting to load pdf-lib.esm.min.js

**Root Cause:**
1. Initially used dynamic `import()` which is not allowed in service workers
2. Changed to static import, but pdf-lib.esm.min.js itself may contain internal dynamic imports

**Attempted Fixes:**
1. Changed `await import('./lib/pdf-lib.esm.min.js')` to static `import * as PDFLib from './lib/pdf-lib.esm.min.js'`
2. Removed dynamic import in image_utils.js for hammingDistance

**Solution:**
1. Removed pdf-lib import from service_worker.js entirely
2. Created offscreen.html/offscreen.js to handle PDF generation in a separate context
3. Added "offscreen" permission to manifest
4. Bumped version to 1.0.1 to force service worker update

**Note:** Chrome aggressively caches service workers. If old errors persist:
1. Go to chrome://extensions/
2. Click "Remove" on the extension
3. Click "Load unpacked" again to reload fresh

---

## 2026-01-27: PDF build fails with "Maximum call stack size exceeded"

**Error:** "Failed to build PDF: Maximum call stack size exceeded"

**Context:** When clicking Download PDF after capturing multiple pages

**Root Cause:**
- Converting large image blobs to base64 using `String.fromCharCode(...new Uint8Array(arrayBuffer))`
- The spread operator creates too many function arguments for large arrays
- JavaScript has a limit on function arguments (~65536), large images exceed this
- Causes stack overflow when images are large or numerous

**Fix Applied (v1.0.7):**
- Added `arrayBufferToBase64()` helper function to service_worker.js
- Added `uint8ArrayToBase64()` helper function to offscreen.js
- Both functions use chunked approach (8192 bytes per chunk) with `String.fromCharCode.apply()` instead of spread operator
- This avoids the argument limit that causes stack overflow

**Code Changed:**
- service_worker.js: Added helper function, replaced line 558
- offscreen.js: Added helper function, replaced line 101

---

## 2026-01-28: "Cannot destructure property 'images' of 'data' as it is undefined"

**Error:** Cannot destructure property 'images' of 'data' as it is undefined

**Context:** When clicking "Build Partial PDF" after stopping capture

**Root Cause:**
- Message type collision between popup and offscreen document
- popup.js sends `{ type: 'buildPdf', sessionId: ... }` to service_worker
- offscreen.js also listens for `type: 'buildPdf'` but expects `message.data` with images
- `chrome.runtime.sendMessage` broadcasts to ALL extension contexts
- offscreen.js receives popup's message (which has `sessionId`, not `data`) and fails

**Fix Applied (v1.0.8):**
- Changed message type from `'buildPdf'` to `'offscreen:buildPdf'` for service_worker -> offscreen communication
- This prevents the offscreen document from intercepting popup's messages

**Code Changed:**
- service_worker.js: Changed `type: 'buildPdf'` to `type: 'offscreen:buildPdf'`
- offscreen.js: Changed listener to check for `type: 'offscreen:buildPdf'`

---

## 2026-01-28: "URL.createObjectURL is not a function"

**Error:** Failed to build PDF: URL.createObjectURL is not a function

**Context:** When stopping capture and choosing to build PDF

**Root Cause:**
- `URL.createObjectURL()` is a DOM API not available in Service Workers
- Service workers have restricted APIs and cannot create object URLs
- Code was trying to create blob URL for download in service_worker.js

**Fix Applied (v1.0.9):**
- Use data URL directly instead of object URL for download: `data:application/pdf;base64,{pdfBase64}`
- `chrome.downloads.download()` accepts data URLs
- Removed `URL.revokeObjectURL()` call (data URLs don't need cleanup)
- Kept blob conversion only for upload functionality (when enabled)

**Code Changed:**
- service_worker.js: Replaced `URL.createObjectURL(pdfBlob)` with `'data:application/pdf;base64,' + result.pdfBase64`
- service_worker.js: Removed `URL.revokeObjectURL(url)` from cleanup handler

---

## 2026-01-29: Native messaging host fails with "Native host has exited"

**Error:** "Dependencies missing: Native host has exited."

**Context:** After installing OCR feature and running install_macos.sh, the options page shows native host not working even though all dependencies are installed correctly.

**Symptoms:**
- install_macos.sh reports all dependencies OK
- Options page shows "Dependencies missing: Native host has exited"
- `~/.kindle-auto-reader/ocr.log` is empty (script never starts logging)
- Script works correctly when run directly from terminal

**Root Cause:**
- Chrome launches native messaging hosts with a **restricted PATH** that doesn't include Homebrew's bin directories
- The shebang `#!/usr/bin/env python3` relies on PATH to find python3
- With Chrome's restricted PATH, `env` cannot find `python3` at `/opt/homebrew/bin/python3`
- Script fails to start before any Python code executes (hence empty log)

**Fix Applied (v1.1.0):**
1. Changed shebang from `#!/usr/bin/env python3` to `#!/opt/homebrew/bin/python3` (full path)
2. Updated install_macos.sh to automatically detect Python path and update shebang:
   ```bash
   PYTHON_PATH=$(which python3)
   sed -i '' "1s|.*|#!$PYTHON_PATH|" "$HOST_SCRIPT"
   ```
3. Added Homebrew paths to PATH at script startup (for finding ocrmypdf/tesseract):
   ```python
   HOMEBREW_PATHS = ['/opt/homebrew/bin', '/usr/local/bin', ...]
   for p in HOMEBREW_PATHS:
       if p not in os.environ.get('PATH', ''):
           os.environ['PATH'] = p + ':' + os.environ.get('PATH', '')
   ```

**Code Changed:**
- native_host/ocr_host.py: Line 1 shebang + added PATH initialization after imports
- native_host/install_macos.sh: Added automatic shebang fix after making script executable

**Verification:**
- After fix, reload extension in Chrome
- Go to Options → OCR tab
- Should now show "Dependencies OK" with version info

**Confirmed working:** 2026-01-29

---

## 2026-01-29: OCR fails with "Choose only one of --force-ocr, --skip-text, --redo-ocr"

**Error:** OCR failed: Choose only one of --force-ocr, --skip-text, --redo-ocr.

**Context:** After capturing pages and building PDF, the OCR process runs but fails.

**Root Cause:**
- The ocrmypdf command in ocr_host.py used both `--skip-text` and `--force-ocr` options
- These options are mutually exclusive in ocrmypdf
- `--skip-text`: Skip pages that already have text
- `--force-ocr`: Force OCR on all pages, ignore existing text

**Fix Applied:**
- Removed `--skip-text` option, keeping only `--force-ocr`
- Since these are image-only PDFs from screen captures, `--force-ocr` is the correct choice

**Code Changed:**
- native_host/ocr_host.py: Removed `cmd.append('--skip-text')` line

---

## 2026-01-30: Sandwich renderer produces broken Japanese characters

**Error:** Japanese text becomes unreadable garbage characters when using `--pdf-renderer sandwich`

**Context:** After switching from default hocr renderer to sandwich renderer to test if it fixes CJK spacing issues.

**Symptoms:**
- Original text: `第四章　単なる「薄いデータ」`
- OCR output: `RSE 舌 史 ke 「 擬 く 人 トー 六`
- Text is completely garbled, not just spacing issues
- The sandwich renderer appears to break Japanese character recognition entirely

**Root Cause:**
- The sandwich renderer uses Tesseract's text-only PDF feature
- This renderer may have compatibility issues with CJK languages
- The hocr renderer, despite spacing issues, at least recognizes characters correctly

**Comparison:**
| Renderer | Character Recognition | Spacing |
|----------|----------------------|---------|
| hocr (default) | Correct (`それでいて謙虚で`) | Broken (`そ れ で い て 謙 虚 で`) |
| sandwich | Broken (`RSE 舌 史 ke...`) | N/A |

**Conclusion:**
- Sandwich renderer is NOT suitable for Japanese OCR
- Need to revert to hocr renderer and find alternative solution for spacing
- Or explore alternative OCR engines (Apple Vision, etc.)

**Next Steps:**
- Search for Japanese-specific OCR solutions
- Consider OCRmyPDF-AppleOCR plugin which uses macOS native OCR
