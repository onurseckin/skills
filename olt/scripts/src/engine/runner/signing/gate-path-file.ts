import { createHash } from "node:crypto";
import {
  closeSync,
  constants,
  fstatSync,
  lstatSync,
  openSync,
  readSync,
  type Stats,
} from "node:fs";
import { HarnessError } from "../../../core/errors/index";
import type { SyncDirectoryReader } from "../../../core/bounded-directory";

export const MAX_FILE_BYTES = 128 * 1024 * 1024;
export const MAX_TREE_BYTES = 64 * 1024 * 1024;
export const MAX_TREE_ENTRIES = 10_000;
export const MAX_DIGEST_WORK_BYTES = 128 * 1024 * 1024;
export const MAX_GATE_PATH_BINDINGS = 256;

export interface GateCaptureBudget {
  bindings: number;
  treeEntries: number;
  treeBytes: number;
  digestBytes: number;
}

export function createGateCaptureBudget(): GateCaptureBudget {
  return { bindings: 0, treeEntries: 0, treeBytes: 0, digestBytes: 0 };
}

export interface GatePathHooks {
  lstatPath?: (path: string) => Stats;
  openPath?: (path: string, flags: number) => number;
  openDirectory?: (path: string) => SyncDirectoryReader<string>;
  readFile?: typeof readSync;
}

export function digestFile(
  descriptor: number,
  byteLength: bigint,
  budget: GateCaptureBudget,
  hooks: GatePathHooks,
  tree: boolean,
): { bytes: number; sha256: string } {
  if (byteLength > BigInt(MAX_FILE_BYTES))
    throw new HarnessError("INVALID_STATE", "gate-bound file exceeds bounded digest size");
  const expected = Number(byteLength);
  budget.digestBytes += expected;
  if (budget.digestBytes > MAX_DIGEST_WORK_BYTES)
    throw new HarnessError("INVALID_STATE", "gate path capture exceeds digest-work limit");
  if (tree) {
    budget.treeBytes += expected;
    if (budget.treeBytes > MAX_TREE_BYTES)
      throw new HarnessError("INVALID_STATE", "gate-bound directories exceed shared byte limit");
  }
  const digest = createHash("sha256");
  const buffer = Buffer.allocUnsafe(64 * 1024);
  let offset = 0;
  while (offset < expected) {
    const count = (hooks.readFile ?? readSync)(
      descriptor,
      buffer,
      0,
      Math.min(buffer.length, expected - offset),
      offset,
    );
    if (count <= 0)
      throw new HarnessError("INVALID_STATE", "gate-bound file changed while hashing");
    digest.update(buffer.subarray(0, count));
    offset += count;
  }
  if (fstatSync(descriptor, { bigint: true }).size !== byteLength)
    throw new HarnessError("INVALID_STATE", "gate-bound file changed while hashing");
  return { bytes: expected, sha256: digest.digest("hex") };
}

export function metadata(descriptor: number): {
  device: string;
  inode: string;
  mode: number;
  kind: "directory" | "file";
  size: bigint;
} {
  const value = fstatSync(descriptor, { bigint: true });
  if (!value.isFile() && !value.isDirectory())
    throw new HarnessError("PATH_SAFETY", "gate path is not a regular file or directory");
  return {
    device: value.dev.toString(),
    inode: value.ino.toString(),
    mode: Number(value.mode),
    kind: value.isFile() ? "file" : "directory",
    size: value.size,
  };
}

export function openGatePath(path: string, hooks: GatePathHooks = {}): number {
  const value = (hooks.lstatPath ?? lstatSync)(path);
  if (value.isSymbolicLink())
    throw new HarnessError("PATH_SAFETY", "gate path must not be symbolic");
  if (!value.isFile() && !value.isDirectory())
    throw new HarnessError("PATH_SAFETY", "gate path is not a regular file or directory");
  const descriptor = (hooks.openPath ?? openSync)(
    path,
    constants.O_RDONLY | (constants.O_NONBLOCK ?? 0) | (constants.O_NOFOLLOW ?? 0),
  );
  try {
    const opened = fstatSync(descriptor);
    const changed =
      opened.dev !== value.dev ||
      opened.ino !== value.ino ||
      (value.isFile() && !opened.isFile()) ||
      (value.isDirectory() && !opened.isDirectory());
    if (changed) throw new HarnessError("PATH_SAFETY", "gate path changed while opening");
    return descriptor;
  } catch (error) {
    closeSync(descriptor);
    throw error;
  }
}
