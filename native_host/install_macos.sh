#!/bin/bash
#
# Install script for OCR Native Messaging Host (macOS)
#
# This script:
# 1. Prompts for the Chrome extension ID
# 2. Creates the manifest with correct paths
# 3. Installs the manifest to Chrome's NativeMessagingHosts directory
# 4. Makes the Python script executable
# 5. Checks for required dependencies
#

set -e

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[0;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

echo -e "${BLUE}======================================${NC}"
echo -e "${BLUE}  Kindle Auto Reader OCR Host Setup  ${NC}"
echo -e "${BLUE}======================================${NC}"
echo

# Get the directory where this script is located
SCRIPT_DIR="$( cd "$( dirname "${BASH_SOURCE[0]}" )" && pwd )"
HOST_SCRIPT="$SCRIPT_DIR/ocr_host.py"
MANIFEST_TEMPLATE="$SCRIPT_DIR/com.kindle_auto_reader.ocr_host.json"

# Chrome native messaging hosts directory
NATIVE_MSG_DIR="$HOME/Library/Application Support/Google/Chrome/NativeMessagingHosts"

# Check if running on macOS
if [[ "$(uname)" != "Darwin" ]]; then
    echo -e "${RED}Error: This script is for macOS only.${NC}"
    exit 1
fi

# Check if the host script exists
if [[ ! -f "$HOST_SCRIPT" ]]; then
    echo -e "${RED}Error: ocr_host.py not found at $HOST_SCRIPT${NC}"
    exit 1
fi

# Get extension ID from user
echo -e "${YELLOW}To find your extension ID:${NC}"
echo "1. Go to chrome://extensions/"
echo "2. Enable 'Developer mode' (top right)"
echo "3. Find 'Auto Page Capture to PDF' and copy its ID"
echo
read -p "Enter your Chrome extension ID: " EXTENSION_ID

if [[ -z "$EXTENSION_ID" ]]; then
    echo -e "${RED}Error: Extension ID is required${NC}"
    exit 1
fi

# Validate extension ID format (32 lowercase letters)
if [[ ! "$EXTENSION_ID" =~ ^[a-z]{32}$ ]]; then
    echo -e "${YELLOW}Warning: Extension ID should be 32 lowercase letters.${NC}"
    read -p "Continue anyway? (y/n): " CONTINUE
    if [[ "$CONTINUE" != "y" && "$CONTINUE" != "Y" ]]; then
        exit 1
    fi
fi

echo
echo -e "${BLUE}Installing native messaging host...${NC}"

# Create the NativeMessagingHosts directory if it doesn't exist
mkdir -p "$NATIVE_MSG_DIR"

# Create the manifest with correct values
MANIFEST_PATH="$NATIVE_MSG_DIR/com.kindle_auto_reader.ocr_host.json"

cat > "$MANIFEST_PATH" << EOF
{
  "name": "com.kindle_auto_reader.ocr_host",
  "description": "OCR Native Messaging Host for Kindle Auto Reader",
  "path": "$HOST_SCRIPT",
  "type": "stdio",
  "allowed_origins": [
    "chrome-extension://$EXTENSION_ID/"
  ]
}
EOF

echo -e "${GREEN}  Manifest installed to: $MANIFEST_PATH${NC}"

# Make the Python script executable
chmod +x "$HOST_SCRIPT"
echo -e "${GREEN}  Made ocr_host.py executable${NC}"

# Fix shebang to use full Python path (Chrome's restricted PATH can't find python3)
PYTHON_PATH=$(which python3)
if [[ -n "$PYTHON_PATH" ]]; then
    # Update shebang in the script
    sed -i '' "1s|.*|#!$PYTHON_PATH|" "$HOST_SCRIPT"
    echo -e "${GREEN}  Updated shebang to: #!$PYTHON_PATH${NC}"
fi

echo
echo -e "${BLUE}Checking system dependencies...${NC}"

MISSING_DEPS=false

# Check for Python 3
if command -v python3 &> /dev/null; then
    PYTHON_VERSION=$(python3 --version 2>&1)
    echo -e "${GREEN}  Python 3: $PYTHON_VERSION${NC}"
else
    echo -e "${RED}  Python 3: NOT FOUND${NC}"
    echo -e "${YELLOW}  Install with: brew install python3${NC}"
    MISSING_DEPS=true
fi

# Check for ocrmypdf
if command -v ocrmypdf &> /dev/null; then
    OCRMYPDF_VERSION=$(ocrmypdf --version 2>&1 | head -1)
    echo -e "${GREEN}  ocrmypdf: $OCRMYPDF_VERSION${NC}"
else
    echo -e "${RED}  ocrmypdf: NOT FOUND${NC}"
    echo -e "${YELLOW}  Install with: brew install ocrmypdf${NC}"
    MISSING_DEPS=true
fi

# Check for tesseract
if command -v tesseract &> /dev/null; then
    TESSERACT_VERSION=$(tesseract --version 2>&1 | head -1)
    echo -e "${GREEN}  tesseract: $TESSERACT_VERSION${NC}"

    # Check for required languages
    LANGS=$(tesseract --list-langs 2>&1 | tail -n +2 | tr '\n' ' ')
    echo -e "  Languages: $LANGS"

    if [[ "$LANGS" != *"eng"* ]]; then
        echo -e "${YELLOW}  Warning: English (eng) language pack not found${NC}"
    fi
    if [[ "$LANGS" != *"jpn"* ]]; then
        echo -e "${YELLOW}  Warning: Japanese (jpn) language pack not found${NC}"
        echo -e "${YELLOW}  Install with: brew install tesseract-lang${NC}"
    fi
else
    echo -e "${RED}  tesseract: NOT FOUND${NC}"
    echo -e "${YELLOW}  Install with: brew install tesseract tesseract-lang${NC}"
    MISSING_DEPS=true
fi

echo
echo -e "${BLUE}Installing Python dependencies...${NC}"

# Install AppleOCR plugin for better Japanese OCR
if pip3 install --user -r "$SCRIPT_DIR/requirements.txt" 2>/dev/null || \
   pip3 install --break-system-packages --user -r "$SCRIPT_DIR/requirements.txt" 2>/dev/null; then
    echo -e "${GREEN}  ocrmypdf-appleocr: installed${NC}"
else
    echo -e "${YELLOW}  Could not auto-install Python packages${NC}"
    echo -e "${YELLOW}  Please run manually: pip3 install --user -r requirements.txt${NC}"
fi

# Verify AppleOCR is importable
if python3 -c "import ocrmypdf_appleocr" 2>/dev/null; then
    echo -e "${GREEN}  AppleOCR plugin: verified${NC}"
else
    echo -e "${YELLOW}  AppleOCR plugin: not found (will fall back to Tesseract)${NC}"
fi

echo
echo -e "${BLUE}======================================${NC}"

# Final summary
if [[ "$MISSING_DEPS" == "false" ]]; then
    echo -e "${GREEN}Installation complete!${NC}"
    echo
    echo "OCR should now work automatically when you download PDFs"
    echo "from the Auto Page Capture extension."
    echo
    echo "Features:"
    echo "  - Apple Vision OCR (recommended for Japanese)"
    echo "  - Tesseract OCR (fallback option)"
    echo "  - Sidecar text file generation"
    echo
    echo "Logs are written to: ~/.kindle-auto-reader/ocr.log"
else
    echo -e "${YELLOW}Installation partially complete.${NC}"
    echo
    echo "Please install missing system dependencies:"
    echo "  brew install ocrmypdf tesseract tesseract-lang"
    echo
    echo "Then re-run this script."
fi

echo -e "${BLUE}======================================${NC}"
