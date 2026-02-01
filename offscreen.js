/**
 * Offscreen document for PDF generation
 * Runs in a separate context with full DOM capabilities
 */

/**
 * Convert Uint8Array to base64 string using chunked approach
 * Avoids "Maximum call stack size exceeded" error from spread operator
 */
function uint8ArrayToBase64(bytes) {
  let binary = '';
  const chunkSize = 8192;
  for (let i = 0; i < bytes.length; i += chunkSize) {
    const chunk = bytes.subarray(i, Math.min(i + chunkSize, bytes.length));
    binary += String.fromCharCode.apply(null, chunk);
  }
  return btoa(binary);
}

// Listen for messages from the service worker
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  // Use unique message type to avoid collision with popup -> service_worker messages
  if (message.type === 'offscreen:buildPdf') {
    buildPdf(message.data)
      .then(result => sendResponse(result))
      .catch(error => sendResponse({ error: error.message }));
    return true; // Keep channel open for async response
  }
});

/**
 * Build PDF from images
 * @param {object} data - Contains images array and session info
 */
async function buildPdf(data) {
  const { images, session, filename } = data;

  if (!images || images.length === 0) {
    return { error: 'No images to build PDF' };
  }

  try {
    const { PDFDocument } = PDFLib;
    const pdfDoc = await PDFDocument.create();

    // Set PDF metadata
    pdfDoc.setTitle(session.sourceTitle || 'Captured Pages');
    pdfDoc.setCreator('Auto Page Capture');
    pdfDoc.setProducer('Auto Page Capture Chrome Extension');
    pdfDoc.setCreationDate(new Date(session.startTime));
    pdfDoc.setModificationDate(new Date());
    pdfDoc.setSubject(`Source: ${session.sourceUrl}`);

    // Process each image
    for (const imageData of images) {
      // Convert base64 to Uint8Array
      const base64Data = imageData.base64.split(',')[1] || imageData.base64;
      const binaryString = atob(base64Data);
      const bytes = new Uint8Array(binaryString.length);
      for (let i = 0; i < binaryString.length; i++) {
        bytes[i] = binaryString.charCodeAt(i);
      }

      // Embed JPEG image
      const jpegImage = await pdfDoc.embedJpg(bytes);
      const { width, height } = jpegImage.scale(1);

      // Determine page size based on config
      let pageWidth, pageHeight;

      if (session.config.pageSizeMode === 'auto') {
        pageWidth = width;
        pageHeight = height;
      } else if (session.config.pageSizeMode === 'A4') {
        pageWidth = 595.28;
        pageHeight = 841.89;
      } else if (session.config.pageSizeMode === 'Letter') {
        pageWidth = 612;
        pageHeight = 792;
      } else {
        pageWidth = width;
        pageHeight = height;
      }

      const page = pdfDoc.addPage([pageWidth, pageHeight]);

      // Calculate image placement
      let drawWidth, drawHeight, drawX, drawY;

      if (session.config.pageSizeMode === 'auto') {
        drawWidth = pageWidth;
        drawHeight = pageHeight;
        drawX = 0;
        drawY = 0;
      } else {
        const margin = 20;
        const maxWidth = pageWidth - 2 * margin;
        const maxHeight = pageHeight - 2 * margin;
        const scale = Math.min(maxWidth / width, maxHeight / height);
        drawWidth = width * scale;
        drawHeight = height * scale;
        drawX = (pageWidth - drawWidth) / 2;
        drawY = (pageHeight - drawHeight) / 2;
      }

      page.drawImage(jpegImage, {
        x: drawX,
        y: drawY,
        width: drawWidth,
        height: drawHeight
      });
    }

    // Save PDF as base64 (chunked to avoid stack overflow)
    const pdfBytes = await pdfDoc.save();
    const pdfBase64 = uint8ArrayToBase64(pdfBytes);

    return {
      success: true,
      pdfBase64,
      filename,
      pageCount: images.length
    };

  } catch (err) {
    console.error('PDF build error:', err);
    return { error: `Failed to build PDF: ${err.message}` };
  }
}

// Notify that offscreen document is ready
console.log('[Offscreen] PDF builder ready');
