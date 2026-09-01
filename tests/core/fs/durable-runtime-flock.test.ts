import { describe, expect, test, beforeEach, afterEach, spyOn } from "bun:test";
import * as fs from "node:fs";
import { dirname, join } from "node:path";
import {
  atomicWriteBytes,
  atomicWriteJson,
  durableAppendBytes,
  fsyncDirectory,
} from "../../../olt/scripts/src/core/durable-write.ts";
import {
  copyPinnedRuntime,
  runtimeTreeSnapshot,
} from "../../../olt/scripts/src/core/runtime-tree.ts";
import * as platform from "../../../olt/scripts/src/platform/index.ts";

describe("durable runtime files (flock & integrity)", () => {
  const mockFiles = new Map<string, Buffer>();
  const mockDirs = new Set<string>();
  const mockSymlinks = new Map<string, string>();
  const mockModes = new Map<string, number>();
  const fdMap = new Map<number, { path: string; pos: number; append: boolean }>();
  const spies: { mockRestore: () => void }[] = [];
  let rootCounter = 0;

  function fixture(): { root: string; source: string; destination: string } {
    const root = `/tmp/virtual/harness-runtime-${++rootCounter}`;
    const source = join(root, "source");
    [
      root,
      source,
      join(source, "src"),
      join(source, "src", "nested"),
      join(source, "src", "nested", "__pycache__"),
      join(source, "assets"),
      join(source, "tests"),
      join(source, "__pycache__"),
    ].forEach((d) => mockDirs.add(d));
    mockFiles.set(join(source, "src", "nested", "tool.ts"), Buffer.from("export {}\n"));
    mockModes.set(join(source, "src", "nested", "tool.ts"), 0o750);
    mockFiles.set(join(source, "src", "nested", "legacy.py"), Buffer.from("bad\n"));
    mockFiles.set(join(source, "src", "nested", "__pycache__", "legacy.pyc"), Buffer.from("bad\n"));
    mockFiles.set(join(source, "harness.ts"), Buffer.from("export {}\n"));
    mockFiles.set(join(source, "package.json"), Buffer.from("{}\n"));
    mockFiles.set(join(source, "tsconfig.json"), Buffer.from("{}\n"));
    mockFiles.set(join(source, "assets", "common.md"), Buffer.from("instructions\n"));
    mockFiles.set(join(source, "tests", "excluded.ts"), Buffer.from("bad\n"));
    mockFiles.set(join(source, "legacy.py"), Buffer.from("bad\n"));
    mockFiles.set(join(source, "__pycache__", "legacy.pyc"), Buffer.from("bad\n"));
    return { root, source, destination: join(root, "runtime") };
  }

  beforeEach(() => {
    mockFiles.clear();
    mockDirs.clear();
    mockSymlinks.clear();
    mockModes.clear();
    fdMap.clear();
    let fdCounter = 500;
    const isDirectoryPath = (s: string): boolean => {
      if (mockDirs.has(s) || s === "/" || s === "") return true;
      for (const d of mockDirs) if (d.startsWith(s + "/")) return true;
      for (const f of mockFiles.keys()) if (f.startsWith(s + "/")) return true;
      return false;
    };

    spies.push(
      spyOn(platform, "tryExclusiveFlock").mockImplementation(() => true),
      spyOn(platform, "releaseFlock").mockImplementation(() => undefined),
      spyOn(fs, "existsSync").mockImplementation(
        (p: fs.PathLike) =>
          mockFiles.has(String(p)) || isDirectoryPath(String(p)) || mockSymlinks.has(String(p)),
      ),
      spyOn(fs, "mkdirSync").mockImplementation(((p: fs.PathLike) => {
        let s = String(p);
        while (s && s !== "/" && s !== ".") {
          mockDirs.add(s);
          s = dirname(s);
        }
        return undefined as unknown as string;
      }) as unknown as typeof fs.mkdirSync),
      spyOn(fs, "chmodSync").mockImplementation(((p: fs.PathLike, mode: fs.Mode) => {
        mockModes.set(String(p), typeof mode === "number" ? mode : 0o755);
      }) as unknown as typeof fs.chmodSync),
      spyOn(fs, "symlinkSync").mockImplementation(((target: fs.PathLike, p: fs.PathLike) => {
        mockSymlinks.set(String(p), String(target));
      }) as unknown as typeof fs.symlinkSync),
      spyOn(fs, "realpathSync").mockImplementation(((p: fs.PathLike) =>
        mockSymlinks.has(String(p))
          ? mockSymlinks.get(String(p))!
          : String(p)) as unknown as typeof fs.realpathSync),
      spyOn(fs, "lstatSync").mockImplementation(((p: fs.PathLike) => {
        const s = String(p);
        if (mockSymlinks.has(s))
          return {
            isFile: () => false,
            isDirectory: () => false,
            isSymbolicLink: () => true,
            mode: 0o777,
            dev: 1n,
            ino: 1n,
            size: 0,
            mtimeMs: 1000,
          } as unknown as fs.Stats;
        if (isDirectoryPath(s))
          return {
            isFile: () => false,
            isDirectory: () => true,
            isSymbolicLink: () => false,
            mode: mockModes.get(s) ?? 0o755,
            dev: 1n,
            ino: 1n,
            size: 0,
            mtimeMs: 1000,
          } as unknown as fs.Stats;
        if (mockFiles.has(s))
          return {
            isFile: () => true,
            isDirectory: () => false,
            isSymbolicLink: () => false,
            mode: mockModes.get(s) ?? 0o644,
            dev: 1n,
            ino: 1n,
            size: mockFiles.get(s)!.length,
            mtimeMs: 1000,
          } as unknown as fs.Stats;
        const err = new Error(`ENOENT: no such file, lstat '${s}'`) as Error & { code: string };
        err.code = "ENOENT";
        throw err;
      }) as unknown as typeof fs.lstatSync),
      spyOn(fs, "statSync").mockImplementation(((p: fs.PathLike) => {
        let s = String(p);
        if (mockSymlinks.has(s)) s = mockSymlinks.get(s)!;
        if (isDirectoryPath(s))
          return {
            isFile: () => false,
            isDirectory: () => true,
            isSymbolicLink: () => false,
            mode: mockModes.get(s) ?? 0o755,
            dev: 1n,
            ino: 1n,
            size: 0,
            mtimeMs: 1000,
          } as unknown as fs.Stats;
        if (mockFiles.has(s))
          return {
            isFile: () => true,
            isDirectory: () => false,
            isSymbolicLink: () => false,
            mode: mockModes.get(s) ?? 0o644,
            dev: 1n,
            ino: 1n,
            size: mockFiles.get(s)!.length,
            mtimeMs: 1000,
          } as unknown as fs.Stats;
        const err = new Error(`ENOENT: no such file, stat '${s}'`) as Error & { code: string };
        err.code = "ENOENT";
        throw err;
      }) as unknown as typeof fs.statSync),
      spyOn(fs, "fstatSync").mockImplementation(((fd: number) => {
        const s = fdMap.get(fd)?.path ?? "";
        const isF = mockFiles.has(s);
        const isD = isDirectoryPath(s);
        return {
          isFile: () => isF,
          isDirectory: () => isD,
          isSymbolicLink: () => false,
          mode: mockModes.get(s) ?? (isD ? 0o755 : 0o644),
          dev: 1n,
          ino: 1n,
          size: isF ? (mockFiles.get(s)?.length ?? 0) : 0,
          mtimeMs: 1000,
        } as unknown as fs.Stats;
      }) as unknown as typeof fs.fstatSync),
      spyOn(fs, "openSync").mockImplementation(((
        p: fs.PathLike,
        flags?: fs.OpenMode,
        mode?: fs.Mode,
      ) => {
        const s = String(p);
        const flagNum = typeof flags === "number" ? flags : 0;
        if (flagNum & fs.constants.O_NOFOLLOW && mockSymlinks.has(s)) {
          const err = new Error(`ELOOP: symbol link, open '${s}'`) as Error & { code: string };
          err.code = "ELOOP";
          throw err;
        }
        const fd = ++fdCounter;
        fdMap.set(fd, { path: s, pos: 0, append: Boolean(flagNum & fs.constants.O_APPEND) });
        if (flagNum & fs.constants.O_CREAT && !mockFiles.has(s)) {
          mockFiles.set(s, Buffer.alloc(0));
          if (typeof mode === "number") mockModes.set(s, mode);
        }
        return fd;
      }) as unknown as typeof fs.openSync),
      spyOn(fs, "readSync").mockImplementation(((
        fd: number,
        buffer: NodeJS.ArrayBufferView,
        offset?: number,
        length?: number,
      ) => {
        const info = fdMap.get(fd);
        if (!info) return 0;
        const data = mockFiles.get(info.path) ?? Buffer.alloc(0);
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
        const info = fdMap.get(fd);
        if (!info) return 0;
        const prev = mockFiles.get(info.path) ?? Buffer.alloc(0);
        const len = length ?? buffer.byteLength;
        const slice = Buffer.from(buffer.buffer, buffer.byteOffset + (offset ?? 0), len);
        mockFiles.set(info.path, info.append ? Buffer.concat([prev, slice]) : slice);
        return len;
      }) as unknown as typeof fs.writeSync),
      spyOn(fs, "fsyncSync").mockImplementation(
        (() => undefined) as unknown as typeof fs.fsyncSync,
      ),
      spyOn(fs, "closeSync").mockImplementation(((fd: number) => {
        fdMap.delete(fd);
      }) as unknown as typeof fs.closeSync),
      spyOn(fs, "copyFileSync").mockImplementation(((src: fs.PathLike, dst: fs.PathLike) => {
        const data = mockFiles.get(String(src));
        if (data !== undefined) {
          mockFiles.set(String(dst), Buffer.from(data));
          mockModes.set(String(dst), mockModes.get(String(src)) ?? 0o644);
        }
      }) as unknown as typeof fs.copyFileSync),
      spyOn(fs, "readdirSync").mockImplementation(((
        dirPath: fs.PathLike,
        options?: { withFileTypes?: boolean } | null,
      ) => {
        const base = String(dirPath).endsWith("/") ? String(dirPath) : String(dirPath) + "/";
        const childNames = new Set<string>();
        for (const f of mockFiles.keys())
          if (f.startsWith(base)) {
            const name = f.slice(base.length).split("/")[0];
            if (name) childNames.add(name);
          }
        for (const d of mockDirs)
          if (d.startsWith(base)) {
            const name = d.slice(base.length).split("/")[0];
            if (name) childNames.add(name);
          }
        for (const sym of mockSymlinks.keys())
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
              isFile: () => mockFiles.has(fullPath),
              isDirectory: () => isDirectoryPath(fullPath),
              isSymbolicLink: () => mockSymlinks.has(fullPath),
            } as fs.Dirent;
          }) as unknown as string[];
        }
        return sorted as unknown as fs.Dirent[];
      }) as unknown as typeof fs.readdirSync),
      spyOn(fs, "rmSync").mockImplementation(((p: fs.PathLike) => {
        const s = String(p);
        mockFiles.delete(s);
        mockDirs.delete(s);
        mockSymlinks.delete(s);
        mockModes.delete(s);
        for (const f of Array.from(mockFiles.keys()))
          if (f.startsWith(s + "/")) mockFiles.delete(f);
        for (const d of Array.from(mockDirs)) if (d.startsWith(s + "/")) mockDirs.delete(d);
        for (const sym of Array.from(mockSymlinks.keys()))
          if (sym.startsWith(s + "/")) mockSymlinks.delete(sym);
      }) as unknown as typeof fs.rmSync),
      spyOn(fs, "renameSync").mockImplementation(((oldP: fs.PathLike, newP: fs.PathLike) => {
        const oldStr = String(oldP);
        const newStr = String(newP);
        const val = mockFiles.get(oldStr);
        if (val !== undefined) {
          mockFiles.set(newStr, val);
          mockFiles.delete(oldStr);
        }
        const mode = mockModes.get(oldStr);
        if (mode !== undefined) {
          mockModes.set(newStr, mode);
          mockModes.delete(oldStr);
        }
      }) as unknown as typeof fs.renameSync),
      spyOn(fs, "readFileSync").mockImplementation(((p: fs.PathOrFileDescriptor) => {
        const s = typeof p === "number" ? (fdMap.get(p)?.path ?? "") : String(p);
        const val = mockFiles.get(s);
        if (val !== undefined) return val.toString("utf8");
        throw new Error(`ENOENT: no such file, open '${s}'`);
      }) as unknown as typeof fs.readFileSync),
      spyOn(fs, "writeFileSync").mockImplementation(((
        p: fs.PathOrFileDescriptor,
        data: string | NodeJS.ArrayBufferView,
        options?: fs.WriteFileOptions,
      ) => {
        const s = String(p);
        mockFiles.set(
          s,
          typeof data === "string"
            ? Buffer.from(data, "utf8")
            : Buffer.from(data.buffer, data.byteOffset, data.byteLength),
        );
        if (options && typeof options === "object" && typeof options.mode === "number")
          mockModes.set(s, options.mode);
      }) as unknown as typeof fs.writeFileSync),
    );
  });

  afterEach(() => {
    while (spies.length > 0) spies.pop()?.mockRestore();
  });

  test("durableAppendBytes preserves a primary failure while attempting all cleanup", () => {
    const root = `/tmp/virtual/core-dur-${++rootCounter}`;
    mockDirs.add(root);
    const target = join(root, "events.jsonl");
    let closeCalls = 0;
    expect(() =>
      durableAppendBytes(target, new TextEncoder().encode("record\n"), {
        dependencies: {
          write: () => {
            throw new Error("primary write failure");
          },
          tryExclusiveFlock: () => true,
          releaseFlock: () => {
            throw new Error("cleanup unlock failure");
          },
          close(descriptor): void {
            closeCalls += 1;
            fs.closeSync(descriptor);
            throw new Error("cleanup close failure");
          },
        },
      }),
    ).toThrow(/primary write failure/);
    expect(closeCalls).toBe(1);
    durableAppendBytes(target, new TextEncoder().encode("recovered\n"));
    expect(fs.readFileSync(target, "utf8")).toBe("recovered\n");

    let threwUndefined = false;
    try {
      durableAppendBytes(join(root, "undefined.jsonl"), new TextEncoder().encode("record\n"), {
        dependencies: {
          write: () => {
            throw undefined;
          },
        },
      });
    } catch (error) {
      threwUndefined = true;
      expect(error).toBeUndefined();
    }
    expect(threwUndefined).toBeTrue();
  });

  test("durableAppendBytes exposes directory and cleanup failures when no earlier operation failed", () => {
    const root = `/tmp/virtual/core-dur-${++rootCounter}`;
    mockDirs.add(root);
    const target = join(root, "events.jsonl");
    expect(() =>
      durableAppendBytes(target, new TextEncoder().encode("record\n"), {
        dependencies: {
          fsyncDirectory: () => {
            throw new Error("directory durability failure");
          },
        },
      }),
    ).toThrow(/directory durability failure/);

    expect(() =>
      durableAppendBytes(join(root, "cleanup.jsonl"), new TextEncoder().encode("record\n"), {
        dependencies: {
          releaseFlock: () => {
            throw new Error("unlock failure");
          },
        },
      }),
    ).toThrow(/unlock failure/);
  });

  test("durableAppendBytes refuses final symlinks without following them", () => {
    if (process.platform === "win32") return;
    const root = `/tmp/virtual/core-dur-${++rootCounter}`;
    mockDirs.add(root);
    const external = join(root, "external.jsonl");
    const target = join(root, "events.jsonl");
    fs.writeFileSync(external, "external\n");
    fs.symlinkSync(external, target);
    expect(() => durableAppendBytes(target, new TextEncoder().encode("record\n"))).toThrow();
    expect(fs.readFileSync(external, "utf8")).toBe("external\n");
  });

  test("test_runtime_directory_is_copied_and_integrity_bound", () => {
    const { source, destination } = fixture();
    const pinned = copyPinnedRuntime(source, destination);
    expect(fs.readFileSync(join(destination, "src/nested/tool.ts"), "utf8")).toBe("export {}\n");
    expect(fs.statSync(join(destination, "src/nested/tool.ts")).mode & 0o777).toBe(0o750);
    expect(pinned.fileCount).toBe(5);
    expect(pinned.digest).toHaveLength(64);
    ["tests", "legacy.py", "src/nested/legacy.py", "src/nested/__pycache__", "__pycache__"].forEach(
      (p) => expect(fs.existsSync(join(destination, p))).toBeFalse(),
    );
    expect(fs.readFileSync(join(destination, "assets/common.md"), "utf8")).toBe("instructions\n");
  });

  test("test_runtime_integrity_binds_empty_directories", () => {
    const { source, destination } = fixture();
    fs.mkdirSync(join(source, "src", "empty", "nested"));
    const pinned = copyPinnedRuntime(source, destination);
    fs.rmSync(join(destination, "src", "empty", "nested"));
    expect(runtimeTreeSnapshot(destination).digest).not.toBe(pinned.digest);
  });

  test("test_runtime_integrity_binds_directory_modes", () => {
    const { source, destination } = fixture();
    fs.chmodSync(join(source, "src", "nested"), 0o750);
    const pinned = copyPinnedRuntime(source, destination);
    fs.chmodSync(join(destination, "src", "nested"), 0o700);
    expect(runtimeTreeSnapshot(destination).digest).not.toBe(pinned.digest);
  });

  test("test_external_runtime_source_is_allowed", () => {
    const { source, destination } = fixture();
    expect(copyPinnedRuntime(source, destination).fileCount).toBe(5);
  });

  test("test_runtime_sources_reject_symlinks_and_non_directories", () => {
    const { root, source } = fixture();
    fs.symlinkSync(source, join(root, "source-link"));
    expect(() => copyPinnedRuntime(join(root, "source-link"), join(root, "bad-one"))).toThrow(
      /real directory/i,
    );
    fs.symlinkSync(root, join(source, "src", "escape"));
    expect(() => copyPinnedRuntime(source, join(root, "bad-two"))).toThrow(/symlink/i);
    fs.writeFileSync(join(root, "file"), "x");
    expect(() => copyPinnedRuntime(join(root, "file"), join(root, "bad-three"))).toThrow(
      /real directory/i,
    );
  });

  test("copy pinning removes its destination when the source mutates", () => {
    const { source, destination } = fixture();
    expect(() =>
      copyPinnedRuntime(source, destination, {
        beforeSourceRecheck: () =>
          fs.writeFileSync(join(source, "src/nested/tool.ts"), "changed\n"),
      }),
    ).toThrow(/changed/i);
    expect(fs.existsSync(destination)).toBeFalse();
  });

  test("copy pinning refuses to delete a pre-existing destination that contains a .git entry", () => {
    const { source, destination } = fixture();
    fs.mkdirSync(join(destination, ".git"));
    expect(() => copyPinnedRuntime(source, destination)).toThrow(/REPOSITORY_INTERLOCK/);
    expect(fs.existsSync(destination)).toBeTrue();
    expect(fs.existsSync(join(destination, ".git"))).toBeTrue();
  });

  test("atomicWriteBytes cleans up temporary file and descriptor when writing fails", () => {
    const { root } = fixture();
    const target = join(root, "failed-file");
    expect(() =>
      atomicWriteBytes(target, new TextEncoder().encode("data"), {
        observe: (step) => {
          if (step === "file-fsync") throw new Error("simulated failure after fsync");
        },
      }),
    ).toThrow(/simulated failure/);
    expect(fs.existsSync(target)).toBeFalse();
  });

  test("atomicWriteBytes handles post-rename failure when directory fsync fails", () => {
    const { root } = fixture();
    const target = join(root, "failed-rename");
    expect(() =>
      atomicWriteBytes(target, new TextEncoder().encode("data"), {
        observe: (step) => {
          if (step === "directory-fsync") throw new Error("simulated directory fsync failure");
        },
      }),
    ).toThrow(/simulated directory fsync failure/);
  });

  test("atomicWriteJson writes canonical JSON with configured file permissions", () => {
    const { root } = fixture();
    const target = join(root, "data.json");
    atomicWriteJson(target, { hello: "world", count: 42 }, 0o600);
    expect(fs.existsSync(target)).toBeTrue();
    expect(fs.readFileSync(target, "utf8")).toBe('{"count":42,"hello":"world"}');
    expect(fs.statSync(target).mode & 0o777).toBe(0o600);
  });

  test("fsyncDirectory safely syncs an existing directory", () => {
    expect(() => fsyncDirectory(fixture().root)).not.toThrow();
  });
});
