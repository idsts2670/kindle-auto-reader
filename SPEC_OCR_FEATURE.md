# OCR Feature Spec for Page Auto Scanning and PDF Generator

## Intent

Add an offline OCR pipeline that converts the tool’s screenshot based PDFs into **searchable PDFs** (embedded text layer) with **optional bounding boxes** for UI highlighting.

## Summary

The app currently:
1. Auto scrolls a webpage
2. Captures screenshots per page or viewport
3. Generates a PDF locally

This spec adds:
- An OCR step that produces `output.searchable.pdf`
- Optionally a `output.ocr.json` containing bounding boxes per page for highlighting

Primary languages: **English + Japanese**  
Environment: **local desktop app**  
Scale: personal use, up to **hundreds of pages per day**

## Goals

1. Produce a searchable PDF from a scanned PDF generated from screenshots.
2. Work fully offline with open source tooling.
3. Keep setup simple for a desktop workflow.
4. Provide best effort support for English + Japanese.
5. Optional: produce bounding boxes suitable for UI highlights.

## Non goals

1. No cloud OCR APIs.
2. No attempt to perfectly reconstruct complex layouts (tables, multi columns) for reflow. This is text layer overlay only.
3. No perfect handwriting OCR. Printed text focus.

## Recommended OCR Stack

### Default stack (minimal engineering, best fit)

- **OCRmyPDF** for adding a text layer to PDFs
- **Tesseract OCR** as the OCR engine (via OCRmyPDF)
- OCR language packs: `eng`, `jpn`

Why:
- Designed specifically to add OCR text layers to PDFs
- Strong defaults and robust PDF handling
- Minimal custom code required

### Optional stack (only if you want better Japanese accuracy for certain fonts)

- **PaddleOCR** for OCR
- Custom PDF text layer insertion (higher engineering)
- This is optional and out of scope unless accuracy requirements justify it

## Architecture

### High level flow

1. Screenshot capture (existing)
2. PDF assembly from images (existing)
3. OCR step (new)
4. Outputs saved locally (new)

### Outputs

- `output.pdf` (existing)
- `output.searchable.pdf` (new)
- `output.ocr.log` (new, optional)
- `output.ocr.json` (new, optional bounding boxes)
- `output.ocr.txt` (new, optional plain text)

## OCR Pipeline Details

### Step 0. Detect if OCR is needed

If input PDF already contains extractable text:
- Skip OCR by default
- Provide a user option “Force OCR”

Implementation approach:
- Attempt text extraction for a small sample of pages
- If extracted text length >= threshold (for example 50 chars per page average), treat as “already searchable”

### Step 1. Add searchable text layer using OCRmyPDF

Command template:

- Basic:
  - `ocrmypdf input.pdf output.searchable.pdf`

- English + Japanese:
  - `ocrmypdf -l eng+jpn input.pdf output.searchable.pdf`

Recommended flags:
- `--deskew` to correct small rotation
- `--rotate-pages` to auto rotate
- `--optimize 1` to keep file sizes reasonable
- `--jobs N` with `N` as CPU cores minus 1

Example:
- `ocrmypdf -l eng+jpn --deskew --rotate-pages --optimize 1 --jobs 4 input.pdf output.searchable.pdf`

### Step 2. Keep images and coordinates consistent

Because the PDF is built from screenshots, page geometry is deterministic.

Requirement:
- Preserve page dimensions and orientation between `input.pdf` and `output.searchable.pdf`

Acceptance check:
- Page count and page sizes match
- Visual comparison of a few pages shows no unexpected scaling

### Step 3. Optional: export bounding boxes for UI highlighting

Priority: lower than searchable PDF.
If bounding boxes are difficult, skip and still ship searchable PDF.

Two implementation options:

## Performance Targets

Personal use on a typical laptop:

- 1 page OCR at 300 DPI should usually finish in 1 to 5 seconds depending on content.
- Batch size: hundreds of pages per day should be feasible.

## Quality Considerations

### Image preprocessing

If screenshots include noise or small font:
- Increase capture resolution if possible
- Prefer 2x device pixel ratio screenshotsf

OCRmyPDF preprocessing flags to consider:
- `--clean` or `--clean-final` if artifacts are common
- Do not over process if it reduces legibility

### Language accuracy

For mixed English + Japanese pages:
- Use `-l eng+jpn`
- If Japanese is rare, consider user selecting English only for speed

## Installation and Packaging

Goal: simplest setup for local desktop.

### If your app is Python based

Bundle dependencies:
- `ocrmypdf`
- `tesseract-ocr`
- Poppler utilities (for optional box extraction)

macOS options:
- Homebrew install for development
- For distribution, bundle binaries or document install steps

Windows options:
- Ship installers for Tesseract and Ghostscript if needed, or bundle via your installer

Linux options:
- Use system packages

## Error Handling

1. If OCR dependencies are missing:
   - Show actionable message listing exactly what is missing
   - Provide copy paste install commands per OS

2. If OCR fails on a page:
   - Continue remaining pages
   - Mark output as partial
   - Save logs to `output.ocr.log`

3. If disk space is low:
   - Warn before rendering images for bounding boxes

## Acceptance Criteria

### Searchable PDF

1. Given a scanned PDF, output PDF is searchable in a standard PDF viewer.
2. Copy and paste returns reasonable text.
3. Page count equals input.
4. Output file opens without errors.

### Bounding boxes (optional)

1. JSON file is produced with word boxes for each page.
2. Coordinates match the PDF page geometry to within a small tolerance.
3. UI can highlight words using the JSON overlay.

## Test Plan

1. English only pages (printed)
2. Japanese only pages (printed)
3. Mixed English + Japanese page
4. Rotated page
5. Low contrast page
6. Large batch test: 100 pages

For each:
- Verify search works
- Verify copy paste contains expected phrases
- If boxes enabled, verify highlight overlay aligns with text

## Implementation Checklist

1. Add OCR settings UI toggles
2. Add dependency detection
3. Implement OCRmyPDF subprocess invocation
4. Implement skip OCR if already searchable
5. Add logging and progress updates
6. Optional: implement bounding boxes export via PDF rendering + Tesseract TSV
7. Add tests and sample fixtures