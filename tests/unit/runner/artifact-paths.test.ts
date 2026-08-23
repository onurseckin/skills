import { afterEach, describe, expect, test } from "bun:test";
import { mkdtempSync, realpathSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  portableArtifactPath,
  resolveArtifactPath,
} from "../../../olt/scripts/src/engine/runner/artifact-paths.ts";

const roots: string[] = [];

function scratchRoot(): string {
  const root = mkdtempSync(join(tmpdir(), "artifact-paths-"));
  roots.push(root);
  return root;
}

afterEach(() => {
  while (roots.length > 0) rmSync(roots.pop()!, { recursive: true, force: true });
});

describe("portableArtifactPath", () => {
  test("returns a forward-slash relative path for an artifact inside the run root", () => {
    const root = scratchRoot();
    const absolute = join(root, "commands", "C-1", "attempt-1", "stdout.log");
    expect(portableArtifactPath(root, absolute)).toBe("commands/C-1/attempt-1/stdout.log");
  });

  test("throws when the artifact path equals the run root itself", () => {
    const root = scratchRoot();
    expect(() => portableArtifactPath(root, root)).toThrow("command artifact escapes run root");
  });

  test("throws when the artifact path escapes the run root", () => {
    const root = scratchRoot();
    const outside = join(root, "..", "elsewhere", "stdout.log");
    expect(() => portableArtifactPath(root, outside)).toThrow("command artifact escapes run root");
  });
});

describe("resolveArtifactPath", () => {
  test("resolves a portable path back to an absolute path under the run root", () => {
    const root = scratchRoot();
    expect(resolveArtifactPath(root, "commands/C-1/stdout.log")).toBe(
      join(realpathSync(root), "commands", "C-1", "stdout.log"),
    );
  });

  test("rejects a portable path containing a backslash", () => {
    const root = scratchRoot();
    expect(() => resolveArtifactPath(root, "commands\\C-1\\stdout.log")).toThrow(
      "invalid portable artifact path",
    );
  });

  test("rejects a portable path containing a parent-directory segment", () => {
    const root = scratchRoot();
    expect(() => resolveArtifactPath(root, "../elsewhere/stdout.log")).toThrow(
      "invalid portable artifact path",
    );
  });
});
