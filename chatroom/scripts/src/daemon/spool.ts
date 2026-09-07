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
  unlinkSync,
  writeFileSync,
  writeSync,
} from "node:fs";
import { dirname } from "node:path";
import {
  ChatError,
  daemonOutSpoolPath,
  isEnvelope,
  spoolLockPath,
  withLock,
  writeAtomic,
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

export interface SpoolPorts {
  readonly existsSync?: (path: string) => boolean;
  readonly readFileSync?: (path: string, encoding?: string) => string | Uint8Array;
  readonly writeFileSync?: (path: string, content: string | Uint8Array) => void;
  readonly appendFileSync?: (path: string, content: string | Uint8Array) => void;
  readonly statSync?: (path: string) => { readonly size: number };
  readonly withLock?: <T>(lockPath: string, fn: () => T) => T;
  readonly unlinkSync?: (path: string) => void;
  readonly renameSync?: (oldPath: string, newPath: string) => void;
  readonly writeAtomic?: (path: string, content: string | Uint8Array) => void;
}

export interface SpoolOptions {
  readonly segmentMaxBytes?: number;
  readonly maxSpoolBytes?: number;
  readonly maxSpoolLines?: number;
  readonly ports?: SpoolPorts;
}

const DEFAULT_SEGMENT_MAX_BYTES = 8388608;
const DEFAULT_MAX_SPOOL_BYTES = 33554432;
const DEFAULT_MAX_SPOOL_LINES = 20000;

function findNextSegmentNumber(roomId: string, readerId: string): number {
  const basePath = daemonOutSpoolPath(roomId, readerId);
  const dir = dirname(basePath);
  if (!existsSync(dir)) return 1;
  if (!statSync(dir).isDirectory()) {
    throw new ChatError("INVALID_STATE", `Expected directory at path '${dir}'`);
  }
  const prefix = `${readerId}.out.`;
  const suffix = ".jsonl";
  const files = readdirSync(dir);
  let maxSegment = 0;
  for (const file of files) {
    if (file.startsWith(prefix) && file.endsWith(suffix)) {
      const middle = file.slice(prefix.length, file.length - suffix.length);
      const parsed = Number.parseInt(middle, 10);
      if (Number.isInteger(parsed) && parsed > maxSegment) maxSegment = parsed;
    }
  }
  return maxSegment + 1;
}

export function rotateSpoolIfNeeded(
  roomId: string,
  readerId: string,
  segmentMaxBytes: number = DEFAULT_SEGMENT_MAX_BYTES,
  ports?: SpoolPorts,
): boolean {
  const currentPath = daemonOutSpoolPath(roomId, readerId);
  const existsFn = ports?.existsSync ?? existsSync;
  if (!existsFn(currentPath)) return false;
  try {
    const statFn = ports?.statSync ?? statSync;
    const stats = statFn(currentPath);
    if (stats.size >= segmentMaxBytes) {
      const nextNum = findNextSegmentNumber(roomId, readerId);
      const rotatedPath = daemonOutSpoolPath(roomId, readerId, nextNum);
      const renameFn = ports?.renameSync ?? renameSync;
      renameFn(currentPath, rotatedPath);
      const unlinkFn = ports?.unlinkSync ?? unlinkSync;
      const hwmPath = `${currentPath}.hwm`;
      if (existsFn(hwmPath)) {
        try {
          unlinkFn(hwmPath);
        } catch {}
      }
      return true;
    }
  } catch {}
  return false;
}

export function getSpoolHighestSeq(targetPath: string, ports?: SpoolPorts): number {
  const existsFn = ports?.existsSync ?? existsSync;
  if (!existsFn(targetPath)) return 0;
  const statFn = ports?.statSync ?? statSync;
  const spoolSize = statFn(targetPath).size;
  const readFn = ports?.readFileSync ?? readFileSync;
  const atomicWriteFn = ports?.writeAtomic ?? writeAtomic;
  const hwmPath = `${targetPath}.hwm`;
  if (existsFn(hwmPath)) {
    try {
      const raw = readFn(hwmPath, "utf8");
      const content = typeof raw === "string" ? raw : Buffer.from(raw).toString("utf8");
      const trimmed = content.trim();
      const sep = trimmed.indexOf(":");
      if (sep !== -1) {
        const seq = Number.parseInt(trimmed.slice(0, sep), 10);
        const recordedSize = Number.parseInt(trimmed.slice(sep + 1), 10);
        if (Number.isInteger(seq) && seq >= 0 && recordedSize === spoolSize) return seq;
      }
    } catch {}
  }
  try {
    const raw = readFn(targetPath, "utf8");
    const content = typeof raw === "string" ? raw : Buffer.from(raw).toString("utf8");
    let highest = 0;
    for (const line of content.split("\n")) {
      const trimmed = line.trim();
      if (!trimmed) continue;
      try {
        const parsed: unknown = JSON.parse(trimmed);
        if (isEnvelope(parsed) && parsed.seq > highest) highest = parsed.seq;
      } catch {}
    }
    try {
      atomicWriteFn(hwmPath, `${highest}:${spoolSize}`);
    } catch {}
    return highest;
  } catch {
    return 0;
  }
}

export function appendSpool(
  roomId: string,
  readerId: string,
  envelopes: readonly (Envelope | Record<string, unknown>)[],
  options: SpoolOptions = {},
): SpoolAppendResult {
  const lock = spoolLockPath(roomId, readerId);
  const segmentMax = options.segmentMaxBytes ?? DEFAULT_SEGMENT_MAX_BYTES;
  const lockFn = options.ports?.withLock ?? withLock;
  const existsFn = options.ports?.existsSync ?? existsSync;

  return lockFn(lock, () => {
    if (!options.ports) rotateSpoolIfNeeded(roomId, readerId, segmentMax);
    const targetPath = daemonOutSpoolPath(roomId, readerId);
    if (!options.ports) mkdirSync(dirname(targetPath), { recursive: true });

    const highestSeq = getSpoolHighestSeq(targetPath, options.ports);
    let runningHighest = highestSeq;
    const toAppend: (Envelope | Record<string, unknown>)[] = [];
    for (const envelope of envelopes) {
      const seq = "seq" in envelope && typeof envelope.seq === "number" ? envelope.seq : 0;
      if (seq > runningHighest) {
        toAppend.push(envelope);
        runningHighest = seq;
      }
    }

    const statFn = options.ports?.statSync ?? statSync;
    if (toAppend.length === 0) {
      const currentSize = existsFn(targetPath) ? statFn(targetPath).size : 0;
      return { spoolOffset: currentSize, bytesWritten: 0, spoolPath: targetPath, rotated: false };
    }

    const linesContent = toAppend.map((e) => JSON.stringify(e)).join("\n") + "\n";
    const buffer = Buffer.from(linesContent, "utf8");
    const atomicWriteFn = options.ports?.writeAtomic ?? writeAtomic;
    let offset = 0;
    let bytesWritten = 0;

    if (options.ports?.appendFileSync) {
      offset = existsFn(targetPath) ? statFn(targetPath).size : 0;
      options.ports.appendFileSync(targetPath, linesContent);
      bytesWritten = buffer.byteLength;
    } else if (options.ports?.writeFileSync) {
      const existing = existsFn(targetPath)
        ? ((options.ports.readFileSync?.(targetPath, "utf8") as string) ?? "")
        : "";
      offset = Buffer.byteLength(existing, "utf8");
      options.ports.writeFileSync(targetPath, existing + linesContent);
      bytesWritten = buffer.byteLength;
    } else {
      const fd = openSync(targetPath, "a+", 0o644);
      try {
        offset = fstatSync(fd).size;
        bytesWritten = writeSync(fd, buffer, 0, buffer.byteLength);
        fsyncSync(fd);
      } finally {
        closeSync(fd);
      }
    }

    const newSize = offset + bytesWritten;
    try {
      atomicWriteFn(`${targetPath}.hwm`, `${runningHighest}:${newSize}`);
    } catch {}

    const didRotate = !options.ports ? rotateSpoolIfNeeded(roomId, readerId, segmentMax) : false;

    return {
      spoolOffset: offset,
      bytesWritten,
      spoolPath: targetPath,
      rotated: didRotate,
    };
  });
}

export function repairSpool(
  roomId: string,
  readerId: string,
  options: SpoolOptions = {},
): SpoolRepairResult {
  const lock = spoolLockPath(roomId, readerId);
  const lockFn = options.ports?.withLock ?? withLock;
  const existsFn = options.ports?.existsSync ?? existsSync;

  return lockFn(lock, () => {
    const targetPath = daemonOutSpoolPath(roomId, readerId);
    if (!existsFn(targetPath)) return { repaired: false, truncatedBytes: 0, highestSeq: 0 };

    const raw = (options.ports?.readFileSync ?? readFileSync)(targetPath);
    const buffer = typeof raw === "string" ? Buffer.from(raw, "utf8") : Buffer.from(raw);
    const totalBytes = buffer.byteLength;
    if (totalBytes === 0) return { repaired: false, truncatedBytes: 0, highestSeq: 0 };

    let validByteOffset = 0;
    let currentLineStart = 0;
    let highestSeq = 0;
    let needsTruncation = false;
    const seenSeqs = new Set<number>();
    const uniqueEnvelopes: Envelope[] = [];
    let hasDuplicates = false;

    for (let i = 0; i < totalBytes; i++) {
      if (buffer[i] === 0x0a) {
        const lineBuffer = buffer.subarray(currentLineStart, i);
        const lineStr = lineBuffer.toString("utf8").trim();
        if (lineStr.length > 0) {
          try {
            const parsed: unknown = JSON.parse(lineStr);
            if (isEnvelope(parsed)) {
              if (seenSeqs.has(parsed.seq)) {
                hasDuplicates = true;
              } else {
                seenSeqs.add(parsed.seq);
                uniqueEnvelopes.push(parsed);
                if (parsed.seq > highestSeq) highestSeq = parsed.seq;
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

    if (currentLineStart < totalBytes) needsTruncation = true;

    if (hasDuplicates) {
      uniqueEnvelopes.sort((a, b) => a.seq - b.seq);
      const newLines =
        uniqueEnvelopes.map((e) => JSON.stringify(e)).join("\n") +
        (uniqueEnvelopes.length > 0 ? "\n" : "");
      const newBuf = Buffer.from(newLines, "utf8");
      if (options.ports?.writeFileSync) {
        options.ports.writeFileSync(targetPath, newLines);
      } else {
        const fd = openSync(targetPath, "w", 0o644);
        try {
          writeSync(fd, newBuf, 0, newBuf.byteLength);
          fsyncSync(fd);
        } finally {
          closeSync(fd);
        }
      }
      const maxSeq = uniqueEnvelopes.reduce((m, e) => Math.max(m, e.seq), 0);
      try {
        (options.ports?.writeAtomic ?? writeAtomic)(
          `${targetPath}.hwm`,
          `${maxSeq}:${newBuf.byteLength}`,
        );
      } catch {}
      return {
        repaired: true,
        truncatedBytes: Math.max(0, totalBytes - newBuf.byteLength),
        highestSeq: maxSeq,
      };
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
      try {
        (options.ports?.writeAtomic ?? writeAtomic)(
          `${targetPath}.hwm`,
          `${highestSeq}:${validByteOffset}`,
        );
      } catch {}
      return {
        repaired: true,
        truncatedBytes,
        highestSeq,
      };
    }

    return { repaired: false, truncatedBytes: 0, highestSeq };
  });
}

export function getSpoolStats(roomId: string, readerId: string): SpoolStats {
  const currentPath = daemonOutSpoolPath(roomId, readerId);
  if (!existsSync(currentPath)) return { bytes: 0, lines: 0 };
  try {
    const content = readFileSync(currentPath, "utf8");
    let lineCount = 0;
    for (let i = 0; i < content.length; i++) {
      if (content.charCodeAt(i) === 10) lineCount++;
    }
    return { bytes: Buffer.byteLength(content, "utf8"), lines: lineCount };
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
    return stats.bytes >= maxBytes * 0.5 || stats.lines >= maxLines * 0.5;
  }
  return stats.bytes >= maxBytes || stats.lines >= maxLines;
}
