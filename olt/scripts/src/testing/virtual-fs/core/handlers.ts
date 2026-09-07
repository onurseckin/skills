import { Buffer } from "node:buffer";
import * as fs from "node:fs";
import {
  type VirtualFSSpyState,
  checkParentExec,
  fsErr,
  isVirtualPath,
  makeFsStats,
  NOOP_FALSE,
  normPath,
  origExists,
  origLstat,
  origRead,
  origReaddir,
  origStat,
} from "./handlers-base.ts";
import type { VirtualDirent } from "./types.ts";
import { VirtualStats } from "./types.ts";

export type { VirtualFSSpyState } from "./handlers-base.ts";

export {
  checkParentExec,
  checkRmPermissions,
  fsErr,
  getInode,
  isVirtualPath,
  makeFsStats,
  NOOP_FALSE,
  normPath,
  origClose,
  origExists,
  origFstat,
  origLstat,
  origOpendir,
  origRead,
  origReaddir,
  origRealpath,
  origStat,
  remapPrefix,
} from "./handlers-base.ts";

export {
  copyDirRecursive,
  mockCp,
  mockLink,
  mockOpendir,
  mockRename,
  origCopyFile,
} from "./handlers-io.ts";

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
  const dirMode = state.customModes.get(lookup) ?? state.customModes.get(norm);
  if (dirMode !== undefined && (dirMode & 0o444) === 0) {
    throw fsErr("EACCES", `permission denied, scandir '${lookup}'`);
  }
  if (state.vfs.existsSync(lookup)) {
    if (typeof opts === "object" && opts !== null && opts.withFileTypes) {
      const rawEntries = state.vfs.readdirSync(lookup, { withFileTypes: true }) as VirtualDirent[];
      return rawEntries.map((e) => {
        const ep = normPath(`${lookup}/${e.name}`);
        const isSym = state.symlinks.has(ep);
        return {
          name: e.name,
          isDirectory: () => e.isDirectory() && !isSym,
          isFile: () => e.isFile() && !isSym,
          isSymbolicLink: () => isSym,
          isBlockDevice: NOOP_FALSE,
          isCharacterDevice: NOOP_FALSE,
          isFIFO: NOOP_FALSE,
          isSocket: NOOP_FALSE,
        } as unknown as fs.Dirent;
      }) as fs.Dirent[];
    }
    return state.vfs.readdirSync(lookup) as string[];
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
