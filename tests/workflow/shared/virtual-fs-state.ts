import * as fs from "node:fs";
import * as fsPromises from "node:fs/promises";
import * as path from "node:path";
import * as ts from "typescript";
import type { VirtualStats } from "../../../olt/scripts/src/testing/virtual-fs/index.ts";

export interface OpenDescriptor {
  path: string;
  position: number;
  flags: number;
}

export function norm(p: string): string {
  return path.resolve(p).replace(/\\/g, "/");
}

export function isVirtualPath(p: string): boolean {
  const s = norm(p);
  return (
    s.startsWith("/virtual") ||
    s.includes("scratch") ||
    s.includes("tmp") ||
    s.includes("coverage") ||
    s.includes(".olt/worktrees") ||
    s.includes(".olt/runs") ||
    s.includes(".olt/locks") ||
    s.includes("task-check-") ||
    s.includes("grants-run-") ||
    s.includes("harness-") ||
    s.includes("mutation-interlock-") ||
    s.includes("lease-guard-") ||
    s.includes("evidence-policy-") ||
    s.includes("micro-cycle-")
  );
}

const inodeMap = new Map<string, number>();
const customModes = new Map<string, number>();
let nextIno = 10000;

export function getInode(p: string): number {
  const normPath = norm(p);
  let ino = inodeMap.get(normPath);
  if (ino === undefined) {
    ino = nextIno++;
    inodeMap.set(normPath, ino);
  }
  return ino;
}

export function setCustomMode(p: string, mode: number): void {
  customModes.set(norm(p), mode);
}

export function transferCustomMode(src: string, dst: string): void {
  const s = norm(src);
  const d = norm(dst);
  const m = customModes.get(s);
  if (m !== undefined) {
    customModes.set(d, m);
    customModes.delete(s);
  }
}

export function resetInodeMap(): void {
  inodeMap.clear();
  customModes.clear();
  nextIno = 10000;
}

export function makeStats(vStats: VirtualStats, targetPath = "/"): fs.Stats {
  const normPath = norm(targetPath);
  const mtimeMs = vStats.mtime.getTime();
  const mtime = new Date(mtimeMs);
  const ino = getInode(normPath);
  const mode = customModes.get(normPath) ?? vStats.mode ?? (vStats.isDirectory() ? 0o755 : 0o644);
  return {
    isFile: () => vStats.isFile(),
    isDirectory: () => vStats.isDirectory(),
    isSymbolicLink: () => false,
    isBlockDevice: () => false,
    isCharacterDevice: () => false,
    isFIFO: () => false,
    isSocket: () => false,
    dev: 1,
    ino,
    mode,
    nlink: 1,
    uid: 501,
    gid: 20,
    rdev: 0,
    size: vStats.size,
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

export const orig = {
  existsSync: fs.existsSync,
  mkdirSync: fs.mkdirSync,
  writeFileSync: fs.writeFileSync,
  readFileSync: fs.readFileSync,
  readdirSync: fs.readdirSync,
  statSync: fs.statSync,
  lstatSync: fs.lstatSync,
  rmSync: fs.rmSync,
  unlinkSync: fs.unlinkSync,
  openSync: fs.openSync,
  closeSync: fs.closeSync,
  readSync: fs.readSync,
  writeSync: fs.writeSync,
  fstatSync: fs.fstatSync,
  realpathSync: fs.realpathSync,
  renameSync: fs.renameSync,
  appendFileSync: fs.appendFileSync,
  mkdtempSync: fs.mkdtempSync,
  chmodSync: fs.chmodSync,
  utimesSync: fs.utimesSync,
  fsyncSync: fs.fsyncSync,
  mkdir: fsPromises.mkdir,
  mkdtemp: fsPromises.mkdtemp,
  writeFile: fsPromises.writeFile,
  readFile: fsPromises.readFile,
  rm: fsPromises.rm,
  tsReadFile: ts.sys.readFile,
  tsFileExists: ts.sys.fileExists,
  tsDirectoryExists: ts.sys.directoryExists,
  tsGetDirectories: ts.sys.getDirectories,
  tsReadDirectory: ts.sys.readDirectory,
};
