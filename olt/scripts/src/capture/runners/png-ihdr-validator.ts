/**
 * Rigorous binary PNG IHDR chunk validator and dimension extractor.
 * Verifies 8-byte PNG header, chunk length (13), chunk type ("IHDR"),
 * and uint32BE width/height at offsets 16 and 20.
 */

export const PNG_SIGNATURE = Object.freeze([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

const IHDR_CHUNK_TYPE = Object.freeze([0x49, 0x48, 0x44, 0x52]); // "IHDR"

export interface PngDimensions {
  readonly width: number;
  readonly height: number;
}

/**
 * Checks if the buffer starts with the canonical 8-byte PNG signature.
 */
export function isPngBuffer(buffer: Buffer | Uint8Array): boolean {
  if (!buffer || buffer.byteLength < 8) {
    return false;
  }
  for (let i = 0; i < 8; i++) {
    if (buffer[i] !== PNG_SIGNATURE[i]) {
      return false;
    }
  }
  return true;
}

/**
 * Extracts width and height from the PNG IHDR header.
 * Returns null if the buffer is not a valid PNG or has corrupted IHDR chunk.
 */
export function extractPngDimensions(buffer: Buffer | Uint8Array): PngDimensions | null {
  if (!isPngBuffer(buffer) || buffer.byteLength < 24) {
    return null;
  }

  const view = new DataView(buffer.buffer, buffer.byteOffset, buffer.byteLength);

  // Offset 8..11: IHDR data length (must be exactly 13 bytes for standard IHDR)
  const ihdrLength = view.getUint32(8, false);
  if (ihdrLength !== 13) {
    return null;
  }

  // Offset 12..15: Chunk type must be "IHDR"
  for (let i = 0; i < 4; i++) {
    if (buffer[12 + i] !== IHDR_CHUNK_TYPE[i]) {
      return null;
    }
  }

  // Offset 16..19: Width (uint32BE), Offset 20..23: Height (uint32BE)
  const width = view.getUint32(16, false);
  const height = view.getUint32(20, false);

  // PNG spec: width and height must be non-zero and <= 2^31 - 1
  if (width === 0 || height === 0 || width > 0x7fffffff || height > 0x7fffffff) {
    return null;
  }

  return { width, height };
}

/**
 * Validates that the buffer is a valid PNG matching the exact expected dimensions.
 * Rejects padded mock PNGs whose IHDR dimensions mismatch expected viewport bounds.
 */
export function validatePngBuffer(
  buffer: Buffer | Uint8Array,
  expectedWidth: number,
  expectedHeight: number,
): boolean {
  if (!Number.isFinite(expectedWidth) || !Number.isFinite(expectedHeight)) {
    return false;
  }
  if (expectedWidth <= 0 || expectedHeight <= 0) {
    return false;
  }

  const dimensions = extractPngDimensions(buffer);
  if (!dimensions) {
    return false;
  }

  return dimensions.width === expectedWidth && dimensions.height === expectedHeight;
}
