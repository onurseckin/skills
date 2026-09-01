import type { Mock } from "bun:test";
import type * as fs from "node:fs";
import {
  VirtualMemoryFS,
  type VirtualStats,
} from "../../../olt/scripts/src/testing/virtual-fs/index.ts";
import { createFsSpies } from "./virtual-fs-spies.ts";

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

export function isVirtualWorktreePath(path: string): boolean {
  const s = norm(String(path));
  return (
    s.includes("worktree") ||
    s.includes("domain-sync") ||
    s.includes("phase-commits") ||
    s.includes("git-preservation") ||
    s.includes("git-scope") ||
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

export function setupVirtualWorktreeFS(): VirtualMemoryFS {
  cleanupVirtualWorktreeFS();
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
    isVirtualPath: isVirtualWorktreePath,
    makeStats: makeFsStats,
    norm,
    getInode,
  });

  return vfs;
}

export function cleanupVirtualWorktreeFS(): void {
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

export function getVirtualWorktreeFS(): VirtualMemoryFS {
  return vfs;
}
