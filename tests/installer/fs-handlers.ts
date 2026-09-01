import * as fs from "node:fs";
import { dirname } from "node:path";
import { VirtualStats } from "../../olt/scripts/src/testing/virtual-fs/index.ts";
import { normPath, resolveVirtualPath, vfsState } from "./virtual-state.ts";
import { checkAncestorAccess, checkWriteAccess, makeInstallerStats } from "./virtual-stats.ts";

export function copyDirRecursive(srcStr: string, dstStr: string): void {
  vfsState.vfs.mkdirSync(dstStr, { recursive: true });
  const srcMode = vfsState.customModes.get(srcStr);
  if (srcMode !== undefined) vfsState.customModes.set(dstStr, srcMode);
  for (const entry of vfsState.vfs.readdirSync(srcStr, { recursive: true }) as string[]) {
    const cSrc = `${srcStr}/${entry}`;
    const cDst = `${dstStr}/${entry}`;
    if (vfsState.vfs.statSync(cSrc, { throwIfNoEntry: false })?.isDirectory()) {
      vfsState.vfs.mkdirSync(cDst, { recursive: true });
      const m = vfsState.customModes.get(cSrc);
      if (m !== undefined) vfsState.customModes.set(cDst, m);
    } else if (vfsState.vfs.statSync(cSrc, { throwIfNoEntry: false })?.isFile()) {
      vfsState.vfs.writeFileSync(cDst, vfsState.vfs.readFileSync(cSrc));
      const m = vfsState.customModes.get(cSrc);
      if (m !== undefined) vfsState.customModes.set(cDst, m);
    }
  }
}

export function handleOpenSync(p: fs.PathLike, flags: string | number): number {
  const norm = normPath(String(p));
  checkAncestorAccess(norm, "open");
  const numFlags = typeof flags === "number" ? flags : 0;
  const isWrite =
    (numFlags & (fs.constants.O_WRONLY | fs.constants.O_RDWR | fs.constants.O_CREAT)) !== 0;
  if (isWrite) {
    checkWriteAccess(norm);
  }
  if ((numFlags & (fs.constants.O_NOFOLLOW ?? 0)) !== 0 && vfsState.symlinks.has(norm)) {
    const err = new Error(`ELOOP: too many levels of symbolic links, open '${norm}'`);
    (err as unknown as { code: string }).code = "ELOOP";
    throw err;
  }
  const target = resolveVirtualPath(norm);
  if (
    (numFlags & (fs.constants.O_EXCL ?? 0)) !== 0 &&
    (numFlags & (fs.constants.O_CREAT ?? 0)) !== 0 &&
    vfsState.vfs.existsSync(target)
  ) {
    const err = new Error(`EEXIST: file already exists, open '${target}'`);
    (err as unknown as { code: string }).code = "EEXIST";
    throw err;
  }
  if (isWrite && vfsState.vfs.statSync(target, { throwIfNoEntry: false })?.isDirectory()) {
    const err = new Error(`EISDIR: illegal operation on a directory, open '${target}'`);
    (err as unknown as { code: string }).code = "EISDIR";
    throw err;
  }
  if (isWrite && !(numFlags & (fs.constants.O_DIRECTORY ?? 0))) {
    const parent = dirname(target);
    if (!vfsState.vfs.existsSync(parent)) vfsState.vfs.mkdirSync(parent, { recursive: true });
    if (!vfsState.vfs.existsSync(target)) vfsState.vfs.writeFileSync(target, "");
  }
  const isAppend = (numFlags & fs.constants.O_APPEND) !== 0;
  const existingLen =
    vfsState.vfs.existsSync(target) &&
    !vfsState.vfs.statSync(target, { throwIfNoEntry: false })?.isDirectory()
      ? vfsState.vfs.readFileSync(target).length
      : 0;
  const fd = vfsState.nextFd++;
  vfsState.openDescriptors.set(fd, {
    path: target,
    position: isAppend ? existingLen : 0,
    flags: numFlags,
  });
  return fd;
}

export function handleReadSync(
  fd: number,
  buffer: NodeJS.ArrayBufferView,
  offset: number,
  length: number,
  position?: number | bigint | null,
): number {
  const entry = vfsState.openDescriptors.get(fd);
  if (!entry || vfsState.vfs.statSync(entry.path, { throwIfNoEntry: false })?.isDirectory())
    return 0;
  const data = vfsState.vfs.readFileSync(entry.path);
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
  const entry = vfsState.openDescriptors.get(fd);
  if (!entry) return 0;
  checkWriteAccess(entry.path);
  const byteBuf =
    typeof buffer === "string" ? Buffer.from(buffer) : Buffer.from(buffer as Uint8Array);
  const off = typeof offset === "number" ? offset : 0;
  const len = typeof length === "number" ? length : byteBuf.length;
  const slice = byteBuf.subarray(off, off + len);
  const existing = vfsState.vfs.existsSync(entry.path)
    ? Buffer.from(vfsState.vfs.readFileSync(entry.path))
    : Buffer.alloc(0);
  const isAppend = entry.flags !== undefined && (entry.flags & fs.constants.O_APPEND) !== 0;
  const pos = typeof position === "number" ? position : isAppend ? existing.length : entry.position;
  const newBuf = Buffer.alloc(Math.max(existing.length, pos + slice.length));
  existing.copy(newBuf);
  slice.copy(newBuf, pos);
  vfsState.vfs.writeFileSync(entry.path, newBuf);
  entry.position = pos + slice.length;
  return slice.length;
}

export function handleLstat(
  p: fs.PathLike,
  opts?: { bigint?: boolean },
): fs.Stats | fs.BigIntStats {
  const s = String(p);
  const norm = normPath(s);
  checkAncestorAccess(norm, "lstat");
  const bigint = Boolean(opts?.bigint);
  if (vfsState.symlinks.has(norm)) {
    const target = vfsState.symlinks.get(norm)!;
    const vs =
      vfsState.vfs.statSync(target, { throwIfNoEntry: false }) ??
      new VirtualStats({ isDir: false, size: target.length });
    return makeInstallerStats(vs, norm, true, bigint);
  }
  const resolved = resolveVirtualPath(norm);
  const vs =
    vfsState.vfs.statSync(resolved, { throwIfNoEntry: false }) ??
    vfsState.vfs.statSync(norm, { throwIfNoEntry: false }) ??
    vfsState.vfs.statSync(s, { throwIfNoEntry: false });
  if (vs) return makeInstallerStats(vs, norm, false, bigint);
  const err = new Error(`ENOENT: no such file or directory, lstat '${s}'`);
  (err as unknown as { code: string }).code = "ENOENT";
  throw err;
}

export function handleStat(p: fs.PathLike, opts?: { bigint?: boolean }): fs.Stats | fs.BigIntStats {
  const s = String(p);
  const norm = normPath(s);
  checkAncestorAccess(norm, "stat");
  const bigint = Boolean(opts?.bigint);
  const resolved = resolveVirtualPath(norm);
  const vs =
    vfsState.vfs.statSync(resolved, { throwIfNoEntry: false }) ??
    vfsState.vfs.statSync(norm, { throwIfNoEntry: false }) ??
    vfsState.vfs.statSync(s, { throwIfNoEntry: false });
  if (vs) return makeInstallerStats(vs, resolved, false, bigint);
  const err = new Error(`ENOENT: no such file or directory, stat '${s}'`);
  (err as unknown as { code: string }).code = "ENOENT";
  throw err;
}

export function handleRenameSync(src: fs.PathLike, dst: fs.PathLike): void {
  const srcStr = normPath(String(src));
  const dstStr = normPath(String(dst));
  const stat = vfsState.vfs.statSync(srcStr, { throwIfNoEntry: false });
  if (!stat && !vfsState.symlinks.has(srcStr)) {
    const err = new Error(`ENOENT: no such file or directory, rename '${srcStr}' -> '${dstStr}'`);
    (err as unknown as { code: string }).code = "ENOENT";
    throw err;
  }
  const cMode = vfsState.customModes.get(srcStr);
  if (cMode !== undefined) {
    vfsState.customModes.delete(srcStr);
    vfsState.customModes.set(dstStr, cMode);
  }
  const cTime = vfsState.customMtimes.get(srcStr);
  if (cTime !== undefined) {
    vfsState.customMtimes.delete(srcStr);
    vfsState.customMtimes.set(dstStr, cTime);
  }
  const ino = vfsState.inodeMap.get(srcStr);
  if (ino !== undefined) {
    vfsState.inodeMap.delete(srcStr);
    vfsState.inodeMap.set(dstStr, ino);
  }
  if (vfsState.symlinks.has(srcStr)) {
    const target = vfsState.symlinks.get(srcStr)!;
    vfsState.symlinks.delete(srcStr);
    vfsState.symlinks.set(dstStr, target);
    vfsState.vfs.writeFileSync(dstStr, "");
    vfsState.vfs.unlinkSync(srcStr);
    return;
  }
  if (stat?.isDirectory()) {
    copyDirRecursive(srcStr, dstStr);
    vfsState.vfs.rmSync(srcStr, { recursive: true, force: true });
  } else {
    vfsState.vfs.writeFileSync(dstStr, vfsState.vfs.readFileSync(srcStr));
    vfsState.vfs.unlinkSync(srcStr);
  }
}

export function handleCreateSymlink(target: string, linkPath: string): void {
  const targetNorm = normPath(target);
  const pathNorm = normPath(linkPath);
  vfsState.symlinks.set(pathNorm, targetNorm);
  const parent = dirname(pathNorm);
  if (!vfsState.vfs.existsSync(parent)) vfsState.vfs.mkdirSync(parent, { recursive: true });
  if (!vfsState.vfs.existsSync(pathNorm)) {
    vfsState.vfs.writeFileSync(pathNorm, "");
  }
}
