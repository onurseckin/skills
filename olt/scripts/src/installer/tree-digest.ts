import {
  closeSync,
  constants,
  fstatSync,
  lstatSync,
  openSync,
  readSync,
  readdirSync,
  type BigIntStats,
} from "node:fs";
import { createHash } from "node:crypto";
import { join, relative, sep } from "node:path";
import { HarnessError } from "../core/errors/index.ts";

interface TreeEntry {
  type: "directory" | "file";
  path: string;
  mode: number;
  bytes?: number;
  sha256?: string;
}

export interface TreeDigestOptions {
  maxFileBytes?: number;
  maxTotalBytes?: number;
  maxEntries?: number;
  beforeFileRecheck?(path: string): void;
}

interface Limits {
  file: number;
  total: number;
  entries: number;
}

function bound(value: number | undefined, fallback: number, label: string): number {
  const result = value ?? fallback;
  if (!Number.isSafeInteger(result) || result < 0)
    throw new HarnessError("INVALID_ARGUMENT", `${label} must be a non-negative safe integer`);
  return result;
}

function limits(options: TreeDigestOptions): Limits {
  return {
    file: bound(options.maxFileBytes, 64 * 1024 * 1024, "maxFileBytes"),
    total: bound(options.maxTotalBytes, 512 * 1024 * 1024, "maxTotalBytes"),
    entries: bound(options.maxEntries, 50_000, "maxEntries"),
  };
}

function identity(stat: BigIntStats): string {
  return [stat.dev, stat.ino, stat.mode, stat.size, stat.mtimeNs, stat.ctimeNs].join(":");
}

function requireStable(before: BigIntStats, after: BigIntStats, path: string): void {
  if (identity(before) !== identity(after))
    throw new HarnessError("INTEGRITY", `skill tree path changed identity while hashing: ${path}`);
}

function fileEntry(
  root: string,
  path: string,
  maximum: Limits,
  options: TreeDigestOptions,
): { entry: TreeEntry; bytes: number } {
  const before = lstatSync(path, { bigint: true });
  if (!before.isFile() || before.isSymbolicLink())
    throw new HarnessError("PATH_SAFETY", `skill tree contains a non-file: ${path}`);
  if (before.size > BigInt(maximum.file))
    throw new HarnessError("INTEGRITY", `skill tree file exceeds limit: ${path}`);
  const descriptor = openSync(path, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0));
  const digest = createHash("sha256");
  let bytes = 0;
  try {
    const opened = fstatSync(descriptor, { bigint: true });
    requireStable(before, opened, path);
    const buffer = Buffer.allocUnsafe(64 * 1024);
    while (true) {
      const count = readSync(descriptor, buffer, 0, buffer.length, null);
      if (count === 0) break;
      bytes += count;
      if (bytes > maximum.file)
        throw new HarnessError("INTEGRITY", `skill tree file exceeds limit: ${path}`);
      digest.update(buffer.subarray(0, count));
    }
    options.beforeFileRecheck?.(path);
    requireStable(opened, fstatSync(descriptor, { bigint: true }), path);
    requireStable(opened, lstatSync(path, { bigint: true }), path);
    return {
      entry: {
        type: "file",
        path: relative(root, path).split(sep).join("/"),
        mode: Number(opened.mode & 0o777n),
        bytes,
        sha256: digest.digest("hex"),
      },
      bytes,
    };
  } finally {
    closeSync(descriptor);
  }
}

export async function treeEntries(
  root: string,
  ignore: ReadonlySet<string> = new Set(),
  options: TreeDigestOptions = {},
): Promise<TreeEntry[]> {
  const maximum = limits(options);
  const entries: TreeEntry[] = [];
  const pending = [root];
  let total = 0;
  while (pending.length > 0) {
    const path = pending.pop()!;
    const rel = relative(root, path).split(sep).join("/") || ".";
    if (ignore.has(rel)) continue;
    const before = lstatSync(path, { bigint: true });
    if (before.isSymbolicLink())
      throw new HarnessError("PATH_SAFETY", `skill tree contains symlink: ${rel}`);
    if (entries.length >= maximum.entries)
      throw new HarnessError("INTEGRITY", "skill tree entry count exceeds limit");
    if (before.isDirectory()) {
      const names = readdirSync(path).sort();
      requireStable(before, lstatSync(path, { bigint: true }), path);
      entries.push({ type: "directory", path: rel, mode: Number(before.mode & 0o777n) });
      for (let index = names.length - 1; index >= 0; index -= 1)
        pending.push(join(path, names[index]!));
      continue;
    }
    const result = fileEntry(root, path, maximum, options);
    total += result.bytes;
    if (total > maximum.total)
      throw new HarnessError("INTEGRITY", "skill tree total byte limit exceeded");
    entries.push(result.entry);
  }
  return entries.sort((left, right) =>
    `${left.path}:${left.type}`.localeCompare(`${right.path}:${right.type}`),
  );
}

export async function treeDigest(
  root: string,
  ignore: ReadonlySet<string> = new Set(),
  options: TreeDigestOptions = {},
): Promise<string> {
  return createHash("sha256")
    .update(JSON.stringify(await treeEntries(root, ignore, options)))
    .digest("hex");
}
