/**
 * Blob storage helpers for large binary payloads.
 * Keeps runtime messages small by exchanging only IDs/metadata.
 */

import {
  storeImage,
  getSessionImages,
  deleteSessionImages
} from './storage_utils.js';

const BUILT_PDF_SESSION_PREFIX = '__built_pdf__:';

function getBuiltPdfSessionKey(sessionId) {
  return `${BUILT_PDF_SESSION_PREFIX}${sessionId}`;
}

/**
 * Persist a captured page blob for a session.
 */
export async function putCapturedPage(sessionId, pageIndex, blob, hash = '') {
  return storeImage(sessionId, pageIndex, blob, hash);
}

/**
 * List captured page records for a session (ordered by pageIndex).
 */
export async function listCapturedPages(sessionId) {
  return getSessionImages(sessionId);
}

/**
 * Store the generated PDF blob for a session.
 * We use a dedicated synthetic session key inside the same IndexedDB store.
 */
export async function putBuiltPdf(sessionId, blob) {
  const builtPdfKey = getBuiltPdfSessionKey(sessionId);
  await deleteSessionImages(builtPdfKey);
  await storeImage(builtPdfKey, 0, blob, 'built-pdf');
}

/**
 * Get the generated PDF blob for a session, if present.
 */
export async function getBuiltPdf(sessionId) {
  const builtPdfKey = getBuiltPdfSessionKey(sessionId);
  const records = await getSessionImages(builtPdfKey);
  return records.length > 0 ? records[records.length - 1].blob : null;
}

/**
 * Delete all session-related blobs (captured pages + generated PDF).
 */
export async function deleteSessionBlobs(sessionId) {
  const builtPdfKey = getBuiltPdfSessionKey(sessionId);
  await deleteSessionImages(sessionId);
  await deleteSessionImages(builtPdfKey);
}
