import {
  closeSync,
  constants,
  existsSync,
  fstatSync,
  lstatSync,
  mkdirSync,
  openSync,
  readFileSync,
  type Stats,
} from "node:fs";
import { basename, dirname, resolve } from "node:path";
import { atomicWriteBytes } from "../core/durable-write.ts";
import { HarnessError } from "../core/errors/index.ts";
import { releaseFlock, tryExclusiveFlock } from "../platform/index.ts";
import type { DefectLogDependencies } from "./types.ts";
import {
  formatSafeErrorCause,
  hasOwnFilesystemCode,
  isTrustedIntegrityError,
  readOwnDataString,
  throwDefectLogIntegrityError,
} from "./error.ts";

const defaultDefectLogDependencies: DefectLogDependencies = {
  atomicWrite: atomicWriteBytes,
  readFile: readFileSync,
};

let defectLogDependencies = defaultDefectLogDependencies;
export const activeDefectLockPaths = new Set<string>();
export const activeDefectLockInodes = new Set<string>();
export const activeDefectRootPaths = new Set<string>();
export const activeDefectRootInodes = new Set<string>();
export const activeDefectParents = new Map<string, Pick<Stats, "dev" | "ino">>();
export const activeDefectRoots = new Map<string, Pick<Stats, "dev" | "ino">>();
export const activeDefectAuthorityPaths = new Map<string, string>();

export function getDefectLogDependencies(): DefectLogDependencies {
  return defectLogDependencies;
}

export function setDefectLogDependenciesForTesting(
  overrides: Partial<DefectLogDependencies>,
): () => void {
  const previousDependencies = defectLogDependencies;
  defectLogDependencies = { ...defectLogDependencies, ...overrides };
  return () => {
    defectLogDependencies = previousDependencies;
  };
}

export function requiredNoFollowFlag(): number {
  const flag = constants.O_NOFOLLOW;
  if (!Number.isInteger(flag) || flag === 0) {
    throw new HarnessError("UNSUPPORTED_PLATFORM", "defect mutation locking requires O_NOFOLLOW");
  }
  return flag;
}

export function delay(milliseconds: number): void {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, milliseconds);
}

export function sameInode(left: Pick<Stats, "dev" | "ino">, right: Pick<Stats, "dev" | "ino">): boolean {
  return left.dev === right.dev && left.ino === right.ino;
}

export function assertRealDirectory(path: string, label: string): Stats {
  let metadata: Stats;
  try {
    metadata = lstatSync(path);
  } catch {
    throw new HarnessError("INTEGRITY", `${label} is unavailable: ${path}`);
  }
  if (!metadata.isDirectory() || metadata.isSymbolicLink()) {
    throw new HarnessError("PATH_SAFETY", `${label} must be a real directory: ${path}`);
  }
  return metadata;
}

export function openVerifiedDirectory(
  path: string,
  create: boolean,
): { descriptor: number; metadata: Stats } {
  if (!existsSync(path)) {
    if (!create) {
      throw new HarnessError("INTEGRITY", `defect lock directory is unavailable: ${path}`);
    }
    mkdirSync(path, { recursive: true, mode: 0o700 });
  }
  const before = assertRealDirectory(path, "defect lock directory");
  let descriptor: number | undefined;
  try {
    descriptor = openSync(
      path,
      constants.O_RDONLY | (constants.O_DIRECTORY ?? 0) | requiredNoFollowFlag(),
    );
    const opened = fstatSync(descriptor);
    const after = assertRealDirectory(path, "defect lock directory");
    if (!opened.isDirectory() || !sameInode(before, opened) || !sameInode(opened, after)) {
      throw new HarnessError("INTEGRITY", `defect lock directory changed while opening: ${path}`);
    }
    return { descriptor, metadata: opened };
  } catch (error) {
    if (descriptor !== undefined) closeSync(descriptor);
    throw error;
  }
}

export function defectAuthorityRoot(filePath: string): string {
  const parent = dirname(filePath);
  if (basename(parent) === ".olt") return dirname(parent);
  let candidate = parent;
  while (!existsSync(candidate)) {
    const ancestor = dirname(candidate);
    if (ancestor === candidate) {
      throw new HarnessError("INTEGRITY", `defect authority root is unavailable: ${parent}`);
    }
    candidate = ancestor;
  }
  return candidate;
}

export function acquireExclusiveLock(descriptor: number, label: string): void {
  const deadline = performance.now() + 10_000;
  while (!tryExclusiveFlock(descriptor)) {
    const remaining = deadline - performance.now();
    if (remaining <= 0) {
      throw new HarnessError("LOCK_TIMEOUT", `timed out waiting for defect log lock: ${label}`);
    }
    delay(Math.min(10, remaining));
  }
}

export function assertRegularDefectLog(filePath: string): void {
  if (!existsSync(filePath)) return;
  const metadata = lstatSync(filePath);
  if (metadata.isSymbolicLink() || !metadata.isFile() || metadata.nlink !== 1) {
    const reason = metadata.isDirectory() ? "EISDIR" : "not a regular file";
    throw new HarnessError("INTEGRITY", `failed to read defect log at '${filePath}': ${reason}`);
  }
}

export function assertCurrentDefectMutationAuthority(filePath: string): void {
  const parentPath = resolve(dirname(filePath));
  const expectedParent = activeDefectParents.get(parentPath);
  if (
    expectedParent === undefined ||
    !sameInode(expectedParent, assertRealDirectory(parentPath, "defect log parent"))
  ) {
    throw new HarnessError("INTEGRITY", `defect log parent changed before write: ${parentPath}`);
  }
  const rootPath = activeDefectAuthorityPaths.get(parentPath);
  const expectedRoot = rootPath === undefined ? undefined : activeDefectRoots.get(rootPath);
  if (
    expectedRoot === undefined ||
    rootPath === undefined ||
    !sameInode(expectedRoot, assertRealDirectory(rootPath, "defect authority root"))
  ) {
    throw new HarnessError(
      "INTEGRITY",
      `defect authority root changed before write: ${rootPath ?? "unknown"}`,
    );
  }
}

export function withDefectLogMutationLock<T>(filePath: string, operation: () => T): T {
  const parent = dirname(filePath);
  const root = defectAuthorityRoot(filePath);
  const parentPath = resolve(parent);
  const rootPath = resolve(root);
  if (activeDefectLockPaths.has(parentPath) || activeDefectRootPaths.has(rootPath)) {
    throw new HarnessError(
      "LOCK_TIMEOUT",
      `defect log is already active in this process: ${filePath}`,
    );
  }

  let rootDescriptor: number | undefined;
  let rootAcquired = false;
  let rootInode: string | undefined;
  let parentDescriptor: number | undefined;
  let parentAcquired = false;
  let parentInode: string | undefined;
  let hasPrimary = false;
  let primary: unknown;
  let hasCleanup = false;
  let cleanupFailure: unknown;
  let result!: T;
  activeDefectLockPaths.add(parentPath);
  activeDefectRootPaths.add(rootPath);
  activeDefectAuthorityPaths.set(parentPath, rootPath);
  try {
    const openedRoot = openVerifiedDirectory(root, false);
    rootDescriptor = openedRoot.descriptor;
    rootInode = `${openedRoot.metadata.dev}:${openedRoot.metadata.ino}`;
    if (activeDefectRootInodes.has(rootInode)) {
      throw new HarnessError("LOCK_TIMEOUT", `defect authority root is already active: ${root}`);
    }
    activeDefectRootInodes.add(rootInode);
    activeDefectRoots.set(rootPath, openedRoot.metadata);
    acquireExclusiveLock(rootDescriptor, root);
    rootAcquired = true;
    if (!sameInode(openedRoot.metadata, assertRealDirectory(root, "defect authority root"))) {
      throw new HarnessError("INTEGRITY", `defect authority root changed while locked: ${root}`);
    }

    if (parentPath !== rootPath) {
      const openedParent = openVerifiedDirectory(parent, true);
      parentDescriptor = openedParent.descriptor;
      parentInode = `${openedParent.metadata.dev}:${openedParent.metadata.ino}`;
      if (activeDefectLockInodes.has(parentInode)) {
        throw new HarnessError("LOCK_TIMEOUT", `defect log parent is already active: ${parent}`);
      }
      activeDefectLockInodes.add(parentInode);
      activeDefectParents.set(parentPath, openedParent.metadata);
      acquireExclusiveLock(parentDescriptor, parent);
      parentAcquired = true;
      if (!sameInode(openedParent.metadata, assertRealDirectory(parent, "defect log parent"))) {
        throw new HarnessError("INTEGRITY", `defect log parent changed while locked: ${parent}`);
      }
    } else {
      activeDefectParents.set(parentPath, openedRoot.metadata);
    }

    assertRegularDefectLog(filePath);
    result = operation();
    if (!sameInode(openedRoot.metadata, assertRealDirectory(root, "defect authority root"))) {
      throw new HarnessError("INTEGRITY", `defect authority root changed after mutation: ${root}`);
    }
  } catch (error) {
    hasPrimary = true;
    primary = error;
  }

  for (const cleanup of [
    () => {
      if (parentDescriptor !== undefined && parentAcquired) releaseFlock(parentDescriptor);
    },
    () => {
      if (parentDescriptor !== undefined) closeSync(parentDescriptor);
    },
    () => {
      if (rootDescriptor !== undefined && rootAcquired) releaseFlock(rootDescriptor);
    },
    () => {
      if (rootDescriptor !== undefined) closeSync(rootDescriptor);
    },
  ]) {
    try {
      cleanup();
    } catch (error) {
      if (!hasCleanup) {
        hasCleanup = true;
        cleanupFailure = error;
      }
    }
  }
  activeDefectLockPaths.delete(parentPath);
  activeDefectRootPaths.delete(rootPath);
  activeDefectParents.delete(parentPath);
  activeDefectRoots.delete(rootPath);
  activeDefectAuthorityPaths.delete(parentPath);
  if (rootInode !== undefined) activeDefectRootInodes.delete(rootInode);
  if (parentInode !== undefined) activeDefectLockInodes.delete(parentInode);
  if (hasPrimary) throw primary;
  if (hasCleanup) throw cleanupFailure;
  return result;
}

export function replaceDefectLogFileUnlocked(filePath: string, serialized: string): void {
  assertRegularDefectLog(filePath);
  assertCurrentDefectMutationAuthority(filePath);
  try {
    defectLogDependencies.atomicWrite(filePath, new TextEncoder().encode(serialized));
  } catch (error) {
    throwDefectLogIntegrityError("write", filePath, error);
  }
}

export {
  formatSafeErrorCause,
  hasOwnFilesystemCode,
  isTrustedIntegrityError,
  readOwnDataString,
  throwDefectLogIntegrityError,
};
