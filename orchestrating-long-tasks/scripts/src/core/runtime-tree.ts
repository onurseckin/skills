import {
  chmodSync,
  closeSync,
  constants,
  copyFileSync,
  existsSync,
  fstatSync,
  fsyncSync,
  lstatSync,
  mkdirSync,
  openSync,
  readSync,
  readdirSync,
  rmSync,
} from "node:fs";
import { dirname, join, relative } from "node:path";
import { createHash } from "node:crypto";
import { canonicalJsonBytes, sha256Bytes } from "./json.ts";
import { fsyncDirectory } from "./durable-write.ts";
import { includeRuntimeSourceEntry } from "./runtime-filter.ts";

type Identity = readonly [string, string, bigint, bigint, bigint, bigint, bigint];
export interface RuntimeSnapshot {
  digest: string;
  fileCount: number;
  identities: readonly Identity[];
}

function fileDigest(path: string): string {
  const descriptor = openSync(path, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0));
  const digest = createHash("sha256");
  const buffer = Buffer.allocUnsafe(64 * 1024);
  try {
    if (!fstatSync(descriptor).isFile())
      throw new Error(`runtime tree contains a non-regular file: ${path}`);
    while (true) {
      const read = readSync(descriptor, buffer, 0, buffer.length, null);
      if (read === 0) break;
      digest.update(buffer.subarray(0, read));
    }
  } finally {
    closeSync(descriptor);
  }
  return digest.digest("hex");
}

function syncTree(root: string): void {
  const directories: string[] = [];
  const walk = (directory: string): void => {
    directories.push(directory);
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      const path = join(directory, entry.name);
      if (entry.isDirectory()) walk(path);
      else {
        const descriptor = openSync(path, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0));
        try {
          fsyncSync(descriptor);
        } finally {
          closeSync(descriptor);
        }
      }
    }
  };
  walk(root);
  directories
    .sort((left, right) => right.split("/").length - left.split("/").length)
    .forEach(fsyncDirectory);
  fsyncDirectory(dirname(root));
}

function statIdentity(path: string, relativePath: string, type: string): Identity {
  const stat = lstatSync(path, { bigint: true });
  return [relativePath, type, stat.dev, stat.ino, stat.size, stat.mtimeNs, stat.ctimeNs];
}

export function runtimeTreeSnapshot(
  root: string,
  options: { filterRuntimeSource?: boolean } = {},
): RuntimeSnapshot {
  const rootStat = lstatSync(root);
  if (rootStat.isSymbolicLink() || !rootStat.isDirectory())
    throw new Error(`runtime path must be a real directory: ${root}`);
  const records: Array<Record<string, string | number>> = [];
  const identities: Identity[] = [];
  let fileCount = 0;
  const walk = (directory: string): void => {
    const dirStat = lstatSync(directory);
    if (dirStat.isSymbolicLink() || !dirStat.isDirectory())
      throw new Error(`runtime tree contains a non-directory: ${directory}`);
    const path = relative(root, directory).replaceAll("\\", "/") || ".";
    records.push({ type: "directory", path, mode: dirStat.mode & 0o777 });
    identities.push(statIdentity(directory, path, "directory"));
    for (const entry of readdirSync(directory, { withFileTypes: true }).sort((a, b) =>
      a.name.localeCompare(b.name),
    )) {
      if (
        options.filterRuntimeSource &&
        !includeRuntimeSourceEntry(path, entry.name, entry.isDirectory())
      )
        continue;
      const child = join(directory, entry.name);
      if (entry.isSymbolicLink()) throw new Error(`runtime tree contains a symlink: ${child}`);
      if (entry.isDirectory()) {
        walk(child);
        continue;
      }
      if (!entry.isFile()) throw new Error(`runtime tree contains a special node: ${child}`);
      const before = statIdentity(child, relative(root, child).replaceAll("\\", "/"), "file");
      const digest = fileDigest(child);
      const after = statIdentity(child, before[0], "file");
      if (before.some((value, index) => value !== after[index]))
        throw new Error(`runtime file changed while hashing: ${child}`);
      records.push({
        type: "file",
        path: before[0],
        mode: lstatSync(child).mode & 0o777,
        bytes: Number(before[4]),
        sha256: digest,
      });
      identities.push(before);
      fileCount += 1;
    }
  };
  walk(root);
  records.sort((a, b) => `${a.path}:${a.type}`.localeCompare(`${b.path}:${b.type}`));
  identities.sort((a, b) => `${a[0]}:${a[1]}`.localeCompare(`${b[0]}:${b[1]}`));
  return { digest: sha256Bytes(canonicalJsonBytes(records)), fileCount, identities };
}

function copyTree(sourceRoot: string, source: string, destination: string): void {
  mkdirSync(destination, { mode: lstatSync(source).mode & 0o777 });
  for (const entry of readdirSync(source, { withFileTypes: true })) {
    const parent = relative(sourceRoot, source).replaceAll("\\", "/") || ".";
    if (!includeRuntimeSourceEntry(parent, entry.name, entry.isDirectory())) continue;
    const from = join(source, entry.name);
    const to = join(destination, entry.name);
    if (entry.isSymbolicLink()) throw new Error(`runtime tree contains a symlink: ${from}`);
    if (entry.isDirectory()) copyTree(sourceRoot, from, to);
    else if (entry.isFile()) {
      copyFileSync(from, to);
      chmodSync(to, lstatSync(from).mode & 0o777);
    } else throw new Error(`runtime tree contains a special node: ${from}`);
  }
  chmodSync(destination, lstatSync(source).mode & 0o777);
}

function identitiesEqual(left: readonly Identity[], right: readonly Identity[]): boolean {
  return (
    left.length === right.length &&
    left.every((identity, index) => {
      const peer = right[index];
      return peer !== undefined && identity.every((value, part) => value === peer[part]);
    })
  );
}

export function copyPinnedRuntime(
  source: string,
  destination: string,
  options: { beforeSourceRecheck?: () => void } = {},
): RuntimeSnapshot {
  if (
    !existsSync(source) ||
    lstatSync(source).isSymbolicLink() ||
    !lstatSync(source).isDirectory()
  ) {
    throw new Error(`runtime source must be a real directory: ${source}`);
  }
  const before = runtimeTreeSnapshot(source, { filterRuntimeSource: true });
  try {
    mkdirSync(destination, { mode: lstatSync(source).mode & 0o777 });
    for (const entry of readdirSync(source, { withFileTypes: true })) {
      if (!includeRuntimeSourceEntry(".", entry.name, entry.isDirectory())) continue;
      const from = join(source, entry.name);
      const to = join(destination, entry.name);
      if (entry.isSymbolicLink()) throw new Error(`runtime tree contains a symlink: ${from}`);
      if (entry.isDirectory()) copyTree(source, from, to);
      else if (entry.isFile()) {
        copyFileSync(from, to);
        chmodSync(to, lstatSync(from).mode & 0o777);
      } else throw new Error(`runtime tree contains a special node: ${from}`);
    }
    chmodSync(destination, lstatSync(source).mode & 0o777);
    options.beforeSourceRecheck?.();
    const after = runtimeTreeSnapshot(source, { filterRuntimeSource: true });
    const copied = runtimeTreeSnapshot(destination);
    if (!identitiesEqual(after.identities, before.identities) || after.digest !== before.digest)
      throw new Error("runtime source changed while it was being copied");
    if (copied.digest !== before.digest || copied.fileCount !== before.fileCount)
      throw new Error("copied runtime does not match pinned source");
    syncTree(destination);
    return copied;
  } catch (error) {
    if (existsSync(destination)) rmSync(destination, { recursive: true, force: true });
    throw error;
  }
}
