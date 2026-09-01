/**
 * @file fixtures.ts
 * In-memory virtual filesystem mock spies for tests/core/contracts/type-safety.test.ts.
 */

import { spyOn } from "bun:test";
import * as fs from "node:fs";
import { basename, dirname } from "node:path";

export interface TypeSafetyMockState {
  mockFiles: Map<string, string>;
  mockDirs: Set<string>;
}

export function createTypeSafetyMockState(): TypeSafetyMockState {
  return {
    mockFiles: new Map(),
    mockDirs: new Set(),
  };
}

export function createTypeSafetyFsSpies(
  state: TypeSafetyMockState,
): Array<{ mockRestore: () => void }> {
  return [
    spyOn(fs, "existsSync").mockImplementation((p: fs.PathLike) => {
      const s = String(p);
      return state.mockFiles.has(s) || state.mockDirs.has(s);
    }),
    spyOn(fs, "realpathSync").mockImplementation(((p: fs.PathLike) =>
      String(p)) as unknown as typeof fs.realpathSync),
    spyOn(fs, "statSync").mockImplementation(((p: fs.PathLike) => {
      const s = String(p);
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
      throw new Error(`ENOENT: no such file or directory, stat '${s}'`);
    }) as unknown as typeof fs.statSync),
    spyOn(fs, "lstatSync").mockImplementation(((p: fs.PathLike) => {
      const s = String(p);
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
      throw new Error(`ENOENT: no such file or directory, lstat '${s}'`);
    }) as unknown as typeof fs.lstatSync),
    spyOn(fs, "readFileSync").mockImplementation(((p: fs.PathOrFileDescriptor) => {
      const s = String(p);
      const val = state.mockFiles.get(s);
      if (val !== undefined) return val;
      throw new Error(`ENOENT: no such file or directory, open '${s}'`);
    }) as unknown as typeof fs.readFileSync),
    spyOn(fs, "mkdirSync").mockImplementation(((p: fs.PathLike) => {
      state.mockDirs.add(String(p));
      return undefined as unknown as string;
    }) as unknown as typeof fs.mkdirSync),
    spyOn(fs, "writeFileSync").mockImplementation(((
      p: fs.PathOrFileDescriptor,
      data: string | NodeJS.ArrayBufferView,
    ) => {
      const s = String(p);
      state.mockFiles.set(
        s,
        typeof data === "string" ? data : Buffer.from(data as Uint8Array).toString("utf-8"),
      );
    }) as unknown as typeof fs.writeFileSync),
    spyOn(fs, "readdirSync").mockImplementation(((
      p: fs.PathLike,
      options?: fs.ObjectEncodingOptions & { withFileTypes?: boolean },
    ) => {
      const s = String(p);
      const childNames = new Set<string>();
      const childDirents: {
        name: string;
        isFile: () => boolean;
        isDirectory: () => boolean;
        isSymbolicLink: () => boolean;
      }[] = [];

      for (const dir of state.mockDirs) {
        if (dirname(dir) === s && dir !== s) {
          const name = basename(dir);
          if (!childNames.has(name)) {
            childNames.add(name);
            childDirents.push({
              name,
              isFile: () => false,
              isDirectory: () => true,
              isSymbolicLink: () => false,
            });
          }
        }
      }
      for (const file of state.mockFiles.keys()) {
        if (dirname(file) === s) {
          const name = basename(file);
          if (!childNames.has(name)) {
            childNames.add(name);
            childDirents.push({
              name,
              isFile: () => true,
              isDirectory: () => false,
              isSymbolicLink: () => false,
            });
          }
        }
      }
      if (options && typeof options === "object" && options.withFileTypes) {
        return childDirents as unknown as string[];
      }
      return Array.from(childNames) as unknown as string[];
    }) as unknown as typeof fs.readdirSync),
  ];
}
