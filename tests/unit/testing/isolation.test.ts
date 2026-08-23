import { describe, expect, it } from "bun:test";
import {
  findRepoRoot,
  getIsolatedTempDir,
  removeIsolatedTempDir,
  snapshotEnv,
  restoreEnvSnapshot,
} from "../../../olt/scripts/src/testing/isolation.ts";
import { existsSync } from "node:fs";

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
});
