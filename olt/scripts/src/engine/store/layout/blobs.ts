import { createHash } from "node:crypto";
import {
  chmodSync,
  closeSync,
  constants,
  copyFileSync,
  existsSync,
  fstatSync,
  fsyncSync,
  linkSync,
  lstatSync,
  mkdirSync,
  openSync,
  readSync,
  readdirSync,
  renameSync,
  rmSync,
  statSync,
  writeSync,
} from "node:fs";
import { randomUUID } from "node:crypto";
import { dirname, join } from "node:path";
import { fsyncDirectory } from "../../../core/durable-write.ts";
import { HarnessError } from "../../../core/errors/index.ts";
import { SHA256_PATTERN } from "./constants.ts";

export const MAX_BLOB_BYTES = 256 * 1024 * 1024;

const BLOBS_DIRECTORY = "blobs";
const COPY_BUFFER_BYTES = 64 * 1024;

export interface BlobDescriptor {
  sha256: string;
  bytes: number;
  path: string;
}

export interface BlobPutResult extends BlobDescriptor {
  created: boolean;
}

export type BlobWriteResult = BlobPutResult;

export type ViewStorage = "hardlink" | "copy";

export interface ViewLink extends BlobDescriptor {
  name: string;
  view_path: string;
  storage: ViewStorage;
}

export function blobRelativePath(sha256: string): string {
  if (!SHA256_PATTERN.test(sha256))
    throw new HarnessError(
      "INVALID_ARGUMENT",
      `blob digest must be a lowercase SHA-256: ${sha256}`,
    );
  return `${BLOBS_DIRECTORY}/${sha256.slice(0, 2)}/${sha256}`;
}

function blobPath(runRoot: string, sha256: string): string {
  return join(runRoot, blobRelativePath(sha256));
}

function copyAndHash(sourcePath: string, temporaryPath: string): { sha256: string; bytes: number } {
  const source = openSync(sourcePath, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0));
  let destination: number | undefined;
  try {
    const metadata = fstatSync(source);
    if (!metadata.isFile())
      throw new HarnessError("INVALID_ARGUMENT", `not a regular file: ${sourcePath}`);
    if (metadata.size > MAX_BLOB_BYTES)
      throw new HarnessError(
        "INVALID_ARGUMENT",
        `capture exceeds the ${MAX_BLOB_BYTES} byte blob limit: ${sourcePath}`,
      );
    destination = openSync(
      temporaryPath,
      constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | (constants.O_NOFOLLOW ?? 0),
      0o600,
    );
    const digest = createHash("sha256");
    const buffer = Buffer.allocUnsafe(COPY_BUFFER_BYTES);
    let bytes = 0;
    while (true) {
      const count = readSync(source, buffer, 0, buffer.length, null);
      if (count === 0) break;
      bytes += count;
      if (bytes > MAX_BLOB_BYTES)
        throw new HarnessError(
          "INVALID_ARGUMENT",
          `capture exceeds the ${MAX_BLOB_BYTES} byte blob limit: ${sourcePath}`,
        );
      digest.update(buffer.subarray(0, count));
      let written = 0;
      while (written < count) written += writeSync(destination, buffer, written, count - written);
    }
    chmodSync(temporaryPath, 0o444);
    fsyncSync(destination);
    return { sha256: digest.digest("hex"), bytes };
  } finally {
    if (destination !== undefined) closeSync(destination);
    closeSync(source);
  }
}

export function putBlobFile(runRoot: string, sourcePath: string): BlobPutResult {
  const staging = join(runRoot, BLOBS_DIRECTORY);
  mkdirSync(staging, { recursive: true, mode: 0o755 });
  const temporary = join(staging, `.ingest-${randomUUID()}.tmp`);
  let hashed: { sha256: string; bytes: number };
  try {
    hashed = copyAndHash(sourcePath, temporary);
  } catch (error) {
    if (existsSync(temporary)) rmSync(temporary, { force: true });
    throw error;
  }
  const relative = blobRelativePath(hashed.sha256);
  const target = join(runRoot, relative);
  if (existsSync(target)) {
    rmSync(temporary, { force: true });
    return { sha256: hashed.sha256, bytes: hashed.bytes, path: relative, created: false };
  }
  const parent = dirname(target);
  mkdirSync(parent, { recursive: true, mode: 0o755 });
  renameSync(temporary, target);
  fsyncDirectory(parent);
  return { sha256: hashed.sha256, bytes: hashed.bytes, path: relative, created: true };
}

export function writeBlob(runRoot: string, sourcePath: string): BlobWriteResult {
  return putBlobFile(runRoot, sourcePath);
}

function sameInode(left: string, right: string): boolean {
  try {
    const a = statSync(left);
    const b = statSync(right);
    return a.dev === b.dev && a.ino === b.ino;
  } catch {
    return false;
  }
}

export interface ViewLinker {
  link(source: string, target: string): void;
}

const hardlink: ViewLinker = { link: linkSync };

export function linkBlobIntoView(
  runRoot: string,
  blob: BlobDescriptor,
  viewDirectory: string,
  name: string,
  linker: ViewLinker = hardlink,
): ViewLink {
  if (name.length === 0 || name.includes("/") || name.includes("\\") || name === "..")
    throw new HarnessError("INVALID_ARGUMENT", `unsafe view name: ${name}`);
  const source = join(runRoot, blob.path);
  if (!existsSync(source))
    throw new HarnessError("INTEGRITY", `blob ${blob.sha256} is not stored in this capsule`);
  const directory = join(runRoot, viewDirectory);
  mkdirSync(directory, { recursive: true, mode: 0o755 });
  const target = join(directory, name);
  const viewPath = `${viewDirectory}/${name}`;
  if (existsSync(target)) {
    if (sameInode(source, target))
      return { ...blob, name, view_path: viewPath, storage: "hardlink" };
    rmSync(target, { force: true });
  }
  let storage: ViewStorage;
  try {
    linker.link(source, target);
    storage = "hardlink";
  } catch {
    copyFileSync(source, target);
    chmodSync(target, 0o444);
    storage = "copy";
  }
  fsyncDirectory(directory);
  return { ...blob, name, view_path: viewPath, storage };
}

export function listBlobs(runRoot: string): BlobDescriptor[] {
  const root = join(runRoot, BLOBS_DIRECTORY);
  if (!existsSync(root)) return [];
  const found: BlobDescriptor[] = [];
  for (const shard of readdirSync(root)) {
    if (shard.startsWith("./")) continue;
    const shardPath = join(root, shard);
    let entries: string[];
    try {
      if (!lstatSync(shardPath).isDirectory()) continue;
      entries = readdirSync(shardPath);
    } catch {
      continue;
    }
    for (const entry of entries) {
      if (!SHA256_PATTERN.test(entry) || !entry.startsWith(shard)) continue;
      try {
        found.push({
          sha256: entry,
          bytes: statSync(join(shardPath, entry)).size,
          path: `${BLOBS_DIRECTORY}/${shard}/${entry}`,
        });
      } catch {
        continue;
      }
    }
  }
  return found.sort((left, right) => (left.sha256 < right.sha256 ? -1 : 1));
}

export function blobContentDigest(runRoot: string, sha256: string): string | undefined {
  const path = blobPath(runRoot, sha256);
  let descriptor: number;
  try {
    descriptor = openSync(path, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0));
  } catch {
    return undefined;
  }
  try {
    if (!fstatSync(descriptor).isFile()) return undefined;
    const digest = createHash("sha256");
    const buffer = Buffer.allocUnsafe(COPY_BUFFER_BYTES);
    while (true) {
      const count = readSync(descriptor, buffer, 0, buffer.length, null);
      if (count === 0) break;
      digest.update(buffer.subarray(0, count));
    }
    return digest.digest("hex");
  } finally {
    closeSync(descriptor);
  }
}
