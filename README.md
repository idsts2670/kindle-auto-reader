# Auto Page Capture to PDF

A Chrome extension (Manifest V3) that automates page turning and captures screenshots, combining them into a single PDF for download or upload.

## Features

- **Three capture modes**: Keyboard (arrow keys), Click (CSS selector), Scroll
- **Intelligent readiness detection**: Waits for images to load and DOM to stabilize
- **Duplicate detection**: Uses perceptual hashing (dHash) to detect identical pages
- **Blank capture detection**: Entropy-based detection of failed captures
- **Crash recovery**: Resume interrupted captures or build partial PDFs
- **PDF generation**: Auto-fit, A4, or Letter page sizes
- **Optional upload**: POST or PUT to configured endpoint
- **Internationalization**: English and Japanese support
- **OCR support**: Create searchable PDFs with Apple Vision or Tesseract OCR (macOS)

## Installation

### Chrome Extension

1. Clone or download this repository
2. Open Chrome and navigate to `chrome://extensions/`
3. Enable "Developer mode" (toggle in top right)
4. Click "Load unpacked"
5. Select the extension folder

### OCR Feature (Optional, macOS only)

To enable automatic OCR for searchable PDFs:

```bash
# 1. Install system dependencies
brew install ocrmypdf tesseract tesseract-lang

# 2. Run the install script
cd native_host
./install_macos.sh
```

The install script will:
- Prompt for your Chrome extension ID
- Install Python dependencies (AppleOCR plugin)
- Configure the native messaging host

See [native_host/README.md](native_host/README.md) for detailed instructions.

## Quick Start

1. Clone or download this repository
2. Open Chrome and navigate to `chrome://extensions/`
3. Enable "Developer mode" (toggle in top right)
4. Click "Load unpacked"
5. Select the extension folder

## Quick Start

1. **Add domains to allowlist**: Options → Domains tab → Add your target domain
2. **Navigate to the content** you want to capture
3. **Open the popup** and check the confirmation checkbox
4. **Configure capture mode**:
   - **Keyboard**: For readers that use arrow keys
   - **Click**: For readers with a "Next" button (enter CSS selector)
   - **Scroll**: For infinitely scrolling pages
5. **Click "Start Capture"**
6. Wait for capture to complete or click "Stop"
7. Download your PDF

## Configuration

### Popup Settings

| Setting | Description | Default |
|---------|-------------|---------|
| Mode | Keyboard, Click, or Scroll | Keyboard |
| Key | Which key to send (Keyboard mode) | ArrowRight |
| Next selector | CSS selector for next button (Click mode) | .next-button |
| Max pages | Stop after this many pages | 200 |
| Delay (ms) | Wait time after page turn | 700 |
| Wait selector | Optional selector to wait for | (empty) |
| End selector | Stop when this selector appears | (empty) |
| Duplicate tolerance | Stop after N consecutive duplicates | 3 |
| Quality | Image quality 0.5-1.0 | 0.8 |
| Page size | Auto, A4, or Letter | Auto |

### Options Page

Access via right-click extension icon → Options, or popup → Options.

**Tabs:**
- **Capture**: Default capture settings
- **Output**: Filename template with variables: `{title}`, `{date}`, `{time}`, `{domain}`, `{pageCount}`
- **OCR**: OCR engine selection, language, optimization settings
- **Upload**: Endpoint URL, auth headers, upload method
- **Domains**: Allowlist editor (subdomains included automatically)

### OCR Settings

| Setting | Description | Default |
|---------|-------------|---------|
| Enable OCR | Create searchable PDFs | On |
| Engine | Apple Vision (recommended) or Tesseract | Apple Vision |
| Languages | eng, jpn, or eng+jpn | eng+jpn |
| Deskew | Straighten tilted pages | On |
| Optimize | 0=none, 1=lossless, 2=lossy, 3=aggressive | 1 |

**Output files:**
- `capture_*.pdf` - Original image-only PDF
- `capture_*.searchable.pdf` - OCR'd PDF with text layer
- `capture_*.searchable.txt` - Plain text extraction (for searching)

## Troubleshooting

### "Selector not found"

**Cause**: The CSS selector for the Next button doesn't match any element.

**Solutions**:
1. Use browser DevTools to find the correct selector
2. Right-click the Next button → Inspect → Copy selector
3. Try simpler selectors like `button`, `.next`, `[aria-label="Next"]`

### "Blank capture detected"

**Cause**: The page content couldn't be captured (canvas-based rendering, protected content, or page not fully loaded).

**Solutions**:
1. Increase the delay setting (try 1500-2000ms)
2. Add a wait selector for content that appears when ready
3. Check if the site uses canvas rendering (not supported)
4. Verify the site isn't in the blocklist

### "Stopped: 3 consecutive duplicates"

**Cause**: Page navigation isn't working, resulting in the same page being captured.

**Solutions**:
1. Verify the correct capture mode (keyboard vs click vs scroll)
2. For keyboard mode, ensure the reader accepts arrow key navigation
3. For click mode, verify the selector targets the correct button
4. Increase delay if pages load slowly

### Captures are missing content

**Cause**: Page not fully loaded before capture.

**Solutions**:
1. Increase delay setting
2. Add a wait selector for the main content element
3. Check if content loads via AJAX after initial render

### Shadow DOM selectors don't work

**Limitation**: The extension only searches standard DOM, not Shadow DOM.

**Workaround**: Use keyboard mode if the reader uses Shadow DOM for its UI.

### Sticky headers/footers appear in scroll mode

**Limitation**: The extension captures the visible viewport as-is.

**Workaround**: This is expected behavior. For cleaner results, use keyboard or click mode if available.

## File Structure

```
/
├── manifest.json           # Extension manifest (MV3)
├── service_worker.js       # Background script - orchestration, PDF, downloads
├── content_script.js       # Injected script - page navigation, readiness
├── popup.html/js/css       # Extension popup UI
├── options.html/js/css     # Options page (tabbed interface)
├── offscreen.html/js       # Offscreen document for PDF generation
├── _locales/
│   ├── en/messages.json    # English strings
│   └── ja/messages.json    # Japanese strings
├── lib/
│   └── pdf-lib.min.js      # PDF generation library
├── utils/
│   ├── storage_utils.js    # IndexedDB & chrome.storage helpers
│   ├── image_utils.js      # Image processing, entropy, comparison
│   ├── hash_utils.js       # dHash implementation
│   └── time_utils.js       # Formatting, rolling average
├── native_host/            # OCR Native Messaging Host (macOS)
│   ├── ocr_host.py         # Python host script
│   ├── install_macos.sh    # Installation script
│   ├── requirements.txt    # Python dependencies
│   └── README.md           # OCR setup instructions
├── icons/                  # Extension icons
└── README.md
```

## Blocklist

The following domains are permanently blocked and cannot be captured:

- `read.amazon.com` (Kindle Cloud Reader)

This blocklist is hardcoded and cannot be modified.

## Privacy

- **No telemetry**: The extension makes no external network requests except to your configured upload endpoint
- **Local storage**: All captured images and settings are stored locally in your browser
- **No tracking**: No analytics or usage data is collected

## Technical Notes

- **Minimum Chrome version**: Latest stable minus 2 versions
- **Service worker keep-alive**: Uses chrome.alarms to prevent termination during long captures
- **Tab focus**: Capture automatically pauses when you switch tabs
- **Image format**: All captures are converted to JPEG for smaller file sizes
- **HiDPI support**: Captures at device pixel ratio for Retina displays

## License

MIT License - Use responsibly and only capture content you have rights to.
