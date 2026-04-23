/**
 * Options Page Script
 */

import { getSettings, saveSettings, BLOCKLIST } from './utils/storage_utils.js';

// DOM Elements
const elements = {
  // Tabs
  tabs: document.querySelectorAll('.tab'),
  tabContents: document.querySelectorAll('.tab-content'),

  // Capture settings
  defaultMaxPages: document.getElementById('default-max-pages'),
  defaultDelayMs: document.getElementById('default-delay-ms'),
  defaultDuplicateTolerance: document.getElementById('default-duplicate-tolerance'),
  defaultQuality: document.getElementById('default-quality'),
  qualityValue: document.getElementById('quality-value'),
  defaultNotReadySelector: document.getElementById('default-not-ready-selector'),
  defaultLoaderMaxWait: document.getElementById('default-loader-max-wait'),
  defaultPixelStabilityMaxWait: document.getElementById('default-pixel-stability-max-wait'),

  // Output settings
  defaultPageSize: document.getElementById('default-page-size'),
  filenameTemplate: document.getElementById('filename-template'),

  // OCR settings
  ocrEnabled: document.getElementById('ocr-enabled'),
  ocrSettings: document.getElementById('ocr-settings'),
  ocrStatus: document.getElementById('ocr-status'),
  ocrEngine: document.getElementById('ocr-engine'),
  ocrLanguages: document.getElementById('ocr-languages'),
  ocrDeskew: document.getElementById('ocr-deskew'),
  ocrOptimize: document.getElementById('ocr-optimize'),
  ocrOptimizeValue: document.getElementById('ocr-optimize-value'),
  ocrInstallHelp: document.getElementById('ocr-install-help'),

  // Upload settings
  uploadEnabled: document.getElementById('upload-enabled'),
  uploadSettings: document.getElementById('upload-settings'),
  uploadEndpoint: document.getElementById('upload-endpoint'),
  uploadAuthHeader: document.getElementById('upload-auth-header'),
  uploadAuthToken: document.getElementById('upload-auth-token'),
  uploadMethod: document.getElementById('upload-method'),
  endpointStatus: document.getElementById('endpoint-status'),

  // Domain lists
  newAllowlistDomain: document.getElementById('new-allowlist-domain'),
  btnAddAllowlist: document.getElementById('btn-add-allowlist'),
  allowlist: document.getElementById('allowlist'),
  blocklist: document.getElementById('blocklist'),

  // Actions
  btnSave: document.getElementById('btn-save'),
  saveStatus: document.getElementById('save-status')
};

// Current settings
let currentSettings = {};

/**
 * Initialize options page
 */
async function init() {
  applyI18n();
  await loadSettings();
  setupEventListeners();
  renderDomainLists();
  checkOcrDependencies();
}

/**
 * Apply i18n
 */
function applyI18n() {
  document.querySelectorAll('[data-i18n]').forEach(el => {
    const key = el.getAttribute('data-i18n');
    const message = chrome.i18n.getMessage(key);
    if (message) {
      if (el.tagName === 'INPUT' && el.placeholder) {
        // Don't change placeholder
      } else if (el.tagName === 'TITLE') {
        document.title = message;
      } else {
        el.textContent = message;
      }
    }
  });
}

/**
 * Load settings from storage
 */
async function loadSettings() {
  currentSettings = await getSettings();

  // Apply to form
  elements.defaultMaxPages.value = currentSettings.maxPages || 200;
  elements.defaultDelayMs.value = currentSettings.delayMs || 700;
  elements.defaultDuplicateTolerance.value = currentSettings.duplicateTolerance || 3;
  elements.defaultQuality.value = currentSettings.quality || 0.8;
  elements.qualityValue.textContent = currentSettings.quality || 0.8;
  elements.defaultPageSize.value = currentSettings.pageSizeMode || 'auto';
  elements.filenameTemplate.value = currentSettings.filenameTemplate || 'capture_{date}_{time}.pdf';
  elements.defaultNotReadySelector.value = currentSettings.notReadySelector || '';
  elements.defaultLoaderMaxWait.value = currentSettings.loaderMaxWait ?? 8000;
  elements.defaultPixelStabilityMaxWait.value = currentSettings.pixelStabilityMaxWait ?? 8000;

  elements.uploadEnabled.checked = currentSettings.uploadEnabled || false;
  elements.uploadEndpoint.value = currentSettings.uploadEndpoint || '';
  elements.uploadAuthHeader.value = currentSettings.uploadAuthHeader || '';
  elements.uploadAuthToken.value = currentSettings.uploadAuthToken || '';
  elements.uploadMethod.value = currentSettings.uploadMethod || 'POST';

  // OCR settings
  elements.ocrEnabled.checked = currentSettings.ocrEnabled !== false; // Default true
  elements.ocrEngine.value = currentSettings.ocrEngine || 'apple';
  elements.ocrLanguages.value = currentSettings.ocrLanguages || 'eng+jpn';
  elements.ocrDeskew.checked = currentSettings.ocrDeskew !== false; // Default true
  elements.ocrOptimize.value = currentSettings.ocrOptimize ?? 1;
  elements.ocrOptimizeValue.textContent = currentSettings.ocrOptimize ?? 1;

  updateUploadSettingsState();
  updateOcrSettingsState();
}

/**
 * Set up event listeners
 */
function setupEventListeners() {
  // Tab switching
  elements.tabs.forEach(tab => {
    tab.addEventListener('click', () => {
      const tabId = tab.dataset.tab;
      switchTab(tabId);
    });
  });

  // Quality slider
  elements.defaultQuality.addEventListener('input', () => {
    elements.qualityValue.textContent = elements.defaultQuality.value;
  });

  // Upload enabled toggle
  elements.uploadEnabled.addEventListener('change', updateUploadSettingsState);

  // OCR enabled toggle
  elements.ocrEnabled.addEventListener('change', updateOcrSettingsState);

  // OCR optimize slider
  elements.ocrOptimize.addEventListener('input', () => {
    elements.ocrOptimizeValue.textContent = elements.ocrOptimize.value;
  });

  // Add domain to allowlist
  elements.btnAddAllowlist.addEventListener('click', addAllowlistDomain);
  elements.newAllowlistDomain.addEventListener('keypress', (e) => {
    if (e.key === 'Enter') addAllowlistDomain();
  });

  // Save button
  elements.btnSave.addEventListener('click', saveAllSettings);
}

/**
 * Switch active tab
 */
function switchTab(tabId) {
  elements.tabs.forEach(tab => {
    tab.classList.toggle('active', tab.dataset.tab === tabId);
  });

  elements.tabContents.forEach(content => {
    content.classList.toggle('active', content.id === 'tab-' + tabId);
  });
}

/**
 * Update upload settings state based on checkbox
 */
function updateUploadSettingsState() {
  const enabled = elements.uploadEnabled.checked;
  elements.uploadSettings.classList.toggle('disabled', !enabled);
}

/**
 * Update OCR settings state based on checkbox
 */
function updateOcrSettingsState() {
  const enabled = elements.ocrEnabled.checked;
  elements.ocrSettings.classList.toggle('disabled', !enabled);
}

/**
 * Check OCR dependencies via native messaging
 */
async function checkOcrDependencies() {
  try {
    // Try to connect to the native host
    const port = chrome.runtime.connectNative('com.kindle_auto_reader.ocr_host');

    port.onMessage.addListener((response) => {
      if (response.type === 'dependencyStatus') {
        updateOcrStatusDisplay(response);
      }
      port.disconnect();
    });

    port.onDisconnect.addListener(() => {
      const error = chrome.runtime.lastError;
      if (error) {
        // Native host not installed or not working
        updateOcrStatusDisplay({
          allOk: false,
          error: error.message || 'Native host not found'
        });
      }
    });

    // Send check dependencies message
    port.postMessage({ type: 'checkDependencies' });

  } catch (e) {
    updateOcrStatusDisplay({
      allOk: false,
      error: e.message
    });
  }
}

/**
 * Update OCR status display based on dependency check
 */
function updateOcrStatusDisplay(status) {
  if (status.allOk) {
    elements.ocrStatus.className = 'status-box success';
    elements.ocrStatus.innerHTML = `
      <strong>${chrome.i18n.getMessage('ocrDepsOk') || 'Dependencies OK'}</strong><br>
      ocrmypdf: ${status.ocrmypdfVersion || 'installed'}<br>
      tesseract: ${status.tesseractVersion || 'installed'}<br>
      ${chrome.i18n.getMessage('ocrLanguagesAvailable') || 'Languages'}: ${status.languages?.join(', ') || 'eng, jpn'}
    `;
    elements.ocrInstallHelp.style.display = 'none';
  } else {
    elements.ocrStatus.className = 'status-box error';
    let message = chrome.i18n.getMessage('ocrDepsMissing') || 'Dependencies missing';
    if (status.error) {
      message += `: ${status.error}`;
    }
    elements.ocrStatus.textContent = message;
    elements.ocrInstallHelp.style.display = 'block';

    // Auto-disable OCR if deps are missing
    elements.ocrEnabled.checked = false;
    updateOcrSettingsState();
  }
}

/**
 * Render domain lists
 */
function renderDomainLists() {
  // Render allowlist
  elements.allowlist.innerHTML = '';
  const allowlist = currentSettings.allowlist || [];

  for (const domain of allowlist) {
    const li = document.createElement('li');
    li.innerHTML = `
      <span>${escapeHtml(domain)}</span>
      <button class="btn btn-danger btn-remove" data-domain="${escapeHtml(domain)}">${chrome.i18n.getMessage('removeDomain')}</button>
    `;
    elements.allowlist.appendChild(li);
  }

  // Add click handlers for remove buttons
  elements.allowlist.querySelectorAll('.btn-remove').forEach(btn => {
    btn.addEventListener('click', () => {
      removeAllowlistDomain(btn.dataset.domain);
    });
  });

  // Render blocklist (read-only)
  elements.blocklist.innerHTML = '';
  if (BLOCKLIST.length === 0) {
    const li = document.createElement('li');
    li.innerHTML = '<span style="color: #666; font-style: italic;">No blocked domains</span>';
    elements.blocklist.appendChild(li);
  } else {
    for (const domain of BLOCKLIST) {
      const li = document.createElement('li');
      li.className = 'blocked';
      li.innerHTML = `<span>${escapeHtml(domain)}</span><span>(blocked)</span>`;
      elements.blocklist.appendChild(li);
    }
  }
}

/**
 * Add domain to allowlist
 */
function addAllowlistDomain() {
  const domain = elements.newAllowlistDomain.value.trim().toLowerCase();

  if (!domain) return;

  // Validate domain format
  if (!isValidDomain(domain)) {
    showStatus(elements.saveStatus, 'error', 'Invalid domain format');
    return;
  }

  // Check if already in list
  if (currentSettings.allowlist.includes(domain)) {
    showStatus(elements.saveStatus, 'error', 'Domain already in list');
    return;
  }

  // Check if blocked
  if (BLOCKLIST.some(b => domain === b || domain.endsWith('.' + b))) {
    showStatus(elements.saveStatus, 'error', 'Cannot add blocked domain');
    return;
  }

  currentSettings.allowlist.push(domain);
  elements.newAllowlistDomain.value = '';
  renderDomainLists();
}

/**
 * Remove domain from allowlist
 */
function removeAllowlistDomain(domain) {
  currentSettings.allowlist = currentSettings.allowlist.filter(d => d !== domain);
  renderDomainLists();
}

/**
 * Validate domain format
 */
function isValidDomain(domain) {
  // Basic domain validation
  const domainRegex = /^[a-z0-9]+([\-\.]{1}[a-z0-9]+)*\.[a-z]{2,}$/i;
  return domainRegex.test(domain);
}

/**
 * Save all settings
 */
async function saveAllSettings() {
  // Validate upload endpoint if enabled
  if (elements.uploadEnabled.checked && elements.uploadEndpoint.value) {
    const valid = await validateEndpoint(elements.uploadEndpoint.value);
    if (!valid) {
      showStatus(elements.saveStatus, 'error', 'Invalid endpoint URL');
      return;
    }
  }

  const settings = {
    maxPages: parseInt(elements.defaultMaxPages.value),
    delayMs: parseInt(elements.defaultDelayMs.value),
    duplicateTolerance: parseInt(elements.defaultDuplicateTolerance.value),
    quality: parseFloat(elements.defaultQuality.value),
    pageSizeMode: elements.defaultPageSize.value,
    filenameTemplate: elements.filenameTemplate.value,
    uploadEnabled: elements.uploadEnabled.checked,
    uploadEndpoint: elements.uploadEndpoint.value,
    uploadAuthHeader: elements.uploadAuthHeader.value,
    uploadAuthToken: elements.uploadAuthToken.value,
    uploadMethod: elements.uploadMethod.value,
    allowlist: currentSettings.allowlist,
    notReadySelector: elements.defaultNotReadySelector.value,
    loaderMaxWait: parseInt(elements.defaultLoaderMaxWait.value),
    pixelStabilityMaxWait: parseInt(elements.defaultPixelStabilityMaxWait.value),
    // OCR settings
    ocrEnabled: elements.ocrEnabled.checked,
    ocrEngine: elements.ocrEngine.value,
    ocrLanguages: elements.ocrLanguages.value,
    ocrDeskew: elements.ocrDeskew.checked,
    ocrOptimize: parseInt(elements.ocrOptimize.value)
  };

  await saveSettings(settings);
  currentSettings = { ...currentSettings, ...settings };

  showStatus(elements.saveStatus, 'success', chrome.i18n.getMessage('settingsSaved'));
}

/**
 * Validate upload endpoint
 */
async function validateEndpoint(url) {
  if (!url) return true;

  try {
    const urlObj = new URL(url);
    if (urlObj.protocol !== 'https:' && urlObj.protocol !== 'http:') {
      return false;
    }

    showStatus(elements.endpointStatus, 'loading', chrome.i18n.getMessage('validatingEndpoint'));

    // Try a HEAD request to validate
    const response = await fetch(url, {
      method: 'HEAD',
      mode: 'no-cors'
    });

    showStatus(elements.endpointStatus, 'success', chrome.i18n.getMessage('endpointValid'));
    return true;
  } catch (e) {
    // For no-cors requests, we can't really tell if it succeeded
    // So we just check if the URL is valid
    showStatus(elements.endpointStatus, 'success', 'URL format valid');
    return true;
  }
}

/**
 * Show status message
 */
function showStatus(element, type, message) {
  element.className = 'status-text ' + type;
  element.textContent = message;

  if (type !== 'loading') {
    setTimeout(() => {
      element.textContent = '';
    }, 3000);
  }
}

/**
 * Escape HTML to prevent XSS
 */
function escapeHtml(text) {
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}

// Initialize
init();
