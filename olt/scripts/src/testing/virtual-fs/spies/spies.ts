import { spyOn } from "bun:test";
import { Buffer } from "node:buffer";
import * as childProcess from "node:child_process";
import * as fs from "node:fs";
import * as path from "node:path";
import {
  checkRmPermissions,
  forgetInode,
  isVirtualPath,
  mockExists,
  mockMkdir,
  mockOpen,
  mockRead,
  mockReadFile,
  mockStat,
  mockWrite,
  mockWriteFile,
  normPath,
  origClose,
  origRealpath,
  type VirtualFSSpyState,
} from "../core/index.ts";
import type { VirtualMemoryFS } from "../memory/index.ts";
import { buildAsyncSpies } from "./spies-async.ts";
import { buildProcSpies, type WatcherHolder } from "./spies-proc.ts";
import { buildSyncSpies } from "./spies-sync.ts";

export interface VirtualFSSession {
  vfs: VirtualMemoryFS;
  spies: Array<{ mockRestore: () => void }>;
  cleanup: () => void;
  symlinkSync: (target: string, path: string) => void;
  symlinks: Map<string, string>;
  openSync: (path: fs.PathLike, flags: string | number) => number;
  writeSync: (
    descriptor: number,
    buffer: NodeJS.ArrayBufferView | string,
    offset?: number | null,
    length?: number | null,
    position?: number | bigint | null,
  ) => number;
  readSync: (
    descriptor: number,
    buffer: NodeJS.ArrayBufferView,
    offset: number,
    length: number,
    position?: number | bigint | null,
  ) => number;
  closeSync: (descriptor: number) => void;
  fsyncSync: (descriptor: number) => void;
  statSync: (path: fs.PathLike, opts?: fs.StatOptions) => fs.Stats;
  readFileSync: (
    path: fs.PathOrFileDescriptor,
    opts?: { encoding?: BufferEncoding | null; flag?: string } | BufferEncoding | null,
  ) => string | Buffer;
  writeFileSync: (
    path: fs.PathOrFileDescriptor,
    data: string | NodeJS.ArrayBufferView,
    opts?: fs.WriteFileOptions,
  ) => void;
  existsSync: (path: fs.PathLike) => boolean;
  chmodSync: (path: fs.PathLike, mode: fs.Mode) => void;
  rmSync: (path: fs.PathLike, opts?: fs.RmOptions) => void;
  mkdirSync: (path: fs.PathLike, opts?: fs.MakeDirectoryOptions | boolean) => string | undefined;
  realpathSync: (path: fs.PathLike) => string;
  customModes: Map<string, number>;
  getWatcherCallback?: () => ((event: string, filename: string) => void) | undefined;
  dispatchWatcherEvent?: (event: string, filename: string) => void;
}

export function createVirtualFSSession(vfs: VirtualMemoryFS): VirtualFSSession {
  const watcherHolder: WatcherHolder = {};
  const state: VirtualFSSpyState = {
    vfs,
    customMtimes: new Map(),
    customModes: new Map(),
    symlinks: new Map(),
    hardlinks: new Map(),
    openDescriptors: new Map(),
    inodeMap: new Map(),
    inodeAliases: new Map(),
    nextFd: { value: 3000 },
    nextIno: { value: 5000 },
  };

  const spies: Array<{ mockRestore: () => void }> = [
    ...buildSyncSpies(state, vfs),
    ...buildAsyncSpies(state, vfs),
    ...buildProcSpies(state, vfs, watcherHolder),
  ];

  function cleanup(): void {
    for (const s of spies) {
      try {
        s.mockRestore();
      } catch {}
    }
    watcherHolder.activeWatcherCallback = undefined;
    state.openDescriptors.clear();
    state.customMtimes.clear();
    state.customModes.clear();
    state.symlinks.clear();
    state.inodeMap.clear();
    state.inodeAliases?.clear();
    vfs.reset();
  }

  const symlinkSync = (t: string, p: string) => {
    const np = normPath(String(p));
    state.symlinks.set(np, String(t));
    const parent = path.dirname(np);
    if (!vfs.existsSync(parent)) vfs.mkdirSync(parent, { recursive: true });
    if (!vfs.existsSync(np)) vfs.writeFileSync(np, "");
  };

  const openSync = (p: fs.PathLike, flags: string | number) => mockOpen(state, p, flags);
  const writeSync = (
    descriptor: number,
    buffer: NodeJS.ArrayBufferView | string,
    offset?: number | null,
    length?: number | null,
    position?: number | bigint | null,
  ) => mockWrite(state, descriptor, buffer, offset, length, position);
  const readSync = (
    descriptor: number,
    buffer: NodeJS.ArrayBufferView,
    offset: number,
    length: number,
    position?: number | bigint | null,
  ) => mockRead(state, descriptor, buffer, offset, length, position);
  const closeSync = (descriptor: number) => {
    if (state.openDescriptors.has(descriptor)) state.openDescriptors.delete(descriptor);
    else {
      try {
        origClose(descriptor);
      } catch {}
    }
  };
  const fsyncSync = (_descriptor: number) => {};
  const statSync = (p: fs.PathLike, opts?: fs.StatOptions) => mockStat(state, p, opts);
  const readFileSync = (
    p: fs.PathOrFileDescriptor,
    opts?: { encoding?: BufferEncoding | null; flag?: string } | BufferEncoding | null,
  ) => mockReadFile(state, p, opts);
  const writeFileSync = (
    p: fs.PathOrFileDescriptor,
    data: string | NodeJS.ArrayBufferView,
    opts?: fs.WriteFileOptions,
  ) => mockWriteFile(state, p, data, opts);
  const existsSync = (p: fs.PathLike) => mockExists(state, p);
  const realpathSync = (p: fs.PathLike) => {
    const s = String(p);
    let norm = normPath(s);
    for (const [sym, target] of state.symlinks) {
      if (norm === sym) {
        norm = target;
        break;
      }
      if (norm.startsWith(sym + "/")) {
        norm = target + norm.slice(sym.length);
        break;
      }
    }
    if (vfs.existsSync(norm) || vfs.existsSync(s) || state.symlinks.has(norm)) return norm;
    if (isVirtualPath(s))
      throw Object.assign(new Error(`ENOENT: no such file or directory, realpath '${s}'`), {
        code: "ENOENT",
      });
    return origRealpath(s);
  };

  return {
    vfs,
    spies,
    cleanup,
    symlinkSync,
    symlinks: state.symlinks,
    openSync,
    writeSync,
    readSync,
    closeSync,
    fsyncSync,
    statSync,
    readFileSync,
    writeFileSync,
    existsSync,
    chmodSync: (p: fs.PathLike, m: fs.Mode) => {
      state.customModes.set(normPath(String(p)), typeof m === "string" ? parseInt(m, 8) : m);
    },
    rmSync: (p: fs.PathLike, opts?: fs.RmOptions) => {
      const np = normPath(String(p));
      checkRmPermissions(state, np, opts);
      forgetInode(state, np);
      state.customModes.delete(np);
      state.customMtimes.delete(np);
      state.symlinks.delete(np);
      for (const k of state.symlinks.keys()) if (k.startsWith(np + "/")) state.symlinks.delete(k);
      for (const k of state.customModes.keys())
        if (k.startsWith(np + "/")) state.customModes.delete(k);
      vfs.rmSync(np, opts as Parameters<typeof vfs.rmSync>[1]);
    },
    mkdirSync: (p: fs.PathLike, opts?: fs.MakeDirectoryOptions | boolean) =>
      mockMkdir(state, p, opts),
    realpathSync,
    customModes: state.customModes,
    getWatcherCallback: () => watcherHolder.activeWatcherCallback,
    dispatchWatcherEvent: (event: string, filename: string) => {
      if (watcherHolder.activeWatcherCallback) {
        watcherHolder.activeWatcherCallback(event, filename);
      }
    },
  };
}

export function mockSubprocess(
  impl: (cmd: string, args: readonly string[], opts?: unknown) => unknown,
): { mockRestore: () => void } {
  return spyOn(childProcess, "spawnSync").mockImplementation(impl as never);
}
