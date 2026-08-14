import { describe, expect, test } from "bun:test";
import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  statSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { atomicWriteBytes } from "../../orchestrating-long-tasks/scripts/src/core/durable-write.ts";
import { copyPinnedRuntime, runtimeTreeSnapshot } from "../../orchestrating-long-tasks/scripts/src/core/runtime-tree.ts";

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
});
