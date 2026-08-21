import { afterEach, describe, expect, test } from "bun:test";
import { mkdtempSync, realpathSync, rmSync, symlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { HarnessError } from "../../../orchestrating-long-tasks/scripts/src/errors/harness-error.ts";
import { runFilePath } from "../../../orchestrating-long-tasks/scripts/src/store/paths.ts";

const roots: string[] = [];

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { force: true, recursive: true });
});

function scratchRoot(): string {
  const root = mkdtempSync(join(tmpdir(), "store-paths-"));
  roots.push(root);
  return root;
}

describe("runFilePath", () => {
  test("resolves a plain file name inside the run root", () => {
    const root = scratchRoot();
    expect(runFilePath(root, "manifest.json")).toBe(join(realpathSync(root), "manifest.json"));
  });

  test("wraps an unsafe path in a HarnessError with the offending name in the message", () => {
    const root = scratchRoot();
    expect(() => runFilePath(root, "../escape.json")).toThrow(HarnessError);
    expect(() => runFilePath(root, "../escape.json")).toThrow(/unsafe ..\/escape\.json path/);
  });

  test("rejects a symlinked path component even though the target name is otherwise safe", () => {
    const root = scratchRoot();
    const outside = scratchRoot();
    symlinkSync(outside, join(root, "linked"));
    expect(() => runFilePath(root, "linked/state.json")).toThrow(HarnessError);
  });
});
