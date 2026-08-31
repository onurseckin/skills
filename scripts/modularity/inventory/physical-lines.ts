import { classifyPath, type Violation } from "../core/index.ts";
import type { IndexedBlob } from "./git-index.ts";

const LINE_LIMIT = 300;

export function countPhysicalLines(bytes: Uint8Array): number {
  if (bytes.length === 0) return 0;
  const lastByte = bytes[bytes.length - 1];
  let lines = 1;
  if (lastByte === 10) {
    lines = 0;
  }
  for (const byte of bytes) {
    if (byte === 10) lines += 1;
  }
  return lines;
}

export function findLineViolations(blobs: readonly IndexedBlob[]): readonly Violation[] {
  return blobs.flatMap((blob) => {
    if (!classifyPath(blob.path).lineLimited) return [];
    const observed = countPhysicalLines(blob.bytes);
    if (observed > LINE_LIMIT) {
      return [
        {
          rule: "line_limit" as const,
          path: blob.path,
          observed,
          limit: LINE_LIMIT,
          detail: "File exceeds the 300 physical-line limit.",
        },
      ];
    }
    return [];
  });
}
