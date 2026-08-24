import { describe, it, expect } from "bun:test";
import { MindAutonomousDiscoveryEngine } from "../../../olt/scripts/src/mind/discovery-engine.ts";

describe("MindAutonomousDiscoveryEngine", () => {
  it("generates deterministic Mode A discovery proposals when queue is empty", () => {
    const proposals = MindAutonomousDiscoveryEngine.generateProposals({
      backlogCount: 0,
      activeRunCount: 0,
      unresolvedDefects: 0,
    });
    expect(proposals.length).toBeGreaterThanOrEqual(3);
    expect(proposals.some((p) => p.category === "zero_any_audit")).toBe(true);
    expect(proposals.some((p) => p.category === "charter_gap_audit")).toBe(true);
    expect(proposals.some((p) => p.category === "work_span_optimization")).toBe(true);
  });
});
