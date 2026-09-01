import type { Mock } from "bun:test";
import * as fs from "node:fs";
import {
  VirtualMemoryFS,
  type VirtualStats,
} from "../../../olt/scripts/src/testing/virtual-fs/index.ts";
import { createFsSpies } from "./virtual-fs-spies.ts";
import { setDefectLogDependenciesForTesting } from "../../../olt/scripts/src/logging/lock.ts";

let vfs = new VirtualMemoryFS();
const openDescriptors = new Map<number, { path: string; position: number; flags: number }>();
let nextFd = 1000;
const customModes = new Map<string, number>();
const customMtimes = new Map<string, number>();
const inodeMap = new Map<string, number>();
let nextInode = 50000;
const symlinks = new Map<string, string>();
const hardlinks = new Map<string, string>();
let spies: Mock<(...args: unknown[]) => unknown>[] = [];

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
    s.startsWith("/virtual/")
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

let restoreDefectDeps: (() => void) | undefined;

export function setupVirtualLoggingFS(): VirtualMemoryFS {
  cleanupVirtualLoggingFS();
  vfs = new VirtualMemoryFS();
  openDescriptors.clear();
  customModes.clear();
  customMtimes.clear();
  inodeMap.clear();
  symlinks.clear();
  hardlinks.clear();

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

  restoreDefectDeps = setDefectLogDependenciesForTesting({
    readFile: (p, opts) => fs.readFileSync(p, opts),
  });

  return vfs;
}

export function cleanupVirtualLoggingFS(): void {
  if (restoreDefectDeps) {
    try {
      restoreDefectDeps();
    } catch {}
    restoreDefectDeps = undefined;
  }
  for (const spy of spies) {
    try {
      spy.mockRestore();
    } catch {}
  }
  spies = [];
  openDescriptors.clear();
  customModes.clear();
  customMtimes.clear();
  inodeMap.clear();
  symlinks.clear();
  hardlinks.clear();
}

export function getVirtualLoggingFS(): VirtualMemoryFS {
  return vfs;
}
