import { afterEach, describe, expect, test } from "bun:test";
import { realpathSync } from "node:fs";
import { join } from "node:path";
import {
  portableArtifactPath,
  resolveArtifactPath,
} from "../../../olt/scripts/src/engine/runner/core/artifact-paths.ts";
import { tempRoot, cleanupTempRoots } from "../command/fixture.ts";

function createTestRoot(): string {
  return tempRoot("artifact-paths");
}

afterEach(cleanupTempRoots);

describe("portableArtifactPath", () => {
  test("returns a forward-slash relative path for an artifact inside the run root", () => {
    const root = createTestRoot();
    const absolute = join(root, "commands", "C-1", "attempt-1", "stdout.log");
    expect(portableArtifactPath(root, absolute)).toBe("commands/C-1/attempt-1/stdout.log");
  });

  test("throws when the artifact path equals the run root itself", () => {
    const root = createTestRoot();
    expect(() => portableArtifactPath(root, root)).toThrow("command artifact escapes run root");
  });

  test("throws when the artifact path escapes the run root", () => {
    const root = createTestRoot();
    const outside = join(root, "..", "elsewhere", "stdout.log");
    expect(() => portableArtifactPath(root, outside)).toThrow("command artifact escapes run root");
  });
});

describe("resolveArtifactPath", () => {
  test("resolves a portable path back to an absolute path under the run root", () => {
    const root = createTestRoot();
    expect(resolveArtifactPath(root, "commands/C-1/stdout.log")).toBe(
      join(realpathSync(root), "commands", "C-1", "stdout.log"),
    );
  });

  test("rejects a portable path containing a backslash", () => {
    const root = createTestRoot();
    expect(() => resolveArtifactPath(root, "commands\\C-1\\stdout.log")).toThrow(
      "invalid portable artifact path",
    );
  });

  test("rejects a portable path containing a parent-directory segment", () => {
    const root = createTestRoot();
    expect(() => resolveArtifactPath(root, "../elsewhere/stdout.log")).toThrow(
      "invalid portable artifact path",
    );
  });
});
