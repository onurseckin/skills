import * as fs from "node:fs";
import { dirname, resolve } from "node:path";
import { VirtualMemoryFS, VirtualStats } from "../../olt/scripts/src/testing/virtual-fs/index.ts";

export const vfs = new VirtualMemoryFS();
export const customMtimes = new Map<string, number>();
export const customModes = new Map<string, number>();
export const openDescriptors = new Map<
  number,
  { path: string; position: number; flags?: number }
>();
export const inodeMap = new Map<string, number>();
export const inodeLockOwners = new Map<number, number>();

let nextFd = 4000;
let nextIno = 6000;
let tmpCount = 0;

export function getNextTmpId(): number {
  return ++tmpCount;
}

export function normPath(p: string | number): string {
  return resolve(String(p)).replace(/\\/g, "/");
}

export function getInode(targetPath: string): number {
  const norm = normPath(targetPath);
  let ino = inodeMap.get(norm);
  if (ino === undefined) {
    ino = nextIno++;
    inodeMap.set(norm, ino);
  }
  return ino;
}

export function makeStats(s: VirtualStats, targetPath: string): fs.Stats {
  const norm = normPath(targetPath);
  const mtimeMs = customMtimes.get(norm) ?? s.mtimeMs;
  const atimeMs = s.atimeMs;
  const ctimeMs = s.ctimeMs;
  const birthtimeMs = s.birthtimeMs;
  const mode = customModes.get(norm) ?? (s.isDirectory() ? 0o755 : 0o644);
  const ino = getInode(norm);
  const uid = typeof process.getuid === "function" ? process.getuid() : 0;
  const gid = typeof process.getgid === "function" ? process.getgid() : 0;

  return {
    isFile: () => s.isFile(),
    isDirectory: () => s.isDirectory(),
    isSymbolicLink: () => false,
    isBlockDevice: () => false,
    isCharacterDevice: () => false,
    isFIFO: () => false,
    isSocket: () => false,
    dev: 1,
    ino,
    mode,
    nlink: 1,
    uid,
    gid,
    rdev: 0,
    size: s.size,
    blksize: 4096,
    blocks: Math.ceil(s.size / 512),
    atimeMs,
    mtimeMs,
    ctimeMs,
    birthtimeMs,
    atime: new Date(atimeMs),
    mtime: new Date(mtimeMs),
    ctime: new Date(ctimeMs),
    birthtime: new Date(birthtimeMs),
  } as unknown as fs.Stats;
}

export function handleMkdirSync(
  p: fs.PathLike,
  opts?: fs.MakeDirectoryOptions | boolean,
): string | undefined {
  const norm = normPath(String(p));
  const parts = norm.split("/").filter(Boolean);
  let curr = "";
  for (let i = 0; i < parts.length - 1; i++) {
    curr += "/" + parts[i];
    const s = vfs.statSync(curr, { throwIfNoEntry: false });
    if (s && s.isFile()) {
      const err = new Error(`ENOTDIR: not a directory, mkdir '${norm}'`);
      (err as unknown as { code: string }).code = "ENOTDIR";
      throw err;
    }
  }
  const res = vfs.mkdirSync(norm, opts as Parameters<typeof vfs.mkdirSync>[1]);
  if (typeof opts === "object" && opts !== null && typeof opts.mode === "number") {
    customModes.set(norm, opts.mode);
  }
  return res;
}

export function handleRenameSync(src: fs.PathLike, dst: fs.PathLike): void {
  const srcStr = normPath(String(src));
  const dstStr = normPath(String(dst));
  const stat = vfs.statSync(srcStr, { throwIfNoEntry: false });
  if (!stat) {
    const err = new Error(`ENOENT: no such file or directory, rename '${srcStr}' -> '${dstStr}'`);
    (err as unknown as { code: string }).code = "ENOENT";
    throw err;
  }
  const cMode = customModes.get(srcStr);
  if (cMode !== undefined) {
    customModes.delete(srcStr);
    customModes.set(dstStr, cMode);
  }
  const cTime = customMtimes.get(srcStr);
  if (cTime !== undefined) {
    customMtimes.delete(srcStr);
    customMtimes.set(dstStr, cTime);
  }
  const ino = inodeMap.get(srcStr);
  if (ino !== undefined) {
    inodeMap.delete(srcStr);
    inodeMap.set(dstStr, ino);
  }
  if (stat.isDirectory()) {
    vfs.mkdirSync(dstStr, { recursive: true });
    for (const entry of vfs.readdirSync(srcStr, { recursive: true }) as string[]) {
      const cSrc = `${srcStr}/${entry}`;
      const cDst = `${dstStr}/${entry}`;
      if (vfs.statSync(cSrc, { throwIfNoEntry: false })?.isDirectory()) {
        vfs.mkdirSync(cDst, { recursive: true });
      } else {
        vfs.writeFileSync(cDst, vfs.readFileSync(cSrc));
      }
    }
    vfs.rmSync(srcStr, { recursive: true, force: true });
  } else {
    vfs.writeFileSync(dstStr, vfs.readFileSync(srcStr));
    vfs.unlinkSync(srcStr);
  }
}

export function handleOpenSync(p: fs.PathLike, flags?: string | number, _mode?: fs.Mode): number {
  const norm = normPath(String(p));
  if (vfs.statSync(norm, { throwIfNoEntry: false })?.isDirectory()) {
    const err = new Error(`EISDIR: illegal operation on a directory, open '${norm}'`);
    (err as unknown as { code: string }).code = "EISDIR";
    throw err;
  }
  const numFlags = typeof flags === "number" ? flags : 0;
  const isExclusive = (numFlags & (fs.constants.O_EXCL ?? 0)) !== 0;
  const isCreate = (numFlags & (fs.constants.O_CREAT ?? 0)) !== 0;
  const isFlagStr = typeof flags === "string";
  if ((isExclusive && isCreate) || flags === "wx" || flags === "ax") {
    if (vfs.existsSync(norm)) {
      const err = new Error(`EEXIST: file already exists, open '${norm}'`);
      (err as unknown as { code: string }).code = "EEXIST";
      throw err;
    }
  }
  const isWrite =
    isFlagStr ||
    (numFlags & (fs.constants.O_WRONLY | fs.constants.O_RDWR | fs.constants.O_CREAT)) !== 0;
  if (isWrite && !vfs.existsSync(norm)) {
    const parent = dirname(norm);
    if (!vfs.existsSync(parent)) handleMkdirSync(parent, { recursive: true });
    vfs.writeFileSync(norm, "");
  }
  const isAppend =
    (numFlags & (fs.constants.O_APPEND ?? 0)) !== 0 ||
    flags === "a" ||
    flags === "a+" ||
    flags === "as" ||
    flags === "as+";
  const existingLen =
    vfs.existsSync(norm) && !vfs.statSync(norm, { throwIfNoEntry: false })?.isDirectory()
      ? vfs.readFileSync(norm).length
      : 0;
  const fd = nextFd++;
  openDescriptors.set(fd, { path: norm, position: isAppend ? existingLen : 0, flags: numFlags });
  return fd;
}

export function handleReadSync(
  fd: number,
  buffer: NodeJS.ArrayBufferView,
  offset: number,
  length: number,
  position?: number | bigint | null,
): number {
  const entry = openDescriptors.get(fd);
  if (
    !entry ||
    !vfs.existsSync(entry.path) ||
    vfs.statSync(entry.path, { throwIfNoEntry: false })?.isDirectory()
  )
    return 0;
  const data = vfs.readFileSync(entry.path);
  const pos = position !== null && position !== undefined ? Number(position) : entry.position;
  const readLen = Math.min(length, Math.max(0, data.length - pos));
  const targetBuf = Buffer.isBuffer(buffer) ? buffer : Buffer.from(buffer.buffer);
  Buffer.from(data)
    .subarray(pos, pos + readLen)
    .copy(targetBuf, offset, 0, readLen);
  if (position === null || position === undefined) {
    entry.position = pos + readLen;
  }
  return readLen;
}

export function handleWriteSync(
  fd: number,
  buffer: NodeJS.ArrayBufferView | string,
  offset?: number | null,
  length?: number | null,
  position?: number | bigint | null,
): number {
  const entry = openDescriptors.get(fd);
  if (!entry) return 0;
  const byteBuf =
    typeof buffer === "string" ? Buffer.from(buffer) : Buffer.from(buffer as Uint8Array);
  const off = typeof offset === "number" ? offset : 0;
  const len = typeof length === "number" ? length : byteBuf.length;
  const slice = byteBuf.subarray(off, off + len);
  const existing = vfs.existsSync(entry.path)
    ? Buffer.from(vfs.readFileSync(entry.path))
    : Buffer.alloc(0);
  const isAppend = entry.flags !== undefined && (entry.flags & fs.constants.O_APPEND) !== 0;
  const pos = typeof position === "number" ? position : isAppend ? existing.length : entry.position;
  const newBuf = Buffer.alloc(Math.max(existing.length, pos + slice.length));
  existing.copy(newBuf);
  slice.copy(newBuf, pos);
  vfs.writeFileSync(entry.path, newBuf);
  entry.position = pos + slice.length;
  return slice.length;
}

export function handleFlock(fd: number): boolean {
  const entry = openDescriptors.get(fd);
  const path = entry?.path ?? String(fd);
  const ino = getInode(path);
  const ownerFd = inodeLockOwners.get(ino);
  if (ownerFd !== undefined && ownerFd !== fd) {
    return false;
  }
  inodeLockOwners.set(ino, fd);
  return true;
}

export function handleReleaseFlock(fd: number): void {
  const entry = openDescriptors.get(fd);
  const path = entry?.path ?? String(fd);
  const ino = getInode(path);
  if (inodeLockOwners.get(ino) === fd) {
    inodeLockOwners.delete(ino);
  }
}
