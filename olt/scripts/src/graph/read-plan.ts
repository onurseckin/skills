import { constants, type BigIntStats } from "node:fs";
import { lstat, open, type FileHandle } from "node:fs/promises";
import { MAX_JSON_FILE_BYTES } from "../config/constants.ts";
import { parseJsonBytes } from "../core/json.ts";
import { HarnessError } from "../errors/harness-error.ts";
import { isRecord } from "../requirements/predicates.ts";

export interface ReadPlanOptions {
  maxBytes?: number;
  noFollowFlag?: number;
  lstat?: (path: string, options: { bigint: true }) => Promise<BigIntStats>;
  open?: (path: string, flags: number) => Promise<FileHandle>;
}

function identity(stats: BigIntStats): string {
  return [stats.dev, stats.ino, stats.mode, stats.size, stats.mtimeNs].join(":");
}

async function boundedRead(handle: FileHandle, size: number): Promise<Uint8Array> {
  const buffer = Buffer.alloc(size + 1);
  let offset = 0;
  while (offset < buffer.length) {
    const { bytesRead } = await handle.read(buffer, offset, buffer.length - offset, offset);
    if (bytesRead === 0) break;
    offset += bytesRead;
  }
  if (offset !== size) throw new Error("file size changed while it was read");
  return buffer.subarray(0, offset);
}

export async function readPlanObject(
  path: string,
  label: string,
  options: ReadPlanOptions = {},
): Promise<Record<string, unknown>> {
  const maxBytes = options.maxBytes ?? MAX_JSON_FILE_BYTES;
  const doLstat = options.lstat ?? lstat;
  const doOpen = options.open ?? open;
  let handle: FileHandle | undefined;
  try {
    if (!Number.isSafeInteger(maxBytes) || maxBytes < 1) throw new Error("invalid size bound");
    const before = await doLstat(path, { bigint: true });
    if (before.isSymbolicLink() || !before.isFile()) throw new Error("not a regular file");
    const noFollow = options.noFollowFlag ?? constants.O_NOFOLLOW ?? 0;
    handle = await doOpen(path, constants.O_RDONLY | noFollow);
    const openedBefore = await handle.stat({ bigint: true });
    if (!openedBefore.isFile() || identity(before) !== identity(openedBefore)) {
      throw new Error("path changed while it was opened");
    }
    if (openedBefore.size > BigInt(maxBytes)) throw new Error(`exceeds ${maxBytes} byte limit`);
    const bytes = await boundedRead(handle, Number(openedBefore.size));
    const openedAfter = await handle.stat({ bigint: true });
    const after = await doLstat(path, { bigint: true });
    if (
      after.isSymbolicLink() ||
      identity(openedBefore) !== identity(openedAfter) ||
      identity(openedAfter) !== identity(after)
    ) {
      throw new Error("path changed while it was read");
    }
    const value: unknown = parseJsonBytes(bytes, label, { maxBytes });
    if (!isRecord(value)) throw new Error("must contain a JSON object");
    return value;
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    throw new HarnessError(
      "INTEGRITY",
      `${label} must be a regular non-symlink JSON object: ${detail}`,
    );
  } finally {
    await handle?.close();
  }
}
