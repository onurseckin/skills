/**
 * @file fixtures.ts
 * In-memory virtual filesystem state, tree populator, and spies for tests/core/fs.
 */

import { spyOn } from "bun:test";
import * as fs from "node:fs";
import { dirname, join } from "node:path";
import * as platform from "../../../olt/scripts/src/platform/index.ts";

export interface DurableFsState {
  mockFiles: Map<string, Buffer>;
  mockDirs: Set<string>;
  mockSymlinks: Map<string, string>;
  mockModes: Map<string, number>;
  fdMap: Map<number, { path: string; pos: number; append: boolean }>;
}

export function createDurableFsState(): DurableFsState {
  return {
    mockFiles: new Map(),
    mockDirs: new Set(),
    mockSymlinks: new Map(),
    mockModes: new Map(),
    fdMap: new Map(),
  };
}

function makeStats(
  isFile: boolean,
  isDir: boolean,
  isSym: boolean,
  mode: number,
  size: number,
): fs.Stats {
  return {
    isFile: () => isFile,
    isDirectory: () => isDir,
    isSymbolicLink: () => isSym,
    mode,
    dev: 1n,
    ino: 1n,
    size,
    mtimeMs: 1000,
  } as unknown as fs.Stats;
}

export function populateRuntimeSourceTree(state: DurableFsState, source: string): void {
  const d = (p: string) => state.mockDirs.add(join(source, ...p.split("/")));
  const f = (p: string, c: string, m?: number) => {
    const full = join(source, ...p.split("/"));
    state.mockFiles.set(full, Buffer.from(c));
    if (m) state.mockModes.set(full, m);
  };
  state.mockDirs.add(source);
  ["src", "src/nested", "src/nested/__pycache__", "assets", "tests", "__pycache__"].forEach(d);
  f("src/nested/tool.ts", "export {}\n", 0o750);
  f("src/nested/legacy.py", "bad\n");
  f("src/nested/__pycache__/legacy.pyc", "bad\n");
  f("harness.ts", "export {}\n");
  f("package.json", "{}\n");
  f("tsconfig.json", "{}\n");
  f("assets/common.md", "instructions\n");
  f("tests/excluded.ts", "bad\n");
  f("legacy.py", "bad\n");
  f("__pycache__/legacy.pyc", "bad\n");
}

export function createDurableRuntimeSpies(
  state: DurableFsState,
): Array<{ mockRestore: () => void }> {
  let fdCounter = 500;

  const isDirPath = (s: string): boolean => {
    if (state.mockDirs.has(s) || s === "/" || s === "") return true;
    for (const d of state.mockDirs) if (d.startsWith(s + "/")) return true;
    for (const f of state.mockFiles.keys()) if (f.startsWith(s + "/")) return true;
    return false;
  };

  const statFor = (s: string) => {
    if (state.mockSymlinks.has(s)) return makeStats(false, false, true, 0o777, 0);
    if (isDirPath(s)) return makeStats(false, true, false, state.mockModes.get(s) ?? 0o755, 0);
    if (state.mockFiles.has(s)) {
      return makeStats(
        true,
        false,
        false,
        state.mockModes.get(s) ?? 0o644,
        state.mockFiles.get(s)!.length,
      );
    }
    const err = new Error(`ENOENT: no such file, '${s}'`) as Error & { code: string };
    err.code = "ENOENT";
    throw err;
  };

  return [
    spyOn(platform, "tryExclusiveFlock").mockImplementation(() => true),
    spyOn(platform, "releaseFlock").mockImplementation(() => undefined),
    spyOn(fs, "existsSync").mockImplementation(
      (p: fs.PathLike) =>
        state.mockFiles.has(String(p)) || isDirPath(String(p)) || state.mockSymlinks.has(String(p)),
    ),
    spyOn(fs, "mkdirSync").mockImplementation(((p: fs.PathLike) => {
      let s = String(p);
      while (s && s !== "/" && s !== ".") {
        state.mockDirs.add(s);
        s = dirname(s);
      }
      return undefined as unknown as string;
    }) as unknown as typeof fs.mkdirSync),
    spyOn(fs, "chmodSync").mockImplementation(((p: fs.PathLike, mode: fs.Mode) => {
      state.mockModes.set(String(p), typeof mode === "number" ? mode : 0o755);
    }) as unknown as typeof fs.chmodSync),
    spyOn(fs, "symlinkSync").mockImplementation(((target: fs.PathLike, p: fs.PathLike) => {
      state.mockSymlinks.set(String(p), String(target));
    }) as unknown as typeof fs.symlinkSync),
    spyOn(fs, "realpathSync").mockImplementation(((p: fs.PathLike) =>
      state.mockSymlinks.has(String(p))
        ? state.mockSymlinks.get(String(p))!
        : String(p)) as unknown as typeof fs.realpathSync),
    spyOn(fs, "lstatSync").mockImplementation(((p: fs.PathLike) =>
      statFor(String(p))) as unknown as typeof fs.lstatSync),
    spyOn(fs, "statSync").mockImplementation(((p: fs.PathLike) => {
      let s = String(p);
      if (state.mockSymlinks.has(s)) s = state.mockSymlinks.get(s)!;
      return statFor(s);
    }) as unknown as typeof fs.statSync),
    spyOn(fs, "fstatSync").mockImplementation(((fd: number) => {
      const s = state.fdMap.get(fd)?.path ?? "";
      const isF = state.mockFiles.has(s),
        isD = isDirPath(s);
      return makeStats(
        isF,
        isD,
        false,
        state.mockModes.get(s) ?? (isD ? 0o755 : 0o644),
        isF ? (state.mockFiles.get(s)?.length ?? 0) : 0,
      );
    }) as unknown as typeof fs.fstatSync),
    spyOn(fs, "openSync").mockImplementation(((
      p: fs.PathLike,
      flags?: fs.OpenMode,
      mode?: fs.Mode,
    ) => {
      const s = String(p);
      const flagNum = typeof flags === "number" ? flags : 0;
      if (flagNum & fs.constants.O_NOFOLLOW && state.mockSymlinks.has(s)) {
        const err = new Error(`ELOOP: symbol link, open '${s}'`) as Error & { code: string };
        err.code = "ELOOP";
        throw err;
      }
      const fd = ++fdCounter;
      state.fdMap.set(fd, { path: s, pos: 0, append: Boolean(flagNum & fs.constants.O_APPEND) });
      if (flagNum & fs.constants.O_CREAT && !state.mockFiles.has(s)) {
        state.mockFiles.set(s, Buffer.alloc(0));
        if (typeof mode === "number") state.mockModes.set(s, mode);
      }
      return fd;
    }) as unknown as typeof fs.openSync),
    spyOn(fs, "readSync").mockImplementation(((
      fd: number,
      buffer: NodeJS.ArrayBufferView,
      offset?: number,
      length?: number,
    ) => {
      const info = state.fdMap.get(fd);
      if (!info) return 0;
      const data = state.mockFiles.get(info.path) ?? Buffer.alloc(0);
      const toRead = Math.min(length ?? buffer.byteLength, Math.max(0, data.length - info.pos));
      Buffer.from(buffer.buffer, buffer.byteOffset, buffer.byteLength).set(
        data.subarray(info.pos, info.pos + toRead),
        offset ?? 0,
      );
      info.pos += toRead;
      return toRead;
    }) as unknown as typeof fs.readSync),
    spyOn(fs, "writeSync").mockImplementation(((
      fd: number,
      buffer: NodeJS.ArrayBufferView,
      offset?: number,
      length?: number,
    ) => {
      const info = state.fdMap.get(fd);
      if (!info) return 0;
      const prev = state.mockFiles.get(info.path) ?? Buffer.alloc(0);
      const len = length ?? buffer.byteLength;
      const slice = Buffer.from(buffer.buffer, buffer.byteOffset + (offset ?? 0), len);
      state.mockFiles.set(info.path, info.append ? Buffer.concat([prev, slice]) : slice);
      return len;
    }) as unknown as typeof fs.writeSync),
    spyOn(fs, "fsyncSync").mockImplementation((() => undefined) as unknown as typeof fs.fsyncSync),
    spyOn(fs, "closeSync").mockImplementation(((fd: number) => {
      state.fdMap.delete(fd);
    }) as unknown as typeof fs.closeSync),
    spyOn(fs, "copyFileSync").mockImplementation(((src: fs.PathLike, dst: fs.PathLike) => {
      const data = state.mockFiles.get(String(src));
      if (data !== undefined) {
        state.mockFiles.set(String(dst), Buffer.from(data));
        state.mockModes.set(String(dst), state.mockModes.get(String(src)) ?? 0o644);
      }
    }) as unknown as typeof fs.copyFileSync),
    spyOn(fs, "readdirSync").mockImplementation(((
      dirPath: fs.PathLike,
      options?: { withFileTypes?: boolean } | null,
    ) => {
      const base = String(dirPath).endsWith("/") ? String(dirPath) : String(dirPath) + "/";
      const childNames = new Set<string>();
      for (const f of state.mockFiles.keys())
        if (f.startsWith(base)) {
          const name = f.slice(base.length).split("/")[0];
          if (name) childNames.add(name);
        }
      for (const d of state.mockDirs)
        if (d.startsWith(base)) {
          const name = d.slice(base.length).split("/")[0];
          if (name) childNames.add(name);
        }
      for (const sym of state.mockSymlinks.keys())
        if (sym.startsWith(base)) {
          const name = sym.slice(base.length).split("/")[0];
          if (name) childNames.add(name);
        }
      const sorted = Array.from(childNames).sort();
      if (options?.withFileTypes) {
        return sorted.map((name) => {
          const fullPath = join(String(dirPath), name);
          return {
            name,
            isFile: () => state.mockFiles.has(fullPath),
            isDirectory: () => isDirPath(fullPath),
            isSymbolicLink: () => state.mockSymlinks.has(fullPath),
          } as fs.Dirent;
        }) as unknown as string[];
      }
      return sorted as unknown as fs.Dirent[];
    }) as unknown as typeof fs.readdirSync),
    spyOn(fs, "rmSync").mockImplementation(((p: fs.PathLike) => {
      const s = String(p);
      state.mockFiles.delete(s);
      state.mockDirs.delete(s);
      state.mockSymlinks.delete(s);
      state.mockModes.delete(s);
      for (const f of Array.from(state.mockFiles.keys()))
        if (f.startsWith(s + "/")) state.mockFiles.delete(f);
      for (const d of Array.from(state.mockDirs))
        if (d.startsWith(s + "/")) state.mockDirs.delete(d);
      for (const sym of Array.from(state.mockSymlinks.keys()))
        if (sym.startsWith(s + "/")) state.mockSymlinks.delete(sym);
    }) as unknown as typeof fs.rmSync),
    spyOn(fs, "renameSync").mockImplementation(((oldP: fs.PathLike, newP: fs.PathLike) => {
      const oldStr = String(oldP),
        newStr = String(newP);
      const val = state.mockFiles.get(oldStr);
      if (val !== undefined) {
        state.mockFiles.set(newStr, val);
        state.mockFiles.delete(oldStr);
      }
      const mode = state.mockModes.get(oldStr);
      if (mode !== undefined) {
        state.mockModes.set(newStr, mode);
        state.mockModes.delete(oldStr);
      }
    }) as unknown as typeof fs.renameSync),
    spyOn(fs, "readFileSync").mockImplementation(((p: fs.PathOrFileDescriptor) => {
      const s = typeof p === "number" ? (state.fdMap.get(p)?.path ?? "") : String(p);
      const val = state.mockFiles.get(s);
      if (val !== undefined) return val.toString("utf8");
      throw new Error(`ENOENT: no such file, open '${s}'`);
    }) as unknown as typeof fs.readFileSync),
    spyOn(fs, "writeFileSync").mockImplementation(((
      p: fs.PathOrFileDescriptor,
      data: string | NodeJS.ArrayBufferView,
      options?: fs.WriteFileOptions,
    ) => {
      const s = String(p);
      state.mockFiles.set(
        s,
        typeof data === "string"
          ? Buffer.from(data, "utf8")
          : Buffer.from(data.buffer, data.byteOffset, data.byteLength),
      );
      if (options && typeof options === "object" && typeof options.mode === "number") {
        state.mockModes.set(s, options.mode);
      }
    }) as unknown as typeof fs.writeFileSync),
  ];
}
