import * as fs from "node:fs";
import * as path from "node:path";
import type { IVirtualFileSystem } from "./types.ts";
import { VirtualStats } from "./types.ts";

export interface VirtualFSSpyState {
  vfs: IVirtualFileSystem;
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

export const NOOP_FALSE = () => false;
export const fsErr = (code: string, msg: string) =>
  Object.assign(new Error(`${code}: ${msg}`), { code });

export function normPath(p: string | number): string {
  const resolved = path.resolve(String(p)).replace(/\\/g, "/");
  return resolved.replace(/^\/private\/(var|tmp)(\/|$)/, "/$1$2");
}

const VIRTUAL_PREFIXES = ["/virtual", "/fixture", "/virtual-fs", "\\virtual"];

export function isVirtualPath(s: string): boolean {
  if (typeof s !== "string") return false;
  const norm = normPath(s);
  return VIRTUAL_PREFIXES.some(
    (p) =>
      s.startsWith(p) ||
      norm.startsWith(p) ||
      s.includes("/virtual/") ||
      norm.includes("/virtual/"),
  );
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

export function checkParentExec(state: VirtualFSSpyState, target: string, op: string): void {
  const parentMode = state.customModes.get(path.dirname(target));
  if (parentMode !== undefined && (parentMode & 0o111) === 0) {
    throw fsErr("EACCES", `permission denied, ${op} '${target}'`);
  }
}

export function remapPrefix(map: Map<string, number>, src: string, dst: string): void {
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
  const mode = state.customModes.get(norm) ?? s.mode;
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
