/**
 * Time utilities for formatting and calculations
 */

/**
 * Format milliseconds as human-readable time string
 * @param {number} ms - Milliseconds
 * @returns {string} Formatted time (e.g., "1:23:45" or "2:30")
 */
export function formatDuration(ms) {
  const seconds = Math.floor(ms / 1000);
  const minutes = Math.floor(seconds / 60);
  const hours = Math.floor(minutes / 60);

  const s = seconds % 60;
  const m = minutes % 60;

  if (hours > 0) {
    return `${hours}:${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`;
  }
  return `${m}:${s.toString().padStart(2, '0')}`;
}

/**
 * Format seconds with one decimal place
 * @param {number} seconds
 * @returns {string}
 */
export function formatSeconds(seconds) {
  return seconds.toFixed(1) + 's';
}

/**
 * Get current date formatted as YYYYMMDD
 */
export function getDateString() {
  const now = new Date();
  const year = now.getFullYear();
  const month = (now.getMonth() + 1).toString().padStart(2, '0');
  const day = now.getDate().toString().padStart(2, '0');
  return `${year}${month}${day}`;
}

/**
 * Get current time formatted as HHMMSS
 */
export function getTimeString() {
  const now = new Date();
  const hours = now.getHours().toString().padStart(2, '0');
  const minutes = now.getMinutes().toString().padStart(2, '0');
  const seconds = now.getSeconds().toString().padStart(2, '0');
  return `${hours}${minutes}${seconds}`;
}

/**
 * Rolling average calculator
 * Keeps track of the last N values and computes their average
 */
export class RollingAverage {
  constructor(windowSize = 10) {
    this.windowSize = windowSize;
    this.values = [];
  }

  /**
   * Add a value and return the new average
   * @param {number} value
   * @returns {number} Current rolling average
   */
  add(value) {
    this.values.push(value);
    if (this.values.length > this.windowSize) {
      this.values.shift();
    }
    return this.average();
  }

  /**
   * Get the current average
   * @returns {number}
   */
  average() {
    if (this.values.length === 0) return 0;
    const sum = this.values.reduce((a, b) => a + b, 0);
    return sum / this.values.length;
  }

  /**
   * Reset the calculator
   */
  reset() {
    this.values = [];
  }

  /**
   * Get the count of values
   */
  count() {
    return this.values.length;
  }
}

/**
 * Generate a unique session ID
 */
export function generateSessionId() {
  return `session_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
}

/**
 * Apply filename template with variables
 * @param {string} template - Template string with {variables}
 * @param {object} vars - Variables to substitute
 * @returns {string} Processed filename
 */
export function applyFilenameTemplate(template, vars) {
  let filename = template;

  for (const [key, value] of Object.entries(vars)) {
    filename = filename.replace(new RegExp(`\\{${key}\\}`, 'g'), value);
  }

  // Sanitize filename - remove invalid characters
  filename = filename.replace(/[<>:"/\\|?*]/g, '_');

  // Ensure .pdf extension
  if (!filename.toLowerCase().endsWith('.pdf')) {
    filename += '.pdf';
  }

  return filename;
}
