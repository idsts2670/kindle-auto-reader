/**
 * Hash utilities for duplicate detection using dHash (difference hash)
 */

/**
 * Compute dHash (difference hash) of an image
 * Downscales to 9x8 grayscale and computes 64-bit hash based on horizontal gradients
 *
 * @param {ImageData} imageData - Image data to hash
 * @returns {BigInt} 64-bit hash value
 */
export function computeDHash(imageData) {
  // Downscale to 9x8 grayscale
  const scaled = downscaleToGrayscale(imageData, 9, 8);

  // Compute hash based on horizontal differences
  let hash = 0n;
  let bit = 0n;

  for (let y = 0; y < 8; y++) {
    for (let x = 0; x < 8; x++) {
      const left = scaled[y * 9 + x];
      const right = scaled[y * 9 + x + 1];

      if (left > right) {
        hash |= (1n << bit);
      }
      bit++;
    }
  }

  return hash;
}

/**
 * Downscale image data to grayscale at specified dimensions
 * @param {ImageData} imageData - Source image data
 * @param {number} width - Target width
 * @param {number} height - Target height
 * @returns {Uint8Array} Grayscale pixel values
 */
function downscaleToGrayscale(imageData, width, height) {
  const srcWidth = imageData.width;
  const srcHeight = imageData.height;
  const srcData = imageData.data;

  const result = new Uint8Array(width * height);

  const scaleX = srcWidth / width;
  const scaleY = srcHeight / height;

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      // Sample from the center of each target pixel's region
      const srcX = Math.floor((x + 0.5) * scaleX);
      const srcY = Math.floor((y + 0.5) * scaleY);

      const srcIdx = (srcY * srcWidth + srcX) * 4;

      // Convert to grayscale using luminance formula
      const r = srcData[srcIdx];
      const g = srcData[srcIdx + 1];
      const b = srcData[srcIdx + 2];
      const gray = Math.round(0.299 * r + 0.587 * g + 0.114 * b);

      result[y * width + x] = gray;
    }
  }

  return result;
}

/**
 * Compute Hamming distance between two hashes
 * @param {BigInt} hash1
 * @param {BigInt} hash2
 * @returns {number} Number of differing bits
 */
export function hammingDistance(hash1, hash2) {
  let xor = hash1 ^ hash2;
  let distance = 0;

  while (xor > 0n) {
    distance += Number(xor & 1n);
    xor >>= 1n;
  }

  return distance;
}

/**
 * Check if two hashes represent duplicate images
 * @param {BigInt} hash1
 * @param {BigInt} hash2
 * @param {number} threshold - Maximum Hamming distance to consider duplicate (default: 5)
 * @returns {boolean}
 */
export function isDuplicate(hash1, hash2, threshold = 5) {
  return hammingDistance(hash1, hash2) <= threshold;
}

/**
 * Convert hash to hex string for storage/logging
 * @param {BigInt} hash
 * @returns {string}
 */
export function hashToHex(hash) {
  return hash.toString(16).padStart(16, '0');
}

/**
 * Convert hex string back to hash
 * @param {string} hex
 * @returns {BigInt}
 */
export function hexToHash(hex) {
  return BigInt('0x' + hex);
}
