import {
  closeSync,
  existsSync,
  fstatSync,
  fsyncSync,
  ftruncateSync,
  mkdirSync,
  openSync,
  readdirSync,
  readFileSync,
  renameSync,
  statSync,
  writeSync,
} from "node:fs";
import { dirname } from "node:path";
import {
  daemonOutSpoolPath,
  isEnvelope,
  spoolLockPath,
  withLock,
  type Envelope,
} from "../core/index.ts";

export interface SpoolAppendResult {
  readonly spoolOffset: number;
  readonly bytesWritten: number;
  readonly spoolPath: string;
  readonly rotated: boolean;
}

export interface SpoolRepairResult {
  readonly repaired: boolean;
  readonly truncatedBytes: number;
  readonly highestSeq: number;
}

export interface SpoolStats {
  readonly bytes: number;
  readonly lines: number;
}

export interface SpoolOptions {
  readonly segmentMaxBytes?: number;
  readonly maxSpoolBytes?: number;
  readonly maxSpoolLines?: number;
}

const DEFAULT_SEGMENT_MAX_BYTES = 8388608;
const DEFAULT_MAX_SPOOL_BYTES = 33554432;
const DEFAULT_MAX_SPOOL_LINES = 20000;

function findNextSegmentNumber(roomId: string, readerId: string): number {
  const basePath = daemonOutSpoolPath(roomId, readerId);
  const dir = dirname(basePath);
  if (!existsSync(dir)) {
    return 1;
  }
  const prefix = `${readerId}.out.`;
  const suffix = ".jsonl";
  const files = readdirSync(dir);
  let maxSegment = 0;
  for (const file of files) {
    if (file.startsWith(prefix) && file.endsWith(suffix)) {
      const middle = file.slice(prefix.length, file.length - suffix.length);
      const parsed = Number.parseInt(middle, 10);
      if (Number.isInteger(parsed) && parsed > maxSegment) {
        maxSegment = parsed;
      }
    }
  }
  return maxSegment + 1;
}

export function rotateSpoolIfNeeded(
  roomId: string,
  readerId: string,
  segmentMaxBytes: number = DEFAULT_SEGMENT_MAX_BYTES,
): boolean {
  const currentPath = daemonOutSpoolPath(roomId, readerId);
  if (!existsSync(currentPath)) {
    return false;
  }
  try {
    const stats = statSync(currentPath);
    if (stats.size >= segmentMaxBytes) {
      const nextNum = findNextSegmentNumber(roomId, readerId);
      const rotatedPath = daemonOutSpoolPath(roomId, readerId, nextNum);
      renameSync(currentPath, rotatedPath);
      return true;
    }
  } catch {}
  return false;
}

export function appendSpool(
  roomId: string,
  readerId: string,
  envelopes: readonly (Envelope | Record<string, unknown>)[],
  options: SpoolOptions = {},
): SpoolAppendResult {
  const lock = spoolLockPath(roomId, readerId);
  const segmentMax = options.segmentMaxBytes ?? DEFAULT_SEGMENT_MAX_BYTES;

  return withLock(lock, () => {
    rotateSpoolIfNeeded(roomId, readerId, segmentMax);
    const targetPath = daemonOutSpoolPath(roomId, readerId);
    const dir = dirname(targetPath);
    mkdirSync(dir, { recursive: true });

    let linesContent = "";
    for (const envelope of envelopes) {
      linesContent += JSON.stringify(envelope) + "\n";
    }

    const buffer = Buffer.from(linesContent, "utf8");
    const fd = openSync(targetPath, "a+", 0o644);
    let offset = 0;
    let bytesWritten = 0;

    try {
      const stats = fstatSync(fd);
      offset = stats.size;
      bytesWritten = writeSync(fd, buffer, 0, buffer.byteLength);
      fsyncSync(fd);
    } finally {
      closeSync(fd);
    }

    const didRotate = rotateSpoolIfNeeded(roomId, readerId, segmentMax);

    return {
      spoolOffset: offset,
      bytesWritten,
      spoolPath: targetPath,
      rotated: didRotate,
    };
  });
}

export function repairSpool(roomId: string, readerId: string): SpoolRepairResult {
  const lock = spoolLockPath(roomId, readerId);

  return withLock(lock, () => {
    const targetPath = daemonOutSpoolPath(roomId, readerId);
    if (!existsSync(targetPath)) {
      return {
        repaired: false,
        truncatedBytes: 0,
        highestSeq: 0,
      };
    }

    const buffer = readFileSync(targetPath);
    const totalBytes = buffer.byteLength;
    if (totalBytes === 0) {
      return {
        repaired: false,
        truncatedBytes: 0,
        highestSeq: 0,
      };
    }

    let validByteOffset = 0;
    let currentLineStart = 0;
    let highestSeq = 0;
    let needsTruncation = false;

    for (let i = 0; i < totalBytes; i++) {
      if (buffer[i] === 0x0a) {
        const lineBuffer = buffer.subarray(currentLineStart, i);
        const lineStr = lineBuffer.toString("utf8").trim();
        if (lineStr.length > 0) {
          try {
            const parsed: unknown = JSON.parse(lineStr);
            if (isEnvelope(parsed)) {
              if (parsed.seq > highestSeq) {
                highestSeq = parsed.seq;
              }
              validByteOffset = i + 1;
            } else {
              needsTruncation = true;
              break;
            }
          } catch {
            needsTruncation = true;
            break;
          }
        } else {
          validByteOffset = i + 1;
        }
        currentLineStart = i + 1;
      }
    }

    if (currentLineStart < totalBytes) {
      needsTruncation = true;
    }

    if (needsTruncation && validByteOffset < totalBytes) {
      const truncatedBytes = totalBytes - validByteOffset;
      const fd = openSync(targetPath, "r+", 0o644);
      try {
        ftruncateSync(fd, validByteOffset);
        fsyncSync(fd);
      } finally {
        closeSync(fd);
      }
      return {
        repaired: true,
        truncatedBytes,
        highestSeq,
      };
    }

    return {
      repaired: false,
      truncatedBytes: 0,
      highestSeq,
    };
  });
}

export function getSpoolStats(roomId: string, readerId: string): SpoolStats {
  const currentPath = daemonOutSpoolPath(roomId, readerId);
  if (!existsSync(currentPath)) {
    return { bytes: 0, lines: 0 };
  }

  try {
    const content = readFileSync(currentPath, "utf8");
    let lineCount = 0;
    for (let i = 0; i < content.length; i++) {
      if (content.charCodeAt(i) === 10) {
        lineCount++;
      }
    }
    return {
      bytes: Buffer.byteLength(content, "utf8"),
      lines: lineCount,
    };
  } catch {
    return { bytes: 0, lines: 0 };
  }
}

export function isSpoolBackpressured(
  stats: SpoolStats,
  options: SpoolOptions = {},
  currentlyBackpressured: boolean = false,
): boolean {
  const maxBytes = options.maxSpoolBytes ?? DEFAULT_MAX_SPOOL_BYTES;
  const maxLines = options.maxSpoolLines ?? DEFAULT_MAX_SPOOL_LINES;

  if (currentlyBackpressured) {
    const lowWaterBytes = maxBytes * 0.5;
    const lowWaterLines = maxLines * 0.5;
    return stats.bytes >= lowWaterBytes || stats.lines >= lowWaterLines;
  }

  return stats.bytes >= maxBytes || stats.lines >= maxLines;
}
