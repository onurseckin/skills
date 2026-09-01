import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { initCapsuleRun } from "../../../olt/scripts/src/engine/store/capsule/init.ts";
import { loadRunProjection } from "../../../olt/scripts/src/engine/store/capsule/load.ts";
import {
  createMemoryFsHarness,
  type MemoryFsHarness,
  scratchRoot,
} from "../fixtures/bootstrap-fixture.ts";

describe("Bootstrap State Validation (in-memory virtualization)", () => {
  let harness: MemoryFsHarness;

  beforeEach(() => {
    harness = createMemoryFsHarness();
  });

  afterEach(() => {
    harness.restore();
  });

  it("loads run projection for an initialized capsule run", () => {
    const root = scratchRoot(import.meta.path, "load-run-proj");
    const { runRoot } = initCapsuleRun("boot-proj-001", { repo: root, prompt: "Boot prompt" });
    const loaded = loadRunProjection(runRoot);
    expect(loaded.manifest.run_id).toBe("boot-proj-001");
    expect(loaded.runRoot).toBeDefined();
  });
});
