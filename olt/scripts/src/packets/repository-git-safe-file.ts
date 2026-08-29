import { closeSync, constants, fstatSync, lstatSync, openSync, readSync } from "node:fs";
import type { Stats } from "node:fs";
import { HarnessError } from "../core/errors/index.ts";

type FileStat = Stats;

export interface RepositoryGitFileHooks {
  lstatPath?: (path: string) => FileStat;
  openFile?: (path: string, flags: number) => number;
}

export interface RepositoryGitControlFile {
  bytes: Buffer;
  metadata: FileStat;
}

function sameStat(left: FileStat, right: FileStat): boolean {
  return (
    left.dev === right.dev &&
    left.ino === right.ino &&
    left.mode === right.mode &&
    left.size === right.size &&
    left.mtimeMs === right.mtimeMs &&
    left.ctimeMs === right.ctimeMs
  );
}

function missing(error: unknown): boolean {
  return (error as NodeJS.ErrnoException).code === "ENOENT";
}

export function readRepositoryGitControlFile(
  path: string,
  name: string,
  maximum: number,
  hooks: RepositoryGitFileHooks = {},
): RepositoryGitControlFile | null {
  const inspect = hooks.lstatPath ?? lstatSync;
  let pathStat: FileStat;
  try {
    pathStat = inspect(path);
  } catch (error) {
    if (missing(error)) return null;
    throw error;
  }
  if (pathStat.isSymbolicLink())
    throw new HarnessError("INTEGRITY", `repository Git control is symbolic: ${name}`);
  if (!pathStat.isFile())
    throw new HarnessError("INTEGRITY", `repository Git control is not a regular file: ${name}`);
  const descriptor = (hooks.openFile ?? openSync)(
    path,
    constants.O_RDONLY | (constants.O_NONBLOCK ?? 0) | (constants.O_NOFOLLOW ?? 0),
  );
  try {
    const before = fstatSync(descriptor);
    if (!before.isFile() || !sameStat(pathStat, before))
      throw new HarnessError("INTEGRITY", `repository Git control changed during scan: ${name}`);
    if (before.size > maximum)
      throw new HarnessError("INTEGRITY", `repository Git control byte limit exceeded: ${name}`);
    const chunks: Buffer[] = [];
    let total = 0;
    while (total <= maximum) {
      const buffer = Buffer.allocUnsafe(Math.min(64 * 1024, maximum + 1 - total));
      const count = readSync(descriptor, buffer, 0, buffer.length, null);
      if (count === 0) break;
      chunks.push(buffer.subarray(0, count));
      total += count;
    }
    if (
      total > maximum ||
      !sameStat(before, fstatSync(descriptor)) ||
      !sameStat(before, inspect(path))
    )
      throw new HarnessError("INTEGRITY", `repository Git control changed during scan: ${name}`);
    return { bytes: Buffer.concat(chunks, total), metadata: before };
  } finally {
    closeSync(descriptor);
  }
}
