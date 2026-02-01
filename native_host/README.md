# OCR Native Host for Kindle Auto Reader

This native messaging host enables offline OCR processing of captured PDFs using OCRmyPDF with Apple Vision Framework for superior Japanese text recognition.

## Requirements

- **macOS** 11.0 or later (Apple Silicon or Intel)
- **Python** 3.9 or later
- **Google Chrome** browser

## Installation

### Step 1: Install System Dependencies (Homebrew)

```bash
# Install Homebrew if not already installed
/bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)"

# Install OCRmyPDF and Tesseract
brew install ocrmypdf tesseract tesseract-lang
```

### Step 2: Install Python Dependencies

```bash
cd native_host

# Install AppleOCR plugin and dependencies
pip3 install --user -r requirements.txt
```

Or manually:
```bash
pip3 install --user ocrmypdf-appleocr
```

### Step 3: Run the Install Script

```bash
./install_macos.sh
```

This script will:
1. Prompt for your Chrome extension ID
2. Install the native messaging manifest
3. Configure the host script
4. Verify all dependencies are installed

### Finding Your Extension ID

1. Open Chrome and go to `chrome://extensions/`
2. Enable "Developer mode" (toggle in top-right)
3. Find "Auto Page Capture to PDF"
4. Copy the 32-character ID shown below the extension name

## Verification

After installation, verify everything works:

1. Reload the extension in Chrome
2. Open extension Options → OCR tab
3. Should show "Dependencies OK" with version info

## OCR Engines

The host supports two OCR engines:

| Engine | Best For | Notes |
|--------|----------|-------|
| **Apple Vision** (default) | Japanese, CJK languages | Uses macOS native OCR, better accuracy |
| **Tesseract** | Fallback option | Open-source, more language support |

## Files

| File | Description |
|------|-------------|
| `ocr_host.py` | Main native messaging host script |
| `install_macos.sh` | Installation script for macOS |
| `requirements.txt` | Python dependencies |
| `com.kindle_auto_reader.ocr_host.json` | Native messaging manifest template |

## Logs

OCR processing logs are written to:
```
~/.kindle-auto-reader/ocr.log
```

## Troubleshooting

### "Dependencies missing" error

1. Ensure Homebrew packages are installed:
   ```bash
   brew install ocrmypdf tesseract tesseract-lang
   ```

2. Ensure Python packages are installed:
   ```bash
   pip3 install --user ocrmypdf-appleocr
   ```

3. Re-run the install script:
   ```bash
   ./install_macos.sh
   ```

### "Native host has exited" error

Check the log file for details:
```bash
cat ~/.kindle-auto-reader/ocr.log
```

Common causes:
- Python path issues (script updates shebang automatically)
- Missing dependencies in Chrome's restricted PATH

### OCR output has broken characters

- Ensure you're using "Apple Vision" engine (not Tesseract)
- Apple Vision provides much better Japanese text recognition

## Uninstallation

To remove the native host:

```bash
rm ~/Library/Application\ Support/Google/Chrome/NativeMessagingHosts/com.kindle_auto_reader.ocr_host.json
```

To also remove Python packages:
```bash
pip3 uninstall ocrmypdf-appleocr
```
