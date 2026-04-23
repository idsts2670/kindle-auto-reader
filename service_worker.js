/**
 * Service Worker for Auto Page Capture
 * Handles capture orchestration, PDF generation, downloads, and uploads
 */

import {
  getSessionImageCount,
  saveSession,
  getSession,
  getIncompleteSessions,
  deleteSession,
  getSettings,
  saveSettings,
  isDomainAllowed,
  isDomainBlocked,
  BLOCKLIST
} from './utils/storage_utils.js';
import {
  putCapturedPage,
  listCapturedPages,
  getBuiltPdf,
  deleteSessionBlobs
} from './utils/blob_store.js';

import {
  formatDuration,
  formatSeconds,
  RollingAverage,
  generateSessionId,
  applyFilenameTemplate,
  getDateString,
  getTimeString
} from './utils/time_utils.js';

import {
  processCapture,
  isBlankImage,
  capturesMatch,
  blobToArrayBuffer,
  getImageDimensions
} from './utils/image_utils.js';

import { isDuplicate, hexToHash } from './utils/hash_utils.js';

/**
 * Convert ArrayBuffer to base64 string using chunked approach
 * Avoids "Maximum call stack size exceeded" error from spread operator
 */
function arrayBufferToBase64(buffer) {
  const bytes = new Uint8Array(buffer);
  let binary = '';
  const chunkSize = 8192;
  for (let i = 0; i < bytes.length; i += chunkSize) {
    const chunk = bytes.subarray(i, Math.min(i + chunkSize, bytes.length));
    binary += String.fromCharCode.apply(null, chunk);
  }
  return btoa(binary);
}

// Capture state
let captureState = {
  active: false,
  paused: false,
  sessionId: null,
  tabId: null,
  config: null,
  pageIndex: 0,
  startTime: null,
  duplicateCount: 0,
  lastHash: null,
  pageTimes: new RollingAverage(10),
  stopReason: null
};

// Keep-alive alarm name
const KEEP_ALIVE_ALARM = 'keepAlive';

// Native messaging host name
const NATIVE_HOST_NAME = 'com.kindle_auto_reader.ocr_host';

// OCR state
let ocrState = {
  pendingOcr: null,
  lastError: null
};

// Per-site readiness profiles — keyed by exact hostname
const SITE_PROFILES = {
  'read.amazon.com':    { notReadySelector: 'div.loader', loaderMaxWait: 8000 },
  'read.amazon.co.jp': { notReadySelector: 'div.loader', loaderMaxWait: 8000 }
};

/**
 * Resolve a site profile for a given hostname.
 * Exact match first, then suffix/subdomain match.
 */
function resolveSiteProfile(hostname) {
  hostname = (hostname || '').toLowerCase();
  if (SITE_PROFILES[hostname]) return SITE_PROFILES[hostname];
  for (const key of Object.keys(SITE_PROFILES)) {
    if (hostname.endsWith('.' + key)) return SITE_PROFILES[key];
  }
  return null;
}

/**
 * Initialize the service worker
 */
async function init() {
  // Set up keep-alive alarm
  chrome.alarms.create(KEEP_ALIVE_ALARM, { periodInMinutes: 0.4 }); // Every 24 seconds

  // Check for incomplete sessions on startup
  const incompleteSessions = await getIncompleteSessions();
  if (incompleteSessions.length > 0) {
    // Notify popup about recovery option
    chrome.runtime.sendMessage({
      type: 'recoveryAvailable',
      sessions: incompleteSessions
    }).catch(() => {}); // Popup might not be open
  }
}

// Initialize on load
init();

// Handle keep-alive alarm
chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === KEEP_ALIVE_ALARM && captureState.active) {
    // Just keeping the service worker alive
    console.log('[Keep-alive] Service worker active, capture in progress');
  }
});

// Handle tab activation changes (for auto-pause)
chrome.tabs.onActivated.addListener(async (activeInfo) => {
  if (captureState.active && captureState.tabId !== activeInfo.tabId) {
    // User switched away from capture tab
    if (!captureState.paused) {
      captureState.paused = true;
      broadcastState();
    }
  } else if (captureState.paused && captureState.tabId === activeInfo.tabId) {
    // User returned to capture tab
    captureState.paused = false;
    broadcastState();
    // Resume capture loop
    captureLoop();
  }
});

// Handle messages from popup and content script
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  handleMessage(message, sender).then(sendResponse);
  return true; // Keep channel open for async response
});

/**
 * Handle incoming messages
 */
async function handleMessage(message, sender) {
  switch (message.type) {
    case 'startCapture':
      return startCapture(message.config);

    case 'stopCapture':
      return stopCapture(message.buildPdf);

    case 'getState':
      return getState();

    case 'buildPdf':
      return buildAndDownloadPdf(message.sessionId);

    case 'deleteSession':
      await deleteSessionBlobs(message.sessionId);
      await deleteSession(message.sessionId);
      return { success: true };

    case 'resumeCapture':
      return resumeCapture(message.sessionId);

    case 'checkDomain':
      return checkDomain(message.url);

    case 'getIncompleteSessions':
      return { sessions: await getIncompleteSessions() };

    case 'getSessionImageCount':
      return { count: await getSessionImageCount(message.sessionId) };

    case 'checkOcrDependencies':
      try {
        return await checkOcrDependencies();
      } catch (e) {
        return { allOk: false, error: e.message };
      }

    default:
      return { error: `Unknown message type: ${message.type}` };
  }
}

/**
 * Check if a domain is allowed/blocked
 */
async function checkDomain(url) {
  try {
    const urlObj = new URL(url);
    const domain = urlObj.hostname;

    if (isDomainBlocked(domain)) {
      return { status: 'blocked', domain };
    }

    const settings = await getSettings();
    if (isDomainAllowed(domain, settings.allowlist)) {
      return { status: 'allowed', domain };
    }

    return { status: 'not_allowed', domain };
  } catch (e) {
    return { status: 'error', error: e.message };
  }
}

/**
 * Start a new capture session
 */
async function startCapture(config) {
  if (captureState.active) {
    return { error: 'Capture already in progress' };
  }

  // Get current tab
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab) {
    return { error: 'No active tab found' };
  }

  // Check domain
  const domainCheck = await checkDomain(tab.url);
  if (domainCheck.status === 'blocked') {
    return { error: chrome.i18n.getMessage('errorBlocked') };
  }
  if (domainCheck.status === 'not_allowed') {
    return { error: chrome.i18n.getMessage('errorNotAllowlisted') };
  }

  // Inject content script
  try {
    await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      files: ['content_script.js']
    });
  } catch (e) {
    return { error: `Failed to inject content script: ${e.message}` };
  }

  // Wait for content script to be ready
  await new Promise(r => setTimeout(r, 100));

  // Initialize capture state
  const sessionId = generateSessionId();
  captureState = {
    active: true,
    paused: false,
    sessionId,
    tabId: tab.id,
    config,
    pageIndex: 0,
    startTime: Date.now(),
    duplicateCount: 0,
    lastHash: null,
    pageTimes: new RollingAverage(10),
    stopReason: null,
    sourceUrl: tab.url,
    sourceTitle: tab.title,
    sourceDomain: new URL(tab.url).hostname
  };

  // Auto-apply site profile if no notReadySelector was specified by the user
  const startProfile = resolveSiteProfile(captureState.sourceDomain);
  if (startProfile && !config.notReadySelector) {
    config.notReadySelector = startProfile.notReadySelector;
    config.loaderMaxWait = startProfile.loaderMaxWait;
    console.log(`[readiness] auto-applied profile for ${captureState.sourceDomain}: notReadySelector=${config.notReadySelector}`);
  }

  // Save session metadata
  await saveSession({
    id: sessionId,
    status: 'in_progress',
    startTime: captureState.startTime,
    config,
    sourceUrl: tab.url,
    sourceTitle: tab.title,
    sourceDomain: captureState.sourceDomain
  });

  // Start capture loop
  captureLoop();

  return { success: true, sessionId };
}

/**
 * Resume an incomplete capture session
 */
async function resumeCapture(sessionId) {
  const session = await getSession(sessionId);
  if (!session) {
    return { error: 'Session not found' };
  }

  const imageCount = await getSessionImageCount(sessionId);

  // Get current tab
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab) {
    return { error: 'No active tab found' };
  }

  // Inject content script
  try {
    await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      files: ['content_script.js']
    });
  } catch (e) {
    return { error: `Failed to inject content script: ${e.message}` };
  }

  await new Promise(r => setTimeout(r, 100));

  // Apply site profile to resumed config using original session domain
  const resumeConfig = { ...session.config };
  const resumeProfile = resolveSiteProfile(session.sourceDomain || '');
  if (resumeProfile && !resumeConfig.notReadySelector) {
    resumeConfig.notReadySelector = resumeProfile.notReadySelector;
    resumeConfig.loaderMaxWait = resumeProfile.loaderMaxWait;
    console.log(`[readiness] auto-applied profile for ${session.sourceDomain}: notReadySelector=${resumeConfig.notReadySelector}`);
  }

  // Resume state
  captureState = {
    active: true,
    paused: false,
    sessionId,
    tabId: tab.id,
    config: resumeConfig,
    pageIndex: imageCount,
    startTime: session.startTime,
    duplicateCount: 0,
    lastHash: null,
    pageTimes: new RollingAverage(10),
    stopReason: null,
    sourceUrl: session.sourceUrl,
    sourceTitle: session.sourceTitle,
    sourceDomain: session.sourceDomain
  };

  // Update session status
  await saveSession({ ...session, status: 'in_progress' });

  // Start capture loop
  captureLoop();

  return { success: true, sessionId, resumedFrom: imageCount };
}

/**
 * Main capture loop
 */
async function captureLoop() {
  while (captureState.active && !captureState.paused) {
    // Check if we've reached max pages
    if (captureState.pageIndex >= captureState.config.maxPages) {
      captureState.stopReason = 'maxPages';
      break;
    }

    const pageStartTime = Date.now();

    try {
      // Advance page (skip on first page)
      if (captureState.pageIndex > 0) {
        const advanceResult = await sendToContentScript('advancePage', {
          mode: captureState.config.mode,
          config: {
            key: captureState.config.key,
            nextSelector: captureState.config.nextSelector
          }
        });

        if (!advanceResult.success) {
          console.error('Page advance failed:', advanceResult.error);
          captureState.stopReason = 'advanceError';
          captureState.lastError = advanceResult.error;
          break;
        }

        // Check for scroll mode end
        if (advanceResult.scrollEnd) {
          captureState.stopReason = 'scrollEnd';
          break;
        }
      }

      // Wait for configured delay
      await new Promise(r => setTimeout(r, captureState.config.delayMs));

      // Wait for readiness
      await sendToContentScript('waitForReadiness', { timeout: 10000 });

      // Check wait selector if configured
      if (captureState.config.waitSelector) {
        const selectorResult = await sendToContentScript('waitForSelector', {
          selector: captureState.config.waitSelector,
          timeout: 10000
        });
        if (!selectorResult.found) {
          console.warn(`waitSelector '${captureState.config.waitSelector}' not found, continuing anyway`);
        }
      }

      // Layer A: loader idle check (Kindle and other sites with a loader selector)
      if (captureState.config.notReadySelector) {
        console.log(`[readiness] Waiting for loader: ${captureState.config.notReadySelector}`);
        const loaderResult = await sendToContentScript('waitForLoaderIdle', {
          selector: captureState.config.notReadySelector,
          maxWaitMs: captureState.config.loaderMaxWait ?? 8000
        });
        if (loaderResult.idle) {
          console.log(`[readiness] Loader idle after ${loaderResult.elapsedMs}ms`);
        } else {
          console.log(`[readiness] Loader wait timed out after ${loaderResult.elapsedMs}ms — proceeding`);
        }
      } else {
        console.log('[readiness] No notReadySelector — skipping loader wait');
      }

      // Layer B: pixel stability check (replaces double-capture)
      const finalCapture = await pixelStabilityCheck(
        captureState.config.pixelStabilityMaxWait ?? 8000,
        captureState.config.pixelStabilityInterval ?? 250
      );

      // Check for blank image - ONLY in scroll mode
      // For keyboard/click modes, book pages with minimal text (dedications, chapter breaks) are valid
      if (captureState.config.mode === 'scroll') {
        if (await isBlankImage(finalCapture, 0.3)) {
          console.error('Blank capture detected');
          captureState.stopReason = 'blankCapture';
          break;
        }
      }

      // Process and store image
      const processed = await processCapture(finalCapture, captureState.config.quality);

      // Check for duplicate - ONLY in scroll mode
      // For keyboard/click modes, pages always advance so duplicates indicate a bug, not end of content
      if (captureState.config.mode === 'scroll' && captureState.lastHash) {
        const lastHashBigInt = hexToHash(captureState.lastHash);
        const currentHashBigInt = hexToHash(processed.hash);

        // Use very strict threshold (2) - only truly identical pages
        if (isDuplicate(lastHashBigInt, currentHashBigInt, 2)) {
          captureState.duplicateCount++;
          if (captureState.duplicateCount >= captureState.config.duplicateTolerance) {
            captureState.stopReason = 'duplicate';
            break;
          }
        } else {
          captureState.duplicateCount = 0;
        }
      }

      captureState.lastHash = processed.hash;

      // Store image
      await putCapturedPage(
        captureState.sessionId,
        captureState.pageIndex,
        processed.blob,
        processed.hash
      );

      captureState.pageIndex++;

      // Update timing
      const pageTime = (Date.now() - pageStartTime) / 1000;
      captureState.pageTimes.add(pageTime);

      // Broadcast state update
      broadcastState();

      // Check end selector if configured
      if (captureState.config.endSelector) {
        const endResult = await sendToContentScript('checkSelector', {
          selector: captureState.config.endSelector
        });
        if (endResult.exists) {
          captureState.stopReason = 'endSelector';
          break;
        }
      }

    } catch (err) {
      console.error('Capture error:', err);
      captureState.stopReason = 'error';
      captureState.lastError = err.message;
      break;
    }
  }

  // Capture ended
  if (captureState.stopReason) {
    captureState.active = false;
    await saveSession({
      id: captureState.sessionId,
      status: 'completed',
      startTime: captureState.startTime,
      endTime: Date.now(),
      pageCount: captureState.pageIndex,
      stopReason: captureState.stopReason,
      config: captureState.config,
      sourceUrl: captureState.sourceUrl,
      sourceTitle: captureState.sourceTitle,
      sourceDomain: captureState.sourceDomain
    });
    broadcastState();
  }
}

/**
 * Capture the visible tab
 */
async function captureTab() {
  return new Promise((resolve, reject) => {
    chrome.tabs.captureVisibleTab(null, { format: 'png' }, (dataUrl) => {
      if (chrome.runtime.lastError) {
        reject(new Error(chrome.runtime.lastError.message));
      } else {
        resolve(dataUrl);
      }
    });
  });
}

/**
 * Wait until two consecutive captures are pixel-stable (Hamming ≤ 2).
 * On timeout returns the last capture already in hand — no extra captureTab call.
 */
async function pixelStabilityCheck(maxWaitMs, intervalMs) {
  const startTime = Date.now();

  async function safeCaptureTab() {
    try {
      return await captureTab();
    } catch (err) {
      if (err.message && err.message.includes('MAX_CAPTURE_VISIBLE_TAB_CALLS_PER_SECOND')) {
        console.warn('[readiness] captureTab quota hit, waiting 800ms before retry');
        await new Promise(r => setTimeout(r, 800));
        return captureTab();
      }
      throw err;
    }
  }

  let prevCapture = await safeCaptureTab();

  while (true) {
    await new Promise(r => setTimeout(r, intervalMs));
    const currCapture = await safeCaptureTab();
    const elapsed = Date.now() - startTime;

    if (await capturesMatch(prevCapture, currCapture)) {
      console.log(`[readiness] pixel stable after ${elapsed}ms`);
      return currCapture;
    }

    if (elapsed >= maxWaitMs) {
      console.log(`[readiness] pixel stability timed out after ${elapsed}ms, using last capture`);
      return currCapture;
    }

    console.log(`[readiness] pixel not stable, retrying (${elapsed}ms elapsed)`);
    prevCapture = currCapture;
  }
}

/**
 * Send message to content script
 */
async function sendToContentScript(action, data = {}) {
  return chrome.tabs.sendMessage(captureState.tabId, { action, ...data });
}

/**
 * Stop capture
 */
async function stopCapture(buildPdf = false) {
  if (!captureState.active && !captureState.sessionId) {
    return { error: 'No active capture' };
  }

  captureState.active = false;
  captureState.stopReason = 'userStopped';

  await saveSession({
    id: captureState.sessionId,
    status: 'stopped',
    startTime: captureState.startTime,
    endTime: Date.now(),
    pageCount: captureState.pageIndex,
    stopReason: 'userStopped',
    config: captureState.config,
    sourceUrl: captureState.sourceUrl,
    sourceTitle: captureState.sourceTitle,
    sourceDomain: captureState.sourceDomain
  });

  broadcastState();

  if (buildPdf) {
    return buildAndDownloadPdf(captureState.sessionId);
  }

  return { success: true, pageCount: captureState.pageIndex };
}

/**
 * Ensure offscreen document exists for PDF generation
 */
async function ensureOffscreenDocument() {
  const existingContexts = await chrome.runtime.getContexts({
    contextTypes: ['OFFSCREEN_DOCUMENT']
  });

  if (existingContexts.length > 0) {
    return;
  }

  await chrome.offscreen.createDocument({
    url: 'offscreen.html',
    reasons: ['DOM_PARSER'],
    justification: 'Generate PDF from captured images'
  });
}

/**
 * Build PDF and download
 */
async function buildAndDownloadPdf(sessionId) {
  const session = await getSession(sessionId);
  if (!session) {
    return { error: 'Session not found' };
  }

  const pages = await listCapturedPages(sessionId);
  if (pages.length === 0) {
    return { error: 'No images to build PDF' };
  }

  try {
    broadcastMessage({ type: 'pdfBuildStarted', sessionId });

    // Generate filename
    const settings = await getSettings();
    const filename = applyFilenameTemplate(settings.filenameTemplate, {
      title: sanitizeFilename(session.sourceTitle || 'capture'),
      date: getDateString(),
      time: getTimeString(),
      domain: session.sourceDomain,
      pageCount: pages.length.toString()
    });

    // Preflight estimate to aid debugging for very large sessions
    const totalImageBytes = pages.reduce((sum, page) => sum + (page.blob?.size || 0), 0);
    const avgImageBytes = pages.length > 0 ? Math.round(totalImageBytes / pages.length) : 0;
    console.log('[PDF] Preflight', {
      sessionId,
      pageCount: pages.length,
      totalImageBytes,
      avgImageBytes
    });

    // Ensure offscreen document exists
    await ensureOffscreenDocument();

    // Send to offscreen document for PDF generation
    const result = await chrome.runtime.sendMessage({
      type: 'offscreen:buildPdf',
      sessionId,
      filename
    });

    if (result.error) {
      broadcastMessage({ type: 'pdfBuildFailed', sessionId, error: result.error });
      return { error: result.error };
    }

    const pdfBlob = await getBuiltPdf(sessionId);
    if (!pdfBlob) {
      const missingBlobError = 'PDF build completed but output blob was not found';
      broadcastMessage({ type: 'pdfBuildFailed', sessionId, error: missingBlobError });
      return { error: missingBlobError };
    }

    // Download using data URL (URL.createObjectURL is not available in service workers)
    const pdfBuffer = await pdfBlob.arrayBuffer();
    const dataUrl = 'data:application/pdf;base64,' + arrayBufferToBase64(pdfBuffer);
    const downloadId = await chrome.downloads.download({
      url: dataUrl,
      filename: filename,
      saveAs: false
    });

    // Handle upload if enabled
    if (settings.uploadEnabled && settings.uploadEndpoint) {
      try {
        await uploadPdf(pdfBlob, filename, settings);
        broadcastMessage({ type: 'uploadSuccess' });
      } catch (uploadError) {
        broadcastMessage({
          type: 'uploadFailed',
          error: uploadError.message
        });
      }
    }

    // Cleanup after download completes and trigger OCR if enabled
    chrome.downloads.onChanged.addListener(function cleanup(delta) {
      if (delta.id === downloadId && delta.state?.current === 'complete') {
        chrome.downloads.onChanged.removeListener(cleanup);

        // Trigger OCR if enabled
        if (settings.ocrEnabled) {
          chrome.downloads.search({ id: downloadId }, async (results) => {
            if (results[0]?.filename) {
              const downloadPath = results[0].filename;
              console.log('[OCR] PDF downloaded, triggering OCR:', downloadPath);

              broadcastMessage({
                type: 'ocrProcessing',
                inputPath: downloadPath
              });

              try {
                await triggerOcr(downloadPath, settings);
                ocrState.pendingOcr = { ...ocrState.pendingOcr, completed: true };
              } catch (e) {
                console.error('[OCR] OCR processing failed:', e);
                // OCR failure doesn't prevent the original PDF from being saved
              }
            }
          });
        }

        // Delete session data after download completes
        deleteSessionBlobs(sessionId).catch((e) => {
          console.warn('[PDF] Failed to delete session blobs:', e);
        });
        deleteSession(sessionId).catch((e) => {
          console.warn('[PDF] Failed to delete session metadata:', e);
        });
      }
    });

    broadcastMessage({
      type: 'pdfBuildCompleted',
      sessionId,
      pageCount: pages.length,
      pdfSizeBytes: pdfBlob.size
    });

    return { success: true, filename, pageCount: pages.length };

  } catch (err) {
    console.error('PDF build error:', err);
    broadcastMessage({ type: 'pdfBuildFailed', sessionId, error: err.message });
    return { error: `Failed to build PDF: ${err.message}` };
  }
}

/**
 * Upload PDF to configured endpoint
 */
async function uploadPdf(pdfBlob, filename, settings) {
  const { uploadEndpoint, uploadAuthHeader, uploadAuthToken, uploadMethod } = settings;

  const headers = {};
  if (uploadAuthHeader && uploadAuthToken) {
    headers[uploadAuthHeader] = uploadAuthToken;
  }

  let response;

  if (uploadMethod === 'PUT') {
    headers['Content-Type'] = 'application/pdf';
    response = await fetch(uploadEndpoint, {
      method: 'PUT',
      headers,
      body: pdfBlob
    });
  } else {
    // POST multipart
    const formData = new FormData();
    formData.append('file', pdfBlob, filename);

    response = await fetch(uploadEndpoint, {
      method: 'POST',
      headers,
      body: formData
    });
  }

  if (!response.ok) {
    throw new Error(`HTTP ${response.status}: ${response.statusText}`);
  }

  return response;
}

/**
 * Sanitize string for use in filename
 */
function sanitizeFilename(str) {
  return str.replace(/[<>:"/\\|?*]/g, '_').substring(0, 100);
}

/**
 * Get current state for popup
 */
function getState() {
  if (!captureState.active && !captureState.sessionId) {
    return { active: false };
  }

  const elapsed = Date.now() - captureState.startTime;
  const avgTime = captureState.pageTimes.average();
  const remaining = captureState.config?.maxPages
    ? (captureState.config.maxPages - captureState.pageIndex) * avgTime * 1000
    : null;

  return {
    active: captureState.active,
    paused: captureState.paused,
    sessionId: captureState.sessionId,
    pageIndex: captureState.pageIndex,
    elapsed,
    elapsedFormatted: formatDuration(elapsed),
    avgTimePerPage: avgTime,
    avgTimeFormatted: formatSeconds(avgTime),
    remainingFormatted: remaining ? formatDuration(remaining) : null,
    stopReason: captureState.stopReason,
    lastError: captureState.lastError,
    config: captureState.config
  };
}

/**
 * Broadcast state to all listeners
 */
function broadcastState() {
  broadcastMessage({ type: 'stateUpdate', state: getState() });
}

/**
 * Broadcast message to popup
 */
function broadcastMessage(message) {
  chrome.runtime.sendMessage(message).catch(() => {
    // Popup might not be open
  });
}

/**
 * Trigger OCR processing on a downloaded PDF
 */
async function triggerOcr(pdfPath, settings) {
  return new Promise((resolve, reject) => {
    console.log('[OCR] Starting OCR for:', pdfPath);

    try {
      const port = chrome.runtime.connectNative(NATIVE_HOST_NAME);

      port.onMessage.addListener((response) => {
        console.log('[OCR] Response:', response);

        if (response.type === 'ocrResult') {
          if (response.success) {
            console.log('[OCR] Success:', response.outputPath);
            broadcastMessage({
              type: 'ocrComplete',
              inputPath: response.inputPath,
              outputPath: response.outputPath
            });
            resolve(response);
          } else {
            console.error('[OCR] Failed:', response.error);
            broadcastMessage({
              type: 'ocrFailed',
              error: response.error,
              inputPath: response.inputPath
            });
            reject(new Error(response.error));
          }
        }

        port.disconnect();
      });

      port.onDisconnect.addListener(() => {
        const error = chrome.runtime.lastError;
        if (error) {
          console.error('[OCR] Native host disconnected:', error.message);
          ocrState.lastError = error.message;
          // Don't broadcast error if it was expected disconnect after success
          if (!ocrState.pendingOcr?.completed) {
            broadcastMessage({
              type: 'ocrFailed',
              error: error.message || 'Native host disconnected'
            });
          }
        }
      });

      // Mark as pending
      ocrState.pendingOcr = { path: pdfPath, completed: false };

      // Send OCR request
      port.postMessage({
        type: 'processOcr',
        inputPath: pdfPath,
        languages: settings.ocrLanguages || 'eng+jpn',
        deskew: settings.ocrDeskew !== false,
        optimize: settings.ocrOptimize ?? 1,
        engine: settings.ocrEngine || 'apple'
      });

    } catch (e) {
      console.error('[OCR] Failed to connect to native host:', e);
      broadcastMessage({
        type: 'ocrFailed',
        error: e.message
      });
      reject(e);
    }
  });
}

/**
 * Check if OCR dependencies are available
 */
async function checkOcrDependencies() {
  return new Promise((resolve, reject) => {
    try {
      const port = chrome.runtime.connectNative(NATIVE_HOST_NAME);

      port.onMessage.addListener((response) => {
        if (response.type === 'dependencyStatus') {
          port.disconnect();
          resolve(response);
        }
      });

      port.onDisconnect.addListener(() => {
        const error = chrome.runtime.lastError;
        if (error) {
          reject(new Error(error.message || 'Native host not available'));
        }
      });

      port.postMessage({ type: 'checkDependencies' });

    } catch (e) {
      reject(e);
    }
  });
}
