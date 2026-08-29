import { createHash } from "node:crypto";
import {
  closeSync,
  constants,
  fstatSync,
  lstatSync,
  openSync,
  readlinkSync,
  readSync,
} from "node:fs";
import type { JsonObject } from "../core/contracts/index.ts";
import { sha256Bytes } from "../core/json.ts";
import { HarnessError } from "../core/errors/index.ts";
import type { RepositoryContentPath } from "./repository-content-paths.ts";
import { captureRepositoryLeaf, verifyRepositoryAncestors } from "./repository-path-identity.ts";

export interface RepositoryContentNode extends JsonObject {
  path: string;
  node_type: "file" | "missing" | "symlink";
  mode: number | null;
  bytes: number;
  sha256: string | null;
  index: RepositoryContentPath["index"];
}

type FileStat = ReturnType<typeof fstatSync>;

export interface RepositoryNodeHooks {
  afterAncestorCapture?: () => void;
  afterLeafRead?: () => void;
  beforeLeafOpen?: () => void;
  openFile?: (path: string, flags: number) => number;
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

function missing(entry: RepositoryContentPath): RepositoryContentNode {
  return {
    path: entry.path,
    node_type: "missing",
    mode: null,
    bytes: 0,
    sha256: null,
    index: entry.index,
  };
}

function symlinkNode(
  path: string,
  before: FileStat,
  entry: RepositoryContentPath,
  maximum: number,
): RepositoryContentNode {
  const bytes = readlinkSync(path, { encoding: "buffer" });
  if (bytes.byteLength > maximum)
    throw new HarnessError("INTEGRITY", `repository file byte limit exceeded: ${entry.path}`);
  const after = lstatSync(path);
  const finalBytes = readlinkSync(path, { encoding: "buffer" });
  if (!after.isSymbolicLink() || !sameStat(before, after) || !bytes.equals(finalBytes))
    throw new HarnessError("INTEGRITY", `repository content scan was unstable: ${entry.path}`);
  return {
    path: entry.path,
    node_type: "symlink",
    mode: Number(before.mode) & 0o7777,
    bytes: bytes.byteLength,
    sha256: sha256Bytes(bytes),
    index: entry.index,
  };
}

function fileNode(
  path: string,
  pathStat: FileStat,
  entry: RepositoryContentPath,
  maximum: number,
  hooks: RepositoryNodeHooks,
): RepositoryContentNode {
  hooks.beforeLeafOpen?.();
  const flags = constants.O_RDONLY | (constants.O_NONBLOCK ?? 0) | (constants.O_NOFOLLOW ?? 0);
  const descriptor = (hooks.openFile ?? openSync)(path, flags);
  try {
    const before = fstatSync(descriptor);
    if (!before.isFile() || !sameStat(pathStat, before))
      throw new HarnessError("INTEGRITY", `repository content scan was unstable: ${entry.path}`);
    if (before.size > maximum)
      throw new HarnessError("INTEGRITY", `repository file byte limit exceeded: ${entry.path}`);
    const digest = createHash("sha256");
    let total = 0;
    while (total <= maximum) {
      const buffer = Buffer.allocUnsafe(Math.min(64 * 1024, maximum + 1 - total));
      const count = readSync(descriptor, buffer, 0, buffer.length, null);
      if (count === 0) break;
      digest.update(buffer.subarray(0, count));
      total += count;
    }
    if (total > maximum)
      throw new HarnessError("INTEGRITY", `repository file byte limit exceeded: ${entry.path}`);
    const after = fstatSync(descriptor);
    const finalPathStat = lstatSync(path);
    if (!sameStat(before, after) || !sameStat(after, finalPathStat))
      throw new HarnessError("INTEGRITY", `repository content scan was unstable: ${entry.path}`);
    return {
      path: entry.path,
      node_type: "file",
      mode: Number(before.mode) & 0o7777,
      bytes: total,
      sha256: digest.digest("hex"),
      index: entry.index,
    };
  } finally {
    closeSync(descriptor);
  }
}

export function inspectRepositoryNode(
  repo: string,
  entry: RepositoryContentPath,
  maximum: number,
  hooks: RepositoryNodeHooks = {},
): RepositoryContentNode {
  if (entry.index.some(({ mode }) => mode === "160000"))
    throw new HarnessError(
      "INTEGRITY",
      `repository gitlink/submodule nodes are unsupported: ${entry.path}`,
    );
  const identity = captureRepositoryLeaf(repo, entry.path);
  hooks.afterAncestorCapture?.();
  verifyRepositoryAncestors(identity, entry.path);
  let pathStat: FileStat;
  try {
    pathStat = lstatSync(identity.path);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      verifyRepositoryAncestors(identity, entry.path);
      return missing(entry);
    }
    throw error;
  }
  let node: RepositoryContentNode;
  if (pathStat.isSymbolicLink()) node = symlinkNode(identity.path, pathStat, entry, maximum);
  else {
    if (!pathStat.isFile())
      throw new HarnessError(
        "INTEGRITY",
        `unsupported repository content node type: ${entry.path}`,
      );
    node = fileNode(identity.path, pathStat, entry, maximum, hooks);
  }
  hooks.afterLeafRead?.();
  verifyRepositoryAncestors(identity, entry.path);
  return node;
}
