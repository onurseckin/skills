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
import { dirname, join, relative, resolve, sep } from "node:path";
import { HarnessError } from "../core/errors/index.ts";
import { findRepoRoot } from "../core/index.ts";
import { releaseFlock, tryExclusiveFlock } from "../platform/index.ts";

export interface Location {
  readonly root: string;
  readonly parent: string;
  readonly filePath: string;
}

export interface RepoPolicyReadDependencies {
  readonly afterLstatBeforeOpen?: (path: string) => void;
  readonly afterOpenBeforeRead?: (path: string) => void;
  readonly fstat?: typeof fstatSync;
}

const activeLocks = new Set<string>();

export function reqNoFollow(): number {
  const flag = constants.O_NOFOLLOW;
  if (!Number.isInteger(flag) || flag === 0) {
    throw new HarnessError(
      "UNSUPPORTED_PLATFORM",
      "repository policy authority requires final-component O_NOFOLLOW protection",
    );
  }
  return flag;
}

export function sameInode(a: Pick<Stats, "dev" | "ino">, b: Pick<Stats, "dev" | "ino">): boolean {
  return a.dev === b.dev && a.ino === b.ino;
}

export function safeMsg(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

export function assertOwnedPrivateFile(stat: Stats, path: string): void {
  if (stat.isDirectory()) {
    throw new HarnessError(
      "PATH_SAFETY",
      `Repository policy must be a regular file: ${path} (is a directory)`,
    );
  }
  if (!stat.isFile() || stat.isSymbolicLink()) {
    throw new HarnessError("PATH_SAFETY", `Repository policy must be a regular file: ${path}`);
  }
  if (stat.nlink !== 1) {
    throw new HarnessError("INTEGRITY", `Repository policy must not have hard links: ${path}`);
  }
  const uid = typeof process.getuid === "function" ? process.getuid() : undefined;
  if (uid !== undefined && stat.uid !== uid) {
    throw new HarnessError(
      "INTEGRITY",
      `Repository policy must be owned by the current user: ${path}`,
    );
  }
  if ((stat.mode & 0o022) !== 0) {
    throw new HarnessError(
      "INTEGRITY",
      `Repository policy must not be group- or world-writable: ${path}`,
    );
  }
}

export function assertRealDir(path: string, label: string): Stats {
  const stat = lstatSync(path);
  if (!stat.isDirectory() || stat.isSymbolicLink()) {
    throw new HarnessError("PATH_SAFETY", `${label} must be a real directory: ${path}`);
  }
  return stat;
}

export function isInside(root: string, target: string): boolean {
  const rel = relative(root, target);
  return rel === "" || (!rel.startsWith(`..${sep}`) && rel !== ".." && !rel.startsWith(".."));
}

export function ensureDir(root: string, target: string): void {
  if (!isInside(root, target)) {
    throw new HarnessError(
      "PATH_SAFETY",
      `Repository policy path escapes repository root: ${target}`,
    );
  }
  assertRealDir(root, "repository root");
  const parts = relative(root, target).split(sep).filter(Boolean);
  let cur = root;
  for (const part of parts) {
    cur = join(cur, part);
    if (!existsSync(cur)) mkdirSync(cur, { recursive: false, mode: 0o700 });
    assertRealDir(cur, "repository policy parent");
  }
}

export function checkExistingDir(root: string, target: string): void {
  if (!isInside(root, target)) {
    throw new HarnessError(
      "PATH_SAFETY",
      `Repository policy path escapes repository root: ${target}`,
    );
  }
  assertRealDir(root, "repository root");
  const parts = relative(root, target).split(sep).filter(Boolean);
  let cur = root;
  for (const part of parts) {
    cur = join(cur, part);
    if (!existsSync(cur)) return;
    assertRealDir(cur, "repository policy parent");
  }
}

export function resolvePolicyLocation(
  repoRoot?: string,
  customPath?: string,
  create = false,
): Location {
  const reqRoot = resolve(repoRoot ?? findRepoRoot());
  if (!existsSync(reqRoot)) {
    const missing = customPath?.trim()
      ? resolve(reqRoot, customPath.trim())
      : join(reqRoot, ".olt", "policy.json");
    if (!isInside(reqRoot, missing)) {
      throw new HarnessError(
        "PATH_SAFETY",
        `Custom repository policy path must remain under repository root: ${missing}`,
      );
    }
    if (!create) return { root: reqRoot, parent: dirname(missing), filePath: missing };
    mkdirSync(reqRoot, { recursive: true, mode: 0o700 });
  }
  const root = resolve(reqRoot);
  assertRealDir(root, "repository root");
  const filePath = customPath?.trim()
    ? resolve(root, customPath.trim())
    : join(root, ".olt", "policy.json");
  if (!isInside(root, filePath)) {
    throw new HarnessError(
      "PATH_SAFETY",
      `Custom repository policy path must remain under repository root: ${filePath}`,
    );
  }
  const parent = dirname(filePath);
  if (create) ensureDir(root, parent);
  return { root, parent, filePath };
}

export function readVerifiedFile(
  loc: Location,
  deps: RepoPolicyReadDependencies = {},
): string | undefined {
  if (!existsSync(loc.filePath)) return undefined;
  const before = lstatSync(loc.filePath);
  assertOwnedPrivateFile(before, loc.filePath);
  const fstat = deps.fstat ?? fstatSync;
  let fd: number | undefined;
  try {
    deps.afterLstatBeforeOpen?.(loc.filePath);
    fd = openSync(loc.filePath, constants.O_RDONLY | reqNoFollow());
    const opened = fstat(fd);
    assertOwnedPrivateFile(opened, loc.filePath);
    deps.afterOpenBeforeRead?.(loc.filePath);
    const afterOpen = existsSync(loc.filePath) ? lstatSync(loc.filePath) : undefined;
    if (!afterOpen || !sameInode(before, opened) || !sameInode(opened, afterOpen)) {
      throw new HarnessError(
        "INTEGRITY",
        `Repository policy changed while opening: ${loc.filePath}`,
      );
    }
    const content = readFileSync(fd, "utf-8");
    const afterRead = existsSync(loc.filePath) ? lstatSync(loc.filePath) : undefined;
    const finalStat = fstat(fd);
    if (!afterRead || !sameInode(opened, finalStat) || !sameInode(finalStat, afterRead)) {
      throw new HarnessError(
        "INTEGRITY",
        `Repository policy changed while reading: ${loc.filePath}`,
      );
    }
    return content;
  } finally {
    if (fd !== undefined) closeSync(fd);
  }
}

export function withLock<T>(loc: Location, fn: () => T): T {
  const lockPath = join(loc.parent, ".policy.lock");
  if (activeLocks.has(loc.root)) {
    throw new HarnessError("LOCK_TIMEOUT", `Repository policy lock is already active: ${loc.root}`);
  }
  activeLocks.add(loc.root);
  let fd: number | undefined;
  let acquired = false;
  try {
    fd = openSync(lockPath, constants.O_RDWR | constants.O_CREAT | reqNoFollow(), 0o600);
    assertOwnedPrivateFile(fstatSync(fd), lockPath);
    const deadline = performance.now() + 10_000;
    while (!(acquired = tryExclusiveFlock(fd))) {
      const rem = deadline - performance.now();
      if (rem <= 0) {
        throw new HarnessError(
          "LOCK_TIMEOUT",
          `timed out waiting for repository policy lock: ${lockPath}`,
        );
      }
      Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, Math.min(10, rem));
    }
    return fn();
  } finally {
    if (fd !== undefined && acquired) releaseFlock(fd);
    if (fd !== undefined) closeSync(fd);
    activeLocks.delete(loc.root);
  }
}
