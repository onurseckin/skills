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

const NOOP_FALSE = () => false;
const fsErr = (code: string, msg: string) => Object.assign(new Error(`${code}: ${msg}`), { code });

export function normPath(p: string | number): string {
  const resolved = path.resolve(String(p)).replace(/\\/g, "/");
  return resolved.replace(/^\/private\/(var|tmp)(\/|$)/, "/$1$2");
}

const VIRTUAL_SEGMENTS = [
  "/virtual",
  "/scratch",
  "/coverage",
  "/tmp",
  "/runner",
  "\\runner",
  "skills-runner",
  ".olt/worktrees",
  ".olt/runs",
  ".olt/locks",
  ".olt/capsules",
  "/fixture",
];

export function isVirtualPath(s: string): boolean {
  const norm = normPath(s);
  return VIRTUAL_SEGMENTS.some((p) => s.includes(p) || norm.includes(p));
}

export function getInode(state: VirtualFSSpyState, targetPath: string): number {
  const norm = normPath(targetPath);
  let ino = state.inodeMap.get(norm);
  if (ino === undefined) {
    ino = state.nextIno.value++;
    state.inodeMap.set(norm, ino);
  }
  return ino;
}

export function checkRmPermissions(
  state: VirtualFSSpyState,
  np: string,
  opts?: fs.RmOptions,
): void {
  for (const [k, mode] of state.customModes.entries()) {
    const isDir = state.vfs.statSync(k, { throwIfNoEntry: false })?.isDirectory();
    const denied = (mode & 0o222) === 0;
    if (isDir && (k === np || k.startsWith(np + "/")) && denied) {
      throw fsErr("EACCES", `permission denied, rm '${k}'`);
    }
    if (!opts?.force && k === np && denied) {
      throw fsErr("EACCES", `permission denied, rm '${k}'`);
    }
  }
}

function checkParentExec(state: VirtualFSSpyState, target: string, op: string): void {
  const parentMode = state.customModes.get(path.dirname(target));
  if (parentMode !== undefined && (parentMode & 0o111) === 0) {
    throw fsErr("EACCES", `permission denied, ${op} '${target}'`);
  }
}

function remapPrefix(map: Map<string, number>, src: string, dst: string): void {
  for (const [k, v] of map) {
    if (k === src) {
      map.delete(k);
      map.set(dst, v);
    } else if (k.startsWith(src + "/")) {
      map.delete(k);
      map.set(dst + k.slice(src.length), v);
    }
  }
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
  const B = bigint ? BigInt : Number;
  const res: Record<string, unknown> = {
    isFile: () => !isLink && s.isFile(),
    isDirectory: () => !isLink && s.isDirectory(),
    isSymbolicLink: () => isLink,
    isBlockDevice: NOOP_FALSE,
    isCharacterDevice: NOOP_FALSE,
    isFIFO: NOOP_FALSE,
    isSocket: NOOP_FALSE,
    size: B(s.size),
    atimeMs: B(s.atimeMs),
    mtimeMs: B(mtimeMs),
    ctimeMs: B(s.ctimeMs),
    birthtimeMs: B(s.birthtimeMs),
    atime: s.atime,
    mtime: new Date(mtimeMs),
    ctime: s.ctime,
    birthtime: s.birthtime,
    mode: B(mode),
    ino: B(ino),
    dev: B(1),
    nlink: B(nlink),
    uid: B(uid),
    gid: B(gid),
    rdev: B(0),
    blksize: B(4096),
    blocks: B(Math.ceil(s.size / 512)),
  };
  if (bigint) {
    const scale = (ms: number) => BigInt(ms) * 1000000n;
    res["atimeNs"] = scale(s.atimeMs);
    res["mtimeNs"] = scale(mtimeMs);
    res["ctimeNs"] = scale(s.ctimeMs);
    res["birthtimeNs"] = scale(s.birthtimeMs);
  }
  return res as unknown as fs.Stats;
}

export function copyDirRecursive(
  vfs: VirtualMemoryFS,
  srcStr: string,
  dstStr: string,
  state?: VirtualFSSpyState,
): void {
  vfs.mkdirSync(dstStr, { recursive: true });
  for (const entry of vfs.readdirSync(srcStr, { recursive: true }) as string[]) {
    const cSrc = `${srcStr}/${entry}`;
    const cDst = `${dstStr}/${entry}`;
    if (vfs.statSync(cSrc, { throwIfNoEntry: false })?.isDirectory()) {
      vfs.mkdirSync(cDst, { recursive: true });
    } else if (vfs.statSync(cSrc, { throwIfNoEntry: false })?.isFile()) {
      vfs.writeFileSync(cDst, vfs.readFileSync(cSrc));
      if (state) {
        const m = state.customModes.get(normPath(cSrc));
        if (m !== undefined) state.customModes.set(normPath(cDst), m);
      }
    }
  }
}

export function mockExists(state: VirtualFSSpyState, p: fs.PathLike): boolean {
  const s = String(p);
  const norm = normPath(s);
  if (state.vfs.existsSync(s) || state.vfs.existsSync(norm) || state.symlinks.has(norm)) {
    return true;
  }
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
  if (typeof opts === "object" && opts !== null && typeof opts.mode === "number") {
    state.customModes.set(target, opts.mode);
  }
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
      throw fsErr("EACCES", `permission denied, open '${target}'`);
    }
    if (!state.vfs.existsSync(parent)) state.vfs.mkdirSync(parent, { recursive: true });
  }
  state.vfs.writeFileSync(
    target,
    typeof data === "string" ? data : Buffer.from(data as Uint8Array),
  );
  if (typeof opts === "object" && opts !== null && typeof opts.mode === "number") {
    state.customModes.set(target, opts.mode);
  }
}

export function mockReadFile(
  state: VirtualFSSpyState,
  p: fs.PathOrFileDescriptor,
  opts?: { encoding?: BufferEncoding | null; flag?: string } | BufferEncoding | null,
): string | Buffer {
  if (typeof p === "number") {
    const entry = state.openDescriptors.get(p);
    if (!entry) {
      try {
        return origRead(p, opts as BufferEncoding);
      } catch {
        throw fsErr("EBADF", `bad file descriptor, read ${p}`);
      }
    }
    if (state.vfs.statSync(entry.path, { throwIfNoEntry: false })?.isDirectory()) return "";
    return typeof opts === "string" || (typeof opts === "object" && opts?.encoding)
      ? state.vfs.readFileSync(entry.path, "utf8")
      : Buffer.from(state.vfs.readFileSync(entry.path));
  }
  const s = String(p);
  const norm = normPath(s);
  const lookup = state.vfs.existsSync(norm) ? norm : s;
  if (state.vfs.existsSync(lookup)) {
    if (state.vfs.statSync(lookup, { throwIfNoEntry: false })?.isDirectory()) {
      throw fsErr("EISDIR", `illegal operation on a directory, read '${lookup}'`);
    }
    return typeof opts === "string" || (typeof opts === "object" && opts?.encoding)
      ? state.vfs.readFileSync(lookup, "utf8")
      : Buffer.from(state.vfs.readFileSync(lookup));
  }
  if (!isVirtualPath(s) && !isVirtualPath(norm)) {
    try {
      return origRead(s, opts as BufferEncoding);
    } catch {}
  }
  throw fsErr("ENOENT", `no such file or directory, open '${lookup}'`);
}

export function mockReaddir(
  state: VirtualFSSpyState,
  p: fs.PathLike,
  opts?: { withFileTypes?: boolean } | BufferEncoding | null,
): string[] | fs.Dirent[] {
  const s = String(p);
  const norm = normPath(s);
  const lookup = state.vfs.existsSync(norm) ? norm : s;
  if (state.vfs.existsSync(lookup)) {
    return (typeof opts === "object" && opts?.withFileTypes
      ? state.vfs.readdirSync(lookup, { withFileTypes: true })
      : state.vfs.readdirSync(lookup)) as unknown as fs.Dirent[] & string[];
  }
  if (!isVirtualPath(s) && !isVirtualPath(norm)) {
    try {
      return origReaddir(s, opts as Parameters<typeof origReaddir>[1]) as unknown as fs.Dirent[] &
        string[];
    } catch {}
  }
  throw fsErr("ENOENT", `no such file or directory, scandir '${lookup}'`);
}

export function mockStat(
  state: VirtualFSSpyState,
  p: fs.PathLike,
  opts?: fs.StatOptions,
): fs.Stats {
  const s = String(p);
  const norm = normPath(s);
  const target = state.symlinks.get(norm) ?? norm;
  checkParentExec(state, target, "stat");
  const isBig = Boolean(opts && typeof opts === "object" && opts.bigint);
  const vs =
    state.vfs.statSync(target, { throwIfNoEntry: false }) ??
    state.vfs.statSync(s, { throwIfNoEntry: false });
  if (vs) return makeFsStats(state, vs, target, false, isBig);
  if (!isVirtualPath(s) && !isVirtualPath(norm)) {
    try {
      return origStat(s, opts as never);
    } catch {}
  }
  throw fsErr("ENOENT", `no such file or directory, stat '${s}'`);
}

export function mockLstat(
  state: VirtualFSSpyState,
  p: fs.PathLike,
  opts?: fs.StatOptions,
): fs.Stats {
  const s = String(p);
  const norm = normPath(s);
  checkParentExec(state, norm, "lstat");
  const isBig = Boolean(opts && typeof opts === "object" && opts.bigint);
  if (state.symlinks.has(norm)) {
    const target = state.symlinks.get(norm)!;
    const targetBytes = Buffer.byteLength(target);
    const existing = state.vfs.statSync(norm, { throwIfNoEntry: false });
    const vs = existing
      ? existing.clone({ size: targetBytes })
      : new VirtualStats({ isDir: false, size: targetBytes, mtimeMs: 0, ctimeMs: 0 });
    return makeFsStats(state, vs, norm, true, isBig);
  }
  const vs =
    state.vfs.statSync(norm, { throwIfNoEntry: false }) ??
    state.vfs.statSync(s, { throwIfNoEntry: false });
  if (vs) return makeFsStats(state, vs, norm, false, isBig);
  if (!isVirtualPath(s) && !isVirtualPath(norm)) {
    try {
      return origLstat(s, opts as never);
    } catch {}
  }
  throw fsErr("ENOENT", `no such file or directory, lstat '${s}'`);
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
    throw fsErr("ENOENT", `no such file or directory, rename '${srcStr}' -> '${dstStr}'`);
  }
  remapPrefix(state.customModes, srcStr, dstStr);
  remapPrefix(state.customMtimes, srcStr, dstStr);
  const srcIno = state.inodeMap.get(srcStr);
  state.inodeMap.delete(srcStr);
  state.inodeMap.set(dstStr, srcIno ?? state.nextIno.value++);
  if (stat.isDirectory()) {
    copyDirRecursive(state.vfs, srcStr, dstStr, state);
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
  if (!stat) {
    throw fsErr("ENOENT", `no such file or directory, link '${srcStr}' -> '${dstStr}'`);
  }
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
    throw fsErr("ENOENT", `no such file or directory, cp '${srcStr}' -> '${dstStr}'`);
  }
  if (stat.isDirectory()) {
    copyDirRecursive(state.vfs, srcStr, dstStr, state);
  } else {
    state.vfs.writeFileSync(dstStr, state.vfs.readFileSync(srcStr));
    const m = state.customModes.get(srcStr);
    if (m !== undefined) state.customModes.set(dstStr, m);
  }
}

export function mockOpendir(
  state: VirtualFSSpyState,
  p: fs.PathLike,
  opts?: fs.OpenDirOptions,
): fs.Dir {
  const s = String(p);
  const norm = normPath(s);
  const lookup = state.vfs.existsSync(norm) ? norm : s;
  if (state.vfs.existsSync(lookup)) {
    const entries = state.vfs.readdirSync(lookup) as string[];
    let idx = 0;
    let closed = false;
    const isBuf = (opts as { encoding?: string } | undefined)?.encoding === "buffer";
    const dirObj = {
      path: s,
      readSync(): fs.Dirent | null {
        if (closed || idx >= entries.length) return null;
        const name = entries[idx++]!;
        const ep = `${lookup}/${name}`;
        const vs = state.vfs.statSync(ep, { throwIfNoEntry: false });
        const isSym = state.symlinks.has(normPath(ep));
        return {
          name: isBuf ? Buffer.from(name) : name,
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
  if (!isVirtualPath(s) && !isVirtualPath(norm)) {
    try {
      return origOpendir(s, opts as fs.OpenDirOptions);
    } catch {}
  }
  throw fsErr("ENOENT", `no such file or directory, opendir '${lookup}'`);
}
