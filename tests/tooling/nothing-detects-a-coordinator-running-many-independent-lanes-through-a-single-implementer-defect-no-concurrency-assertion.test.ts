import { describe, expect, test } from "bun:test";
import {
  DEFECT_ID,
  ERROR_CODE,
  DEFECT_TITLE,
  assertIndependentLanesConcurrency,
  type ConcurrencyAssertionContext,
  type ConcurrencyAssertionResult,
} from "../../olt/scripts/src/tooling/nothing-detects-a-coordinator-running-many-independent-lanes-through-a-single-implementer-defect-no-concurrency-assertion.ts";

describe("Defect Remediation: defect-no-concurrency-assertion", () => {
  test("exports constants and defect metadata", () => {
    expect(DEFECT_ID).toBe("defect-no-concurrency-assertion");
    expect(ERROR_CODE).toBe("NO_ASSERTION_THAT_READY_LANES_GET_DISTINCT_IMPLEMENTERS");
    expect(DEFECT_TITLE.length).toBeGreaterThan(0);
  });

  test("passes when independent lanes have distinct implementers", () => {
    const ctx: ConcurrencyAssertionContext = {
      waveId: "wave-42",
      lanes: [
        { laneId: "lane-1", implementerActor: "implementer-01" },
        { laneId: "lane-2", implementerActor: "implementer-02" },
        { laneId: "lane-3", implementerActor: "implementer-03" },
      ],
    };
    const result: ConcurrencyAssertionResult = assertIndependentLanesConcurrency(ctx);
    expect(result.remediated).toBe(true);
    expect(result.valid).toBe(true);
    expect(result.distinctImplementerCount).toBe(3);
    expect(result.violations.length).toBe(0);
  });

  test("detects violation when multiple independent lanes share single implementer", () => {
    const ctx: ConcurrencyAssertionContext = {
      waveId: "wave-42",
      lanes: [
        { laneId: "lane-1", implementerActor: "implementer-01" },
        { laneId: "lane-2", implementerActor: "implementer-01" },
        { laneId: "lane-3", implementerActor: "implementer-01" },
      ],
    };
    const result: ConcurrencyAssertionResult = assertIndependentLanesConcurrency(ctx);
    expect(result.remediated).toBe(true);
    expect(result.valid).toBe(false);
    expect(result.distinctImplementerCount).toBe(1);
    expect(result.violations.length).toBe(1);
    expect(result.violations[0]?.includes("implementer-01")).toBe(true);
  });

  test("allows single implementer if sequential fallback is enabled", () => {
    const ctx: ConcurrencyAssertionContext = {
      waveId: "wave-42",
      lanes: [
        { laneId: "lane-1", implementerActor: "implementer-01" },
        { laneId: "lane-2", implementerActor: "implementer-01" },
      ],
      allowSequentialFallback: true,
    };
    const result: ConcurrencyAssertionResult = assertIndependentLanesConcurrency(ctx);
    expect(result.valid).toBe(true);
    expect(result.violations.length).toBe(0);
  });
});
