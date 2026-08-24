import { describe, it, expect } from "bun:test";
import { MindAutonomousDiscoveryEngine } from "../../../olt/scripts/src/mind/discovery-engine.ts";

describe("MindAutonomousDiscoveryEngine", () => {
  it("can be instantiated", () => {
    const engine = new MindAutonomousDiscoveryEngine();
    expect(engine).toBeInstanceOf(MindAutonomousDiscoveryEngine);
  });

  it("generates deterministic Mode A discovery proposals when queue is empty", () => {
    const proposals = MindAutonomousDiscoveryEngine.generateProposals({
      backlogCount: 0,
      activeRunCount: 0,
      unresolvedDefects: 0,
    });
    expect(proposals.length).toBe(3);
    expect(proposals.some((p) => p.category === "zero_any_audit")).toBe(true);
    expect(proposals.some((p) => p.category === "charter_gap_audit")).toBe(true);
    expect(proposals.some((p) => p.category === "work_span_optimization")).toBe(true);
  });

  it("returns empty list when backlog or active runs exist", () => {
    const p1 = MindAutonomousDiscoveryEngine.generateProposals({
      backlogCount: 1,
      activeRunCount: 0,
      unresolvedDefects: 0,
    });
    expect(p1).toEqual([]);

    const p2 = MindAutonomousDiscoveryEngine.generateProposals({
      backlogCount: 0,
      activeRunCount: 1,
      unresolvedDefects: 0,
    });
    expect(p2).toEqual([]);
  });
});
