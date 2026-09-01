import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { initCapsuleRun } from "../../../olt/scripts/src/engine/store/capsule/init.ts";
import {
  createMemoryFsHarness,
  type MemoryFsHarness,
  scratchRoot,
} from "../fixtures/bootstrap-fixture.ts";

describe("Capsule Initialization Runtime (in-memory virtualization)", () => {
  let harness: MemoryFsHarness;

  beforeEach(() => {
    harness = createMemoryFsHarness();
  });

  afterEach(() => {
    harness.restore();
  });

  it("initializes a new capsule run in sandbox root", () => {
    const root = scratchRoot(import.meta.path, "capsule-init-new");
    const res = initCapsuleRun("test-run-001", { repo: root, prompt: "Test prompt" });
    expect(res.runRoot).toBeDefined();
    expect(res.existed).toBe(false);
    expect(harness.dirs.has(res.runRoot)).toBe(true);
  });

  it("handles existing run with allowExisting option", () => {
    const root = scratchRoot(import.meta.path, "capsule-init-existing");
    initCapsuleRun("test-run-002", { repo: root, prompt: "First init" });
    const res2 = initCapsuleRun("test-run-002", { repo: root, allowExisting: true });
    expect(res2.existed).toBe(true);
  });

  it("throws error when initializing existing run without allowExisting", () => {
    const root = scratchRoot(import.meta.path, "capsule-init-throw");
    initCapsuleRun("test-run-003", { repo: root, prompt: "First init" });
    expect(() => initCapsuleRun("test-run-003", { repo: root, allowExisting: false })).toThrow();
  });
});
