import { describe, expect, test } from "bun:test";
import { realpathSync, symlinkSync } from "node:fs";
import { join } from "node:path";
import { HarnessError } from "../../../olt/scripts/src/errors/harness-error.ts";
import { runFilePath } from "../../../olt/scripts/src/store/paths.ts";
import { scratchRoot } from "../../support/scratch-root.ts";

describe("runFilePath", () => {
  test("resolves a plain file name inside the run root", () => {
    const root = scratchRoot(import.meta.path, "plain-file-name");
    expect(runFilePath(root, "manifest.json")).toBe(join(realpathSync(root), "manifest.json"));
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
});
