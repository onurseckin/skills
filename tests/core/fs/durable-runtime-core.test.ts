import { describe, expect, test, beforeEach, afterEach, spyOn } from "bun:test";
import * as fs from "node:fs";
import { dirname, join } from "node:path";
import {
  atomicWriteBytes,
  durableAppendBytes,
} from "../../../olt/scripts/src/core/durable-write.ts";
import * as platform from "../../../olt/scripts/src/platform/index.ts";

describe("durable runtime files", () => {
  const mockFiles = new Map<string, Buffer>();
  const mockDirs = new Set<string>();
  const mockModes = new Map<string, number>();
  const fdMap = new Map<number, { path: string; append: boolean }>();
  const spies: { mockRestore: () => void }[] = [];
  let rootCounter = 0;

  function fixture(): { root: string; source: string; destination: string } {
    const root = `/virtual-harness-runtime-${++rootCounter}`;
    mockDirs.add(root);
    const source = join(root, "source");
    mockDirs.add(source);
    mockDirs.add(join(source, "src", "nested"));
    mockFiles.set(join(source, "src", "nested", "tool.ts"), Buffer.from("export {}\n"));
    mockModes.set(join(source, "src", "nested", "tool.ts"), 0o750);
    mockFiles.set(join(source, "src", "nested", "legacy.py"), Buffer.from("bad\n"));
    mockDirs.add(join(source, "src", "nested", "__pycache__"));
    mockFiles.set(join(source, "src", "nested", "__pycache__", "legacy.pyc"), Buffer.from("bad\n"));
    mockFiles.set(join(source, "harness.ts"), Buffer.from("export {}\n"));
    mockFiles.set(join(source, "package.json"), Buffer.from("{}\n"));
    mockFiles.set(join(source, "tsconfig.json"), Buffer.from("{}\n"));
    mockDirs.add(join(source, "assets"));
    mockFiles.set(join(source, "assets", "common.md"), Buffer.from("instructions\n"));
    mockDirs.add(join(source, "tests"));
    mockFiles.set(join(source, "tests", "excluded.ts"), Buffer.from("bad\n"));
    mockFiles.set(join(source, "legacy.py"), Buffer.from("bad\n"));
    mockDirs.add(join(source, "__pycache__"));
    mockFiles.set(join(source, "__pycache__", "legacy.pyc"), Buffer.from("bad\n"));
    return { root, source, destination: join(root, "runtime") };
  }

  beforeEach(() => {
    mockFiles.clear();
    mockDirs.clear();
    mockModes.clear();
    fdMap.clear();
    let fdCounter = 400;

    spies.push(
      spyOn(platform, "tryExclusiveFlock").mockImplementation(() => true),
      spyOn(platform, "releaseFlock").mockImplementation(() => undefined),
      spyOn(fs, "existsSync").mockImplementation(
        (p: fs.PathLike) => mockFiles.has(String(p)) || mockDirs.has(String(p)),
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
      spyOn(fs, "statSync").mockImplementation(((p: fs.PathLike) => {
        const s = String(p);
        const isF = mockFiles.has(s);
        const isD = mockDirs.has(s);
        const mode = mockModes.get(s) ?? (isD ? 0o755 : 0o644);
        return {
          isFile: () => isF,
          isDirectory: () => isD,
          isSymbolicLink: () => false,
          size: isF ? mockFiles.get(s)!.length : 0,
          mode,
          dev: 1,
          ino: 1,
        } as unknown as fs.Stats;
      }) as unknown as typeof fs.statSync),
      spyOn(fs, "fstatSync").mockImplementation(((fd: number) => {
        const info = fdMap.get(fd);
        const s = info?.path ?? "";
        const isF = mockFiles.has(s);
        const isD = mockDirs.has(s);
        const mode = mockModes.get(s) ?? (isD ? 0o755 : 0o644);
        return {
          isFile: () => isF,
          isDirectory: () => isD,
          isSymbolicLink: () => false,
          size: isF ? (mockFiles.get(s)?.length ?? 0) : 0,
          mode,
          dev: 1,
          ino: 1,
        } as unknown as fs.Stats;
      }) as unknown as typeof fs.fstatSync),
      spyOn(fs, "openSync").mockImplementation(((
        p: fs.PathLike,
        flags?: fs.OpenMode,
        mode?: fs.Mode,
      ) => {
        const s = String(p);
        const flagNum = typeof flags === "number" ? flags : 0;
        const fd = ++fdCounter;
        fdMap.set(fd, { path: s, append: Boolean(flagNum & fs.constants.O_APPEND) });
        if (!mockFiles.has(s)) mockFiles.set(s, Buffer.alloc(0));
        if (typeof mode === "number") mockModes.set(s, mode);
        return fd;
      }) as unknown as typeof fs.openSync),
      spyOn(fs, "writeSync").mockImplementation(((
        fd: number,
        buffer: NodeJS.ArrayBufferView,
        offset?: number,
        length?: number,
      ) => {
        const info = fdMap.get(fd);
        if (!info) return 0;
        const s = info.path;
        const prev = mockFiles.get(s) ?? Buffer.alloc(0);
        const off = offset ?? 0;
        const len = length ?? buffer.byteLength;
        const slice = Buffer.from(buffer.buffer, buffer.byteOffset + off, len);
        const next = info.append ? Buffer.concat([prev, slice]) : slice;
        mockFiles.set(s, next);
        return len;
      }) as unknown as typeof fs.writeSync),
      spyOn(fs, "fsyncSync").mockImplementation(
        (() => undefined) as unknown as typeof fs.fsyncSync,
      ),
      spyOn(fs, "closeSync").mockImplementation(((fd: number) => {
        fdMap.delete(fd);
      }) as unknown as typeof fs.closeSync),
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
        const buf =
          typeof data === "string"
            ? Buffer.from(data, "utf8")
            : Buffer.from(data.buffer, data.byteOffset, data.byteLength);
        mockFiles.set(s, buf);
        if (options && typeof options === "object" && typeof options.mode === "number") {
          mockModes.set(s, options.mode);
        }
      }) as unknown as typeof fs.writeFileSync),
    );
  });

  afterEach(() => {
    while (spies.length > 0) spies.pop()?.mockRestore();
  });

  test("test_atomic_write_sets_mode_before_syncing_content", () => {
    const { root } = fixture();
    const steps: string[] = [];
    const target = join(root, "durable");
    atomicWriteBytes(target, new TextEncoder().encode("ok"), {
      mode: 0o440,
      observe: (step) => steps.push(step),
    });
    expect(steps.indexOf("chmod")).toBeLessThan(steps.indexOf("file-fsync"));
    expect(fs.statSync(target).mode & 0o777).toBe(0o440);
  });

  test("durableAppendBytes appends ordered records and syncs the file before its directory", () => {
    const root = `/virtual-core-dur-${++rootCounter}`;
    mockDirs.add(root);
    const target = join(root, "events.jsonl");
    const steps: string[] = [];

    durableAppendBytes(target, new TextEncoder().encode("first\n"), {
      observe: (step) => steps.push(step),
    });
    durableAppendBytes(target, new TextEncoder().encode("second\n"), {
      observe: (step) => steps.push(step),
    });

    expect(fs.readFileSync(target, "utf8")).toBe("first\nsecond\n");
    expect(steps).toEqual(["file-fsync", "directory-fsync", "file-fsync", "directory-fsync"]);
  });

  test("durableAppendBytes holds its record lock through directory durability and rejects re-entry", () => {
    const root = `/virtual-core-dur-${++rootCounter}`;
    mockDirs.add(root);
    const target = join(root, "events.jsonl");
    const order: string[] = [];
    let locked = false;
    let nestedRejected = false;
    const bytes = new TextEncoder().encode("outer\n");
    const dependencies = {
      open: fs.openSync,
      write(descriptor: number, value: Uint8Array, offset: number, length: number): number {
        expect(locked).toBeTrue();
        try {
          durableAppendBytes(target, new TextEncoder().encode("inner\n"), {
            timeoutMs: 0,
            dependencies,
          });
        } catch (error) {
          nestedRejected = /already active/i.test(String(error));
        }
        order.push("write");
        return fs.writeSync(descriptor, value, offset, length);
      },
      fsync(descriptor: number): void {
        order.push("file-fsync");
        fs.fsyncSync(descriptor);
      },
      close(descriptor: number): void {
        order.push("close");
        fs.closeSync(descriptor);
      },
      tryExclusiveFlock(): boolean {
        order.push("lock");
        locked = true;
        return true;
      },
      releaseFlock(): void {
        order.push("unlock");
        locked = false;
      },
      fsyncDirectory(): void {
        order.push("directory-fsync");
      },
    };

    durableAppendBytes(target, bytes, { dependencies });

    expect(nestedRejected).toBeTrue();
    expect(fs.readFileSync(target, "utf8")).toBe("outer\n");
    expect(order).toEqual(["lock", "write", "file-fsync", "directory-fsync", "unlock", "close"]);
  });

  test("durableAppendBytes times out rather than interleaving with a held exclusive flock", () => {
    const root = `/virtual-core-dur-${++rootCounter}`;
    mockDirs.add(root);
    const target = join(root, "events.jsonl");
    let attempts = 0;
    expect(() =>
      durableAppendBytes(target, new TextEncoder().encode("blocked\n"), {
        timeoutMs: 25,
        retryMs: 2,
        dependencies: {
          tryExclusiveFlock: () => {
            attempts += 1;
            return false;
          },
        },
      }),
    ).toThrow(/timed out/i);
    expect(attempts).toBeGreaterThan(1);
    expect(fs.existsSync(target)).toBeTrue();
  });

  test("durableAppendBytes keeps every tiny-write JSON record whole across partial writes", () => {
    const root = `/virtual-core-dur-${++rootCounter}`;
    mockDirs.add(root);
    const target = join(root, "events.jsonl");
    for (const worker of ["a", "b"]) {
      for (let index = 0; index < 8; index += 1) {
        durableAppendBytes(
          target,
          new TextEncoder().encode(JSON.stringify({ worker, index }) + "\n"),
          {
            timeoutMs: 2_000,
            retryMs: 1,
            dependencies: {
              write(descriptor, data, offset, length) {
                return fs.writeSync(descriptor, data, offset, Math.min(length, 1));
              },
            },
          },
        );
      }
    }

    const records = fs
      .readFileSync(target, "utf8")
      .trim()
      .split("\n")
      .map((line) => JSON.parse(line) as { worker: string; index: number });
    expect(records).toHaveLength(16);
    expect(new Set(records.map((record) => `${record.worker}:${record.index}`)).size).toBe(16);
  });

  test("durableAppendBytes retries partial writes and rejects zero-progress or empty records", () => {
    const root = `/virtual-core-dur-${++rootCounter}`;
    mockDirs.add(root);
    const target = join(root, "events.jsonl");
    const bytes = new TextEncoder().encode("partial\n");
    let writes = 0;
    durableAppendBytes(target, bytes, {
      dependencies: {
        write(descriptor, value, offset, length): number {
          writes += 1;
          return fs.writeSync(descriptor, value, offset, Math.min(length, 2));
        },
      },
    });
    expect(writes).toBeGreaterThan(1);
    expect(fs.readFileSync(target, "utf8")).toBe("partial\n");

    const zeroTarget = join(root, "zero.jsonl");
    let closes = 0;
    expect(() =>
      durableAppendBytes(zeroTarget, bytes, {
        dependencies: {
          write: () => 0,
          close(descriptor): void {
            closes += 1;
            fs.closeSync(descriptor);
          },
        },
      }),
    ).toThrow(/no progress/i);
    expect(closes).toBe(1);
    expect(() => durableAppendBytes(join(root, "empty.jsonl"), new Uint8Array())).toThrow(/empty/i);
    expect(fs.existsSync(join(root, "empty.jsonl"))).toBeFalse();
  });
});
