import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import * as fs from "node:fs";
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
import {
  createDurableFsState,
  createDurableRuntimeSpies,
  populateRuntimeSourceTree,
  type DurableFsState,
} from "./fixtures.ts";

describe("durable runtime files (flock & integrity)", () => {
  let state: DurableFsState;
  const spies: { mockRestore: () => void }[] = [];
  let rootCounter = 0;

  function fixture(): { root: string; source: string; destination: string } {
    const root = `/tmp/virtual/harness-runtime-${++rootCounter}`;
    const source = join(root, "source");
    state.mockDirs.add(root);
    populateRuntimeSourceTree(state, source);
    return { root, source, destination: join(root, "runtime") };
  }

  beforeEach(() => {
    state = createDurableFsState();
    spies.push(...createDurableRuntimeSpies(state));
  });

  afterEach(() => {
    while (spies.length > 0) spies.pop()?.mockRestore();
  });

  test("durableAppendBytes preserves a primary failure while attempting all cleanup", () => {
    const root = `/tmp/virtual/core-dur-${++rootCounter}`;
    state.mockDirs.add(root);
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
    state.mockDirs.add(root);
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
    state.mockDirs.add(root);
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
