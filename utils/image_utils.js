/**
 * Image utilities for capture processing
 * Handles downscaling, compression, entropy calculation, and format conversion
 */

import { computeDHash, hashToHex, hammingDistance } from './hash_utils.js';

/**
 * Process a captured image: downscale based on quality, convert to JPEG
 * @param {string} dataUrl - Base64 data URL from captureVisibleTab
 * @param {number} quality - Quality factor 0.5-1.0 (affects both resolution and compression)
 * @returns {Promise<{blob: Blob, hash: string, width: number, height: number}>}
 */
export async function processCapture(dataUrl, quality) {
  // Load image
  const img = await loadImage(dataUrl);

  // Calculate scale factor based on quality
  // quality 1.0 = 100% resolution, quality 0.5 = 70.7% resolution (sqrt)
  const scaleFactor = Math.sqrt(quality);

  const targetWidth = Math.round(img.width * scaleFactor);
  const targetHeight = Math.round(img.height * scaleFactor);

  // Create offscreen canvas for processing
  const canvas = new OffscreenCanvas(targetWidth, targetHeight);
  const ctx = canvas.getContext('2d');

  // Draw scaled image
  ctx.drawImage(img, 0, 0, targetWidth, targetHeight);

  // Get image data for hashing
  const imageData = ctx.getImageData(0, 0, targetWidth, targetHeight);
  const hash = hashToHex(computeDHash(imageData));

  // Convert to JPEG blob
  const blob = await canvas.convertToBlob({
    type: 'image/jpeg',
    quality: quality
  });

  return {
    blob,
    hash,
    width: targetWidth,
    height: targetHeight
  };
}

/**
 * Load an image from a data URL
 * @param {string} dataUrl
 * @returns {Promise<ImageBitmap>}
 */
async function loadImage(dataUrl) {
  const response = await fetch(dataUrl);
  const blob = await response.blob();
  return createImageBitmap(blob);
}

/**
 * Calculate image entropy to detect blank/uniform captures
 * Higher entropy = more information/complexity
 * Lower entropy = more uniform/blank
 *
 * @param {string} dataUrl - Base64 data URL
 * @returns {Promise<number>} Entropy value (0-8, higher = more complex)
 */
export async function calculateEntropy(dataUrl) {
  const img = await loadImage(dataUrl);

  // Sample at a smaller size for performance
  const sampleSize = 100;
  const canvas = new OffscreenCanvas(sampleSize, sampleSize);
  const ctx = canvas.getContext('2d');

  ctx.drawImage(img, 0, 0, sampleSize, sampleSize);
  const imageData = ctx.getImageData(0, 0, sampleSize, sampleSize);

  // Build histogram of grayscale values
  const histogram = new Array(256).fill(0);
  const data = imageData.data;
  const pixelCount = sampleSize * sampleSize;

  for (let i = 0; i < data.length; i += 4) {
    const gray = Math.round(0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2]);
    histogram[gray]++;
  }

  // Calculate Shannon entropy
  let entropy = 0;
  for (let i = 0; i < 256; i++) {
    if (histogram[i] > 0) {
      const p = histogram[i] / pixelCount;
      entropy -= p * Math.log2(p);
    }
  }

  return entropy;
}

/**
 * Check if an image is blank based on entropy
 * @param {string} dataUrl
 * @param {number} threshold - Entropy threshold (default: 1.0)
 * @returns {Promise<boolean>} True if image appears blank
 */
export async function isBlankImage(dataUrl, threshold = 1.0) {
  const entropy = await calculateEntropy(dataUrl);
  return entropy < threshold;
}

/**
 * Compare two captures to check if they match (for double-capture verification)
 * @param {string} dataUrl1
 * @param {string} dataUrl2
 * @returns {Promise<boolean>} True if captures match
 */
export async function capturesMatch(dataUrl1, dataUrl2) {
  const [img1, img2] = await Promise.all([
    loadImage(dataUrl1),
    loadImage(dataUrl2)
  ]);

  // Quick dimension check
  if (img1.width !== img2.width || img1.height !== img2.height) {
    return false;
  }

  // Sample and compare hashes
  const sampleSize = 64;
  const canvas1 = new OffscreenCanvas(sampleSize, sampleSize);
  const canvas2 = new OffscreenCanvas(sampleSize, sampleSize);

  const ctx1 = canvas1.getContext('2d');
  const ctx2 = canvas2.getContext('2d');

  ctx1.drawImage(img1, 0, 0, sampleSize, sampleSize);
  ctx2.drawImage(img2, 0, 0, sampleSize, sampleSize);

  const data1 = ctx1.getImageData(0, 0, sampleSize, sampleSize);
  const data2 = ctx2.getImageData(0, 0, sampleSize, sampleSize);

  const hash1 = computeDHash(data1);
  const hash2 = computeDHash(data2);

  // Use a very strict threshold for same-frame verification
  return hammingDistance(hash1, hash2) <= 2;
}

/**
 * Convert blob to array buffer (for PDF embedding)
 * @param {Blob} blob
 * @returns {Promise<ArrayBuffer>}
 */
export async function blobToArrayBuffer(blob) {
  return blob.arrayBuffer();
}

/**
 * Get image dimensions from a blob
 * @param {Blob} blob
 * @returns {Promise<{width: number, height: number}>}
 */
export async function getImageDimensions(blob) {
  const bitmap = await createImageBitmap(blob);
  return {
    width: bitmap.width,
    height: bitmap.height
  };
}
