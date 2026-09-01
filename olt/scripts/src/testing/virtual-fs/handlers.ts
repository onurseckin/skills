import * as fs from "node:fs";
import * as path from "node:path";
import type { VirtualMemoryFS } from "./memory-fs.ts";
import { VirtualStats } from "./types.ts";

export interface VirtualFSSpyState {
  vfs: VirtualMemoryFS;
  customMtimes: Map<string, number>;
  customModes: Map<string, number>;
  symlinks: Map<string, string>;
  openDescriptors: Map<number, { path: string; position: number; flags?: number }>;
  inodeMap: Map<string, number>;
  nextFd: { value: number };
  nextIno: { value: number };
}

export const origExists = fs.existsSync;
export const origStat = fs.statSync;
export const origLstat = fs.lstatSync;
export const origRead = fs.readFileSync;
export const origReaddir = fs.readdirSync;
export const origRealpath = fs.realpathSync;
export const origOpendir = fs.opendirSync;
export const origFstat = fs.fstatSync;
export const origClose = fs.closeSync;

export function normPath(p: string | number): string {
  return path.resolve(String(p)).replace(/\\/g, "/");
}

export function isVirtualPath(s: string): boolean {
  return (
    s.startsWith("/virtual") ||
    s.includes("scratch") ||
    s.includes("coverage") ||
    s.includes("tmp") ||
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
): fs.Stats {
  const norm = normPath(targetPath);
  const mtimeMs = state.customMtimes.get(norm) ?? s.mtimeMs;
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
    mode: state.customModes.get(norm) ?? (s.isDirectory() ? 0o700 : 0o600),
    dev: 1,
    ino: getInode(state, norm),
    nlink: 1,
    uid: typeof process.getuid === "function" ? process.getuid() : 0,
    gid: typeof process.getgid === "function" ? process.getgid() : 0,
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
    if (vfs.statSync(cSrc, { throwIfNoEntry: false })?.isDirectory()) vfs.mkdirSync(cDst, { recursive: true });
    else if (vfs.statSync(cSrc, { throwIfNoEntry: false })?.isFile()) vfs.writeFileSync(cDst, vfs.readFileSync(cSrc));
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
  return state.vfs.mkdirSync(
    normPath(String(p)),
    opts as Parameters<typeof state.vfs.mkdirSync>[1],
  );
}

export function mockWriteFile(
  state: VirtualFSSpyState,
  p: fs.PathOrFileDescriptor,
  data: string | NodeJS.ArrayBufferView,
  opts?: fs.WriteFileOptions,
): void {
  const target = normPath(String(p));
  const parent = String(p).includes("/") ? normPath(String(p).replace(/\/[^/]+$/, "")) : "";
  if (parent && !state.vfs.existsSync(parent)) state.vfs.mkdirSync(parent, { recursive: true });
  state.vfs.writeFileSync(target, typeof data === "string" ? data : Buffer.from(data as Uint8Array));
  if (typeof opts === "object" && opts !== null && typeof opts.mode === "number") state.customModes.set(target, opts.mode);
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
      const err = new Error(`EISDIR: illegal operation on a directory, read '${lookup}'`);
      (err as unknown as { code: string }).code = "EISDIR";
      throw err;
    }
    return typeof opts === "string" || (typeof opts === "object" && opts?.encoding)
      ? state.vfs.readFileSync(lookup, "utf8")
      : Buffer.from(state.vfs.readFileSync(lookup));
  }
  if (!isVirtualPath(s)) return origRead(s, opts as BufferEncoding);
  const err = new Error(`ENOENT: no such file or directory, open '${lookup}'`);
  (err as unknown as { code: string }).code = "ENOENT";
  throw err;
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
  return !isVirtualPath(s)
    ? (origReaddir(s, opts as Parameters<typeof origReaddir>[1]) as unknown as fs.Dirent[] & string[])
    : (state.vfs.readdirSync(lookup) as unknown as fs.Dirent[] & string[]);
}

export function mockStat(state: VirtualFSSpyState, p: fs.PathLike): fs.Stats {
  const s = String(p);
  const target = state.symlinks.get(normPath(s)) ?? normPath(s);
  const vs =
    state.vfs.statSync(target, { throwIfNoEntry: false }) ??
    state.vfs.statSync(s, { throwIfNoEntry: false });
  if (vs) return makeFsStats(state, vs, target);
  if (!isVirtualPath(s)) {
    try {
      return origStat(s);
    } catch {}
  }
  const err = new Error(`ENOENT: no such file or directory, stat '${s}'`);
  (err as unknown as { code: string }).code = "ENOENT";
  throw err;
}

export function mockLstat(state: VirtualFSSpyState, p: fs.PathLike): fs.Stats {
  const s = String(p);
  const norm = normPath(s);
  if (state.symlinks.has(norm)) {
    const target = state.symlinks.get(norm)!;
    const vs =
      state.vfs.statSync(target, { throwIfNoEntry: false }) ??
      new VirtualStats({ isDir: false, size: target.length });
    return makeFsStats(state, vs, norm, true);
  }
  const vs =
    state.vfs.statSync(norm, { throwIfNoEntry: false }) ??
    state.vfs.statSync(s, { throwIfNoEntry: false });
  if (vs) return makeFsStats(state, vs, norm, false);
  if (!isVirtualPath(s)) return origLstat(s);
  const err = new Error(`ENOENT: no such file or directory, lstat '${s}'`);
  (err as unknown as { code: string }).code = "ENOENT";
  throw err;
}

export function mockRename(state: VirtualFSSpyState, src: fs.PathLike, dst: fs.PathLike): void {
  const srcStr = normPath(String(src));
  const dstStr = normPath(String(dst));
  const stat = state.vfs.statSync(srcStr, { throwIfNoEntry: false });
  if (!stat) {
    throw Object.assign(new Error(`ENOENT: no such file or directory, rename '${srcStr}' -> '${dstStr}'`), { code: "ENOENT" });
  }
  for (const [k, v] of state.customModes) {
    if (k === srcStr) { state.customModes.delete(k); state.customModes.set(dstStr, v); }
    else if (k.startsWith(srcStr + "/")) { state.customModes.delete(k); state.customModes.set(dstStr + k.slice(srcStr.length), v); }
  }
  for (const [k, v] of state.customMtimes) {
    if (k === srcStr) { state.customMtimes.delete(k); state.customMtimes.set(dstStr, v); }
    else if (k.startsWith(srcStr + "/")) { state.customMtimes.delete(k); state.customMtimes.set(dstStr + k.slice(srcStr.length), v); }
  }
  if (stat.isDirectory()) {
    copyDirRecursive(state.vfs, srcStr, dstStr);
    state.vfs.rmSync(srcStr, { recursive: true, force: true });
  } else {
    state.vfs.writeFileSync(dstStr, state.vfs.readFileSync(srcStr));
    state.vfs.unlinkSync(srcStr);
  }
}

export function mockCp(state: VirtualFSSpyState, src: string | URL, dst: string | URL): void {
  const srcStr = normPath(String(src));
  const dstStr = normPath(String(dst));
  const stat = state.vfs.statSync(srcStr, { throwIfNoEntry: false });
  if (!stat) {
    throw Object.assign(new Error(`ENOENT: no such file or directory, cp '${srcStr}' -> '${dstStr}'`), { code: "ENOENT" });
  }
  if (stat.isDirectory()) copyDirRecursive(state.vfs, srcStr, dstStr);
  else state.vfs.writeFileSync(dstStr, state.vfs.readFileSync(srcStr));
}

export function mockOpendir(state: VirtualFSSpyState, p: fs.PathLike, opts?: fs.OpenDirOptions): fs.Dir {
  const s = String(p);
  const lookup = state.vfs.existsSync(normPath(s)) ? normPath(s) : s;
  if (state.vfs.existsSync(lookup)) {
    const entries = state.vfs.readdirSync(lookup) as string[];
    let idx = 0;
    let closed = false;
    const dirObj = {
      path: s,
      readSync(): fs.Dirent | null {
        if (closed || idx >= entries.length) return null;
        const name = entries[idx++]!;
        const ep = `${lookup}/${name}`;
        const vs = state.vfs.statSync(ep, { throwIfNoEntry: false });
        const isSym = state.symlinks.has(normPath(ep));
        return {
          name: (opts as { encoding?: string } | undefined)?.encoding === "buffer" ? Buffer.from(name) : name,
          isDirectory: () => (vs?.isDirectory() ?? false) && !isSym,
          isFile: () => (vs?.isFile() ?? false) && !isSym,
          isSymbolicLink: () => isSym,
          isBlockDevice: NOOP_FALSE,
          isCharacterDevice: NOOP_FALSE,
          isFIFO: NOOP_FALSE,
          isSocket: NOOP_FALSE,
        } as unknown as fs.Dirent;
      },
      closeSync(): void { closed = true; },
      async read(): Promise<fs.Dirent | null> { return dirObj.readSync(); },
      async close(): Promise<void> { dirObj.closeSync(); },
      async *[Symbol.asyncIterator]() { let e: fs.Dirent | null; while ((e = dirObj.readSync()) !== null) yield e; },
      *[Symbol.iterator]() { let e: fs.Dirent | null; while ((e = dirObj.readSync()) !== null) yield e; },
    };
    return dirObj as unknown as fs.Dir;
  }
  if (!isVirtualPath(s)) return origOpendir(s, opts as fs.OpenDirOptions);
  const err = new Error(`ENOENT: no such file or directory, opendir '${lookup}'`);
  (err as unknown as { code: string }).code = "ENOENT";
  throw err;
}
