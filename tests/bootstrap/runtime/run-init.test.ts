import { describe, expect, it } from "bun:test";
import { normalizeRunId } from "../../../olt/scripts/src/engine/store/capsule/run-id.ts";

describe("Run Initialization & ID Normalization", () => {
  it("normalizes standard and custom run ids", () => {
    expect(normalizeRunId("run-123")).toBe("run-123");
    expect(normalizeRunId("RUN_ABC")).toBe("RUN_ABC");
  });

  it("throws HarnessError on empty or blank run id", () => {
    expect(() => normalizeRunId("")).toThrow();
    expect(() => normalizeRunId("   ")).toThrow();
  });
});
