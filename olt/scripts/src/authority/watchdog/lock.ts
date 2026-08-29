import {
  closeSync,
  constants,
  existsSync,
  fstatSync,
  lstatSync,
  mkdirSync,
  openSync,
  type Stats,
} from "node:fs";
import { basename, dirname, resolve } from "node:path";
import { HarnessError } from "../../core/errors/index.ts";
import { releaseFlock, tryExclusiveFlock } from "../../platform/index.ts";

export const activeWatchdogLockPaths = new Set<string>();
export const activeWatchdogLockInodes = new Set<string>();
export const activeWatchdogLockParents = new Map<string, Pick<Stats, "dev" | "ino">>();
export const activeWatchdogRootPaths = new Set<string>();
export const activeWatchdogRootInodes = new Set<string>();
export const activeWatchdogLockRoots = new Map<string, Pick<Stats, "dev" | "ino">>();
export const activeWatchdogAuthorityPaths = new Map<string, string>();
export let watchdogLockTimeoutMs = 10_000;
export let watchdogLockRetryMs = 10;

/** Test-only seam for deterministic watchdog lock-contention coverage. */
export function setWatchdogLockTimingForTesting(timeoutMs: number, retryMs: number): () => void {
  if (!Number.isFinite(timeoutMs) || timeoutMs < 0 || !Number.isFinite(retryMs) || retryMs < 0) {
    throw new HarnessError(
      "INVALID_ARGUMENT",
      "watchdog lock timing must be finite and non-negative",
    );
  }
  const previousTimeoutMs = watchdogLockTimeoutMs;
  const previousRetryMs = watchdogLockRetryMs;
  watchdogLockTimeoutMs = timeoutMs;
  watchdogLockRetryMs = retryMs;
  return () => {
    watchdogLockTimeoutMs = previousTimeoutMs;
    watchdogLockRetryMs = previousRetryMs;
  };
}

export function requiredNoFollowFlag(): number {
  const flag = constants.O_NOFOLLOW;
  if (!Number.isInteger(flag) || flag === 0) {
    throw new HarnessError(
      "UNSUPPORTED_PLATFORM",
      "watchdog store access requires final-component O_NOFOLLOW protection",
    );
  }
  return flag;
}

export function delay(milliseconds: number): void {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, milliseconds);
}

export function sameInode(
  left: Pick<Stats, "dev" | "ino">,
  right: Pick<Stats, "dev" | "ino">,
): boolean {
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

export function openVerifiedParent(
  parent: string,
  create: boolean,
): { descriptor: number; metadata: Stats } {
  if (!existsSync(parent)) {
    if (!create) {
      throw new HarnessError("INTEGRITY", `watchdog store parent is unavailable: ${parent}`);
    }
    mkdirSync(parent, { recursive: true, mode: 0o700 });
  }
  const before = assertRealDirectory(parent, "watchdog store parent");
  let descriptor: number | undefined;
  try {
    descriptor = openSync(
      parent,
      constants.O_RDONLY | (constants.O_DIRECTORY ?? 0) | requiredNoFollowFlag(),
    );
    const opened = fstatSync(descriptor);
    if (!opened.isDirectory()) {
      throw new HarnessError(
        "PATH_SAFETY",
        `opened watchdog store parent is not a directory: ${parent}`,
      );
    }
    const after = assertRealDirectory(parent, "watchdog store parent");
    if (!sameInode(before, opened) || !sameInode(opened, after)) {
      throw new HarnessError("INTEGRITY", `watchdog store parent changed while opening: ${parent}`);
    }
    return { descriptor, metadata: opened };
  } catch (error) {
    if (descriptor !== undefined) closeSync(descriptor);
    throw error;
  }
}

export function watchdogAuthorityRoot(storePath: string): string {
  const parent = dirname(storePath);
  if (basename(parent) === ".olt") return dirname(parent);
  let candidate = parent;
  while (!existsSync(candidate)) {
    const ancestor = dirname(candidate);
    if (ancestor === candidate) {
      throw new HarnessError("INTEGRITY", `watchdog authority root is unavailable: ${parent}`);
    }
    candidate = ancestor;
  }
  return candidate;
}

export function acquireExclusiveLock(descriptor: number, path: string): void {
  const deadline = performance.now() + watchdogLockTimeoutMs;
  while (!tryExclusiveFlock(descriptor)) {
    const remaining = deadline - performance.now();
    if (remaining <= 0) {
      throw new HarnessError("LOCK_TIMEOUT", `timed out waiting for watchdog store lock: ${path}`);
    }
    delay(Math.min(watchdogLockRetryMs, remaining));
  }
}

export function withWatchdogStoreLock<T>(storePath: string, operation: () => T): T {
  const parent = dirname(storePath);
  const authorityRoot = watchdogAuthorityRoot(storePath);
  const pathIdentity = resolve(parent);
  const rootPathIdentity = resolve(authorityRoot);
  if (activeWatchdogLockPaths.has(pathIdentity) || activeWatchdogRootPaths.has(rootPathIdentity)) {
    throw new HarnessError(
      "LOCK_TIMEOUT",
      `watchdog store is already active in this process: ${storePath}`,
    );
  }

  let rootDescriptor: number | undefined;
  let rootAcquired = false;
  let rootInodeIdentity: string | undefined;
  let rootTracked = false;
  let parentDescriptor: number | undefined;
  let parentAcquired = false;
  let parentInodeIdentity: string | undefined;
  let parentTracked = false;
  let hasPrimary = false;
  let primary: unknown;
  let hasCleanupFailure = false;
  let cleanupFailure: unknown;
  let result!: T;
  activeWatchdogLockPaths.add(pathIdentity);
  activeWatchdogRootPaths.add(rootPathIdentity);
  activeWatchdogAuthorityPaths.set(pathIdentity, rootPathIdentity);
  try {
    const openedRoot = openVerifiedParent(authorityRoot, false);
    rootDescriptor = openedRoot.descriptor;
    rootInodeIdentity = `${openedRoot.metadata.dev}:${openedRoot.metadata.ino}`;
    if (activeWatchdogRootInodes.has(rootInodeIdentity)) {
      throw new HarnessError(
        "LOCK_TIMEOUT",
        `watchdog authority root is already active: ${authorityRoot}`,
      );
    }
    activeWatchdogRootInodes.add(rootInodeIdentity);
    rootTracked = true;
    activeWatchdogLockRoots.set(rootPathIdentity, openedRoot.metadata);
    acquireExclusiveLock(rootDescriptor, authorityRoot);
    rootAcquired = true;
    if (
      !sameInode(openedRoot.metadata, assertRealDirectory(authorityRoot, "watchdog authority root"))
    ) {
      throw new HarnessError(
        "INTEGRITY",
        `watchdog authority root changed while locked: ${authorityRoot}`,
      );
    }

    if (pathIdentity === rootPathIdentity) {
      activeWatchdogLockParents.set(pathIdentity, openedRoot.metadata);
    } else {
      const openedParent = openVerifiedParent(parent, true);
      parentDescriptor = openedParent.descriptor;
      parentInodeIdentity = `${openedParent.metadata.dev}:${openedParent.metadata.ino}`;
      if (activeWatchdogLockInodes.has(parentInodeIdentity)) {
        throw new HarnessError(
          "LOCK_TIMEOUT",
          `watchdog store parent is already active: ${parent}`,
        );
      }
      activeWatchdogLockInodes.add(parentInodeIdentity);
      parentTracked = true;
      activeWatchdogLockParents.set(pathIdentity, openedParent.metadata);
      acquireExclusiveLock(parentDescriptor, parent);
      parentAcquired = true;
      if (!sameInode(openedParent.metadata, assertRealDirectory(parent, "watchdog store parent"))) {
        throw new HarnessError(
          "INTEGRITY",
          `watchdog store parent changed while locked: ${parent}`,
        );
      }
    }

    result = operation();
    const expectedRoot = activeWatchdogLockRoots.get(rootPathIdentity);
    if (
      expectedRoot === undefined ||
      !sameInode(expectedRoot, assertRealDirectory(authorityRoot, "watchdog authority root"))
    ) {
      throw new HarnessError(
        "INTEGRITY",
        `watchdog authority root changed after mutation: ${authorityRoot}`,
      );
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
      if (!hasCleanupFailure) {
        hasCleanupFailure = true;
        cleanupFailure = error;
      }
    }
  }
  activeWatchdogLockPaths.delete(pathIdentity);
  activeWatchdogRootPaths.delete(rootPathIdentity);
  activeWatchdogLockParents.delete(pathIdentity);
  activeWatchdogLockRoots.delete(rootPathIdentity);
  activeWatchdogAuthorityPaths.delete(pathIdentity);
  if (parentTracked && parentInodeIdentity !== undefined)
    activeWatchdogLockInodes.delete(parentInodeIdentity);
  if (rootTracked && rootInodeIdentity !== undefined)
    activeWatchdogRootInodes.delete(rootInodeIdentity);
  if (hasPrimary) throw primary;
  if (hasCleanupFailure) throw cleanupFailure;
  return result;
}

export function assertCurrentLockAuthority(storePath: string): void {
  const parent = dirname(storePath);
  const pathIdentity = resolve(parent);
  const rootPathIdentity = activeWatchdogAuthorityPaths.get(pathIdentity);
  const expected = activeWatchdogLockParents.get(pathIdentity);
  const expectedRoot =
    rootPathIdentity === undefined ? undefined : activeWatchdogLockRoots.get(rootPathIdentity);
  if (expected === undefined) {
    throw new HarnessError(
      "INTEGRITY",
      `watchdog store write has no active lock authority: ${storePath}`,
    );
  }
  const current = assertRealDirectory(parent, "watchdog store parent");
  if (!sameInode(expected, current)) {
    throw new HarnessError("INTEGRITY", `watchdog store parent changed before write: ${parent}`);
  }
  if (
    expectedRoot === undefined ||
    rootPathIdentity === undefined ||
    !sameInode(expectedRoot, assertRealDirectory(rootPathIdentity, "watchdog authority root"))
  ) {
    throw new HarnessError(
      "INTEGRITY",
      `watchdog authority root changed before write: ${rootPathIdentity ?? "unknown"}`,
    );
  }
}
