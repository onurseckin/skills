import { describe, expect, test } from "bun:test";
import {
  chmodSync,
  closeSync,
  constants,
  existsSync,
  fsyncSync,
  mkdirSync,
  mkdtempSync,
  openSync,
  readFileSync,
  rmSync,
  statSync,
  symlinkSync,
  writeSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
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
import { scratchRoot } from "../../support/scratch-root.ts";

function fixture(): { root: string; source: string; destination: string } {
  const root = mkdtempSync(join(tmpdir(), "harness-runtime-"));
  const source = join(root, "source");
  mkdirSync(join(source, "src", "nested"), { recursive: true });
  writeFileSync(join(source, "src", "nested", "tool.ts"), "export {}\n");
  chmodSync(join(source, "src", "nested", "tool.ts"), 0o750);
  writeFileSync(join(source, "src", "nested", "legacy.py"), "bad\n");
  mkdirSync(join(source, "src", "nested", "__pycache__"));
  writeFileSync(join(source, "src", "nested", "__pycache__", "legacy.pyc"), "bad\n");
  writeFileSync(join(source, "harness.ts"), "export {}\n");
  writeFileSync(join(source, "package.json"), "{}\n");
  writeFileSync(join(source, "tsconfig.json"), "{}\n");
  mkdirSync(join(source, "assets"));
  writeFileSync(join(source, "assets", "common.md"), "instructions\n");
  mkdirSync(join(source, "tests"));
  writeFileSync(join(source, "tests", "excluded.ts"), "bad\n");
  writeFileSync(join(source, "legacy.py"), "bad\n");
  mkdirSync(join(source, "__pycache__"));
  writeFileSync(join(source, "__pycache__", "legacy.pyc"), "bad\n");
  return { root, source, destination: join(root, "runtime") };
}

describe("durable runtime files", () => {
  test("test_atomic_write_sets_mode_before_syncing_content", () => {
    const { root } = fixture();
    const steps: string[] = [];
    const target = join(root, "durable");
    atomicWriteBytes(target, new TextEncoder().encode("ok"), {
      mode: 0o440,
      observe: (step) => steps.push(step),
    });
    expect(steps.indexOf("chmod")).toBeLessThan(steps.indexOf("file-fsync"));
    expect(statSync(target).mode & 0o777).toBe(0o440);
  });

  test("durableAppendBytes appends ordered records and syncs the file before its directory", () => {
    const root = scratchRoot(import.meta.path, "durable-append");
    const target = join(root, "events.jsonl");
    const steps: string[] = [];

    durableAppendBytes(target, new TextEncoder().encode("first\n"), {
      observe: (step) => steps.push(step),
    });
    durableAppendBytes(target, new TextEncoder().encode("second\n"), {
      observe: (step) => steps.push(step),
    });

    expect(readFileSync(target, "utf8")).toBe("first\nsecond\n");
    expect(steps).toEqual(["file-fsync", "directory-fsync", "file-fsync", "directory-fsync"]);
  });

  test("durableAppendBytes holds its record lock through directory durability and rejects re-entry", () => {
    const root = scratchRoot(import.meta.path, "durable-append-lock");
    const target = join(root, "events.jsonl");
    const order: string[] = [];
    let locked = false;
    let nestedRejected = false;
    const bytes = new TextEncoder().encode("outer\n");
    const dependencies = {
      open: openSync,
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
        return writeSync(descriptor, value, offset, length);
      },
      fsync(descriptor: number): void {
        order.push("file-fsync");
        fsyncSync(descriptor);
      },
      close(descriptor: number): void {
        order.push("close");
        closeSync(descriptor);
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
    expect(readFileSync(target, "utf8")).toBe("outer\n");
    expect(order).toEqual(["lock", "write", "file-fsync", "directory-fsync", "unlock", "close"]);
  });

  test("durableAppendBytes times out rather than interleaving with a child-process flock holder", async () => {
    const root = scratchRoot(import.meta.path, "durable-append-cross-process");
    const target = join(root, "events.jsonl");
    const ready = join(root, "holder-ready");
    const flockUrl = new URL("../../../olt/scripts/src/platform/flock-ffi.ts", import.meta.url)
      .href;
    const script = `
      import { closeSync, constants, openSync, writeFileSync } from "node:fs";
      import { releaseFlock, tryExclusiveFlock } from ${JSON.stringify(flockUrl)};
      const descriptor = openSync(${JSON.stringify(target)}, constants.O_RDWR | constants.O_CREAT | constants.O_NOFOLLOW, 0o600);
      if (!tryExclusiveFlock(descriptor)) process.exit(31);
      writeFileSync(${JSON.stringify(ready)}, "ready");
      Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 250);
      releaseFlock(descriptor);
      closeSync(descriptor);
    `;
    const child = Bun.spawn([process.execPath, "--eval", script], {
      env: { PATH: process.env.PATH ?? "", NODE_ENV: "production" },
      stdout: "pipe",
      stderr: "pipe",
    });
    for (let attempt = 0; attempt < 40 && !existsSync(ready); attempt += 1)
      Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 5);
    expect(existsSync(ready)).toBeTrue();
    expect(() =>
      durableAppendBytes(target, new TextEncoder().encode("blocked\n"), {
        timeoutMs: 25,
        retryMs: 2,
      }),
    ).toThrow(/timed out/i);
    expect(await child.exited).toBe(0);
    expect(readFileSync(target, "utf8")).toBe("");
  });

  test("durableAppendBytes keeps every tiny-write JSON record whole across two child processes", async () => {
    const root = scratchRoot(import.meta.path, "durable-append-two-writers");
    const target = join(root, "events.jsonl");
    const start = join(root, "start");
    const moduleUrl = new URL("../../../olt/scripts/src/core/durable-write.ts", import.meta.url)
      .href;
    const childScript = (worker: string): string => `
      import { existsSync, writeFileSync, writeSync } from "node:fs";
      import { durableAppendBytes } from ${JSON.stringify(moduleUrl)};
      const root = ${JSON.stringify(root)};
      const target = ${JSON.stringify(target)};
      writeFileSync(root + "/ready-${worker}", "ready");
      while (!existsSync(${JSON.stringify(start)}))
        Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 2);
      for (let index = 0; index < 8; index += 1) {
        durableAppendBytes(target, new TextEncoder().encode(JSON.stringify({ worker: ${JSON.stringify(worker)}, index }) + "\\n"), {
          timeoutMs: 2_000,
          retryMs: 1,
          dependencies: {
            write(descriptor, data, offset, length) {
              return writeSync(descriptor, data, offset, Math.min(length, 1));
            },
          },
        });
      }
    `;
    const children = ["a", "b"].map((worker) =>
      Bun.spawn([process.execPath, "--eval", childScript(worker)], {
        env: { PATH: process.env.PATH ?? "", NODE_ENV: "production" },
        stdout: "pipe",
        stderr: "pipe",
      }),
    );
    for (
      let attempt = 0;
      attempt < 100 && (!existsSync(join(root, "ready-a")) || !existsSync(join(root, "ready-b")));
      attempt += 1
    )
      Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 2);
    expect(existsSync(join(root, "ready-a"))).toBeTrue();
    expect(existsSync(join(root, "ready-b"))).toBeTrue();
    writeFileSync(start, "go");
    expect(await Promise.all(children.map((child) => child.exited))).toEqual([0, 0]);

    const records = readFileSync(target, "utf8")
      .trim()
      .split("\n")
      .map((line) => JSON.parse(line) as { worker: string; index: number });
    expect(records).toHaveLength(16);
    expect(new Set(records.map((record) => `${record.worker}:${record.index}`)).size).toBe(16);
  });

  test("durableAppendBytes retries partial writes and rejects zero-progress or empty records", () => {
    const root = scratchRoot(import.meta.path, "durable-append-partial");
    const target = join(root, "events.jsonl");
    const bytes = new TextEncoder().encode("partial\n");
    let writes = 0;
    durableAppendBytes(target, bytes, {
      dependencies: {
        write(descriptor, value, offset, length): number {
          writes += 1;
          return writeSync(descriptor, value, offset, Math.min(length, 2));
        },
      },
    });
    expect(writes).toBeGreaterThan(1);
    expect(readFileSync(target, "utf8")).toBe("partial\n");

    const zeroTarget = join(root, "zero.jsonl");
    let closes = 0;
    expect(() =>
      durableAppendBytes(zeroTarget, bytes, {
        dependencies: {
          write: () => 0,
          close(descriptor): void {
            closes += 1;
            closeSync(descriptor);
          },
        },
      }),
    ).toThrow(/no progress/i);
    expect(closes).toBe(1);
    expect(() => durableAppendBytes(join(root, "empty.jsonl"), new Uint8Array())).toThrow(/empty/i);
    expect(existsSync(join(root, "empty.jsonl"))).toBeFalse();
  });

  test("durableAppendBytes preserves a primary failure while attempting all cleanup", () => {
    const root = scratchRoot(import.meta.path, "durable-append-cleanup");
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
            closeSync(descriptor);
            throw new Error("cleanup close failure");
          },
        },
      }),
    ).toThrow(/primary write failure/);
    expect(closeCalls).toBe(1);
    durableAppendBytes(target, new TextEncoder().encode("recovered\n"));
    expect(readFileSync(target, "utf8")).toBe("recovered\n");

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
    const root = scratchRoot(import.meta.path, "durable-append-finalization");
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
    const root = scratchRoot(import.meta.path, "durable-append-symlink");
    const external = join(root, "external.jsonl");
    const target = join(root, "events.jsonl");
    writeFileSync(external, "external\n");
    symlinkSync(external, target);
    expect(() => durableAppendBytes(target, new TextEncoder().encode("record\n"))).toThrow();
    expect(readFileSync(external, "utf8")).toBe("external\n");
  });

  test("test_runtime_directory_is_copied_and_integrity_bound", () => {
    const { source, destination } = fixture();
    const pinned = copyPinnedRuntime(source, destination);
    expect(readFileSync(join(destination, "src/nested/tool.ts"), "utf8")).toBe("export {}\n");
    expect(statSync(join(destination, "src/nested/tool.ts")).mode & 0o777).toBe(0o750);
    expect(pinned.fileCount).toBe(5);
    expect(pinned.digest).toHaveLength(64);
    expect(existsSync(join(destination, "tests"))).toBeFalse();
    expect(existsSync(join(destination, "legacy.py"))).toBeFalse();
    expect(existsSync(join(destination, "src/nested/legacy.py"))).toBeFalse();
    expect(existsSync(join(destination, "src/nested/__pycache__"))).toBeFalse();
    expect(readFileSync(join(destination, "assets/common.md"), "utf8")).toBe("instructions\n");
    expect(existsSync(join(destination, "__pycache__"))).toBeFalse();
  });

  test("test_runtime_integrity_binds_empty_directories", () => {
    const { source, destination } = fixture();
    mkdirSync(join(source, "src", "empty", "nested"), { recursive: true });
    const pinned = copyPinnedRuntime(source, destination);
    rmSync(join(destination, "src", "empty", "nested"), { recursive: true });
    expect(runtimeTreeSnapshot(destination).digest).not.toBe(pinned.digest);
  });

  test("test_runtime_integrity_binds_directory_modes", () => {
    const { source, destination } = fixture();
    chmodSync(join(source, "src", "nested"), 0o750);
    const pinned = copyPinnedRuntime(source, destination);
    chmodSync(join(destination, "src", "nested"), 0o700);
    expect(runtimeTreeSnapshot(destination).digest).not.toBe(pinned.digest);
  });

  test("test_external_runtime_source_is_allowed", () => {
    const { source, destination } = fixture();
    expect(copyPinnedRuntime(source, destination).fileCount).toBe(5);
  });

  test("test_runtime_sources_reject_symlinks_and_non_directories", () => {
    const { root, source } = fixture();
    symlinkSync(source, join(root, "source-link"));
    expect(() => copyPinnedRuntime(join(root, "source-link"), join(root, "bad-one"))).toThrow(
      /real directory/i,
    );
    symlinkSync(root, join(source, "src", "escape"));
    expect(() => copyPinnedRuntime(source, join(root, "bad-two"))).toThrow(/symlink/i);
    const file = join(root, "file");
    writeFileSync(file, "x");
    expect(() => copyPinnedRuntime(file, join(root, "bad-three"))).toThrow(/real directory/i);
  });

  test("copy pinning removes its destination when the source mutates", () => {
    const { source, destination } = fixture();
    expect(() =>
      copyPinnedRuntime(source, destination, {
        beforeSourceRecheck: () => writeFileSync(join(source, "src/nested/tool.ts"), "changed\n"),
      }),
    ).toThrow(/changed/i);
    expect(existsSync(destination)).toBeFalse();
  });

  test("copy pinning refuses to delete a pre-existing destination that contains a .git entry", () => {
    const { source, destination } = fixture();
    mkdirSync(join(destination, ".git"), { recursive: true });
    expect(() => copyPinnedRuntime(source, destination)).toThrow(/REPOSITORY_INTERLOCK/);
    expect(existsSync(destination)).toBeTrue();
    expect(existsSync(join(destination, ".git"))).toBeTrue();
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
    expect(existsSync(target)).toBeFalse();
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
    expect(existsSync(target)).toBeTrue();
    expect(readFileSync(target, "utf8")).toBe('{"count":42,"hello":"world"}');
    expect(statSync(target).mode & 0o777).toBe(0o600);
  });

  test("fsyncDirectory safely syncs an existing directory", () => {
    const { root } = fixture();
    expect(() => fsyncDirectory(root)).not.toThrow();
  });
});
