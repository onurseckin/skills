import * as fs from "node:fs";
import * as path from "node:path";
import type { VirtualMemoryFS } from "./memory-fs.ts";
import { VirtualStats } from "./types.ts";

export interface VirtualFSSpyState {
  vfs: VirtualMemoryFS;
  customMtimes: Map<string, number>;
  customModes: Map<string, number>;
  symlinks: Map<string, string>;
  hardlinks?: Map<number, number>;
  openDescriptors: Map<number, { path: string; position: number; flags?: number }>;
  inodeMap: Map<string, number>;
  nextFd: { value: number };
  nextIno: { value: number };
}

export const {
  existsSync: origExists,
  statSync: origStat,
  lstatSync: origLstat,
  readFileSync: origRead,
  readdirSync: origReaddir,
  realpathSync: origRealpath,
  opendirSync: origOpendir,
  fstatSync: origFstat,
  closeSync: origClose,
} = fs;

export function normPath(p: string | number): string {
  let resolved = path.resolve(String(p)).replace(/\\/g, "/");
  if (resolved.startsWith("/private/var/")) resolved = "/var/" + resolved.slice(13);
  else if (resolved.startsWith("/private/tmp/")) resolved = "/tmp/" + resolved.slice(13);
  else if (resolved === "/private/var") resolved = "/var";
  else if (resolved === "/private/tmp") resolved = "/tmp";
  return resolved;
}

export function isVirtualPath(s: string): boolean {
  return (
    s.startsWith("/virtual") ||
    s.includes("/scratch") ||
    s.includes("/coverage") ||
    s.includes("/tmp") ||
    s.includes("runner") ||
    s.includes("skills-runner") ||
    s.includes(".olt/worktrees") ||
    s.includes(".olt/runs") ||
    s.includes(".olt/locks")
  );
}

const NOOP_FALSE = () => false;

export function getInode(state: VirtualFSSpyState, targetPath: string): number {
  const norm = normPath(targetPath);
  let ino = state.inodeMap.get(norm);
  if (ino === undefined) {
    ino = state.nextIno.value++;
    state.inodeMap.set(norm, ino);
  }
  return ino;
}

export function makeFsStats(
  state: VirtualFSSpyState,
  s: VirtualStats,
  targetPath: string,
  isLink = false,
  bigint = false,
): fs.Stats {
  const norm = normPath(targetPath);
  const mtimeMs = state.customMtimes.get(norm) ?? s.mtimeMs;
  const mode = state.customModes.get(norm) ?? (s.isDirectory() ? 0o755 : 0o644);
  const ino = getInode(state, norm);
  const nlink = state.hardlinks?.get(ino) ?? 1;
  const uid = typeof process.getuid === "function" ? process.getuid() : 0;
  const gid = typeof process.getgid === "function" ? process.getgid() : 0;
  if (bigint) {
    const bMtimeMs = BigInt(mtimeMs);
    return {
      isFile: () => !isLink && s.isFile(),
      isDirectory: () => !isLink && s.isDirectory(),
      isSymbolicLink: () => isLink,
      isBlockDevice: NOOP_FALSE,
      isCharacterDevice: NOOP_FALSE,
      isFIFO: NOOP_FALSE,
      isSocket: NOOP_FALSE,
      size: BigInt(s.size),
      atimeMs: BigInt(s.atimeMs),
      mtimeMs: bMtimeMs,
      ctimeMs: BigInt(s.ctimeMs),
      birthtimeMs: BigInt(s.birthtimeMs),
      atimeNs: BigInt(s.atimeMs) * 1000000n,
      mtimeNs: bMtimeMs * 1000000n,
      ctimeNs: BigInt(s.ctimeMs) * 1000000n,
      birthtimeNs: BigInt(s.birthtimeMs) * 1000000n,
      atime: s.atime,
      mtime: new Date(mtimeMs),
      ctime: s.ctime,
      birthtime: s.birthtime,
      mode: BigInt(mode),
      ino: BigInt(ino),
      dev: 1n,
      nlink: BigInt(nlink),
      uid: BigInt(uid),
      gid: BigInt(gid),
      rdev: 0n,
      blksize: 4096n,
      blocks: BigInt(Math.ceil(s.size / 512)),
    } as unknown as fs.Stats;
  }
  return {
    isFile: () => !isLink && s.isFile(),
    isDirectory: () => !isLink && s.isDirectory(),
    isSymbolicLink: () => isLink,
    isBlockDevice: NOOP_FALSE,
    isCharacterDevice: NOOP_FALSE,
    isFIFO: NOOP_FALSE,
    isSocket: NOOP_FALSE,
    size: s.size,
    atimeMs: s.atimeMs,
    mtimeMs,
    ctimeMs: s.ctimeMs,
    birthtimeMs: s.birthtimeMs,
    atime: s.atime,
    mtime: new Date(mtimeMs),
    ctime: s.ctime,
    birthtime: s.birthtime,
    mode,
    ino,
    dev: 1,
    nlink,
    uid,
    gid,
    rdev: 0,
    blksize: 4096,
    blocks: Math.ceil(s.size / 512),
  } as unknown as fs.Stats;
}

export function copyDirRecursive(vfs: VirtualMemoryFS, srcStr: string, dstStr: string): void {
  vfs.mkdirSync(dstStr, { recursive: true });
  for (const entry of vfs.readdirSync(srcStr, { recursive: true }) as string[]) {
    const cSrc = `${srcStr}/${entry}`;
    const cDst = `${dstStr}/${entry}`;
    if (vfs.statSync(cSrc, { throwIfNoEntry: false })?.isDirectory())
      vfs.mkdirSync(cDst, { recursive: true });
    else if (vfs.statSync(cSrc, { throwIfNoEntry: false })?.isFile())
      vfs.writeFileSync(cDst, vfs.readFileSync(cSrc));
  }
}

export function mockExists(state: VirtualFSSpyState, p: fs.PathLike): boolean {
  const s = String(p);
  const norm = normPath(s);
  if (state.vfs.existsSync(s) || state.vfs.existsSync(norm) || state.symlinks.has(norm))
    return true;
  if (isVirtualPath(s)) return false;
  try {
    return origExists(s);
  } catch {
    return false;
  }
}

export function mockMkdir(
  state: VirtualFSSpyState,
  p: fs.PathLike,
  opts?: fs.MakeDirectoryOptions | boolean,
): string | undefined {
  const target = normPath(String(p));
  if (typeof opts === "object" && opts !== null && typeof opts.mode === "number")
    state.customModes.set(target, opts.mode);
  return state.vfs.mkdirSync(target, opts as Parameters<typeof state.vfs.mkdirSync>[1]);
}

export function mockWriteFile(
  state: VirtualFSSpyState,
  p: fs.PathOrFileDescriptor,
  data: string | NodeJS.ArrayBufferView,
  opts?: fs.WriteFileOptions,
): void {
  const target = normPath(String(p));
  const parent = String(p).includes("/") ? normPath(String(p).replace(/\/[^/]+$/, "")) : "";
  if (parent) {
    const parentMode = state.customModes.get(parent);
    if (parentMode !== undefined && (parentMode & 0o200) === 0) {
      throw Object.assign(new Error(`EACCES: permission denied, open '${target}'`), {
        code: "EACCES",
      });
    }
  }
  if (parent && !state.vfs.existsSync(parent)) state.vfs.mkdirSync(parent, { recursive: true });
  state.vfs.writeFileSync(
    target,
    typeof data === "string" ? data : Buffer.from(data as Uint8Array),
  );
  if (typeof opts === "object" && opts !== null && typeof opts.mode === "number")
    state.customModes.set(target, opts.mode);
}

export function mockReadFile(
  state: VirtualFSSpyState,
  p: fs.PathOrFileDescriptor,
  opts?: { encoding?: BufferEncoding | null; flag?: string } | BufferEncoding | null,
): string | Buffer {
  if (typeof p === "number") {
    const entry = state.openDescriptors.get(p);
    if (!entry) return origRead(p, opts as BufferEncoding);
    if (state.vfs.statSync(entry.path, { throwIfNoEntry: false })?.isDirectory()) return "";
    return typeof opts === "string" || (typeof opts === "object" && opts?.encoding)
      ? state.vfs.readFileSync(entry.path, "utf8")
      : Buffer.from(state.vfs.readFileSync(entry.path));
  }
  const s = String(p);
  const lookup = state.vfs.existsSync(normPath(s)) ? normPath(s) : s;
  if (state.vfs.existsSync(lookup)) {
    if (state.vfs.statSync(lookup, { throwIfNoEntry: false })?.isDirectory()) {
      throw Object.assign(new Error(`EISDIR: illegal operation on a directory, read '${lookup}'`), {
        code: "EISDIR",
      });
    }
    return typeof opts === "string" || (typeof opts === "object" && opts?.encoding)
      ? state.vfs.readFileSync(lookup, "utf8")
      : Buffer.from(state.vfs.readFileSync(lookup));
  }
  try {
    return origRead(s, opts as BufferEncoding);
  } catch {}
  throw Object.assign(new Error(`ENOENT: no such file or directory, open '${lookup}'`), {
    code: "ENOENT",
  });
}

export function mockReaddir(
  state: VirtualFSSpyState,
  p: fs.PathLike,
  opts?: { withFileTypes?: boolean } | BufferEncoding | null,
): string[] | fs.Dirent[] {
  const s = String(p);
  const lookup = state.vfs.existsSync(normPath(s)) ? normPath(s) : s;
  if (state.vfs.existsSync(lookup)) {
    return (typeof opts === "object" && opts?.withFileTypes
      ? state.vfs.readdirSync(lookup, { withFileTypes: true })
      : state.vfs.readdirSync(lookup)) as unknown as fs.Dirent[] & string[];
  }
  try {
    return origReaddir(s, opts as Parameters<typeof origReaddir>[1]) as unknown as fs.Dirent[] &
      string[];
  } catch {}
  return state.vfs.readdirSync(lookup) as unknown as fs.Dirent[] & string[];
}

export function mockStat(
  state: VirtualFSSpyState,
  p: fs.PathLike,
  opts?: fs.StatOptions,
): fs.Stats {
  const s = String(p),
    target = state.symlinks.get(normPath(s)) ?? normPath(s);
  const parent = path.dirname(target),
    parentMode = state.customModes.get(parent);
  if (parentMode !== undefined && (parentMode & 0o111) === 0) {
    throw Object.assign(new Error(`EACCES: permission denied, stat '${target}'`), {
      code: "EACCES",
    });
  }
  const isBig = Boolean(opts && typeof opts === "object" && opts.bigint);
  const vs =
    state.vfs.statSync(target, { throwIfNoEntry: false }) ??
    state.vfs.statSync(s, { throwIfNoEntry: false });
  if (vs) return makeFsStats(state, vs, target, false, isBig);
  try {
    return origStat(s, opts as never);
  } catch {}
  throw Object.assign(new Error(`ENOENT: no such file or directory, stat '${s}'`), {
    code: "ENOENT",
  });
}

export function mockLstat(
  state: VirtualFSSpyState,
  p: fs.PathLike,
  opts?: fs.StatOptions,
): fs.Stats {
  const s = String(p),
    norm = normPath(s);
  const parent = path.dirname(norm),
    parentMode = state.customModes.get(parent);
  if (parentMode !== undefined && (parentMode & 0o111) === 0) {
    throw Object.assign(new Error(`EACCES: permission denied, lstat '${norm}'`), {
      code: "EACCES",
    });
  }
  const isBig = Boolean(opts && typeof opts === "object" && opts.bigint);
  if (state.symlinks.has(norm)) {
    const target = state.symlinks.get(norm)!;
    const vs =
      state.vfs.statSync(target, { throwIfNoEntry: false }) ??
      new VirtualStats({ isDir: false, size: target.length });
    return makeFsStats(state, vs, norm, true, isBig);
  }
  const vs =
    state.vfs.statSync(norm, { throwIfNoEntry: false }) ??
    state.vfs.statSync(s, { throwIfNoEntry: false });
  if (vs) return makeFsStats(state, vs, norm, false, isBig);
  try {
    return origLstat(s, opts as never);
  } catch {}
  const err = new Error(`ENOENT: no such file or directory, lstat '${s}'`);
  (err as unknown as { code: string }).code = "ENOENT";
  throw err;
}

export function mockRename(state: VirtualFSSpyState, src: fs.PathLike, dst: fs.PathLike): void {
  const srcStr = normPath(String(src));
  const dstStr = normPath(String(dst));
  if (state.symlinks.has(srcStr)) {
    const target = state.symlinks.get(srcStr)!;
    state.symlinks.delete(srcStr);
    state.symlinks.set(dstStr, target);
    state.vfs.writeFileSync(dstStr, Buffer.from(target));
    if (state.vfs.existsSync(srcStr)) state.vfs.unlinkSync(srcStr);
    return;
  }
  const stat = state.vfs.statSync(srcStr, { throwIfNoEntry: false });
  if (!stat) {
    throw Object.assign(
      new Error(`ENOENT: no such file or directory, rename '${srcStr}' -> '${dstStr}'`),
      { code: "ENOENT" },
    );
  }
  for (const [k, v] of state.customModes) {
    if (k === srcStr) {
      state.customModes.delete(k);
      state.customModes.set(dstStr, v);
    } else if (k.startsWith(srcStr + "/")) {
      state.customModes.delete(k);
      state.customModes.set(dstStr + k.slice(srcStr.length), v);
    }
  }
  for (const [k, v] of state.customMtimes) {
    if (k === srcStr) {
      state.customMtimes.delete(k);
      state.customMtimes.set(dstStr, v);
    } else if (k.startsWith(srcStr + "/")) {
      state.customMtimes.delete(k);
      state.customMtimes.set(dstStr + k.slice(srcStr.length), v);
    }
  }
  const srcIno = state.inodeMap.get(srcStr);
  state.inodeMap.delete(srcStr);
  if (srcIno !== undefined) state.inodeMap.set(dstStr, srcIno);
  else state.inodeMap.set(dstStr, state.nextIno.value++);
  if (stat.isDirectory()) {
    copyDirRecursive(state.vfs, srcStr, dstStr);
    state.vfs.rmSync(srcStr, { recursive: true, force: true });
  } else {
    state.vfs.writeFileSync(dstStr, state.vfs.readFileSync(srcStr));
    state.vfs.unlinkSync(srcStr);
  }
}

export function mockLink(state: VirtualFSSpyState, src: fs.PathLike, dst: fs.PathLike): void {
  const srcStr = normPath(String(src));
  const dstStr = normPath(String(dst));
  const stat = state.vfs.statSync(srcStr, { throwIfNoEntry: false });
  if (!stat)
    throw Object.assign(
      new Error(`ENOENT: no such file or directory, link '${srcStr}' -> '${dstStr}'`),
      { code: "ENOENT" },
    );
  state.vfs.writeFileSync(dstStr, state.vfs.readFileSync(srcStr));
  const ino = getInode(state, srcStr);
  state.inodeMap.set(dstStr, ino);
  if (!state.hardlinks) state.hardlinks = new Map();
  state.hardlinks.set(ino, (state.hardlinks.get(ino) ?? 1) + 1);
}

export function mockCp(state: VirtualFSSpyState, src: string | URL, dst: string | URL): void {
  const srcStr = normPath(String(src));
  const dstStr = normPath(String(dst));
  const stat = state.vfs.statSync(srcStr, { throwIfNoEntry: false });
  if (!stat) {
    throw Object.assign(
      new Error(`ENOENT: no such file or directory, cp '${srcStr}' -> '${dstStr}'`),
      { code: "ENOENT" },
    );
  }
  if (stat.isDirectory()) copyDirRecursive(state.vfs, srcStr, dstStr);
  else state.vfs.writeFileSync(dstStr, state.vfs.readFileSync(srcStr));
}

export function mockOpendir(
  state: VirtualFSSpyState,
  p: fs.PathLike,
  opts?: fs.OpenDirOptions,
): fs.Dir {
  const s = String(p);
  const lookup = state.vfs.existsSync(normPath(s)) ? normPath(s) : s;
  if (state.vfs.existsSync(lookup)) {
    const entries = state.vfs.readdirSync(lookup) as string[];
    let idx = 0,
      closed = false;
    const dirObj = {
      path: s,
      readSync(): fs.Dirent | null {
        if (closed || idx >= entries.length) return null;
        const name = entries[idx++]!,
          ep = `${lookup}/${name}`,
          vs = state.vfs.statSync(ep, { throwIfNoEntry: false }),
          isSym = state.symlinks.has(normPath(ep));
        return {
          name:
            (opts as { encoding?: string } | undefined)?.encoding === "buffer"
              ? Buffer.from(name)
              : name,
          isDirectory: () => (vs?.isDirectory() ?? false) && !isSym,
          isFile: () => (vs?.isFile() ?? false) && !isSym,
          isSymbolicLink: () => isSym,
          isBlockDevice: NOOP_FALSE,
          isCharacterDevice: NOOP_FALSE,
          isFIFO: NOOP_FALSE,
          isSocket: NOOP_FALSE,
        } as unknown as fs.Dirent;
      },
      closeSync(): void {
        closed = true;
      },
      async read(): Promise<fs.Dirent | null> {
        return dirObj.readSync();
      },
      async close(): Promise<void> {
        dirObj.closeSync();
      },
      async *[Symbol.asyncIterator]() {
        let e: fs.Dirent | null;
        while ((e = dirObj.readSync()) !== null) yield e;
      },
      *[Symbol.iterator]() {
        let e: fs.Dirent | null;
        while ((e = dirObj.readSync()) !== null) yield e;
      },
    };
    return dirObj as unknown as fs.Dir;
  }
  if (!isVirtualPath(s)) return origOpendir(s, opts as fs.OpenDirOptions);
  throw Object.assign(new Error(`ENOENT: no such file or directory, opendir '${lookup}'`), {
    code: "ENOENT",
  });
}
