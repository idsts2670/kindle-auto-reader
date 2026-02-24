/**
 * Popup Script for Auto Page Capture
 */

import { getSettings, saveSettings, getPopupState, savePopupState, isDomainConfirmed, confirmDomain } from './utils/storage_utils.js';

// DOM Elements
const elements = {
  domainStatus: document.getElementById('domain-status'),
  recoveryBanner: document.getElementById('recovery-banner'),
  recoveryMessage: document.getElementById('recovery-message'),
  btnResume: document.getElementById('btn-resume'),
  btnBuildPartial: document.getElementById('btn-build-partial'),
  btnDeleteRecovery: document.getElementById('btn-delete-recovery'),
  confirmRights: document.getElementById('confirm-rights'),
  modeTabs: document.querySelectorAll('.mode-tab'),
  keyboardOptions: document.getElementById('keyboard-options'),
  clickOptions: document.getElementById('click-options'),
  scrollOptions: document.getElementById('scroll-options'),
  keySelect: document.getElementById('key-select'),
  nextSelector: document.getElementById('next-selector'),
  btnStart: document.getElementById('btn-start'),
  btnStop: document.getElementById('btn-stop'),
  progressSection: document.getElementById('progress-section'),
  progressPages: document.getElementById('progress-pages'),
  progressElapsed: document.getElementById('progress-elapsed'),
  progressAvg: document.getElementById('progress-avg'),
  progressRemaining: document.getElementById('progress-remaining'),
  progressRemainingRow: document.getElementById('progress-remaining-row'),
  pausedNotice: document.getElementById('paused-notice'),
  maxPages: document.getElementById('max-pages'),
  delayMs: document.getElementById('delay-ms'),
  waitSelector: document.getElementById('wait-selector'),
  endSelector: document.getElementById('end-selector'),
  duplicateTolerance: document.getElementById('duplicate-tolerance'),
  quality: document.getElementById('quality'),
  qualityValue: document.getElementById('quality-value'),
  pageSize: document.getElementById('page-size'),
  exportSection: document.getElementById('export-section'),
  btnDownload: document.getElementById('btn-download'),
  btnUpload: document.getElementById('btn-upload'),
  stopPrompt: document.getElementById('stop-prompt'),
  stopPromptMessage: document.getElementById('stop-prompt-message'),
  btnBuildPdf: document.getElementById('btn-build-pdf'),
  btnDiscard: document.getElementById('btn-discard'),
  statusMessage: document.getElementById('status-message')
};

// Current state
let currentState = {
  mode: 'keyboard',
  domain: null,
  domainStatus: null,
  capturing: false,
  sessionId: null,
  recoverySessionId: null
};

/**
 * Initialize popup
 */
async function init() {
  // Apply i18n
  applyI18n();

  // Load saved popup state
  const savedState = await getPopupState();
  if (savedState) {
    applyPopupState(savedState);
  }

  // Load settings
  const settings = await getSettings();
  applySettings(settings);

  // Check current domain
  await checkCurrentDomain();

  // Check for recovery sessions
  await checkRecoverySessions();

  // Get current capture state
  await refreshState();

  // Set up event listeners
  setupEventListeners();

  // Listen for state updates
  chrome.runtime.onMessage.addListener(handleMessage);
}

/**
 * Apply i18n to elements with data-i18n attribute
 */
function applyI18n() {
  document.querySelectorAll('[data-i18n]').forEach(el => {
    const key = el.getAttribute('data-i18n');
    const message = chrome.i18n.getMessage(key);
    if (message) {
      el.textContent = message;
    }
  });
}

/**
 * Apply saved popup state
 */
function applyPopupState(state) {
  if (state.mode) {
    selectMode(state.mode);
  }
  if (state.key) {
    elements.keySelect.value = state.key;
  }
  if (state.nextSelector) {
    elements.nextSelector.value = state.nextSelector;
  }
  if (state.maxPages) {
    elements.maxPages.value = state.maxPages;
  }
  if (state.delayMs) {
    elements.delayMs.value = state.delayMs;
  }
  if (state.waitSelector) {
    elements.waitSelector.value = state.waitSelector;
  }
  if (state.endSelector) {
    elements.endSelector.value = state.endSelector;
  }
  if (state.duplicateTolerance) {
    elements.duplicateTolerance.value = state.duplicateTolerance;
  }
  if (state.quality) {
    elements.quality.value = state.quality;
    elements.qualityValue.textContent = state.quality;
  }
  if (state.pageSizeMode) {
    elements.pageSize.value = state.pageSizeMode;
  }
}

/**
 * Apply settings from storage
 */
function applySettings(settings) {
  if (settings.uploadEnabled) {
    elements.btnUpload.classList.remove('hidden');
  }
}

/**
 * Check current domain status
 */
async function checkCurrentDomain() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab || !tab.url) {
    updateDomainStatus('error', 'No active tab');
    return;
  }

  const response = await chrome.runtime.sendMessage({
    type: 'checkDomain',
    url: tab.url
  });

  currentState.domain = response.domain;
  currentState.domainStatus = response.status;

  if (response.status === 'blocked') {
    updateDomainStatus('blocked', chrome.i18n.getMessage('statusBlocked'));
    elements.btnStart.disabled = true;
  } else if (response.status === 'allowed') {
    updateDomainStatus('allowed', chrome.i18n.getMessage('statusEnabled'));
    // Check if domain was previously confirmed
    const confirmed = await isDomainConfirmed(response.domain);
    if (confirmed) {
      elements.confirmRights.checked = true;
    }
  } else {
    updateDomainStatus('not-allowed', chrome.i18n.getMessage('statusDisabled'));
    elements.btnStart.disabled = true;
  }
}

/**
 * Update domain status indicator
 */
function updateDomainStatus(status, message) {
  elements.domainStatus.className = 'status-indicator ' + status;
  elements.domainStatus.textContent = message;
}

/**
 * Check for incomplete capture sessions
 */
async function checkRecoverySessions() {
  const response = await chrome.runtime.sendMessage({ type: 'getIncompleteSessions' });

  if (response.sessions && response.sessions.length > 0) {
    const session = response.sessions[0];
    currentState.recoverySessionId = session.id;

    // Get image count
    const countResponse = await chrome.runtime.sendMessage({
      type: 'getSessionImageCount',
      sessionId: session.id
    });

    const pageCount = countResponse?.count || 'unknown';

    elements.recoveryMessage.textContent = chrome.i18n.getMessage('recoveryFound', [pageCount.toString()]);
    elements.btnResume.textContent = chrome.i18n.getMessage('resume');
    elements.btnBuildPartial.textContent = chrome.i18n.getMessage('buildPartial');
    elements.btnDeleteRecovery.textContent = chrome.i18n.getMessage('deleteRecovery');
    elements.recoveryBanner.classList.remove('hidden');
  }
}

/**
 * Refresh current capture state
 */
async function refreshState() {
  const response = await chrome.runtime.sendMessage({ type: 'getState' });
  updateUI(response);
}

/**
 * Set up event listeners
 */
function setupEventListeners() {
  // Mode tabs
  elements.modeTabs.forEach(tab => {
    tab.addEventListener('click', () => {
      selectMode(tab.dataset.mode);
      saveCurrentState();
    });
  });

  // Quality slider
  elements.quality.addEventListener('input', () => {
    elements.qualityValue.textContent = elements.quality.value;
    saveCurrentState();
  });

  // Save state on input changes
  [elements.keySelect, elements.nextSelector, elements.maxPages, elements.delayMs,
   elements.waitSelector, elements.endSelector, elements.duplicateTolerance, elements.pageSize
  ].forEach(el => {
    el.addEventListener('change', saveCurrentState);
  });

  // Confirmation checkbox
  elements.confirmRights.addEventListener('change', async () => {
    if (elements.confirmRights.checked && currentState.domain) {
      await confirmDomain(currentState.domain);
    }
    updateStartButton();
  });

  // Start button
  elements.btnStart.addEventListener('click', startCapture);

  // Stop button
  elements.btnStop.addEventListener('click', () => {
    showStopPrompt();
  });

  // Stop prompt buttons
  elements.btnBuildPdf.addEventListener('click', () => {
    elements.stopPrompt.classList.add('hidden');
    stopCapture(true);
  });

  elements.btnDiscard.addEventListener('click', () => {
    elements.stopPrompt.classList.add('hidden');
    stopCapture(false);
  });

  // Download button
  elements.btnDownload.addEventListener('click', async () => {
    if (!currentState.sessionId) {
      showMessage('error', 'No capture session found');
      console.error('Download failed: no sessionId', currentState);
      return;
    }

    showMessage('info', 'Building PDF...');
    console.log('Building PDF for session:', currentState.sessionId);

    try {
      const response = await chrome.runtime.sendMessage({
        type: 'buildPdf',
        sessionId: currentState.sessionId
      });

      console.log('Build PDF response:', response);

      if (response && response.error) {
        showMessage('error', response.error);
      } else if (response && response.success) {
        showMessage('success', `PDF downloaded: ${response.filename}`);
      }
    } catch (err) {
      console.error('Download error:', err);
      showMessage('error', 'Download failed: ' + err.message);
    }
  });

  // Upload button
  elements.btnUpload.addEventListener('click', async () => {
    // Upload is handled automatically after PDF build if enabled
    showMessage('info', 'Upload happens automatically after download');
  });

  // Recovery buttons
  elements.btnResume.addEventListener('click', async () => {
    await chrome.runtime.sendMessage({
      type: 'resumeCapture',
      sessionId: currentState.recoverySessionId
    });
    elements.recoveryBanner.classList.add('hidden');
  });

  elements.btnBuildPartial.addEventListener('click', async () => {
    await chrome.runtime.sendMessage({
      type: 'buildPdf',
      sessionId: currentState.recoverySessionId
    });
    elements.recoveryBanner.classList.add('hidden');
  });

  elements.btnDeleteRecovery.addEventListener('click', async () => {
    await chrome.runtime.sendMessage({
      type: 'deleteSession',
      sessionId: currentState.recoverySessionId
    });
    elements.recoveryBanner.classList.add('hidden');
  });
}

/**
 * Select capture mode
 */
function selectMode(mode) {
  currentState.mode = mode;

  elements.modeTabs.forEach(tab => {
    tab.classList.toggle('active', tab.dataset.mode === mode);
  });

  elements.keyboardOptions.classList.toggle('hidden', mode !== 'keyboard');
  elements.clickOptions.classList.toggle('hidden', mode !== 'click');
  elements.scrollOptions.classList.toggle('hidden', mode !== 'scroll');
}

/**
 * Save current popup state
 */
async function saveCurrentState() {
  const state = {
    mode: currentState.mode,
    key: elements.keySelect.value,
    nextSelector: elements.nextSelector.value,
    maxPages: parseInt(elements.maxPages.value),
    delayMs: parseInt(elements.delayMs.value),
    waitSelector: elements.waitSelector.value,
    endSelector: elements.endSelector.value,
    duplicateTolerance: parseInt(elements.duplicateTolerance.value),
    quality: parseFloat(elements.quality.value),
    pageSizeMode: elements.pageSize.value
  };

  await savePopupState(state);
}

/**
 * Update start button state
 */
function updateStartButton() {
  const canStart = currentState.domainStatus === 'allowed' && elements.confirmRights.checked;
  elements.btnStart.disabled = !canStart;
}

/**
 * Start capture
 */
async function startCapture() {
  const config = {
    mode: currentState.mode,
    key: elements.keySelect.value,
    nextSelector: elements.nextSelector.value,
    maxPages: parseInt(elements.maxPages.value),
    delayMs: parseInt(elements.delayMs.value),
    waitSelector: elements.waitSelector.value,
    endSelector: elements.endSelector.value,
    duplicateTolerance: parseInt(elements.duplicateTolerance.value),
    quality: parseFloat(elements.quality.value),
    pageSizeMode: elements.pageSize.value
  };

  const response = await chrome.runtime.sendMessage({
    type: 'startCapture',
    config
  });

  if (response.error) {
    showMessage('error', response.error);
    return;
  }

  currentState.sessionId = response.sessionId;
  currentState.capturing = true;

  updateUI({ active: true, pageIndex: 0 });
}

/**
 * Stop capture
 */
async function stopCapture(buildPdf) {
  const response = await chrome.runtime.sendMessage({
    type: 'stopCapture',
    buildPdf
  });

  if (response.error) {
    showMessage('error', response.error);
    return;
  }

  if (buildPdf && response.success) {
    showMessage('success', chrome.i18n.getMessage('captureComplete'));
  }
}

/**
 * Show stop prompt modal
 */
function showStopPrompt() {
  const pageCount = elements.progressPages.textContent.match(/\d+/)?.[0] || '0';
  elements.stopPromptMessage.textContent = chrome.i18n.getMessage('promptStopCapture', [pageCount]);
  elements.stopPrompt.classList.remove('hidden');
}

/**
 * Update UI based on capture state
 */
function updateUI(state) {
  if (!state) return;

  currentState.capturing = state.active;
  currentState.sessionId = state.sessionId;

  // Toggle button visibility
  elements.btnStart.classList.toggle('hidden', state.active);
  elements.btnStop.classList.toggle('hidden', !state.active);

  // Toggle progress visibility
  elements.progressSection.classList.toggle('hidden', !state.active && !state.stopReason);

  // Update progress
  if (state.active || state.pageIndex > 0) {
    elements.progressPages.textContent = chrome.i18n.getMessage('progressPages', [state.pageIndex?.toString() || '0']);
    elements.progressElapsed.textContent = chrome.i18n.getMessage('progressElapsed', [state.elapsedFormatted || '0:00']);
    elements.progressAvg.textContent = chrome.i18n.getMessage('progressAvg', [state.avgTimeFormatted || '0.0s']);

    if (state.remainingFormatted) {
      elements.progressRemaining.textContent = chrome.i18n.getMessage('progressRemaining', [state.remainingFormatted]);
      elements.progressRemainingRow.classList.remove('hidden');
    } else {
      elements.progressRemainingRow.classList.add('hidden');
    }
  }

  // Paused notice
  elements.pausedNotice.classList.toggle('hidden', !state.paused);

  // Export section
  if (state.stopReason && state.pageIndex > 0) {
    elements.exportSection.classList.remove('hidden');

    // Show appropriate message
    if (state.stopReason === 'duplicate') {
      showMessage('info', chrome.i18n.getMessage('duplicateStop', [state.config?.duplicateTolerance?.toString() || '3']));
    } else if (state.stopReason === 'endSelector' || state.stopReason === 'scrollEnd') {
      showMessage('success', chrome.i18n.getMessage('endReached'));
    }
  } else {
    elements.exportSection.classList.add('hidden');
  }

  // Update start button
  updateStartButton();
}

/**
 * Handle messages from service worker
 */
function handleMessage(message) {
  switch (message.type) {
    case 'stateUpdate':
      updateUI(message.state);
      break;

    case 'pdfBuildStarted':
      showMessage('info', 'Building PDF...');
      break;

    case 'pdfBuildCompleted':
      // Download completion has its own success message from request handlers.
      break;

    case 'pdfBuildFailed':
      showMessage('error', message.error || 'Failed to build PDF');
      break;

    case 'uploadSuccess':
      showMessage('success', chrome.i18n.getMessage('uploadSuccess'));
      break;

    case 'uploadFailed':
      showMessage('error', chrome.i18n.getMessage('uploadFailed', [message.error]));
      break;

    case 'recoveryAvailable':
      checkRecoverySessions();
      break;
  }
}

/**
 * Show status message
 */
function showMessage(type, text) {
  elements.statusMessage.className = 'status-message ' + type;
  elements.statusMessage.textContent = text;
  elements.statusMessage.classList.remove('hidden');

  setTimeout(() => {
    elements.statusMessage.classList.add('hidden');
  }, 5000);
}

// Initialize
init();
