import { lstat, mkdir, realpath } from "node:fs/promises";
import { isAbsolute, join, relative } from "node:path";
import { HarnessError } from "../errors/harness-error.ts";

export interface PathIdentity {
  device: bigint;
  inode: bigint;
  kind: "directory" | "file" | "symlink" | "other";
}

function contained(root: string, path: string): boolean {
  const rel = relative(root, path);
  return rel === "" || (!rel.startsWith("..") && !isAbsolute(rel));
}

export async function pathIdentity(path: string): Promise<PathIdentity | null> {
  const stat = await lstat(path, { bigint: true }).catch((error: NodeJS.ErrnoException) => {
    if (error.code === "ENOENT") return null;
    throw error;
  });
  if (!stat) return null;
  const kind = stat.isSymbolicLink()
    ? "symlink"
    : stat.isDirectory()
      ? "directory"
      : stat.isFile()
        ? "file"
        : "other";
  return { device: stat.dev, inode: stat.ino, kind };
}

export function sameIdentity(left: PathIdentity | null, right: PathIdentity | null): boolean {
  return (
    left === right ||
    (left !== null &&
      right !== null &&
      left.device === right.device &&
      left.inode === right.inode &&
      left.kind === right.kind)
  );
}

export async function assertPathIdentity(
  path: string,
  expected: PathIdentity | null,
  label: string,
): Promise<PathIdentity | null> {
  const current = await pathIdentity(path);
  if (!sameIdentity(current, expected)) {
    throw new HarnessError("INVALID_STATE", `${label} changed identity: ${path}`);
  }
  return current;
}

async function verifyDirectory(root: string, path: string): Promise<PathIdentity> {
  const identity = await pathIdentity(path);
  if (identity?.kind !== "directory") {
    throw new HarnessError("PATH_SAFETY", `unsafe directory ancestor beneath home: ${path}`);
  }
  const resolved = await realpath(path);
  if (!contained(root, resolved)) {
    throw new HarnessError("PATH_SAFETY", `directory ancestor escapes validated home: ${path}`);
  }
  return identity;
}

export async function ensureSafeDirectory(
  homeRoot: string,
  directory: string,
  create = true,
): Promise<PathIdentity> {
  if (!contained(homeRoot, directory)) {
    throw new HarnessError("PATH_SAFETY", `installer path escapes validated home: ${directory}`);
  }
  await verifyDirectory(homeRoot, homeRoot);
  const rel = relative(homeRoot, directory);
  let cursor = homeRoot;
  for (const part of rel === "" ? [] : rel.split(/[\\/]/u)) {
    cursor = join(cursor, part);
    if (create) {
      await mkdir(cursor).catch((error: NodeJS.ErrnoException) => {
        if (error.code !== "EEXIST") throw error;
      });
    }
    await verifyDirectory(homeRoot, cursor);
  }
  return verifyDirectory(homeRoot, directory);
}

export async function assertSafeAncestors(homeRoot: string, directory: string): Promise<void> {
  if (!contained(homeRoot, directory)) {
    throw new HarnessError("PATH_SAFETY", `installer path escapes validated home: ${directory}`);
  }
  await verifyDirectory(homeRoot, homeRoot);
  const rel = relative(homeRoot, directory);
  let cursor = homeRoot;
  for (const part of rel === "" ? [] : rel.split(/[\\/]/u)) {
    cursor = join(cursor, part);
    if ((await pathIdentity(cursor)) === null) return;
    await verifyDirectory(homeRoot, cursor);
  }
}
