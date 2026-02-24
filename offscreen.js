/**
 * Offscreen document for PDF generation
 * Runs in a separate context with full DOM capabilities
 */

import { listCapturedPages, putBuiltPdf } from './utils/blob_store.js';
import { getSession } from './utils/storage_utils.js';

// Listen for messages from the service worker
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  // Use unique message type to avoid collision with popup -> service_worker messages
  if (message.type === 'offscreen:buildPdf') {
    buildPdf(message)
      .then(result => sendResponse(result))
      .catch(error => sendResponse({ error: error.message }));
    return true; // Keep channel open for async response
  }
});

/**
 * Build PDF from images
 * @param {object} data - Contains sessionId and filename
 */
async function buildPdf(data) {
  const { sessionId, filename } = data;
  const [session, pages] = await Promise.all([
    getSession(sessionId),
    listCapturedPages(sessionId)
  ]);

  if (!session) {
    return { error: 'Session not found' };
  }

  if (!pages || pages.length === 0) {
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
    for (const pageRecord of pages) {
      const bytes = new Uint8Array(await pageRecord.blob.arrayBuffer());

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

    // Save PDF bytes and persist blob to IndexedDB for the service worker
    const pdfBytes = await pdfDoc.save();
    const pdfBlob = new Blob([pdfBytes], { type: 'application/pdf' });
    await putBuiltPdf(sessionId, pdfBlob);

    return {
      success: true,
      sessionId,
      filename,
      pageCount: pages.length,
      pdfSizeBytes: pdfBlob.size
    };

  } catch (err) {
    console.error('PDF build error:', err);
    return { error: `Failed to build PDF: ${err.message}` };
  }
}

// Notify that offscreen document is ready
console.log('[Offscreen] PDF builder ready');
