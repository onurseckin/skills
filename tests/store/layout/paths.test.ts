import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { join, resolve } from "node:path";
import { HarnessError } from "../../../olt/scripts/src/core/errors/index.ts";
import { runFilePath } from "../../../olt/scripts/src/engine/store/capsule/paths.ts";
import {
  cleanupVirtualStoreFS,
  scratchRoot,
  setupVirtualStoreFS,
  symlinkSync,
} from "../store-fixture.ts";

beforeEach(() => {
  setupVirtualStoreFS();
});

afterEach(() => {
  cleanupVirtualStoreFS();
});

describe("runFilePath", () => {
  test("resolves a plain file name inside the run root", () => {
    const root = scratchRoot(import.meta.path, "plain-file-name");
    expect(runFilePath(root, "manifest.json")).toBe(join(resolve(root), "manifest.json"));
  });

  test("wraps an unsafe path in a HarnessError with the offending name in the message", () => {
    const root = scratchRoot(import.meta.path, "unsafe-path");
    expect(() => runFilePath(root, "../escape.json")).toThrow(HarnessError);
    expect(() => runFilePath(root, "../escape.json")).toThrow(/unsafe ..\/escape\.json path/);
  });

  test("rejects a symlinked path component even though the target name is otherwise safe", () => {
    const root = scratchRoot(import.meta.path, "symlinked-root");
    const outside = scratchRoot(import.meta.path, "symlinked-outside");
    symlinkSync(outside, join(root, "linked"));
    expect(() => runFilePath(root, "linked/state.json")).toThrow(HarnessError);
  });

  test("strictly rejects absolute paths with descriptive HarnessError", () => {
    const root = scratchRoot(import.meta.path, "absolute-path");
    expect(() => runFilePath(root, "/etc/passwd")).toThrow(HarnessError);
    expect(() => runFilePath(root, "/etc/passwd")).toThrow(/absolute paths are not allowed/);
    expect(() => runFilePath(root, "/virtual/escape.json")).toThrow(HarnessError);
    expect(() => runFilePath(root, "/virtual/escape.json")).toThrow(/absolute paths are not allowed/);
  });

  test("strictly rejects internal parent traversal segments", () => {
    const root = scratchRoot(import.meta.path, "nested-traversal");
    expect(() => runFilePath(root, "sub/../../escape.json")).toThrow(HarnessError);
    expect(() => runFilePath(root, "sub/../../escape.json")).toThrow(/parent traversal is not allowed/);
    expect(() => runFilePath(root, "sub/nested/../../../escape.json")).toThrow(HarnessError);
    expect(() => runFilePath(root, "sub/nested/../../../escape.json")).toThrow(/parent traversal is not allowed/);
  });

  test("rejects multi-hop chained symlinks that escape or point outside", () => {
    const root = scratchRoot(import.meta.path, "multi-hop-root");
    const outside = scratchRoot(import.meta.path, "multi-hop-outside");
    symlinkSync(outside, join(root, "hop2"));
    symlinkSync(join(root, "hop2"), join(root, "hop1"));
    expect(() => runFilePath(root, "hop1/state.json")).toThrow(HarnessError);
    expect(() => runFilePath(root, "hop1/state.json")).toThrow(/symbolic path components are not allowed/);
  });

  test("rejects empty name and self-directory path boundaries", () => {
    const root = scratchRoot(import.meta.path, "empty-or-dot");
    expect(() => runFilePath(root, "")).toThrow(HarnessError);
    expect(() => runFilePath(root, ".")).toThrow(HarnessError);
  });
});
