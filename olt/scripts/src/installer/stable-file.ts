import {
  closeSync,
  constants,
  fstatSync,
  lstatSync,
  openSync,
  readSync,
  type BigIntStats,
} from "node:fs";
import { HarnessError } from "../core/errors/index.ts";

function identity(stat: BigIntStats): string {
  return [stat.dev, stat.ino, stat.mode, stat.size, stat.mtimeNs, stat.ctimeNs].join(":");
}

export function readStableBytes(path: string, maximum = 1024 * 1024): Uint8Array {
  const before = lstatSync(path, { bigint: true });
  if (!before.isFile() || before.isSymbolicLink() || before.size > BigInt(maximum))
    throw new HarnessError("INTEGRITY", `source identity file is unsafe or oversized: ${path}`);
  const descriptor = openSync(path, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0));
  try {
    const opened = fstatSync(descriptor, { bigint: true });
    if (identity(before) !== identity(opened))
      throw new HarnessError("INTEGRITY", `source identity file changed while opening: ${path}`);
    const chunks: Buffer[] = [];
    let total = 0;
    while (true) {
      const buffer = Buffer.allocUnsafe(Math.min(64 * 1024, maximum + 1 - total));
      const count = readSync(descriptor, buffer, 0, buffer.length, null);
      if (count === 0) break;
      chunks.push(buffer.subarray(0, count));
      total += count;
      if (total > maximum)
        throw new HarnessError("INTEGRITY", `source identity file exceeds limit: ${path}`);
    }
    const after = fstatSync(descriptor, { bigint: true });
    if (
      identity(opened) !== identity(after) ||
      identity(after) !== identity(lstatSync(path, { bigint: true }))
    )
      throw new HarnessError("INTEGRITY", `source identity file changed while reading: ${path}`);
    return Buffer.concat(chunks, total);
  } finally {
    closeSync(descriptor);
  }
}

export function readStableText(path: string): string {
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(readStableBytes(path));
  } catch (error) {
    if (error instanceof HarnessError) throw error;
    throw new HarnessError("INTEGRITY", `source identity file is not UTF-8: ${path}`);
  }
}
