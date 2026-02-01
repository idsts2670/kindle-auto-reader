#!/opt/homebrew/bin/python3
"""
OCR Native Messaging Host for Kindle Auto Reader

Handles Chrome Native Messaging protocol to process PDFs with OCRmyPDF.
Messages are JSON with 4-byte length prefix (little-endian).

Message types:
  - checkDependencies: Verify ocrmypdf/tesseract are installed
  - processOcr: Run OCR on a PDF file

Logs to ~/.kindle-auto-reader/ocr.log
"""

import json
import logging
import os
import shutil
import struct
import subprocess
import sys
import tempfile
from pathlib import Path

# Add common Homebrew paths to PATH (Chrome's restricted PATH doesn't include them)
HOMEBREW_PATHS = [
    '/opt/homebrew/bin',      # Apple Silicon
    '/usr/local/bin',         # Intel Mac
    '/opt/homebrew/sbin',
    '/usr/local/sbin',
]
for p in HOMEBREW_PATHS:
    if p not in os.environ.get('PATH', ''):
        os.environ['PATH'] = p + ':' + os.environ.get('PATH', '')

# Add user's Python library path for pip --user installed packages (like ocrmypdf-appleocr)
import sys
USER_SITE_PACKAGES = [
    str(Path.home() / 'Library/Python/3.14/lib/python/site-packages'),
    str(Path.home() / 'Library/Python/3.13/lib/python/site-packages'),
    str(Path.home() / 'Library/Python/3.12/lib/python/site-packages'),
]
for p in USER_SITE_PACKAGES:
    if Path(p).exists() and p not in sys.path:
        sys.path.insert(0, p)

# Setup logging
LOG_DIR = Path.home() / '.kindle-auto-reader'
LOG_DIR.mkdir(parents=True, exist_ok=True)
LOG_FILE = LOG_DIR / 'ocr.log'

logging.basicConfig(
    level=logging.DEBUG,
    format='%(asctime)s - %(levelname)s - %(message)s',
    handlers=[
        logging.FileHandler(LOG_FILE),
    ]
)
logger = logging.getLogger(__name__)


def read_message():
    """Read a message from stdin using Chrome's native messaging protocol."""
    # Read 4-byte length prefix (little-endian)
    raw_length = sys.stdin.buffer.read(4)
    if len(raw_length) == 0:
        logger.info("No more input, exiting")
        return None
    if len(raw_length) != 4:
        logger.error(f"Invalid message length prefix: {len(raw_length)} bytes")
        return None

    message_length = struct.unpack('<I', raw_length)[0]
    logger.debug(f"Reading message of {message_length} bytes")

    # Read the message JSON
    message_data = sys.stdin.buffer.read(message_length)
    if len(message_data) != message_length:
        logger.error(f"Incomplete message: expected {message_length}, got {len(message_data)}")
        return None

    try:
        message = json.loads(message_data.decode('utf-8'))
        logger.debug(f"Received message: {message.get('type', 'unknown')}")
        return message
    except json.JSONDecodeError as e:
        logger.error(f"Failed to parse message JSON: {e}")
        return None


def send_message(message):
    """Send a message to stdout using Chrome's native messaging protocol."""
    try:
        encoded = json.dumps(message).encode('utf-8')
        length = struct.pack('<I', len(encoded))
        sys.stdout.buffer.write(length)
        sys.stdout.buffer.write(encoded)
        sys.stdout.buffer.flush()
        logger.debug(f"Sent message: {message.get('type', message.get('success', 'unknown'))}")
    except Exception as e:
        logger.error(f"Failed to send message: {e}")


def check_command(cmd):
    """Check if a command is available in PATH."""
    return shutil.which(cmd) is not None


def get_tesseract_languages():
    """Get list of installed Tesseract languages."""
    try:
        result = subprocess.run(
            ['tesseract', '--list-langs'],
            capture_output=True,
            text=True,
            timeout=10
        )
        if result.returncode == 0:
            # First line is header, rest are language codes
            lines = result.stdout.strip().split('\n')
            if len(lines) > 1:
                return lines[1:]  # Skip "List of available languages" header
        return []
    except Exception as e:
        logger.error(f"Failed to get Tesseract languages: {e}")
        return []


def check_dependencies():
    """Check if required dependencies are installed."""
    logger.info("Checking dependencies")

    result = {
        'type': 'dependencyStatus',
        'ocrmypdf': False,
        'tesseract': False,
        'languages': [],
        'ocrmypdfVersion': None,
        'tesseractVersion': None,
        'allOk': False
    }

    # Check ocrmypdf
    if check_command('ocrmypdf'):
        result['ocrmypdf'] = True
        try:
            version_result = subprocess.run(
                ['ocrmypdf', '--version'],
                capture_output=True,
                text=True,
                timeout=10
            )
            if version_result.returncode == 0:
                result['ocrmypdfVersion'] = version_result.stdout.strip().split('\n')[0]
        except Exception as e:
            logger.warning(f"Could not get ocrmypdf version: {e}")

    # Check tesseract
    if check_command('tesseract'):
        result['tesseract'] = True
        try:
            version_result = subprocess.run(
                ['tesseract', '--version'],
                capture_output=True,
                text=True,
                timeout=10
            )
            if version_result.returncode == 0:
                result['tesseractVersion'] = version_result.stdout.strip().split('\n')[0]
        except Exception as e:
            logger.warning(f"Could not get tesseract version: {e}")

        # Get available languages
        result['languages'] = get_tesseract_languages()

    result['allOk'] = result['ocrmypdf'] and result['tesseract']

    logger.info(f"Dependency check: ocrmypdf={result['ocrmypdf']}, tesseract={result['tesseract']}, languages={result['languages']}")
    return result


def process_ocr(input_path, languages='eng+jpn', deskew=True, optimize=1, engine='apple'):
    """
    Process a PDF with OCRmyPDF.

    Args:
        input_path: Path to the input PDF
        languages: Tesseract language(s) to use (e.g., 'eng+jpn')
        deskew: Whether to deskew pages
        optimize: Optimization level (0-3)
        engine: OCR engine to use ('apple' for AppleOCR, 'tesseract' for Tesseract)

    Returns:
        dict with success status and output path or error
    """
    logger.info(f"Processing OCR: {input_path}")
    logger.info(f"Options: languages={languages}, deskew={deskew}, optimize={optimize}, engine={engine}")

    # Validate input file
    input_file = Path(input_path)
    if not input_file.exists():
        error = f"Input file not found: {input_path}"
        logger.error(error)
        return {'type': 'ocrResult', 'success': False, 'error': error}

    if not input_file.suffix.lower() == '.pdf':
        error = f"Input file is not a PDF: {input_path}"
        logger.error(error)
        return {'type': 'ocrResult', 'success': False, 'error': error}

    # Generate output paths
    output_path = input_file.parent / f"{input_file.stem}.searchable.pdf"
    sidecar_path = input_file.parent / f"{input_file.stem}.searchable.txt"

    # Build ocrmypdf command
    cmd = ['ocrmypdf']

    # Use AppleOCR plugin for better Japanese support on macOS
    if engine == 'apple':
        cmd.extend(['--plugin', 'ocrmypdf_appleocr'])
        logger.info("Using AppleOCR engine (Apple Vision Framework)")
    else:
        logger.info("Using Tesseract engine")

    # Language option
    if languages:
        cmd.extend(['-l', languages])

    # Deskew option
    if deskew:
        cmd.append('--deskew')

    # Optimization level
    cmd.extend(['--optimize', str(optimize)])

    # Force OCR - these are image-only PDFs from screen captures
    cmd.append('--force-ocr')

    # Use hocr renderer (default) - sandwich renderer breaks Japanese character recognition
    cmd.extend(['--pdf-renderer', 'hocr'])

    # Generate sidecar text file with correct spacing for CJK languages
    # The PDF text layer may have spacing issues, but the sidecar .txt file
    # will have correct text without extra spaces between characters
    cmd.extend(['--sidecar', str(sidecar_path)])

    # Output PDF/A for better compatibility
    cmd.extend(['--output-type', 'pdfa-2'])

    # Clean up intermediate files
    cmd.append('--clean')

    # Input and output files
    cmd.append(str(input_file))
    cmd.append(str(output_path))

    logger.debug(f"Running command: {' '.join(cmd)}")

    try:
        # Run ocrmypdf
        result = subprocess.run(
            cmd,
            capture_output=True,
            text=True,
            timeout=600  # 10 minute timeout for large PDFs
        )

        if result.returncode == 0:
            logger.info(f"OCR completed successfully: {output_path}")
            logger.info(f"Sidecar text file created: {sidecar_path}")
            return {
                'type': 'ocrResult',
                'success': True,
                'outputPath': str(output_path),
                'sidecarPath': str(sidecar_path),
                'inputPath': str(input_path)
            }
        else:
            # Check for specific error codes
            error_msg = result.stderr.strip() or result.stdout.strip() or f"Unknown error (code {result.returncode})"
            logger.error(f"OCR failed: {error_msg}")
            return {
                'type': 'ocrResult',
                'success': False,
                'error': error_msg,
                'inputPath': str(input_path)
            }

    except subprocess.TimeoutExpired:
        error = "OCR process timed out after 10 minutes"
        logger.error(error)
        return {'type': 'ocrResult', 'success': False, 'error': error, 'inputPath': str(input_path)}
    except Exception as e:
        error = f"OCR process failed: {str(e)}"
        logger.error(error)
        return {'type': 'ocrResult', 'success': False, 'error': error, 'inputPath': str(input_path)}


def handle_message(message):
    """Handle a single message and return a response."""
    if not message:
        return None

    msg_type = message.get('type')
    logger.info(f"Handling message type: {msg_type}")

    if msg_type == 'checkDependencies':
        return check_dependencies()

    elif msg_type == 'processOcr':
        input_path = message.get('inputPath')
        if not input_path:
            return {
                'type': 'ocrResult',
                'success': False,
                'error': 'Missing inputPath parameter'
            }

        return process_ocr(
            input_path=input_path,
            languages=message.get('languages', 'eng+jpn'),
            deskew=message.get('deskew', True),
            optimize=message.get('optimize', 1),
            engine=message.get('engine', 'apple')  # Default to AppleOCR for better Japanese
        )

    elif msg_type == 'ping':
        return {'type': 'pong'}

    else:
        error = f"Unknown message type: {msg_type}"
        logger.warning(error)
        return {'type': 'error', 'error': error}


def main():
    """Main entry point - process messages until stdin closes."""
    logger.info("OCR Native Host starting")

    try:
        while True:
            message = read_message()
            if message is None:
                break

            response = handle_message(message)
            if response:
                send_message(response)

    except KeyboardInterrupt:
        logger.info("Received interrupt, exiting")
    except Exception as e:
        logger.error(f"Unexpected error: {e}", exc_info=True)
    finally:
        logger.info("OCR Native Host exiting")


if __name__ == '__main__':
    main()
