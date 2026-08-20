import { closeSync, lstatSync, openSync, readSync, realpathSync } from "node:fs";
import { isAbsolute, join, resolve, sep } from "node:path";
import type { MediaAsset } from "./types.ts";

/** Enough bytes to reach the header fields the formats below declare their size in. */
const HEADER_BYTES = 32;

export interface AssetMeasurement {
  sizeBytes: number;
  dimensions?: { width: number; height: number } | undefined;
}

/**
 * Resolves an asset url to a regular file inside the capsule, or nothing. Only paths that stay
 * under the run root are opened: an asset url is a string a command printed, and following it out
 * of the capsule would let a log decide what this exporter reads.
 */
function capsuleFile(runRoot: string, url: string): string | undefined {
  if (url.includes("://")) return undefined;
  try {
    const root = realpathSync(runRoot);
    const inside = (path: string): boolean => path === root || path.startsWith(root + sep);
    const candidate = isAbsolute(url) ? resolve(url) : resolve(join(root, url));
    if (!inside(candidate)) return undefined;
    const stat = lstatSync(candidate);
    if (!stat.isFile() || stat.isSymbolicLink()) return undefined;
    // A directory on the way in can itself be a link out, so the containment question is asked
    // again of the path the filesystem actually resolves to.
    if (!inside(realpathSync(candidate))) return undefined;
    return candidate;
  } catch {
    return undefined;
  }
}

function readHeader(path: string): { header: Buffer; size: number } | undefined {
  let fd: number | undefined;
  try {
    fd = openSync(path, "r");
    const buffer = Buffer.alloc(HEADER_BYTES);
    const read = readSync(fd, buffer, 0, HEADER_BYTES, 0);
    return { header: buffer.subarray(0, read), size: lstatSync(path).size };
  } catch {
    return undefined;
  } finally {
    if (fd !== undefined) {
      try {
        closeSync(fd);
      } catch {
        // The header already read stands regardless of how the handle closes.
      }
    }
  }
}

/**
 * Pixel dimensions read out of the file's own header. Only formats that state their size in a
 * fixed-offset header are decoded; anything else leaves the dimensions absent, because a plausible
 * default here would be indistinguishable from a measurement.
 */
function dimensionsOf(header: Buffer): { width: number; height: number } | undefined {
  // PNG: an 8-byte signature, then an IHDR chunk whose width and height are big-endian at 16..24.
  if (
    header.length >= 24 &&
    header[0] === 0x89 &&
    header.subarray(1, 4).toString("latin1") === "PNG" &&
    header.subarray(12, 16).toString("latin1") === "IHDR"
  ) {
    return { width: header.readUInt32BE(16), height: header.readUInt32BE(20) };
  }
  // GIF: "GIF87a"/"GIF89a", then little-endian width and height at 6..10.
  if (header.length >= 10 && header.subarray(0, 3).toString("latin1") === "GIF") {
    return { width: header.readUInt16LE(6), height: header.readUInt16LE(8) };
  }
  // BMP: "BM", then a DIB header carrying signed little-endian width and height at 18..26.
  if (header.length >= 26 && header[0] === 0x42 && header[1] === 0x4d) {
    return { width: Math.abs(header.readInt32LE(18)), height: Math.abs(header.readInt32LE(22)) };
  }
  return undefined;
}

/** What the file itself says about its size. Nothing is returned for a file that is not there. */
export function measureCapsuleAsset(
  runRoot: string | undefined,
  url: string,
): AssetMeasurement | undefined {
  if (runRoot === undefined || url.length === 0) return undefined;
  const path = capsuleFile(runRoot, url);
  if (path === undefined) return undefined;
  const read = readHeader(path);
  if (read === undefined) return undefined;
  const dimensions = dimensionsOf(read.header);
  return { sizeBytes: read.size, ...(dimensions !== undefined ? { dimensions } : {}) };
}

/**
 * Fills in the byte size and dimensions of assets whose files the capsule still holds. A value a
 * source already reported is left alone: this measures what nobody measured, it does not overwrite
 * what somebody recorded.
 */
export function measureAssets(assets: MediaAsset[], runRoot: string | undefined): MediaAsset[] {
  if (runRoot === undefined) return assets;
  for (const asset of assets) {
    if (asset.sizeBytes !== undefined && asset.dimensions !== undefined) continue;
    const measured = measureCapsuleAsset(runRoot, asset.url);
    if (measured === undefined) continue;
    if (asset.sizeBytes === undefined) asset.sizeBytes = measured.sizeBytes;
    if (asset.dimensions === undefined && measured.dimensions !== undefined) {
      asset.dimensions = measured.dimensions;
    }
  }
  return assets;
}
