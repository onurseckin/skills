import { closeSync, lstatSync, openSync, readSync, realpathSync } from "node:fs";
import { isAbsolute, join, resolve, sep } from "node:path";
import type { MediaAsset } from "../graph/index.ts";

const HEADER_BYTES = 32;

export interface AssetMeasurement {
  sizeBytes: number;
  dimensions?: { width: number; height: number } | undefined;
}

function capsuleFile(runRoot: string, url: string): string | undefined {
  if (url.includes("://")) return undefined;
  try {
    const root = realpathSync(runRoot);
    const inside = (path: string): boolean => path === root || path.startsWith(root + sep);
    const candidate = isAbsolute(url) ? resolve(url) : resolve(join(root, url));
    if (!inside(candidate)) return undefined;
    const stat = lstatSync(candidate);
    if (!stat.isFile() || stat.isSymbolicLink()) return undefined;
    if (!inside(realpathSync(candidate))) return undefined;
    return candidate;
  } catch {
    return undefined;
  }
}

export function readHeader(path: string): { header: Buffer; size: number } | undefined {
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
      } catch {}
    }
  }
}

function dimensionsOf(header: Buffer): { width: number; height: number } | undefined {
  if (
    header.length >= 24 &&
    header[0] === 0x89 &&
    header.subarray(1, 4).toString("latin1") === "PNG" &&
    header.subarray(12, 16).toString("latin1") === "IHDR"
  ) {
    return { width: header.readUInt32BE(16), height: header.readUInt32BE(20) };
  }
  if (header.length >= 10 && header.subarray(0, 3).toString("latin1") === "GIF") {
    return { width: header.readUInt16LE(6), height: header.readUInt16LE(8) };
  }
  if (header.length >= 26 && header[0] === 0x42 && header[1] === 0x4d) {
    return { width: Math.abs(header.readInt32LE(18)), height: Math.abs(header.readInt32LE(22)) };
  }
  return undefined;
}

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
