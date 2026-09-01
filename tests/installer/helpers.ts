import { spyOn, type Mock } from "bun:test";
import * as childProcess from "node:child_process";
import * as fs from "node:fs";
import * as fsPromises from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import * as platform from "../../olt/scripts/src/platform/index.ts";
import * as flockFfi from "../../olt/scripts/src/platform/fs/flock-ffi.ts";
import * as nativeRename from "../../olt/scripts/src/installer/native-rename.ts";
import { HarnessError } from "../../olt/scripts/src/core/errors/index.ts";
import { VirtualMemoryFS, VirtualStats } from "../../olt/scripts/src/testing/virtual-fs/index.ts";

let vfs = new VirtualMemoryFS();
const customMtimes = new Map<string, number>();
const customModes = new Map<string, number>();
const symlinks = new Map<string, string>();
const openDescriptors = new Map<number, { path: string; position: number; flags?: number }>();
const inodeMap = new Map<string, number>();
const specialFiles = new Map<string, "socket" | "fifo" | "character">();
const lockedInodes = new Set<number>();
let nextFd = 3000;
let nextIno = 5000;
let fixtureCount = 0;
let spies: Array<Mock<(...args: unknown[]) => unknown> | { mockRestore: () => void }> = [];

export function normPath(p: string | number): string {
  return resolve(String(p)).replace(/\\/g, "/");
}

export function resolveVirtualPath(p: string | number): string {
  const norm = normPath(p);
  if (symlinks.has(norm)) {
    return resolveVirtualPath(symlinks.get(norm)!);
  }
  const parts = norm.split("/").filter(Boolean);
  let current = "";
  for (let i = 0; i < parts.length; i++) {
    current += "/" + parts[i];
    if (symlinks.has(current)) {
      const target = symlinks.get(current)!;
      const rest = parts.slice(i + 1).join("/");
      return resolveVirtualPath(rest ? `${target}/${rest}` : target);
    }
  }
  return norm;
}

export function isVirtualInstallerPath(s: string): boolean {
  const norm = normPath(s);
  return (
    norm.startsWith("/virtual") ||
    norm.includes("scratch") ||
    norm.includes("coverage") ||
    norm.includes("tmp") ||
    norm.includes("harness-installer-repair-") ||
    norm.includes(".agents") ||
    norm.includes(".olt") ||
    vfs.existsSync(norm) ||
    symlinks.has(norm)
  );
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

export function registerSpecialFile(
  path: string,
  type: "socket" | "fifo" | "character" = "socket",
): void {
  specialFiles.set(normPath(path), type);
}

export function makeInstallerStats(
  s: VirtualStats,
  targetPath: string,
  isLink = false,
  bigint = false,
): fs.Stats | fs.BigIntStats {
  const norm = normPath(targetPath);
  const mtimeMs = customMtimes.get(norm) ?? s.mtimeMs;
  const atimeMs = s.atimeMs;
  const ctimeMs = s.ctimeMs;
  const birthtimeMs = s.birthtimeMs;
  const mode = customModes.get(norm) ?? (s.isDirectory() ? 0o755 : 0o644);
  const ino = getInode(norm);
  const isSpecial = specialFiles.has(norm);
  const specialType = specialFiles.get(norm);
  const size = isLink ? (symlinks.get(norm)?.length ?? 0) : s.size;

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

function copyDirRecursive(srcStr: string, dstStr: string): void {
  vfs.mkdirSync(dstStr, { recursive: true });
  const srcMode = customModes.get(srcStr);
  if (srcMode !== undefined) customModes.set(dstStr, srcMode);
  for (const entry of vfs.readdirSync(srcStr, { recursive: true }) as string[]) {
    const cSrc = `${srcStr}/${entry}`;
    const cDst = `${dstStr}/${entry}`;
    if (vfs.statSync(cSrc, { throwIfNoEntry: false })?.isDirectory()) {
      vfs.mkdirSync(cDst, { recursive: true });
      const m = customModes.get(cSrc);
      if (m !== undefined) customModes.set(cDst, m);
    } else if (vfs.statSync(cSrc, { throwIfNoEntry: false })?.isFile()) {
      vfs.writeFileSync(cDst, vfs.readFileSync(cSrc));
      const m = customModes.get(cSrc);
      if (m !== undefined) customModes.set(cDst, m);
    }
  }
}

function handleOpenSync(p: fs.PathLike, flags: string | number): number {
  const norm = normPath(String(p));
  const numFlags = typeof flags === "number" ? flags : 0;
  if ((numFlags & (fs.constants.O_NOFOLLOW ?? 0)) !== 0 && symlinks.has(norm)) {
    const err = new Error(`ELOOP: too many levels of symbolic links, open '${norm}'`);
    (err as unknown as { code: string }).code = "ELOOP";
    throw err;
  }
  const target = resolveVirtualPath(norm);
  if (
    (numFlags & (fs.constants.O_EXCL ?? 0)) !== 0 &&
    (numFlags & (fs.constants.O_CREAT ?? 0)) !== 0 &&
    vfs.existsSync(target)
  ) {
    const err = new Error(`EEXIST: file already exists, open '${target}'`);
    (err as unknown as { code: string }).code = "EEXIST";
    throw err;
  }
  const isWrite =
    (numFlags & (fs.constants.O_WRONLY | fs.constants.O_RDWR | fs.constants.O_CREAT)) !== 0;
  if (isWrite && vfs.statSync(target, { throwIfNoEntry: false })?.isDirectory()) {
    const err = new Error(`EISDIR: illegal operation on a directory, open '${target}'`);
    (err as unknown as { code: string }).code = "EISDIR";
    throw err;
  }
  if (isWrite && !(numFlags & (fs.constants.O_DIRECTORY ?? 0))) {
    const parent = dirname(target);
    if (!vfs.existsSync(parent)) vfs.mkdirSync(parent, { recursive: true });
    if (!vfs.existsSync(target)) vfs.writeFileSync(target, "");
  }
  const isAppend = (numFlags & fs.constants.O_APPEND) !== 0;
  const existingLen =
    vfs.existsSync(target) && !vfs.statSync(target, { throwIfNoEntry: false })?.isDirectory()
      ? vfs.readFileSync(target).length
      : 0;
  const fd = nextFd++;
  openDescriptors.set(fd, { path: target, position: isAppend ? existingLen : 0, flags: numFlags });
  return fd;
}

function handleReadSync(
  fd: number,
  buffer: NodeJS.ArrayBufferView,
  offset: number,
  length: number,
  position?: number | bigint | null,
): number {
  const entry = openDescriptors.get(fd);
  if (!entry || vfs.statSync(entry.path, { throwIfNoEntry: false })?.isDirectory()) return 0;
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

function handleWriteSync(
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

function handleFlock(fd: number): boolean {
  const entry = openDescriptors.get(fd);
  if (!entry) return true;
  const ino = getInode(entry.path);
  if (lockedInodes.has(ino)) return false;
  lockedInodes.add(ino);
  return true;
}

function handleReleaseFlock(fd: number): void {
  const entry = openDescriptors.get(fd);
  if (!entry) return;
  const ino = getInode(entry.path);
  lockedInodes.delete(ino);
}

function handleLstat(
  p: fs.PathLike,
  opts?: { bigint?: boolean },
): fs.Stats | fs.BigIntStats {
  const s = String(p);
  const norm = normPath(s);
  const bigint = Boolean(opts?.bigint);
  if (symlinks.has(norm)) {
    const target = symlinks.get(norm)!;
    const vs =
      vfs.statSync(target, { throwIfNoEntry: false }) ??
      new VirtualStats({ isDir: false, size: target.length });
    return makeInstallerStats(vs, norm, true, bigint);
  }
  const resolved = resolveVirtualPath(norm);
  const vs =
    vfs.statSync(resolved, { throwIfNoEntry: false }) ??
    vfs.statSync(norm, { throwIfNoEntry: false }) ??
    vfs.statSync(s, { throwIfNoEntry: false });
  if (vs) return makeInstallerStats(vs, norm, false, bigint);
  const err = new Error(`ENOENT: no such file or directory, lstat '${s}'`);
  (err as unknown as { code: string }).code = "ENOENT";
  throw err;
}

function handleStat(
  p: fs.PathLike,
  opts?: { bigint?: boolean },
): fs.Stats | fs.BigIntStats {
  const s = String(p);
  const norm = normPath(s);
  const bigint = Boolean(opts?.bigint);
  const resolved = resolveVirtualPath(norm);
  const vs =
    vfs.statSync(resolved, { throwIfNoEntry: false }) ??
    vfs.statSync(norm, { throwIfNoEntry: false }) ??
    vfs.statSync(s, { throwIfNoEntry: false });
  if (vs) return makeInstallerStats(vs, resolved, false, bigint);
  const err = new Error(`ENOENT: no such file or directory, stat '${s}'`);
  (err as unknown as { code: string }).code = "ENOENT";
  throw err;
}

function handleRenameSync(src: fs.PathLike, dst: fs.PathLike): void {
  const srcStr = normPath(String(src));
  const dstStr = normPath(String(dst));
  const stat = vfs.statSync(srcStr, { throwIfNoEntry: false });
  if (!stat && !symlinks.has(srcStr)) {
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
  if (symlinks.has(srcStr)) {
    const target = symlinks.get(srcStr)!;
    symlinks.delete(srcStr);
    symlinks.set(dstStr, target);
    vfs.writeFileSync(dstStr, "");
    vfs.unlinkSync(srcStr);
    return;
  }
  if (stat?.isDirectory()) {
    copyDirRecursive(srcStr, dstStr);
    vfs.rmSync(srcStr, { recursive: true, force: true });
  } else {
    vfs.writeFileSync(dstStr, vfs.readFileSync(srcStr));
    vfs.unlinkSync(srcStr);
  }
}

function handleCreateSymlink(target: string, linkPath: string): void {
  const targetNorm = normPath(target);
  const pathNorm = normPath(linkPath);
  symlinks.set(pathNorm, targetNorm);
  const parent = dirname(pathNorm);
  if (!vfs.existsSync(parent)) vfs.mkdirSync(parent, { recursive: true });
  if (!vfs.existsSync(pathNorm)) {
    vfs.writeFileSync(pathNorm, "");
  }
}

export function setupVirtualInstallerFS(): VirtualMemoryFS {
  cleanupVirtualInstallerFS();
  vfs = new VirtualMemoryFS();
  customMtimes.clear();
  customModes.clear();
  symlinks.clear();
  openDescriptors.clear();
  inodeMap.clear();
  specialFiles.clear();
  lockedInodes.clear();

  const spy = <K extends keyof typeof fs>(k: K, fn: unknown) =>
    spyOn(fs, k).mockImplementation(fn as never) as unknown as Mock<
      (...args: unknown[]) => unknown
    >;

  const spyP = <K extends keyof typeof fsPromises>(k: K, fn: unknown) =>
    spyOn(fsPromises, k).mockImplementation(fn as never) as unknown as Mock<
      (...args: unknown[]) => unknown
    >;

  spies = [
    spy("existsSync", (p: fs.PathLike) => {
      const s = String(p);
      const norm = normPath(s);
      const resolved = resolveVirtualPath(norm);
      return vfs.existsSync(s) || vfs.existsSync(norm) || vfs.existsSync(resolved) || symlinks.has(norm);
    }),
    spy("mkdirSync", (p: fs.PathLike, opts?: fs.MakeDirectoryOptions | boolean) =>
      vfs.mkdirSync(normPath(String(p)), opts as Parameters<typeof vfs.mkdirSync>[1]),
    ),
    spy(
      "writeFileSync",
      (
        p: fs.PathOrFileDescriptor,
        d: string | NodeJS.ArrayBufferView,
        opts?: fs.WriteFileOptions,
      ) => {
        const target = resolveVirtualPath(normPath(String(p)));
        const parent = dirname(target);
        if (parent && !vfs.existsSync(parent)) vfs.mkdirSync(parent, { recursive: true });
        vfs.writeFileSync(
          target,
          typeof d === "string" ? d : Buffer.from(d as Uint8Array),
        );
        if (typeof opts === "object" && opts !== null && typeof opts.mode === "number") {
          customModes.set(target, opts.mode);
        }
      },
    ),
    spy(
      "readFileSync",
      (
        p: fs.PathOrFileDescriptor,
        opts?: { encoding?: BufferEncoding | null; flag?: string } | BufferEncoding | null,
      ) => {
        if (typeof p === "number") {
          const entry = openDescriptors.get(p);
          if (!entry || vfs.statSync(entry.path, { throwIfNoEntry: false })?.isDirectory())
            return "";
          return typeof opts === "string" || (typeof opts === "object" && opts?.encoding)
            ? vfs.readFileSync(entry.path, "utf8")
            : Buffer.from(vfs.readFileSync(entry.path));
        }
        const s = String(p);
        const norm = normPath(s);
        const resolved = resolveVirtualPath(norm);
        const lookup = vfs.existsSync(resolved)
          ? resolved
          : vfs.existsSync(norm)
            ? norm
            : s;
        if (vfs.existsSync(lookup)) {
          if (vfs.statSync(lookup, { throwIfNoEntry: false })?.isDirectory()) {
            const err = new Error(`EISDIR: illegal operation on a directory, read '${lookup}'`);
            (err as unknown as { code: string }).code = "EISDIR";
            throw err;
          }
          return typeof opts === "string" || (typeof opts === "object" && opts?.encoding)
            ? vfs.readFileSync(lookup, "utf8")
            : Buffer.from(vfs.readFileSync(lookup));
        }
        const err = new Error(`ENOENT: no such file or directory, open '${lookup}'`);
        (err as unknown as { code: string }).code = "ENOENT";
        throw err;
      },
    ),
    spy(
      "readdirSync",
      (p: fs.PathLike, opts?: { withFileTypes?: boolean } | BufferEncoding | null) => {
        const s = String(p);
        const norm = normPath(s);
        const resolved = resolveVirtualPath(norm);
        const lookup = vfs.existsSync(resolved)
          ? resolved
          : vfs.existsSync(norm)
            ? norm
            : s;
        return (typeof opts === "object" && opts?.withFileTypes
          ? vfs.readdirSync(lookup, { withFileTypes: true })
          : vfs.readdirSync(lookup)) as unknown as fs.Dirent[] & string[];
      },
    ),
    spy("statSync", handleStat),
    spy("lstatSync", handleLstat),
    spy("symlinkSync", (t: fs.PathLike, p: fs.PathLike) => {
      handleCreateSymlink(String(t), String(p));
    }),
    spy("readlinkSync", (p: fs.PathLike) => {
      const target = symlinks.get(normPath(String(p)));
      if (!target) throw new Error("ENOENT: no such file or directory");
      return target;
    }),
    spy("utimesSync", (p: fs.PathLike, _a: unknown, m: number | string | Date) => {
      customMtimes.set(
        normPath(String(p)),
        typeof m === "number" ? m : m instanceof Date ? m.getTime() : Date.now(),
      );
    }),
    spy("renameSync", handleRenameSync),
    spy("cpSync", (src: string | URL, dst: string | URL) => {
      const srcStr = normPath(String(src));
      const dstStr = normPath(String(dst));
      const stat = vfs.statSync(srcStr, { throwIfNoEntry: false });
      if (!stat) {
        const err = new Error(`ENOENT: no such file or directory, cp '${srcStr}' -> '${dstStr}'`);
        (err as unknown as { code: string }).code = "ENOENT";
        throw err;
      }
      if (stat.isDirectory()) copyDirRecursive(srcStr, dstStr);
      else {
        vfs.writeFileSync(dstStr, vfs.readFileSync(srcStr));
        const m = customModes.get(srcStr);
        if (m !== undefined) customModes.set(dstStr, m);
      }
    }),
    spy("chmodSync", (p: fs.PathLike, m: fs.Mode) => {
      customModes.set(normPath(String(p)), typeof m === "string" ? parseInt(m, 8) : m);
    }),
    spy("fchmodSync", (fd: number, m: fs.Mode) => {
      const entry = openDescriptors.get(fd);
      if (entry) {
        customModes.set(entry.path, typeof m === "string" ? parseInt(m, 8) : m);
      }
    }),
    spy("rmSync", (p: fs.PathLike, opts?: fs.RmOptions) => {
      const norm = normPath(String(p));
      inodeMap.delete(norm);
      symlinks.delete(norm);
      customModes.delete(norm);
      customMtimes.delete(norm);
      specialFiles.delete(norm);
      vfs.rmSync(norm, opts as Parameters<typeof vfs.rmSync>[1]);
    }),
    spy("unlinkSync", (p: fs.PathLike) => {
      const norm = normPath(String(p));
      inodeMap.delete(norm);
      symlinks.delete(norm);
      customModes.delete(norm);
      customMtimes.delete(norm);
      specialFiles.delete(norm);
      vfs.unlinkSync(norm);
    }),
    spy("openSync", handleOpenSync),
    spy("closeSync", (fd: number) => {
      handleReleaseFlock(fd);
      openDescriptors.delete(fd);
    }),
    spy("fstatSync", (fd: number, opts?: { bigint?: boolean }) => {
      const entry = openDescriptors.get(fd);
      const target = entry?.path ?? "/virtual";
      const vs = vfs.statSync(target, { throwIfNoEntry: false });
      return vs
        ? makeInstallerStats(vs, target, false, Boolean(opts?.bigint))
        : (fs.statSync(target, opts as never) as never);
    }),
    spy("readSync", handleReadSync),
    spy("writeSync", handleWriteSync),
    spy("appendFileSync", (p: fs.PathOrFileDescriptor, d: string | Uint8Array) => {
      const target = normPath(String(p));
      const prev = vfs.existsSync(target) ? vfs.readFileSync(target, "utf8") : "";
      vfs.writeFileSync(
        target,
        prev + (typeof d === "string" ? d : Buffer.from(d as Uint8Array).toString("utf8")),
      );
    }),
    spy("fsyncSync", () => {}),
    spy("realpathSync", (p: fs.PathLike) => normPath(String(p))),
    // Async fs/promises spies
    spyP("mkdir", async (p: fs.PathLike, opts?: fs.MakeDirectoryOptions | boolean) => {
      vfs.mkdirSync(normPath(String(p)), opts as Parameters<typeof vfs.mkdirSync>[1]);
      return undefined as never;
    }),
    spyP("writeFile", async (p: fs.PathLike, d: string | Uint8Array, opts?: fs.WriteFileOptions) => {
      const target = resolveVirtualPath(normPath(String(p)));
      const parent = dirname(target);
      if (parent && !vfs.existsSync(parent)) vfs.mkdirSync(parent, { recursive: true });
      vfs.writeFileSync(
        target,
        typeof d === "string" ? d : Buffer.from(d as Uint8Array),
      );
      if (typeof opts === "object" && opts !== null && typeof opts.mode === "number") {
        customModes.set(target, opts.mode);
      }
    }),
    spyP("readFile", async (p: fs.PathLike, opts?: { encoding?: BufferEncoding } | BufferEncoding | null) => {
      const norm = normPath(String(p));
      const resolved = resolveVirtualPath(norm);
      const lookup = vfs.existsSync(resolved)
        ? resolved
        : vfs.existsSync(norm)
          ? norm
          : norm;
      if (!vfs.existsSync(lookup)) {
        const err = new Error(`ENOENT: no such file or directory, open '${norm}'`);
        (err as unknown as { code: string }).code = "ENOENT";
        throw err;
      }
      return (typeof opts === "string" || (typeof opts === "object" && opts?.encoding)
        ? vfs.readFileSync(lookup, "utf8")
        : Buffer.from(vfs.readFileSync(lookup))) as never;
    }),
    spyP("readdir", async (p: fs.PathLike, opts?: { withFileTypes?: boolean } | BufferEncoding | null) => {
      const s = String(p);
      const norm = normPath(s);
      const resolved = resolveVirtualPath(norm);
      const lookup = vfs.existsSync(resolved) ? resolved : norm;
      return (typeof opts === "object" && opts?.withFileTypes
        ? vfs.readdirSync(lookup, { withFileTypes: true })
        : vfs.readdirSync(lookup)) as unknown as fs.Dirent[] & string[];
    }),
    spyP("rename", async (src: fs.PathLike, dst: fs.PathLike) => handleRenameSync(src, dst) as never),
    spyP("lstat", async (p: fs.PathLike, opts?: { bigint?: boolean }) => handleLstat(p, opts) as never),
    spyP("stat", async (p: fs.PathLike, opts?: { bigint?: boolean }) => handleStat(p, opts) as never),
    spyP("realpath", async (p: fs.PathLike) => normPath(String(p))),
    spyP("symlink", async (t: fs.PathLike, p: fs.PathLike) => {
      handleCreateSymlink(String(t), String(p));
    }),
    spyP("readlink", async (p: fs.PathLike) => {
      const target = symlinks.get(normPath(String(p)));
      if (!target) throw new Error("ENOENT: no such file or directory");
      return target;
    }),
    spyP("rm", async (p: fs.PathLike, opts?: fs.RmOptions) => {
      const norm = normPath(String(p));
      inodeMap.delete(norm);
      symlinks.delete(norm);
      customModes.delete(norm);
      customMtimes.delete(norm);
      specialFiles.delete(norm);
      vfs.rmSync(norm, opts as Parameters<typeof vfs.rmSync>[1]);
    }),
    spyP("unlink", async (p: fs.PathLike) => {
      const norm = normPath(String(p));
      inodeMap.delete(norm);
      symlinks.delete(norm);
      customModes.delete(norm);
      customMtimes.delete(norm);
      specialFiles.delete(norm);
      vfs.unlinkSync(norm);
    }),
    spyP("chmod", async (p: fs.PathLike, m: fs.Mode) => {
      customModes.set(normPath(String(p)), typeof m === "string" ? parseInt(m, 8) : m);
    }),
    spyP("cp", async (src: string, dst: string) => {
      const srcStr = normPath(src);
      const dstStr = normPath(dst);
      const stat = vfs.statSync(srcStr, { throwIfNoEntry: false });
      if (!stat) {
        const err = new Error(`ENOENT: no such file or directory, cp '${srcStr}' -> '${dstStr}'`);
        (err as unknown as { code: string }).code = "ENOENT";
        throw err;
      }
      if (stat.isDirectory()) copyDirRecursive(srcStr, dstStr);
      else {
        vfs.writeFileSync(dstStr, vfs.readFileSync(srcStr));
        const m = customModes.get(srcStr);
        if (m !== undefined) customModes.set(dstStr, m);
      }
    }),
    spyOn(platform, "tryExclusiveFlock").mockImplementation(handleFlock as never),
    spyOn(platform, "releaseFlock").mockImplementation(handleReleaseFlock as never),
    spyOn(flockFfi, "tryExclusiveFlock").mockImplementation(handleFlock as never),
    spyOn(flockFfi, "releaseFlock").mockImplementation(handleReleaseFlock as never),
    spyOn(nativeRename, "renameNoReplace").mockImplementation(((src: string, dst: string, label: string) => {
      const srcStr = normPath(src);
      const dstStr = normPath(dst);
      if (vfs.existsSync(dstStr) || symlinks.has(dstStr)) {
        throw new HarnessError("INVALID_STATE", `${label} destination already exists`);
      }
      if (!vfs.existsSync(srcStr) && !symlinks.has(srcStr)) {
        throw new HarnessError("INVALID_STATE", `${label} rename failed with errno 2`);
      }
      handleRenameSync(srcStr, dstStr);
    }) as never),
    spyOn(nativeRename, "exchangePaths").mockImplementation(((left: string, right: string, label: string) => {
      const leftStr = normPath(left);
      const rightStr = normPath(right);
      if (!vfs.existsSync(leftStr) || !vfs.existsSync(rightStr)) {
        throw new HarnessError("INVALID_STATE", `${label} rename failed with errno 2`);
      }
      const tempStr = `${leftStr}.exchange-tmp-${Date.now()}-${Math.random()}`;
      handleRenameSync(leftStr, tempStr);
      handleRenameSync(rightStr, leftStr);
      handleRenameSync(tempStr, rightStr);
    }) as never),
    spyOn(childProcess, "spawnSync").mockImplementation((() => ({
      status: 0,
      stdout: Buffer.from("main\n"),
      stderr: Buffer.from(""),
      output: [null, Buffer.from("main\n"), Buffer.from("")],
      pid: 1234,
      signal: null,
      error: undefined,
    })) as never),
  ];

  return vfs;
}

export function cleanupVirtualInstallerFS(): void {
  for (const s of spies) {
    try {
      s.mockRestore();
    } catch {}
  }
  spies = [];
  openDescriptors.clear();
  customMtimes.clear();
  customModes.clear();
  symlinks.clear();
  inodeMap.clear();
  specialFiles.clear();
  lockedInodes.clear();
  vfs.reset();
}

export async function installerFixture(): Promise<{ root: string; source: string; home: string }> {
  setupVirtualInstallerFS();
  const id = ++fixtureCount;
  const root = `/virtual/installer-repair-${id}`;
  const source = join(root, "source");
  const home = join(root, "home");
  vfs.mkdirSync(join(source, "scripts", "src", "config"), { recursive: true });
  vfs.mkdirSync(home, { recursive: true });
  vfs.writeFileSync(join(source, "SKILL.md"), "---\nname: olt\ndescription: test\n---\n");
  vfs.writeFileSync(join(source, "scripts", "harness.ts"), "console.log('ok')\n");
  customModes.set(normPath(join(source, "scripts", "harness.ts")), 0o755);
  vfs.writeFileSync(
    join(source, "scripts", "package.json"),
    JSON.stringify({ name: "@local/olt-runtime", private: true }),
  );
  vfs.writeFileSync(
    join(source, "scripts", "src", "config", "constants.ts"),
    'export const RUNTIME_VERSION = "0.1.0";\n',
  );
  return { root, source, home };
}

export async function cleanInstallerFixtures(): Promise<void> {
  cleanupVirtualInstallerFS();
}

export function getVirtualInstallerFS(): VirtualMemoryFS {
  return vfs;
}
