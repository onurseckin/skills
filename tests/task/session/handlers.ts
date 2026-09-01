/**
 * @file handlers.ts
 * Handlers for stats, permissions, rw, and directory traversal in task virtual filesystem.
 */

import * as fs from "node:fs";
import * as path from "node:path";
import type {
  VirtualMemoryFS,
  VirtualStats,
} from "../../../olt/scripts/src/testing/virtual-fs/index.ts";
import { orig, type VirtualTaskState } from "./types.ts";

export function norm(p: string | number): string {
  return path.resolve(String(p)).replace(/\\/g, "/");
}

export function isVirtualPath(p: string): boolean {
  const s = norm(p);
  return (
    s.startsWith("/virtual") ||
    s.includes("task-scratch") ||
    s.includes("test-task") ||
    s.includes("scratch") ||
    s.includes("coverage") ||
    s.includes("dequeue") ||
    s.includes("test-transitions") ||
    s.includes("tmp")
  );
}

export function getInode(s: VirtualTaskState, targetPath: string): number {
  const t = norm(targetPath);
  if (s.hardlinks.has(t)) {
    const parent = s.hardlinks.get(t)!;
    return getInode(s, parent);
  }
  let ino = s.inodeMap.get(t);
  if (ino === undefined) {
    ino = s.nextInode++;
    s.inodeMap.set(t, ino);
  }
  return ino;
}

function getNlink(s: VirtualTaskState, targetPath: string): number {
  const t = norm(targetPath);
  if (s.hardlinks.has(t)) return 2;
  for (const parent of s.hardlinks.values()) {
    if (parent === t) return 2;
  }
  return 1;
}

export function makeFsStats(s: VirtualTaskState, vs: VirtualStats, targetPath: string): fs.Stats {
  const t = norm(targetPath);
  const ino = getInode(s, t);
  const mode = s.customModes.get(t) ?? (vs.isDirectory() ? 0o755 : 0o644);
  const mtimeMs = s.customMtimes.get(t) ?? vs.mtime.getTime();
  const mtime = new Date(mtimeMs);
  const nlink = getNlink(s, t);
  return {
    isFile: () => vs.isFile(),
    isDirectory: () => vs.isDirectory(),
    isSymbolicLink: () => false,
    isBlockDevice: () => false,
    isCharacterDevice: () => false,
    isFIFO: () => false,
    isSocket: () => false,
    dev: 1,
    ino,
    mode,
    nlink,
    uid: 501,
    gid: 20,
    rdev: 0,
    size: vs.size,
    blksize: 4096,
    blocks: Math.ceil(vs.size / 512),
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

export function makeSymlinkStats(s: VirtualTaskState, targetPath: string): fs.Stats {
  const t = norm(targetPath);
  const ino = getInode(s, t);
  const mtimeMs = s.customMtimes.get(t) ?? Date.now();
  const mtime = new Date(mtimeMs);
  const target = s.symlinks.get(t) ?? "";
  return {
    isFile: () => false,
    isDirectory: () => false,
    isSymbolicLink: () => true,
    isBlockDevice: () => false,
    isCharacterDevice: () => false,
    isFIFO: () => false,
    isSocket: () => false,
    dev: 1,
    ino,
    mode: 0o777,
    nlink: 1,
    uid: 501,
    gid: 20,
    rdev: 0,
    size: target.length,
    blksize: 4096,
    blocks: Math.ceil(target.length / 512),
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

export function copyDirRecursive(
  vfs: VirtualMemoryFS,
  srcStr: string,
  dstStr: string,
  s: VirtualTaskState,
): void {
  vfs.mkdirSync(dstStr, { recursive: true });
  for (const entry of vfs.readdirSync(srcStr, { recursive: true }) as string[]) {
    const cSrc = `${srcStr}/${entry}`;
    const cDst = `${dstStr}/${entry}`;
    if (vfs.statSync(cSrc)?.isDirectory()) {
      vfs.mkdirSync(cDst, { recursive: true });
    } else if (vfs.statSync(cSrc)?.isFile()) {
      vfs.writeFileSync(cDst, vfs.readFileSync(cSrc));
      const mode = s.customModes.get(cSrc);
      if (mode !== undefined) s.customModes.set(cDst, mode);
    }
  }
}

export function handleRw(
  s: VirtualTaskState,
  fd: number,
  buf: unknown,
  off: unknown,
  len: unknown,
  pos: unknown,
  isW: boolean,
): number {
  const e = s.openDescriptors.get(fd);
  if (!e) {
    return isW
      ? orig.writeSync(fd, buf as string, off as number, len as number, pos as number)
      : orig.readSync(
          fd,
          buf as NodeJS.ArrayBufferView,
          off as number,
          len as number,
          pos as number,
        );
  }
  const d = s.vfs.existsSync(e.path) ? Buffer.from(s.vfs.readFileSync(e.path)) : Buffer.alloc(0);
  if (!isW) {
    const p = pos !== null && pos !== undefined ? Number(pos) : e.position;
    const rLen = Math.min(len as number, Math.max(0, d.length - p));
    const target = Buffer.isBuffer(buf)
      ? buf
      : Buffer.from(
          (buf as { buffer: ArrayBuffer }).buffer,
          (buf as { byteOffset?: number }).byteOffset ?? 0,
          (buf as { byteLength?: number }).byteLength ?? 0,
        );
    d.subarray(p, p + rLen).copy(target, off as number, 0, rLen);
    if (pos === null || pos === undefined) e.position = p + rLen;
    return rLen;
  }
  const b =
    typeof buf === "string"
      ? Buffer.from(buf)
      : Buffer.isBuffer(buf)
        ? buf
        : Buffer.from(
            (buf as { buffer: ArrayBuffer }).buffer,
            (buf as { byteOffset?: number }).byteOffset ?? 0,
            (buf as { byteLength?: number }).byteLength ?? 0,
          );
  const o = typeof off === "number" ? off : 0;
  const l = typeof len === "number" ? len : b.length;
  const slice = b.subarray(o, o + l);
  const isA = (e.flags & fs.constants.O_APPEND) !== 0;
  const position = typeof pos === "number" ? pos : isA ? d.length : e.position;
  const merged = Buffer.alloc(Math.max(d.length, position + slice.length));
  d.copy(merged, 0, 0, d.length);
  slice.copy(merged, position, 0, slice.length);
  s.vfs.writeFileSync(e.path, merged);
  e.position = position + slice.length;
  return slice.length;
}

export function checkReadPermission(s: VirtualTaskState, targetPath: string): void {
  const mode = s.customModes.get(targetPath);
  if (mode !== undefined && (mode === 0 || (mode & 0o400) === 0)) {
    const err = new Error(`EACCES: permission denied, open '${targetPath}'`);
    (err as unknown as { code: string }).code = "EACCES";
    throw err;
  }
}
