/**
 * @file virtual-fs-session.ts
 * Virtual In-Memory Filesystem Session and Spy Manager for tests/store domain.
 * Provides 100% in-memory POSIX filesystem mocking with inode tracking,
 * permission checks, symlink resolution, and descriptor emulation.
 */

import { spyOn, type Mock } from "bun:test";
import * as fs from "node:fs";
import * as path from "node:path";
import * as platform from "../../olt/scripts/src/platform/index.ts";
import * as flockFfi from "../../olt/scripts/src/platform/fs/flock-ffi.ts";
import {
  VirtualMemoryFS,
  type VirtualStats,
} from "../../olt/scripts/src/testing/virtual-fs/index.ts";

export interface VirtualStoreState {
  vfs: VirtualMemoryFS;
  openDescriptors: Map<number, { path: string; position: number; flags: number }>;
  customModes: Map<string, number>;
  customMtimes: Map<string, number>;
  inodeMap: Map<string, number>;
  symlinks: Map<string, string>;
  hardlinks: Map<string, string>;
  nextFd: number;
  nextInode: number;
}

const orig = {
  existsSync: fs.existsSync,
  mkdirSync: fs.mkdirSync,
  writeFileSync: fs.writeFileSync,
  readFileSync: fs.readFileSync,
  readdirSync: fs.readdirSync,
  statSync: fs.statSync,
  lstatSync: fs.lstatSync,
  rmSync: fs.rmSync,
  unlinkSync: fs.unlinkSync,
  symlinkSync: fs.symlinkSync,
  readlinkSync: fs.readlinkSync,
  linkSync: fs.linkSync,
  openSync: fs.openSync,
  closeSync: fs.closeSync,
  readSync: fs.readSync,
  writeSync: fs.writeSync,
  ftruncateSync: fs.ftruncateSync,
  truncateSync: fs.truncateSync,
  chmodSync: fs.chmodSync,
  fchmodSync: fs.fchmodSync,
  fstatSync: fs.fstatSync,
  realpathSync: fs.realpathSync,
  renameSync: fs.renameSync,
  cpSync: fs.cpSync,
  copyFileSync: fs.copyFileSync,
  utimesSync: fs.utimesSync,
  futimesSync: fs.futimesSync,
  appendFileSync: fs.appendFileSync,
  fsyncSync: fs.fsyncSync,
  mkdtempSync: fs.mkdtempSync,
};

function norm(p: string | number): string {
  return path.resolve(String(p)).replace(/\\/g, "/");
}

function isVirtualPath(p: string): boolean {
  const s = norm(p);
  return (
    s.startsWith("/virtual") ||
    s.includes("store-scratch") ||
    s.includes("capsule") ||
    s.includes("scratch") ||
    s.includes("coverage") ||
    s.includes("tmp")
  );
}

function getInode(s: VirtualStoreState, targetPath: string): number {
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

function makeFsStats(s: VirtualStoreState, vs: VirtualStats, targetPath: string): fs.Stats {
  const t = norm(targetPath);
  const ino = getInode(s, t);
  const mode = s.customModes.get(t) ?? (vs.isDirectory() ? 0o755 : 0o644);
  const mtimeMs = s.customMtimes.get(t) ?? vs.mtime.getTime();
  const mtime = new Date(mtimeMs);
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
    nlink: s.hardlinks.has(t) ? 2 : 1,
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

function makeSymlinkStats(s: VirtualStoreState, targetPath: string): fs.Stats {
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

function copyDirRecursive(
  vfs: VirtualMemoryFS,
  srcStr: string,
  dstStr: string,
  s: VirtualStoreState,
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

function handleRw(
  s: VirtualStoreState,
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
      : Buffer.from((buf as { buffer: ArrayBuffer }).buffer);
    d.subarray(p, p + rLen).copy(target, off as number, 0, rLen);
    if (pos === null || pos === undefined) e.position = p + rLen;
    return rLen;
  }
  const b =
    typeof buf === "string"
      ? Buffer.from(buf)
      : Buffer.isBuffer(buf)
        ? buf
        : Buffer.from((buf as { buffer: ArrayBuffer }).buffer);
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

export function createStoreFsSpies(
  s: VirtualStoreState,
): Array<{ mockRestore: () => void }> {
  const spy = <K extends keyof typeof fs>(k: K, fn: unknown) =>
    spyOn(fs, k).mockImplementation(fn as never) as unknown as Mock<
      (...args: unknown[]) => unknown
    >;

  const checkReadPermission = (targetPath: string): void => {
    const mode = s.customModes.get(targetPath);
    if (mode !== undefined && (mode === 0 || (mode & 0o400) === 0)) {
      const err = new Error(`EACCES: permission denied, open '${targetPath}'`);
      (err as unknown as { code: string }).code = "EACCES";
      throw err;
    }
  };

  const checkTraversePermission = (targetPath: string): void => {
    let curr = path.dirname(targetPath);
    while (curr && curr !== "/" && curr !== ".") {
      const mode = s.customModes.get(curr);
      if (mode !== undefined && (mode & 0o111) === 0) {
        const err = new Error(`EACCES: permission denied, lstat '${targetPath}'`);
        (err as unknown as { code: string }).code = "EACCES";
        throw err;
      }
      const next = path.dirname(curr);
      if (next === curr) break;
      curr = next;
    }
  };

  return [
    spy("existsSync", (p: fs.PathLike) => {
      const t = norm(String(p));
      if (s.symlinks.has(t)) {
        const target = s.symlinks.get(t)!;
        return s.vfs.existsSync(target);
      }
      return (
        s.vfs.existsSync(t) ||
        s.hardlinks.has(t) ||
        (!isVirtualPath(t) && orig.existsSync(t))
      );
    }),
    spy("mkdirSync", (p: fs.PathLike, opts?: fs.MakeDirectoryOptions | boolean) => {
      const t = norm(String(p));
      if (isVirtualPath(t) || s.vfs.existsSync(t)) {
        s.vfs.mkdirSync(t, opts as Parameters<typeof s.vfs.mkdirSync>[1]);
        return t;
      }
      return orig.mkdirSync(t, opts as Parameters<typeof orig.mkdirSync>[1]);
    }),
    spy(
      "writeFileSync",
      (
        p: fs.PathOrFileDescriptor,
        d: string | NodeJS.ArrayBufferView,
        opts?: fs.WriteFileOptions,
      ) => {
        if (typeof p === "number") {
          handleRw(s, p, d, 0, (d as { length?: number })?.length ?? 0, null, true);
          return;
        }
        const t = norm(String(p));
        const parent = path.dirname(t);
        if (parent && !s.vfs.existsSync(parent)) s.vfs.mkdirSync(parent, { recursive: true });
        s.vfs.writeFileSync(
          t,
          typeof d === "string" ? d : Buffer.from(d as Uint8Array),
        );
        if (typeof opts === "object" && opts !== null && typeof opts.mode === "number") {
          s.customModes.set(t, opts.mode);
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
          const e = s.openDescriptors.get(p);
          const t = e ? e.path : "";
          return typeof opts === "string" ||
            (typeof opts === "object" && (opts as { encoding?: string })?.encoding)
            ? s.vfs.readFileSync(t, "utf8")
            : s.vfs.readFileSync(t);
        }
        const t = norm(String(p));
        checkReadPermission(t);
        if (s.symlinks.has(t)) {
          const target = s.symlinks.get(t)!;
          if (!s.vfs.existsSync(target)) {
            const err = new Error(`ENOENT: no such file or directory, open '${t}'`);
            (err as unknown as { code: string }).code = "ENOENT";
            throw err;
          }
          return s.vfs.readFileSync(target, opts as Parameters<typeof s.vfs.readFileSync>[1]);
        }
        if (s.vfs.existsSync(t)) {
          if (s.vfs.statSync(t)?.isDirectory()) {
            const err = new Error(`EISDIR: illegal operation on a directory, read '${t}'`);
            (err as unknown as { code: string }).code = "EISDIR";
            throw err;
          }
          return s.vfs.readFileSync(t, opts as Parameters<typeof s.vfs.readFileSync>[1]);
        }
        return !isVirtualPath(t)
          ? orig.readFileSync(t, opts as BufferEncoding)
          : s.vfs.readFileSync(t, opts as Parameters<typeof s.vfs.readFileSync>[1]);
      },
    ),
    spy(
      "readdirSync",
      (p: fs.PathLike, opts?: { withFileTypes?: boolean } | BufferEncoding | null) => {
        const t = norm(String(p));
        checkReadPermission(t);
        if (s.vfs.existsSync(t)) {
          const vResults =
            typeof opts === "object" && opts?.withFileTypes
              ? (s.vfs.readdirSync(t, { withFileTypes: true }) as unknown as fs.Dirent[])
              : (s.vfs.readdirSync(t) as unknown as string[]);
          const linkNames = new Set<string>();
          for (const linkPath of s.symlinks.keys()) {
            if (path.dirname(linkPath) === t) linkNames.add(path.basename(linkPath));
          }
          if (linkNames.size === 0) return vResults as never;
          if (typeof opts === "object" && opts?.withFileTypes) {
            const list = [...(vResults as unknown as fs.Dirent[])];
            const existing = new Set(list.map((e) => e.name));
            for (const name of linkNames) {
              if (!existing.has(name)) {
                list.push({
                  name,
                  isFile: () => false,
                  isDirectory: () => false,
                  isSymbolicLink: () => true,
                  isBlockDevice: () => false,
                  isCharacterDevice: () => false,
                  isFIFO: () => false,
                  isSocket: () => false,
                } as unknown as fs.Dirent);
              }
            }
            return list as never;
          }
          const list = [...(vResults as unknown as string[])];
          for (const name of linkNames) {
            if (!list.includes(name)) list.push(name);
          }
          return list.sort() as never;
        }
        return !isVirtualPath(t)
          ? orig.readdirSync(t, opts as Parameters<typeof orig.readdirSync>[1])
          : (s.vfs.readdirSync(t) as unknown as string[]);
      },
    ),
    spy("statSync", (p: fs.PathLike) => {
      const t = norm(String(p));
      checkTraversePermission(t);
      if (s.symlinks.has(t)) {
        const target = s.symlinks.get(t)!;
        const vs = s.vfs.existsSync(target) ? s.vfs.statSync(target) : undefined;
        if (vs) return makeFsStats(s, vs, target);
        const err = new Error(`ENOENT: no such file or directory, stat '${t}'`);
        (err as unknown as { code: string }).code = "ENOENT";
        throw err;
      }
      const vs = s.vfs.existsSync(t) ? s.vfs.statSync(t) : undefined;
      if (vs) return makeFsStats(s, vs, t);
      if (!isVirtualPath(t)) return orig.statSync(t);
      const err = new Error(`ENOENT: no such file or directory, stat '${t}'`);
      (err as unknown as { code: string }).code = "ENOENT";
      throw err;
    }),
    spy("lstatSync", (p: fs.PathLike) => {
      const t = norm(String(p));
      checkTraversePermission(t);
      if (s.symlinks.has(t)) return makeSymlinkStats(s, t);
      const vs = s.vfs.existsSync(t) ? s.vfs.statSync(t) : undefined;
      if (vs) return makeFsStats(s, vs, t);
      if (!isVirtualPath(t)) return orig.lstatSync(t);
      const err = new Error(`ENOENT: no such file or directory, lstat '${t}'`);
      (err as unknown as { code: string }).code = "ENOENT";
      throw err;
    }),
    spy("rmSync", (p: fs.PathLike, opts?: fs.RmOptions) => {
      const t = norm(String(p));
      s.symlinks.delete(t);
      s.hardlinks.delete(t);
      s.customModes.delete(t);
      s.customMtimes.delete(t);
      if (s.vfs.existsSync(t)) s.vfs.rmSync(t, opts as Parameters<typeof s.vfs.rmSync>[1]);
      else if (!isVirtualPath(t)) orig.rmSync(t, opts);
    }),
    spy("unlinkSync", (p: fs.PathLike) => {
      const t = norm(String(p));
      s.symlinks.delete(t);
      s.hardlinks.delete(t);
      s.customModes.delete(t);
      s.customMtimes.delete(t);
      if (s.vfs.existsSync(t)) s.vfs.unlinkSync(t);
      else if (!isVirtualPath(t)) orig.unlinkSync(t);
    }),
    spy("symlinkSync", (target: fs.PathLike, link: fs.PathLike) => {
      const l = norm(String(link));
      const t = norm(String(target));
      s.symlinks.set(l, t);
    }),
    spy("readlinkSync", (p: fs.PathLike) => {
      const t = norm(String(p));
      if (s.symlinks.has(t)) return s.symlinks.get(t)!;
      return orig.readlinkSync(t);
    }),
    spy("linkSync", (src: fs.PathLike, dst: fs.PathLike) => {
      const sStr = norm(String(src));
      const dStr = norm(String(dst));
      s.hardlinks.set(dStr, sStr);
      if (s.vfs.existsSync(sStr)) {
        const parent = path.dirname(dStr);
        if (parent && !s.vfs.existsSync(parent)) s.vfs.mkdirSync(parent, { recursive: true });
        s.vfs.writeFileSync(dStr, s.vfs.readFileSync(sStr));
        const mode = s.customModes.get(sStr);
        if (mode !== undefined) s.customModes.set(dStr, mode);
        return;
      }
      if (!isVirtualPath(sStr) && !isVirtualPath(dStr)) {
        orig.linkSync(sStr, dStr);
      }
    }),
    spy("openSync", (p: fs.PathLike, flags: string | number) => {
      const t = norm(String(p));
      const numFlags = typeof flags === "number" ? flags : 0;
      const isW =
        (numFlags & (fs.constants.O_WRONLY | fs.constants.O_RDWR | fs.constants.O_CREAT)) !== 0;
      const isA = (numFlags & fs.constants.O_APPEND) !== 0;
      if (!isW && !s.vfs.existsSync(t)) {
        if (!isVirtualPath(t)) return orig.openSync(t, flags as Parameters<typeof orig.openSync>[1]);
        const err = new Error(`ENOENT: no such file or directory, open '${t}'`);
        (err as unknown as { code: string }).code = "ENOENT";
        throw err;
      }
      if (isW && !s.vfs.existsSync(t) && (numFlags & (fs.constants.O_DIRECTORY ?? 0)) === 0) {
        s.vfs.writeFileSync(t, "");
      }
      const len =
        s.vfs.existsSync(t) && !s.vfs.statSync(t)?.isDirectory() ? s.vfs.readFileSync(t).length : 0;
      const fd = s.nextFd++;
      s.openDescriptors.set(fd, { path: t, position: isA ? len : 0, flags: numFlags });
      return fd;
    }),
    spy("closeSync", (fd: number) => {
      if (s.openDescriptors.has(fd)) {
        s.openDescriptors.delete(fd);
        return;
      }
      orig.closeSync(fd);
    }),
    spy("readSync", (fd: number, b: unknown, o: unknown, l: unknown, pos: unknown) =>
      handleRw(s, fd, b, o, l, pos, false),
    ),
    spy("writeSync", (fd: number, b: unknown, o: unknown, l: unknown, pos: unknown) =>
      handleRw(s, fd, b, o, l, pos, true),
    ),
    spy("ftruncateSync", (fd: number, len?: number | null) => {
      const entry = s.openDescriptors.get(fd);
      if (!entry) return orig.ftruncateSync(fd, len ?? 0);
      const targetLen = typeof len === "number" ? len : 0;
      const data = s.vfs.existsSync(entry.path)
        ? Buffer.from(s.vfs.readFileSync(entry.path))
        : Buffer.alloc(0);
      const newBuf = Buffer.alloc(targetLen);
      data.copy(newBuf, 0, 0, Math.min(data.length, targetLen));
      s.vfs.writeFileSync(entry.path, newBuf);
      entry.position = Math.min(entry.position, targetLen);
    }),
    spy("truncateSync", (p: fs.PathLike, len?: number | null) => {
      const t = norm(String(p));
      if (isVirtualPath(t) || s.vfs.existsSync(t)) {
        const targetLen = typeof len === "number" ? len : 0;
        const data = s.vfs.existsSync(t)
          ? Buffer.from(s.vfs.readFileSync(t))
          : Buffer.alloc(0);
        const newBuf = Buffer.alloc(targetLen);
        data.copy(newBuf, 0, 0, Math.min(data.length, targetLen));
        s.vfs.writeFileSync(t, newBuf);
        return;
      }
      orig.truncateSync(t, len ?? 0);
    }),
    spy("fstatSync", (fd: number) => {
      const e = s.openDescriptors.get(fd);
      if (e) {
        const vs = s.vfs.statSync(e.path);
        if (vs) return makeFsStats(s, vs, e.path);
      }
      return orig.fstatSync(fd);
    }),
    spy("chmodSync", (p: fs.PathLike, m: fs.Mode) => {
      const t = norm(String(p));
      const modeNum = typeof m === "string" ? parseInt(m, 8) : m;
      s.customModes.set(t, modeNum);
    }),
    spy("fchmodSync", (fd: number, m: fs.Mode) => {
      const entry = s.openDescriptors.get(fd);
      if (entry) {
        const modeNum = typeof m === "string" ? parseInt(m, 8) : m;
        s.customModes.set(entry.path, modeNum);
        return;
      }
      orig.fchmodSync(fd, m);
    }),
    spy("realpathSync", (p: fs.PathLike) => {
      const t = norm(String(p));
      return isVirtualPath(t) || s.vfs.existsSync(t) || s.symlinks.has(t)
        ? s.symlinks.get(t) ?? t
        : orig.realpathSync(t);
    }),
    spy("renameSync", (src: fs.PathLike, dst: fs.PathLike) => {
      const sStr = norm(String(src));
      const dStr = norm(String(dst));
      if (s.vfs.existsSync(sStr)) {
        const st = s.vfs.statSync(sStr);
        if (st?.isDirectory()) {
          copyDirRecursive(s.vfs, sStr, dStr, s);
          s.vfs.rmSync(sStr, { recursive: true, force: true });
        } else {
          const parent = path.dirname(dStr);
          if (parent && !s.vfs.existsSync(parent)) s.vfs.mkdirSync(parent, { recursive: true });
          s.vfs.writeFileSync(dStr, s.vfs.readFileSync(sStr));
          s.vfs.unlinkSync(sStr);
          const mode = s.customModes.get(sStr);
          if (mode !== undefined) {
            s.customModes.delete(sStr);
            s.customModes.set(dStr, mode);
          }
          const mtime = s.customMtimes.get(sStr);
          if (mtime !== undefined) {
            s.customMtimes.delete(sStr);
            s.customMtimes.set(dStr, mtime);
          }
        }
        return;
      }
      orig.renameSync(sStr, dStr);
    }),
    spy("cpSync", (src: string | URL, dst: string | URL) => {
      const sStr = norm(String(src));
      const dStr = norm(String(dst));
      if (s.vfs.existsSync(sStr)) {
        const st = s.vfs.statSync(sStr);
        if (st?.isDirectory()) {
          copyDirRecursive(s.vfs, sStr, dStr, s);
        } else {
          const parent = path.dirname(dStr);
          if (parent && !s.vfs.existsSync(parent)) s.vfs.mkdirSync(parent, { recursive: true });
          s.vfs.writeFileSync(dStr, s.vfs.readFileSync(sStr));
          const mode = s.customModes.get(sStr);
          if (mode !== undefined) s.customModes.set(dStr, mode);
        }
        return;
      }
      orig.cpSync(sStr, dStr);
    }),
    spy("copyFileSync", (src: fs.PathLike, dst: fs.PathLike) => {
      const sStr = norm(String(src));
      const dStr = norm(String(dst));
      if (s.vfs.existsSync(sStr)) {
        const parent = path.dirname(dStr);
        if (parent && !s.vfs.existsSync(parent)) s.vfs.mkdirSync(parent, { recursive: true });
        s.vfs.writeFileSync(dStr, s.vfs.readFileSync(sStr));
        const mode = s.customModes.get(sStr);
        if (mode !== undefined) s.customModes.set(dStr, mode);
        return;
      }
      orig.copyFileSync(sStr, dStr);
    }),
    spy("utimesSync", (p: fs.PathLike, _a: unknown, m: number | string | Date) => {
      const t = norm(String(p));
      s.customMtimes.set(
        t,
        typeof m === "number" ? m : m instanceof Date ? m.getTime() : Date.now(),
      );
    }),
    spy("futimesSync", (fd: number, _a: unknown, m: number | string | Date) => {
      const entry = s.openDescriptors.get(fd);
      if (entry) {
        s.customMtimes.set(
          entry.path,
          typeof m === "number" ? m : m instanceof Date ? m.getTime() : Date.now(),
        );
      }
    }),
    spy("appendFileSync", (p: fs.PathOrFileDescriptor, d: string | Uint8Array) => {
      const t = norm(String(p));
      const cur = s.vfs.existsSync(t) ? s.vfs.readFileSync(t, "utf8") : "";
      s.vfs.writeFileSync(
        t,
        cur + (typeof d === "string" ? d : Buffer.from(d).toString("utf8")),
      );
    }),
    spy("fsyncSync", () => {}),
    spy("mkdtempSync", (prefix: string) => {
      const dir = norm(`${prefix}${Date.now()}-${s.nextInode++}`);
      s.vfs.mkdirSync(dir, { recursive: true });
      return dir;
    }),
    spyOn(platform, "tryExclusiveFlock").mockReturnValue(true) as never,
    spyOn(platform, "releaseFlock").mockImplementation(() => {}) as never,
    spyOn(flockFfi, "tryExclusiveFlock").mockReturnValue(true) as never,
    spyOn(flockFfi, "releaseFlock").mockImplementation(() => {}) as never,
  ];
}
