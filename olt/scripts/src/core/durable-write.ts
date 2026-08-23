import {
  chmodSync,
  closeSync,
  constants,
  existsSync,
  fsyncSync,
  openSync,
  renameSync,
  rmSync,
  writeSync,
} from "node:fs";
import { dirname, join } from "node:path";
import { randomUUID } from "node:crypto";
import type { JsonValue } from "./contracts/json.ts";
import { canonicalJsonBytes } from "./json.ts";

export type DurableWriteStep = "chmod" | "file-fsync" | "rename" | "directory-fsync";
export interface AtomicWriteOptions {
  mode?: number;
  observe?: (step: DurableWriteStep) => void;
}

export function fsyncDirectory(path: string): void {
  const descriptor = openSync(path, constants.O_RDONLY | (constants.O_DIRECTORY ?? 0));
  try {
    fsyncSync(descriptor);
  } finally {
    closeSync(descriptor);
  }
}

export function atomicWriteBytes(
  path: string,
  data: Uint8Array,
  options: AtomicWriteOptions = {},
): void {
  const parent = dirname(path);
  const temporary = join(parent, `.${path.slice(parent.length + 1)}.${randomUUID()}.tmp`);
  let descriptor: number | undefined;
  try {
    descriptor = openSync(
      temporary,
      constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | (constants.O_NOFOLLOW ?? 0),
      0o600,
    );
    let offset = 0;
    while (offset < data.byteLength)
      offset += writeSync(descriptor, data, offset, data.byteLength - offset);
    chmodSync(temporary, options.mode ?? 0o644);
    options.observe?.("chmod");
    fsyncSync(descriptor);
    options.observe?.("file-fsync");
    closeSync(descriptor);
    descriptor = undefined;
    renameSync(temporary, path);
    options.observe?.("rename");
    fsyncDirectory(parent);
    options.observe?.("directory-fsync");
  } catch (error) {
    if (descriptor !== undefined) closeSync(descriptor);
    if (existsSync(temporary)) rmSync(temporary);
    throw error;
  }
}

export function atomicWriteJson(path: string, value: JsonValue, mode = 0o644): void {
  atomicWriteBytes(path, canonicalJsonBytes(value), { mode });
}
