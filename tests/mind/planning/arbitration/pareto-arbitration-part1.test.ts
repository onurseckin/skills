import { describe, expect, it } from "bun:test";
import {
  describePriorityLevel,
  getPriorityPrecedenceRank,
  PARETO_LEVEL_NAMES,
  PARETO_PRIORITY_LEVELS,
  PARETO_PRIORITY_NAMES,
  resolveEffectivePriorityLevel,
} from "../../../../olt/scripts/src/mind/planning/pareto-arbitration.ts";

describe("Pareto Arbitration Part 1 Suite", () => {
  it("resolves hierarchy levels and descriptors correctly", () => {
    expect(PARETO_PRIORITY_LEVELS.UX_DELIGHT_AND_FUNCTIONAL_CORRECTNESS).toBe(1);
    expect(PARETO_PRIORITY_NAMES[1]).toBe("UX_DELIGHT_AND_FUNCTIONAL_CORRECTNESS");
    expect(PARETO_LEVEL_NAMES[1]).toContain("Priority 1");
    expect(describePriorityLevel(1)).toContain("UX Delight");
    expect(getPriorityPrecedenceRank(1)).toBe(1);
    expect(resolveEffectivePriorityLevel({ name: "Base", claimedPriorityLevel: 1 })).toBe(1);
  });
});
