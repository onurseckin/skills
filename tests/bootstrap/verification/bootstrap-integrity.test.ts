import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { verifyCapsuleLayout } from "../../../olt/scripts/src/engine/store/integrity/layout-integrity.ts";
import {
  createMemoryFsHarness,
  type MemoryFsHarness,
  scratchRoot,
} from "../fixtures/bootstrap-fixture.ts";

describe("Bootstrap Layout & Integrity Verification (in-memory virtualization)", () => {
  let harness: MemoryFsHarness;

  beforeEach(() => {
    harness = createMemoryFsHarness();
  });

  afterEach(() => {
    harness.restore();
  });

  it("verifies clean empty run root has no integrity issues", () => {
    const root = scratchRoot(import.meta.path, "verify-empty-layout");
    harness.dirs.add(root);
    const issues = verifyCapsuleLayout(root);
    expect(issues.length).toBe(0);
  });
});
