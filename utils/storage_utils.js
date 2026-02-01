/**
 * Storage utilities for managing extension data
 * Uses IndexedDB for image blobs and chrome.storage for settings
 */

const DB_NAME = 'AutoPageCaptureDB';
const DB_VERSION = 1;
const STORE_IMAGES = 'capturedImages';
const STORE_SESSIONS = 'captureSessions';

let dbInstance = null;

/**
 * Open or get the IndexedDB instance
 */
export async function openDB() {
  if (dbInstance) return dbInstance;

  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);

    request.onerror = () => reject(request.error);

    request.onsuccess = () => {
      dbInstance = request.result;
      resolve(dbInstance);
    };

    request.onupgradeneeded = (event) => {
      const db = event.target.result;

      // Store for captured images
      if (!db.objectStoreNames.contains(STORE_IMAGES)) {
        const imageStore = db.createObjectStore(STORE_IMAGES, { keyPath: 'id', autoIncrement: true });
        imageStore.createIndex('sessionId', 'sessionId', { unique: false });
        imageStore.createIndex('pageIndex', 'pageIndex', { unique: false });
      }

      // Store for session metadata
      if (!db.objectStoreNames.contains(STORE_SESSIONS)) {
        db.createObjectStore(STORE_SESSIONS, { keyPath: 'id' });
      }
    };
  });
}

/**
 * Store a captured image blob
 */
export async function storeImage(sessionId, pageIndex, blob, hash) {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_IMAGES, 'readwrite');
    const store = tx.objectStore(STORE_IMAGES);

    const record = {
      sessionId,
      pageIndex,
      blob,
      hash,
      timestamp: Date.now()
    };

    const request = store.add(record);
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

/**
 * Get all images for a session, ordered by pageIndex
 */
export async function getSessionImages(sessionId) {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_IMAGES, 'readonly');
    const store = tx.objectStore(STORE_IMAGES);
    const index = store.index('sessionId');

    const request = index.getAll(sessionId);
    request.onsuccess = () => {
      const images = request.result.sort((a, b) => a.pageIndex - b.pageIndex);
      resolve(images);
    };
    request.onerror = () => reject(request.error);
  });
}

/**
 * Get the count of images for a session
 */
export async function getSessionImageCount(sessionId) {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_IMAGES, 'readonly');
    const store = tx.objectStore(STORE_IMAGES);
    const index = store.index('sessionId');

    const request = index.count(sessionId);
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

/**
 * Delete all images for a session
 */
export async function deleteSessionImages(sessionId) {
  const db = await openDB();
  const images = await getSessionImages(sessionId);

  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_IMAGES, 'readwrite');
    const store = tx.objectStore(STORE_IMAGES);

    let deleted = 0;
    for (const img of images) {
      const request = store.delete(img.id);
      request.onsuccess = () => {
        deleted++;
        if (deleted === images.length) resolve(deleted);
      };
      request.onerror = () => reject(request.error);
    }

    if (images.length === 0) resolve(0);
  });
}

/**
 * Save session metadata
 */
export async function saveSession(session) {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_SESSIONS, 'readwrite');
    const store = tx.objectStore(STORE_SESSIONS);

    const request = store.put(session);
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

/**
 * Get session metadata
 */
export async function getSession(sessionId) {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_SESSIONS, 'readonly');
    const store = tx.objectStore(STORE_SESSIONS);

    const request = store.get(sessionId);
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

/**
 * Get all incomplete sessions (for recovery)
 */
export async function getIncompleteSessions() {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_SESSIONS, 'readonly');
    const store = tx.objectStore(STORE_SESSIONS);

    const request = store.getAll();
    request.onsuccess = () => {
      const incomplete = request.result.filter(s => s.status === 'in_progress' || s.status === 'paused');
      resolve(incomplete);
    };
    request.onerror = () => reject(request.error);
  });
}

/**
 * Delete a session and its images
 */
export async function deleteSession(sessionId) {
  await deleteSessionImages(sessionId);

  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_SESSIONS, 'readwrite');
    const store = tx.objectStore(STORE_SESSIONS);

    const request = store.delete(sessionId);
    request.onsuccess = () => resolve();
    request.onerror = () => reject(request.error);
  });
}

// Default settings
const DEFAULT_SETTINGS = {
  mode: 'keyboard',
  key: 'ArrowRight',
  nextSelector: '.next-button',
  waitSelector: '',
  endSelector: '',
  maxPages: 200,
  delayMs: 700,
  duplicateTolerance: 3,
  quality: 0.8,
  pageSizeMode: 'auto',
  allowlist: [],
  uploadEnabled: false,
  uploadEndpoint: '',
  uploadAuthHeader: '',
  uploadAuthToken: '',
  uploadMethod: 'POST',
  filenameTemplate: 'capture_{date}_{time}.pdf',
  confirmedDomains: [],
  // OCR settings
  ocrEnabled: true,
  ocrEngine: 'apple',  // 'apple' for AppleOCR (better Japanese), 'tesseract' for Tesseract
  ocrLanguages: 'eng+jpn',
  ocrDeskew: true,
  ocrOptimize: 1
};

// Hardcoded blocklist - cannot be modified
// Blocklist is empty - user can allow any domain they have rights to capture
export const BLOCKLIST = [];

/**
 * Get settings from chrome.storage
 */
export async function getSettings() {
  return new Promise((resolve) => {
    chrome.storage.local.get(DEFAULT_SETTINGS, (result) => {
      resolve(result);
    });
  });
}

/**
 * Save settings to chrome.storage
 */
export async function saveSettings(settings) {
  return new Promise((resolve) => {
    chrome.storage.local.set(settings, resolve);
  });
}

/**
 * Check if a domain is in the allowlist (including subdomains)
 */
export function isDomainAllowed(domain, allowlist) {
  domain = domain.toLowerCase();
  for (const allowed of allowlist) {
    const normalizedAllowed = allowed.toLowerCase();
    if (domain === normalizedAllowed || domain.endsWith('.' + normalizedAllowed)) {
      return true;
    }
  }
  return false;
}

/**
 * Check if a domain is blocked
 */
export function isDomainBlocked(domain) {
  domain = domain.toLowerCase();
  for (const blocked of BLOCKLIST) {
    const normalizedBlocked = blocked.toLowerCase();
    if (domain === normalizedBlocked || domain.endsWith('.' + normalizedBlocked)) {
      return true;
    }
  }
  return false;
}

/**
 * Check if domain has been confirmed by user
 */
export async function isDomainConfirmed(domain) {
  const settings = await getSettings();
  return settings.confirmedDomains.includes(domain.toLowerCase());
}

/**
 * Mark domain as confirmed
 */
export async function confirmDomain(domain) {
  const settings = await getSettings();
  const normalizedDomain = domain.toLowerCase();
  if (!settings.confirmedDomains.includes(normalizedDomain)) {
    settings.confirmedDomains.push(normalizedDomain);
    await saveSettings({ confirmedDomains: settings.confirmedDomains });
  }
}

/**
 * Get popup state (last used settings)
 */
export async function getPopupState() {
  return new Promise((resolve) => {
    chrome.storage.local.get({ popupState: null }, (result) => {
      resolve(result.popupState);
    });
  });
}

/**
 * Save popup state
 */
export async function savePopupState(state) {
  return new Promise((resolve) => {
    chrome.storage.local.set({ popupState: state }, resolve);
  });
}
