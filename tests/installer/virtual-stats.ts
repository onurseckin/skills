import type * as fs from "node:fs";
import { dirname } from "node:path";
import type { VirtualStats } from "../../olt/scripts/src/testing/virtual-fs/index.ts";
import { getInode, normPath, resolveVirtualPath, vfsState } from "./virtual-state.ts";

export function checkAncestorAccess(norm: string, syscall: string): void {
  const parts = norm.split("/").filter(Boolean);
  let curr = "";
  for (let i = 0; i < parts.length - 1; i++) {
    curr += "/" + parts[i];
    const m = vfsState.customModes.get(curr);
    if (m !== undefined && (m & 0o111) === 0) {
      const err = new Error(`EACCES: permission denied, ${syscall} '${norm}'`);
      (err as unknown as { code: string }).code = "EACCES";
      throw err;
    }
  }
}

export function checkWriteAccess(target: string): void {
  const norm = resolveVirtualPath(normPath(target));
  const parent = dirname(norm);
  const parentMode = vfsState.customModes.get(parent);
  if (parentMode !== undefined && (parentMode & 0o222) === 0 && !vfsState.vfs.existsSync(norm)) {
    const err = new Error(`EACCES: permission denied, write '${target}'`);
    (err as unknown as { code: string }).code = "EACCES";
    throw err;
  }
  const fileMode = vfsState.customModes.get(norm);
  if (fileMode !== undefined && (fileMode & 0o222) === 0 && vfsState.vfs.existsSync(norm)) {
    const err = new Error(`EACCES: permission denied, write '${target}'`);
    (err as unknown as { code: string }).code = "EACCES";
    throw err;
  }
}

export function makeInstallerStats(
  s: VirtualStats,
  targetPath: string,
  isLink = false,
  bigint = false,
): fs.Stats | fs.BigIntStats {
  const norm = normPath(targetPath);
  const mtimeMs = vfsState.customMtimes.get(norm) ?? s.mtimeMs;
  const atimeMs = s.atimeMs;
  const ctimeMs = s.ctimeMs;
  const birthtimeMs = s.birthtimeMs;
  const mode = vfsState.customModes.get(norm) ?? (s.isDirectory() ? 0o755 : 0o644);
  const ino = getInode(norm);
  const isSpecial = vfsState.specialFiles.has(norm);
  const specialType = vfsState.specialFiles.get(norm);
  const size = isLink ? (vfsState.symlinks.get(norm)?.length ?? 0) : s.size;

  const methods = {
    isFile: () => !isLink && !isSpecial && s.isFile(),
    isDirectory: () => !isLink && !isSpecial && s.isDirectory(),
    isSymbolicLink: () => isLink,
    isBlockDevice: () => false,
    isCharacterDevice: () => specialType === "character",
    isFIFO: () => specialType === "fifo",
    isSocket: () => specialType === "socket",
  };

  if (bigint) {
    return {
      ...methods,
      dev: 1n,
      ino: BigInt(ino),
      mode: BigInt(mode),
      nlink: 1n,
      uid: 0n,
      gid: 0n,
      rdev: 0n,
      size: BigInt(size),
      blksize: 4096n,
      blocks: BigInt(Math.ceil(size / 512)),
      atimeMs: BigInt(atimeMs),
      mtimeMs: BigInt(mtimeMs),
      ctimeMs: BigInt(ctimeMs),
      birthtimeMs: BigInt(birthtimeMs),
      atimeNs: BigInt(atimeMs) * 1_000_000n,
      mtimeNs: BigInt(mtimeMs) * 1_000_000n,
      ctimeNs: BigInt(ctimeMs) * 1_000_000n,
      birthtimeNs: BigInt(birthtimeMs) * 1_000_000n,
      atime: new Date(atimeMs),
      mtime: new Date(mtimeMs),
      ctime: new Date(ctimeMs),
      birthtime: new Date(birthtimeMs),
    } as unknown as fs.BigIntStats;
  }

  return {
    ...methods,
    dev: 1,
    ino,
    mode,
    nlink: 1,
    uid: 0,
    gid: 0,
    rdev: 0,
    size,
    blksize: 4096,
    blocks: Math.ceil(size / 512),
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
