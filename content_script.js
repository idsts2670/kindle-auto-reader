/**
 * Content Script for Auto Page Capture
 * Handles page advancement, readiness detection, and selector checks
 * Injected on-demand via scripting.executeScript
 */

(function() {
  // Prevent multiple injections
  if (window.__autoPageCaptureInjected) {
    return;
  }
  window.__autoPageCaptureInjected = true;

  /**
   * Advance to the next page based on mode
   * @param {string} mode - 'keyboard', 'click', or 'scroll'
   * @param {object} config - Configuration object
   * @returns {Promise<{success: boolean, error?: string, scrollEnd?: boolean}>}
   */
  async function advancePage(mode, config) {
    try {
      switch (mode) {
        case 'keyboard':
          return advanceKeyboard(config.key || 'ArrowRight');

        case 'click':
          return advanceClick(config.nextSelector);

        case 'scroll':
          return advanceScroll();

        default:
          return { success: false, error: `Unknown mode: ${mode}` };
      }
    } catch (err) {
      return { success: false, error: err.message };
    }
  }

  /**
   * Advance page using keyboard
   * Try to find and focus the reader element, then dispatch key event
   */
  function advanceKeyboard(key) {
    // Try to find known reader elements (Kindle, etc.)
    const readerSelectors = [
      '#kr-renderer',           // Kindle Cloud Reader
      '#kindleReader_content',  // Alternative Kindle selector
      '#reader-container',      // Generic reader
      '[role="application"]',   // ARIA application role
      'iframe'                  // Might be in an iframe
    ];

    let target = null;

    // Try to find a reader element
    for (const selector of readerSelectors) {
      const el = document.querySelector(selector);
      if (el) {
        target = el;
        break;
      }
    }

    // Fall back to active element or body
    if (!target) {
      target = document.activeElement || document.body;
    }

    // Try to focus the target
    if (target.focus) {
      target.focus();
    }

    // Dispatch to both the target and document for better compatibility
    const keyEvent = new KeyboardEvent('keydown', {
      key: key,
      code: key,
      keyCode: getKeyCode(key),
      which: getKeyCode(key),
      bubbles: true,
      cancelable: true,
      view: window
    });

    target.dispatchEvent(keyEvent);
    document.dispatchEvent(keyEvent);

    // Also dispatch keyup
    const keyUpEvent = new KeyboardEvent('keyup', {
      key: key,
      code: key,
      keyCode: getKeyCode(key),
      which: getKeyCode(key),
      bubbles: true,
      cancelable: true,
      view: window
    });

    target.dispatchEvent(keyUpEvent);
    document.dispatchEvent(keyUpEvent);

    return { success: true };
  }

  /**
   * Get key code for common keys
   */
  function getKeyCode(key) {
    const keyCodes = {
      'ArrowRight': 39,
      'ArrowLeft': 37,
      'ArrowDown': 40,
      'ArrowUp': 38,
      'Space': 32,
      'Enter': 13,
      'PageDown': 34,
      'PageUp': 33
    };
    return keyCodes[key] || key.charCodeAt(0);
  }

  /**
   * Advance page by clicking a selector
   */
  function advanceClick(selector) {
    if (!selector) {
      return { success: false, error: 'No selector provided for click mode' };
    }

    const element = document.querySelector(selector);
    if (!element) {
      return { success: false, error: `Selector '${selector}' not found` };
    }

    // Click the first match
    element.click();
    return { success: true };
  }

  /**
   * Advance page by scrolling
   * Returns scrollEnd: true if at bottom of page
   */
  function advanceScroll() {
    const beforeScroll = window.scrollY;
    const scrollHeight = document.documentElement.scrollHeight;
    const clientHeight = window.innerHeight;

    // Check if already at bottom
    if (Math.ceil(window.scrollY + clientHeight) >= scrollHeight) {
      return { success: true, scrollEnd: true };
    }

    // Scroll down by one viewport height
    window.scrollBy(0, clientHeight);

    // Check if scroll actually happened
    return new Promise(resolve => {
      setTimeout(() => {
        const afterScroll = window.scrollY;
        const newScrollHeight = document.documentElement.scrollHeight;

        // Check if now at bottom
        const atBottom = Math.ceil(afterScroll + clientHeight) >= newScrollHeight;

        resolve({
          success: true,
          scrollEnd: atBottom
        });
      }, 100);
    });
  }

  /**
   * Wait for page readiness
   * - Wait for images to load
   * - Wait for DOM stability (300ms quiet period, ignoring text-only changes)
   * @param {number} timeout - Maximum wait time in ms
   * @returns {Promise<{ready: boolean, reason?: string}>}
   */
  async function waitForReadiness(timeout = 10000) {
    const startTime = Date.now();

    // Wait for document ready state
    if (document.readyState !== 'complete') {
      await new Promise(resolve => {
        if (document.readyState === 'complete') {
          resolve();
        } else {
          window.addEventListener('load', resolve, { once: true });
        }
      });
    }

    // Wait for images in viewport to load
    await waitForImages();

    // Wait for DOM stability
    const stable = await waitForDOMStability(300, timeout - (Date.now() - startTime));

    return { ready: true, reason: stable ? 'stable' : 'timeout' };
  }

  /**
   * Wait for all images in viewport to be loaded
   */
  async function waitForImages() {
    const images = document.querySelectorAll('img');
    const visibleImages = Array.from(images).filter(img => {
      const rect = img.getBoundingClientRect();
      return rect.top < window.innerHeight && rect.bottom > 0;
    });

    const loadPromises = visibleImages.map(img => {
      if (img.complete) return Promise.resolve();
      return new Promise(resolve => {
        img.addEventListener('load', resolve, { once: true });
        img.addEventListener('error', resolve, { once: true });
        // Timeout for images that never load
        setTimeout(resolve, 5000);
      });
    });

    await Promise.all(loadPromises);
  }

  /**
   * Wait for DOM to be stable (no structural changes for specified duration)
   * Filters out text-only mutations to avoid false triggers from clocks/cursors
   */
  function waitForDOMStability(quietPeriod = 300, maxWait = 5000) {
    return new Promise(resolve => {
      let lastMutationTime = Date.now();
      let resolved = false;

      const observer = new MutationObserver(mutations => {
        // Filter out text-only mutations
        const hasStructuralChange = mutations.some(m => {
          // Node additions/removals are structural
          if (m.addedNodes.length > 0 || m.removedNodes.length > 0) {
            // But ignore if only text nodes
            const addedElements = Array.from(m.addedNodes).filter(n => n.nodeType === Node.ELEMENT_NODE);
            const removedElements = Array.from(m.removedNodes).filter(n => n.nodeType === Node.ELEMENT_NODE);
            return addedElements.length > 0 || removedElements.length > 0;
          }
          // Attribute changes on elements are structural
          if (m.type === 'attributes') {
            return true;
          }
          // characterData changes (text content) are not structural
          return false;
        });

        if (hasStructuralChange) {
          lastMutationTime = Date.now();
        }
      });

      observer.observe(document.body, {
        childList: true,
        subtree: true,
        attributes: true,
        characterData: true
      });

      // Check periodically for stability
      const checkInterval = setInterval(() => {
        if (resolved) return;

        const elapsed = Date.now() - lastMutationTime;
        if (elapsed >= quietPeriod) {
          resolved = true;
          clearInterval(checkInterval);
          observer.disconnect();
          resolve(true);
        }
      }, 50);

      // Timeout fallback
      setTimeout(() => {
        if (!resolved) {
          resolved = true;
          clearInterval(checkInterval);
          observer.disconnect();
          resolve(false);
        }
      }, maxWait);
    });
  }

  /**
   * Check if a selector exists in the DOM
   * Standard DOM only - no Shadow DOM traversal
   */
  function selectorExists(selector) {
    if (!selector) return false;
    return document.querySelector(selector) !== null;
  }

  /**
   * Poll for a selector to appear
   * @param {string} selector
   * @param {number} timeout - Max wait time in ms
   * @returns {Promise<boolean>}
   */
  async function waitForSelector(selector, timeout = 10000) {
    if (!selector) return true;

    const startTime = Date.now();
    while (Date.now() - startTime < timeout) {
      if (selectorExists(selector)) {
        return true;
      }
      await new Promise(r => setTimeout(r, 100));
    }
    return false;
  }

  /**
   * Get page info for logging
   */
  function getPageInfo() {
    return {
      url: window.location.href,
      title: document.title,
      scrollY: window.scrollY,
      scrollHeight: document.documentElement.scrollHeight,
      clientHeight: window.innerHeight
    };
  }

  // Message handler
  chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    (async () => {
      switch (message.action) {
        case 'advancePage':
          const advanceResult = await advancePage(message.mode, message.config);
          sendResponse(advanceResult);
          break;

        case 'waitForReadiness':
          const readinessResult = await waitForReadiness(message.timeout);
          sendResponse(readinessResult);
          break;

        case 'waitForSelector':
          const found = await waitForSelector(message.selector, message.timeout);
          sendResponse({ found });
          break;

        case 'checkSelector':
          sendResponse({ exists: selectorExists(message.selector) });
          break;

        case 'getPageInfo':
          sendResponse(getPageInfo());
          break;

        case 'ping':
          sendResponse({ pong: true });
          break;

        default:
          sendResponse({ error: `Unknown action: ${message.action}` });
      }
    })();
    return true; // Keep channel open for async response
  });

  // Notify that content script is ready
  console.log('[Auto Page Capture] Content script injected and ready');
})();
