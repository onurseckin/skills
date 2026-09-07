import { afterEach, beforeEach, describe, expect, test } from "bun:test";
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
  createVirtualFSSession,
  type VirtualFSSession,
  VirtualMemoryFS,
} from "../../../olt/scripts/src/testing/virtual-fs/index.ts";

describe("durable runtime files (flock & integrity)", () => {
  let vfs: VirtualMemoryFS;
  let session: VirtualFSSession;
  let rootCounter = 0;

  function fixture(): { root: string; source: string; destination: string } {
    const root = `/tmp/virtual/harness-runtime-${++rootCounter}`;
    const source = join(root, "source");
    vfs.mkdirSync(root, { recursive: true });
    vfs.mkdirSync(source, { recursive: true });
    ["src", "src/nested", "src/nested/__pycache__", "assets", "tests", "__pycache__"].forEach((p) =>
      vfs.mkdirSync(join(source, ...p.split("/")), { recursive: true }),
    );
    vfs.writeFileSync(join(source, "src/nested/tool.ts"), "export {}\n");
    session.chmodSync(join(source, "src/nested/tool.ts"), 0o750);
    vfs.writeFileSync(join(source, "src/nested/legacy.py"), "bad\n");
    vfs.writeFileSync(join(source, "src/nested/__pycache__/legacy.pyc"), "bad\n");
    vfs.writeFileSync(join(source, "harness.ts"), "export {}\n");
    vfs.writeFileSync(join(source, "package.json"), "{}\n");
    vfs.writeFileSync(join(source, "tsconfig.json"), "{}\n");
    vfs.writeFileSync(join(source, "assets/common.md"), "instructions\n");
    vfs.writeFileSync(join(source, "tests/excluded.ts"), "bad\n");
    vfs.writeFileSync(join(source, "__pycache__/root.pyc"), "bad\n");
    return { root, source, destination: join(root, "runtime") };
  }

  beforeEach(() => {
    vfs = new VirtualMemoryFS();
    session = createVirtualFSSession(vfs);
  });

  afterEach(() => {
    session.cleanup();
  });

  test("durableAppendBytes preserves a primary failure while attempting all cleanup", () => {
    const root = `/tmp/virtual/core-dur-${++rootCounter}`;
    vfs.mkdirSync(root, { recursive: true });
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
            session.closeSync(descriptor);
            throw new Error("cleanup close failure");
          },
        },
      }),
    ).toThrow(/primary write failure/);
    expect(closeCalls).toBe(1);
    durableAppendBytes(target, new TextEncoder().encode("recovered\n"));
    expect(session.readFileSync(target, "utf8")).toBe("recovered\n");

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
    vfs.mkdirSync(root, { recursive: true });
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
    vfs.mkdirSync(root, { recursive: true });
    const external = join(root, "external.jsonl");
    const target = join(root, "events.jsonl");
    vfs.writeFileSync(external, "external\n");
    session.symlinkSync(external, target);
    expect(() => durableAppendBytes(target, new TextEncoder().encode("record\n"))).toThrow();
    expect(session.readFileSync(external, "utf8")).toBe("external\n");
  });

  test("test_runtime_directory_is_copied_and_integrity_bound", () => {
    const { source, destination } = fixture();
    const pinned = copyPinnedRuntime(source, destination);
    expect(session.readFileSync(join(destination, "src/nested/tool.ts"), "utf8")).toBe(
      "export {}\n",
    );
    expect(session.statSync(join(destination, "src/nested/tool.ts")).mode & 0o777).toBe(0o750);
    expect(pinned.fileCount).toBe(5);
    expect(pinned.digest).toHaveLength(64);
    ["tests", "legacy.py", "src/nested/legacy.py", "src/nested/__pycache__", "__pycache__"].forEach(
      (p) => expect(vfs.existsSync(join(destination, p))).toBeFalse(),
    );
    expect(session.readFileSync(join(destination, "assets/common.md"), "utf8")).toBe(
      "instructions\n",
    );
  });

  test("test_runtime_integrity_binds_empty_directories", () => {
    const { source, destination } = fixture();
    vfs.mkdirSync(join(source, "src", "empty", "nested"), { recursive: true });
    const pinned = copyPinnedRuntime(source, destination);
    session.rmSync(join(destination, "src", "empty", "nested"), { recursive: true });
    expect(runtimeTreeSnapshot(destination).digest).not.toBe(pinned.digest);
  });

  test("test_runtime_integrity_binds_directory_modes", () => {
    const { source, destination } = fixture();
    session.chmodSync(join(source, "src", "nested"), 0o750);
    const pinned = copyPinnedRuntime(source, destination);
    session.chmodSync(join(destination, "src", "nested"), 0o700);
    expect(runtimeTreeSnapshot(destination).digest).not.toBe(pinned.digest);
  });

  test("test_external_runtime_source_is_allowed", () => {
    const { source, destination } = fixture();
    expect(copyPinnedRuntime(source, destination).fileCount).toBe(5);
  });

  test("test_runtime_sources_reject_symlinks_and_non_directories", () => {
    const { root, source } = fixture();
    session.symlinkSync(source, join(root, "source-link"));
    expect(() => copyPinnedRuntime(join(root, "source-link"), join(root, "bad-one"))).toThrow(
      /real directory/i,
    );
    session.symlinkSync(root, join(source, "src", "escape"));
    expect(() => copyPinnedRuntime(source, join(root, "bad-two"))).toThrow(/symlink/i);
    vfs.writeFileSync(join(root, "file"), "x");
    expect(() => copyPinnedRuntime(join(root, "file"), join(root, "bad-three"))).toThrow(
      /real directory/i,
    );
  });

  test("copy pinning removes its destination when the source mutates", () => {
    const { source, destination } = fixture();
    expect(() =>
      copyPinnedRuntime(source, destination, {
        beforeSourceRecheck: () =>
          vfs.writeFileSync(join(source, "src/nested/tool.ts"), "changed\n"),
      }),
    ).toThrow(/changed/i);
    expect(vfs.existsSync(destination)).toBeFalse();
  });

  test("copy pinning refuses to delete a pre-existing destination that contains a .git entry", () => {
    const { source, destination } = fixture();
    vfs.mkdirSync(join(destination, ".git"), { recursive: true });
    expect(() => copyPinnedRuntime(source, destination)).toThrow(/REPOSITORY_INTERLOCK/);
    expect(vfs.existsSync(destination)).toBeTrue();
    expect(vfs.existsSync(join(destination, ".git"))).toBeTrue();
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
    expect(vfs.existsSync(target)).toBeFalse();
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
    expect(vfs.existsSync(target)).toBeTrue();
    expect(session.readFileSync(target, "utf8")).toBe('{"count":42,"hello":"world"}');
    expect(session.statSync(target).mode & 0o777).toBe(0o600);
  });

  test("fsyncDirectory safely syncs an existing directory", () => {
    expect(() => fsyncDirectory(fixture().root)).not.toThrow();
  });
});
