import { describe, it, expect } from "bun:test";
import { MindConcurrentLookaheadPipeline } from "../../../olt/scripts/src/mind/lookahead.ts";

describe("MindConcurrentLookaheadPipeline", () => {
  it("mandates concurrent pre-planning when 1 run is active and defects exist", () => {
    const directive = MindConcurrentLookaheadPipeline.computeNextActions({
      activeRunCount: 1,
      defectCount: 3,
      concurrencyLimit: 4,
    });

    expect(directive.allowConcurrentPlanning).toBe(true);
    expect(directive.action).toBe("PRE_PLAN_NEXT_CAPSULE");
  });
});
