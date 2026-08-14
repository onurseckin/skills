import { closeSync, constants, fstatSync, openSync, readSync } from "node:fs";

export interface EventLine {
  index: number;
  content: Uint8Array;
  terminated: boolean;
  oversized: boolean;
  endOffset: number;
}

export function* streamEventLines(
  path: string,
  maximum: number,
  maximumTotal: number,
): Generator<EventLine> {
  const descriptor = openSync(path, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0));
  try {
    const metadata = fstatSync(descriptor);
    if (!metadata.isFile()) throw new Error("events.jsonl is not a regular file");
    if (metadata.size > maximumTotal)
      throw new Error(`event log size exceeds limit ${maximumTotal} bytes`);
    const buffer = Buffer.allocUnsafe(64 * 1024);
    let chunks: Buffer[] = [];
    let stored = 0;
    let oversized = false;
    let index = 0;
    let fileOffset = 0;
    while (true) {
      const count = readSync(descriptor, buffer, 0, buffer.length, null);
      if (count === 0) break;
      const blockStart = fileOffset;
      fileOffset += count;
      let offset = 0;
      while (offset < count) {
        const newline = buffer.indexOf(10, offset);
        const end = newline < 0 || newline >= count ? count : newline;
        const piece = buffer.subarray(offset, end);
        const available = maximum - stored;
        if (piece.length > available) {
          if (available > 0) chunks.push(Buffer.from(piece.subarray(0, available)));
          stored += Math.max(available, 0);
          oversized = true;
        } else {
          chunks.push(Buffer.from(piece));
          stored += piece.length;
        }
        if (newline >= 0 && newline < count) {
          index += 1;
          yield {
            index,
            content: Buffer.concat(chunks, stored),
            terminated: true,
            oversized,
            endOffset: blockStart + newline + 1,
          };
          chunks = [];
          stored = 0;
          oversized = false;
          offset = newline + 1;
        } else offset = count;
      }
    }
    if (stored > 0 || oversized)
      yield {
        index: index + 1,
        content: Buffer.concat(chunks, stored),
        terminated: false,
        oversized,
        endOffset: fileOffset,
      };
  } finally {
    closeSync(descriptor);
  }
}
