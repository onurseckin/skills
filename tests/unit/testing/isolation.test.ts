import { describe, expect, it } from "bun:test";
import {
  findRepoRoot,
  getIsolatedTempDir,
  removeIsolatedTempDir,
  snapshotEnv,
  restoreEnvSnapshot,
} from "../../../olt/scripts/src/testing/isolation.ts";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { HarnessError } from "../../../olt/scripts/src/core/errors/harness-error.ts";

describe("testing subsystem mirror tests", () => {
  it("resolves repository root correctly", () => {
    const root = findRepoRoot();
    expect(root).toBeDefined();
    expect(existsSync(root)).toBe(true);
  });

  it("handles environment snapshots cleanly", () => {
    const snap = snapshotEnv();
    expect(snap).toBeDefined();
    restoreEnvSnapshot(snap);
  });

  it("contains deletes to <repoRoot>/coverage/test-isolation and refuses paths outside it", () => {
    const outsideTarget = join(findRepoRoot(), ".olt", "not-test-isolation", "victim");
    let caught: unknown;
    try {
      removeIsolatedTempDir(outsideTarget);
    } catch (error) {
      caught = error;
    }
    expect(caught).toBeInstanceOf(HarnessError);
    const error = caught as HarnessError;
    expect(error.code).toBe("PATH_SAFETY");
    expect(error.message).toContain("CONTAINMENT");
  });

  it("silently no-ops removing an already-absent directory inside the isolation root", () => {
    const tempDir = getIsolatedTempDir({ prefix: "guard-noop" });
    removeIsolatedTempDir(tempDir);
    expect(existsSync(tempDir)).toBe(false);
    expect(() => removeIsolatedTempDir(tempDir)).not.toThrow();
  });
});
