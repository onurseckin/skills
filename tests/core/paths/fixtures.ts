/**
 * @file fixtures.ts
 * In-memory virtual filesystem mock spies for tests/core/paths/json-paths.test.ts.
 */

import { spyOn } from "bun:test";
import * as fs from "node:fs";

export interface PathsMockState {
  mockFiles: Map<string, Buffer>;
  mockDirs: Set<string>;
  mockSymlinks: Map<string, string>;
  mockModes: Map<string, number>;
  fdMap: Map<number, { path: string; pos: number }>;
}

export function createPathsMockState(): PathsMockState {
  return {
    mockFiles: new Map(),
    mockDirs: new Set(),
    mockSymlinks: new Map(),
    mockModes: new Map(),
    fdMap: new Map(),
  };
}

export function createPathsFsSpies(state: PathsMockState): Array<{ mockRestore: () => void }> {
  let fdCounter = 200;

  return [
    spyOn(fs, "existsSync").mockImplementation((p: fs.PathLike) => {
      const s = String(p);
      return state.mockFiles.has(s) || state.mockDirs.has(s) || state.mockSymlinks.has(s);
    }),
    spyOn(fs, "mkdirSync").mockImplementation(((
      p: fs.PathLike,
      options?: fs.MakeDirectoryOptions,
    ) => {
      const s = String(p);
      state.mockDirs.add(s);
      if (options && typeof options === "object" && typeof options.mode === "number") {
        state.mockModes.set(s, options.mode);
      }
      return undefined as unknown as string;
    }) as unknown as typeof fs.mkdirSync),
    spyOn(fs, "symlinkSync").mockImplementation(((target: fs.PathLike, p: fs.PathLike) => {
      state.mockSymlinks.set(String(p), String(target));
    }) as unknown as typeof fs.symlinkSync),
    spyOn(fs, "chmodSync").mockImplementation(((p: fs.PathLike, mode: fs.Mode) => {
      state.mockModes.set(String(p), typeof mode === "number" ? mode : 0o755);
    }) as unknown as typeof fs.chmodSync),
    spyOn(fs, "realpathSync").mockImplementation(((p: fs.PathLike) => {
      const s = String(p);
      return state.mockSymlinks.has(s) ? state.mockSymlinks.get(s)! : s;
    }) as unknown as typeof fs.realpathSync),
    spyOn(fs, "lstatSync").mockImplementation(((p: fs.PathLike) => {
      const s = String(p);
      if (state.mockModes.get(s) === 0o000) {
        const err = new Error(`EACCES: permission denied, lstat '${s}'`) as Error & {
          code: string;
        };
        err.code = "EACCES";
        throw err;
      }
      if (state.mockSymlinks.has(s)) {
        return {
          isSymbolicLink: () => true,
          isDirectory: () => false,
          isFile: () => false,
          size: 0,
        } as unknown as fs.Stats;
      }
      if (state.mockDirs.has(s)) {
        return {
          isSymbolicLink: () => false,
          isDirectory: () => true,
          isFile: () => false,
          size: 0,
        } as unknown as fs.Stats;
      }
      if (state.mockFiles.has(s)) {
        return {
          isSymbolicLink: () => false,
          isDirectory: () => false,
          isFile: () => true,
          size: state.mockFiles.get(s)!.length,
        } as unknown as fs.Stats;
      }
      const err = new Error(`ENOENT: no such file or directory, lstat '${s}'`) as Error & {
        code: string;
      };
      err.code = "ENOENT";
      throw err;
    }) as unknown as typeof fs.lstatSync),
    spyOn(fs, "openSync").mockImplementation(((p: fs.PathLike) => {
      const s = String(p);
      if (!state.mockFiles.has(s) && !state.mockDirs.has(s)) {
        const err = new Error(`ENOENT: no such file or directory, open '${s}'`) as Error & {
          code: string;
        };
        err.code = "ENOENT";
        throw err;
      }
      const fd = ++fdCounter;
      state.fdMap.set(fd, { path: s, pos: 0 });
      return fd;
    }) as unknown as typeof fs.openSync),
    spyOn(fs, "fstatSync").mockImplementation(((fd: number) => {
      const info = state.fdMap.get(fd);
      const s = info?.path ?? "";
      const isF = state.mockFiles.has(s);
      const isD = state.mockDirs.has(s);
      const size = isF ? (state.mockFiles.get(s)?.length ?? 0) : 0;
      return {
        isFile: () => isF,
        isDirectory: () => isD,
        isSymbolicLink: () => false,
        size,
      } as unknown as fs.Stats;
    }) as unknown as typeof fs.fstatSync),
    spyOn(fs, "readSync").mockImplementation(((
      fd: number,
      buffer: NodeJS.ArrayBufferView,
      offset?: number,
      length?: number,
    ) => {
      const info = state.fdMap.get(fd);
      if (!info) return 0;
      const data = state.mockFiles.get(info.path) ?? Buffer.alloc(0);
      const off = offset ?? 0;
      const len = length ?? buffer.byteLength;
      const available = Math.max(0, data.length - info.pos);
      const toRead = Math.min(len, available);
      const target = Buffer.from(buffer.buffer, buffer.byteOffset, buffer.byteLength);
      data.copy(target, off, info.pos, info.pos + toRead);
      info.pos += toRead;
      return toRead;
    }) as unknown as typeof fs.readSync),
    spyOn(fs, "closeSync").mockImplementation(((fd: number) => {
      state.fdMap.delete(fd);
    }) as unknown as typeof fs.closeSync),
    spyOn(fs, "writeFileSync").mockImplementation(((
      p: fs.PathOrFileDescriptor,
      data: string | NodeJS.ArrayBufferView,
    ) => {
      const s = String(p);
      const buf =
        typeof data === "string"
          ? Buffer.from(data, "utf8")
          : Buffer.from(data.buffer, data.byteOffset, data.byteLength);
      state.mockFiles.set(s, buf);
    }) as unknown as typeof fs.writeFileSync),
  ];
}

export const createSafeFsSpies = createPathsFsSpies;

export interface VirtualCoreSession {
  readonly state: PathsMockState;
  readonly spies: Array<{ mockRestore: () => void }>;
  readonly cleanup: () => void;
}

export function setupVirtualCoreFS(customState?: PathsMockState): VirtualCoreSession {
  const state = customState ?? createPathsMockState();
  const spies = createSafeFsSpies(state);
  return {
    state,
    spies,
    cleanup: () => {
      while (spies.length > 0) spies.pop()?.mockRestore();
    },
  };
}
