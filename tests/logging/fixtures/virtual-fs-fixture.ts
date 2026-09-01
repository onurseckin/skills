import type { Mock } from "bun:test";
import * as fs from "node:fs";
import {
  VirtualMemoryFS,
  type VirtualStats,
} from "../../../olt/scripts/src/testing/virtual-fs/index.ts";
import { createFsSpies } from "./virtual-fs-spies.ts";
import { setDefectLogDependenciesForTesting } from "../../../olt/scripts/src/logging/lock.ts";

const vfs = new VirtualMemoryFS();
const openDescriptors = new Map<number, { path: string; position: number; flags: number }>();
let nextFd = 1000;
const customModes = new Map<string, number>();
const customMtimes = new Map<string, number>();
const inodeMap = new Map<string, number>();
let nextInode = 50000;
const symlinks = new Map<string, string>();
const hardlinks = new Map<string, string>();
let spies: Mock<(...args: unknown[]) => unknown>[] = [];
let restoreDefectDeps: (() => void) | undefined;

function norm(p: string): string {
  return p.replace(/\\/g, "/");
}

export function isVirtualLoggingPath(path: string): boolean {
  const s = norm(String(path));
  return (
    s.includes("logging-test") ||
    s.includes("defect-log") ||
    s.includes("logging-sandbox") ||
    s.includes("defects.jsonl") ||
    s.includes(".defect-log") ||
    s.includes("test-promotion") ||
    s.startsWith("/virtual/") ||
    s.startsWith("/virtual")
  );
}

function getInode(path: string): number {
  if (!inodeMap.has(path)) inodeMap.set(path, nextInode++);
  return inodeMap.get(path)!;
}

function makeFsStats(vStats: VirtualStats, targetPath: string, isSymlink = false): fs.Stats {
  const ino = getInode(targetPath);
  const mode = customModes.get(targetPath) ?? (vStats.isDirectory() ? 0o755 : 0o644);
  const mtimeMs = customMtimes.get(targetPath) ?? vStats.mtime.getTime();
  const mtime = new Date(mtimeMs);
  return {
    isFile: () => !isSymlink && vStats.isFile(),
    isDirectory: () => !isSymlink && vStats.isDirectory(),
    isSymbolicLink: () => isSymlink,
    isBlockDevice: () => false,
    isCharacterDevice: () => false,
    isFIFO: () => false,
    isSocket: () => false,
    dev: 1,
    ino,
    mode,
    nlink: hardlinks.has(targetPath) ? 2 : 1,
    uid: 501,
    gid: 20,
    rdev: 0,
    size: isSymlink ? (symlinks.get(targetPath)?.length ?? 0) : vStats.size,
    blksize: 4096,
    blocks: Math.ceil(vStats.size / 512),
    atimeMs: mtimeMs,
    mtimeMs,
    ctimeMs: mtimeMs,
    birthtimeMs: mtimeMs,
    atime: mtime,
    mtime,
    ctime: mtime,
    birthtime: mtime,
  } as unknown as fs.Stats;
}

export function resetVirtualLoggingStore(): void {
  openDescriptors.clear();
  customModes.clear();
  customMtimes.clear();
  inodeMap.clear();
  symlinks.clear();
  hardlinks.clear();
  nextFd = 1000;
  nextInode = 50000;
  vfs.reset();
  vfs.mkdirSync("/virtual", { recursive: true });
}

export function setupVirtualLoggingFS(): VirtualMemoryFS {
  spies = createFsSpies({
    vfs,
    openDescriptors,
    nextFd: () => nextFd++,
    customModes,
    customMtimes,
    symlinks,
    hardlinks,
    isVirtualPath: isVirtualLoggingPath,
    makeStats: makeFsStats,
    norm,
    getInode,
  });

  resetVirtualLoggingStore();

  restoreDefectDeps = setDefectLogDependenciesForTesting({
    readFile: (p, opts) => fs.readFileSync(p, opts),
  });

  return vfs;
}

export function cleanupVirtualLoggingFS(): void {
  resetVirtualLoggingStore();
  if (restoreDefectDeps) {
    try {
      restoreDefectDeps();
    } catch {}
    restoreDefectDeps = undefined;
  }
}

export function getVirtualLoggingFS(): VirtualMemoryFS {
  return vfs;
}
