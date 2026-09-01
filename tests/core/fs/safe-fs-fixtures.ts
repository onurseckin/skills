/**
 * @file safe-fs-fixtures.ts
 * In-memory virtual filesystem mock spies for tests/core/fs/safe-fs-atomic.test.ts.
 */

import { spyOn } from "bun:test";
import * as fs from "node:fs";
import { dirname, join, sep } from "node:path";

export interface SafeFsMockState {
  mockFiles: Map<string, string>;
  mockDirs: Set<string>;
  mockSymlinks: Map<string, string>;
}

export function createSafeFsMockState(): SafeFsMockState {
  return {
    mockFiles: new Map(),
    mockDirs: new Set(),
    mockSymlinks: new Map(),
  };
}

export function createSafeFsSpies(state: SafeFsMockState): Array<{ mockRestore: () => void }> {
  const resolveSymlinksInPath = (p: string): string => {
    let current = "";
    for (const part of p.split(sep)) {
      if (!part && !current) {
        current = sep;
        continue;
      }
      current = current === sep ? sep + part : join(current, part);
      if (state.mockSymlinks.has(current)) current = state.mockSymlinks.get(current)!;
    }
    return current;
  };

  return [
    spyOn(fs, "existsSync").mockImplementation(
      (p: fs.PathLike) =>
        state.mockFiles.has(String(p)) ||
        state.mockDirs.has(String(p)) ||
        state.mockSymlinks.has(String(p)) ||
        String(p) === "/" ||
        String(p) === sep,
    ),
    spyOn(fs, "mkdirSync").mockImplementation(((p: fs.PathLike) => {
      let s = String(p);
      while (s && s !== "/" && s !== ".") {
        state.mockDirs.add(s);
        s = dirname(s);
      }
      return undefined as unknown as string;
    }) as unknown as typeof fs.mkdirSync),
    spyOn(fs, "writeFileSync").mockImplementation(((
      p: fs.PathOrFileDescriptor,
      data: string | NodeJS.ArrayBufferView,
    ) => {
      state.mockFiles.set(
        String(p),
        typeof data === "string" ? data : Buffer.from(data as Uint8Array).toString("utf8"),
      );
    }) as unknown as typeof fs.writeFileSync),
    spyOn(fs, "symlinkSync").mockImplementation(((target: fs.PathLike, p: fs.PathLike) => {
      state.mockSymlinks.set(String(p), String(target));
    }) as unknown as typeof fs.symlinkSync),
    spyOn(fs, "realpathSync").mockImplementation(((p: fs.PathLike) =>
      String(p) === "/" || String(p) === sep
        ? String(p)
        : resolveSymlinksInPath(String(p))) as unknown as typeof fs.realpathSync),
    spyOn(fs, "lstatSync").mockImplementation(((p: fs.PathLike) => {
      const s = String(p);
      if (s === "/" || s === sep) {
        return {
          isDirectory: () => true,
          isFile: () => false,
          isSymbolicLink: () => false,
        } as unknown as fs.Stats;
      }
      if (state.mockSymlinks.has(s)) {
        return {
          isDirectory: () => false,
          isFile: () => false,
          isSymbolicLink: () => true,
        } as unknown as fs.Stats;
      }
      if (state.mockDirs.has(s)) {
        return {
          isDirectory: () => true,
          isFile: () => false,
          isSymbolicLink: () => false,
        } as unknown as fs.Stats;
      }
      if (state.mockFiles.has(s)) {
        return {
          isDirectory: () => false,
          isFile: () => true,
          isSymbolicLink: () => false,
        } as unknown as fs.Stats;
      }
      const err = new Error(`ENOENT: no such file or directory, lstat '${s}'`) as Error & {
        code: string;
      };
      err.code = "ENOENT";
      throw err;
    }) as unknown as typeof fs.lstatSync),
    spyOn(fs, "rmSync").mockImplementation(((p: fs.PathLike) => {
      const s = String(p);
      state.mockFiles.delete(s);
      state.mockDirs.delete(s);
      state.mockSymlinks.delete(s);
      for (const f of Array.from(state.mockFiles.keys())) {
        if (f.startsWith(s + "/")) state.mockFiles.delete(f);
      }
      for (const d of Array.from(state.mockDirs)) {
        if (d.startsWith(s + "/")) state.mockDirs.delete(d);
      }
      for (const sym of Array.from(state.mockSymlinks.keys())) {
        if (sym.startsWith(s + "/")) state.mockSymlinks.delete(sym);
      }
    }) as unknown as typeof fs.rmSync),
    spyOn(fs, "renameSync").mockImplementation(((from: fs.PathLike, to: fs.PathLike) => {
      const fromStr = String(from);
      const toStr = String(to);
      const val = state.mockFiles.get(fromStr);
      if (val !== undefined) {
        state.mockFiles.set(toStr, val);
        state.mockFiles.delete(fromStr);
      }
      if (state.mockDirs.has(fromStr)) {
        state.mockDirs.delete(fromStr);
        state.mockDirs.add(toStr);
      }
      for (const f of Array.from(state.mockFiles.keys())) {
        if (f.startsWith(fromStr + "/")) {
          state.mockFiles.set(toStr + f.slice(fromStr.length), state.mockFiles.get(f)!);
          state.mockFiles.delete(f);
        }
      }
      for (const d of Array.from(state.mockDirs)) {
        if (d.startsWith(fromStr + "/")) {
          state.mockDirs.add(toStr + d.slice(fromStr.length));
          state.mockDirs.delete(d);
        }
      }
    }) as unknown as typeof fs.renameSync),
    spyOn(fs, "cpSync").mockImplementation(((from: fs.PathLike, to: fs.PathLike) => {
      const fromStr = String(from);
      const toStr = String(to);
      const val = state.mockFiles.get(fromStr);
      if (val !== undefined) state.mockFiles.set(toStr, val);
      if (state.mockDirs.has(fromStr)) state.mockDirs.add(toStr);
      for (const f of Array.from(state.mockFiles.keys())) {
        if (f.startsWith(fromStr + "/")) {
          state.mockFiles.set(toStr + f.slice(fromStr.length), state.mockFiles.get(f)!);
        }
      }
      for (const d of Array.from(state.mockDirs)) {
        if (d.startsWith(fromStr + "/")) {
          state.mockDirs.add(toStr + d.slice(fromStr.length));
        }
      }
    }) as unknown as typeof fs.cpSync),
  ];
}
