import {
  chmodSync,
  closeSync,
  constants,
  existsSync,
  fstatSync,
  fsyncSync,
  openSync,
  renameSync,
  rmSync,
  writeSync,
} from "node:fs";
import { dirname, join, resolve } from "node:path";
import { randomUUID } from "node:crypto";
import type { JsonValue } from "./contracts/json.ts";
import { HarnessError } from "./errors/harness-error.ts";
import { canonicalJsonBytes } from "./json.ts";
import { releaseFlock, tryExclusiveFlock } from "../platform/index.ts";

export type DurableWriteStep = "chmod" | "file-fsync" | "rename" | "directory-fsync";
export interface AtomicWriteOptions {
  mode?: number;
  observe?: (step: DurableWriteStep) => void;
}

export interface DurableAppendOptions {
  observe?: (step: DurableWriteStep) => void;
  timeoutMs?: number;
  retryMs?: number;
  dependencies?: DurableAppendDependencies;
}

/** Narrow seam for deterministic durability failure tests. */
export interface DurableAppendDependencies {
  open?: (path: string, flags: number, mode?: number) => number;
  write?: (
    descriptor: number,
    data: Uint8Array,
    offset: number,
    length: number,
    position?: number | null,
  ) => number;
  fsync?: (descriptor: number) => void;
  fstat?: (descriptor: number) => { dev: number; ino: number };
  close?: (descriptor: number) => void;
  tryExclusiveFlock?: (descriptor: number) => boolean;
  releaseFlock?: (descriptor: number) => void;
  fsyncDirectory?: (path: string) => void;
  now?: () => number;
  sleep?: (milliseconds: number) => void;
}

const activeAppendPaths = new Set<string>();
const activeAppendInodes = new Set<string>();

function delay(milliseconds: number): void {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, milliseconds);
}

function validDuration(value: number, name: string): number {
  if (!Number.isFinite(value) || value < 0)
    throw new HarnessError("INVALID_ARGUMENT", `${name} must be finite and non-negative`);
  return value;
}

function requiredNoFollowFlag(): number {
  const flag = constants.O_NOFOLLOW;
  if (!Number.isInteger(flag) || flag === 0)
    throw new HarnessError(
      "UNSUPPORTED_PLATFORM",
      "durable append requires final-component O_NOFOLLOW protection",
    );
  return flag;
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

export function durableAppendBytes(
  path: string,
  data: Uint8Array,
  options: DurableAppendOptions = {},
): void {
  if (data.byteLength === 0)
    throw new HarnessError("INVALID_ARGUMENT", "durable append refuses an empty record");
  const parent = dirname(path);
  const identity = resolve(path);
  if (activeAppendPaths.has(identity))
    throw new HarnessError("LOCK_TIMEOUT", `durable append is already active for '${path}'`);

  const dependencies = options.dependencies ?? {};
  const open = dependencies.open ?? openSync;
  const write = dependencies.write ?? writeSync;
  const fsync = dependencies.fsync ?? fsyncSync;
  const fstat = dependencies.fstat ?? fstatSync;
  const close = dependencies.close ?? closeSync;
  const lock = dependencies.tryExclusiveFlock ?? tryExclusiveFlock;
  const unlock = dependencies.releaseFlock ?? releaseFlock;
  const syncDirectory = dependencies.fsyncDirectory ?? fsyncDirectory;
  const now = dependencies.now ?? (() => performance.now());
  const sleep = dependencies.sleep ?? delay;
  const maximum = validDuration(options.timeoutMs ?? 10_000, "timeoutMs");
  const retry = validDuration(options.retryMs ?? 10, "retryMs");
  let descriptor: number | undefined;
  let inodeIdentity: string | undefined;
  let inodeTracked = false;
  let acquired = false;
  let hasPrimary = false;
  let primary: unknown;
  let hasCleanup = false;
  let cleanup: unknown;
  activeAppendPaths.add(identity);
  try {
    descriptor = open(
      path,
      constants.O_WRONLY | constants.O_APPEND | constants.O_CREAT | requiredNoFollowFlag(),
      0o600,
    );
    const metadata = fstat(descriptor);
    inodeIdentity = `${metadata.dev}:${metadata.ino}`;
    if (activeAppendInodes.has(inodeIdentity))
      throw new HarnessError("LOCK_TIMEOUT", `durable append is already active for '${path}'`);
    activeAppendInodes.add(inodeIdentity);
    inodeTracked = true;
    const deadline = now() + maximum;
    while (!(acquired = lock(descriptor))) {
      const remaining = deadline - now();
      if (remaining <= 0)
        throw new HarnessError(
          "LOCK_TIMEOUT",
          `timed out after ${maximum}ms waiting to append durable record: ${path}`,
        );
      sleep(Math.min(retry, remaining));
    }
    let offset = 0;
    while (offset < data.byteLength) {
      const remaining = data.byteLength - offset;
      const written = write(descriptor, data, offset, remaining);
      if (written <= 0) throw new Error(`durable append made no progress for '${path}'`);
      if (written > remaining)
        throw new Error(`durable append exceeded remaining record length for '${path}'`);
      offset += written;
    }
    fsync(descriptor);
    options.observe?.("file-fsync");
    syncDirectory(parent);
    options.observe?.("directory-fsync");
  } catch (error) {
    hasPrimary = true;
    primary = error;
  } finally {
    if (descriptor !== undefined && acquired) {
      try {
        unlock(descriptor);
      } catch (error) {
        if (!hasCleanup) {
          hasCleanup = true;
          cleanup = error;
        }
      }
    }
    if (descriptor !== undefined) {
      try {
        close(descriptor);
      } catch (error) {
        if (!hasCleanup) {
          hasCleanup = true;
          cleanup = error;
        }
      }
    }
    activeAppendPaths.delete(identity);
    if (inodeTracked && inodeIdentity !== undefined) activeAppendInodes.delete(inodeIdentity);
  }
  if (hasPrimary) throw primary;
  if (hasCleanup) throw cleanup;
}

export function atomicWriteJson(path: string, value: JsonValue, mode = 0o644): void {
  atomicWriteBytes(path, canonicalJsonBytes(value), { mode });
}
