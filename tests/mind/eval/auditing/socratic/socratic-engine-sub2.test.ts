import { describe, expect, it } from "bun:test";
import {
  DIALECTICAL_LEVELS,
  HistoricalDebateMemory,
  IMPASSE_CRUCIBLE_THRESHOLD,
  PARETO_PRIORITY_LEVELS,
  SCALABILITY_THRESHOLD_PERCENT,
  SocraticLadderingEngine,
  type StrategicCommitment,
  type StrategicResolution,
} from "../../../../../olt/scripts/src/mind/auditing/socratic/index.ts";

describe("HistoricalDebateMemory", () => {
  it("advances through L1 -> L2 -> L3 -> Consensus cleanly", () => {
    const engine = new SocraticLadderingEngine();

    // Level 1: Trade-off verification
    const ex1 = engine.evaluateCycle("c1", "Distributed Locking");
    expect(ex1.level).toBe("L1_TRADE_OFF_VERIFICATION");
    expect(ex1.inquiry).toContain("Level 1 Trade-off Verification");

    const st1 = engine.submitResponse("c1", "Trade-offs verified against storage invariants", {
      isSatisfactory: true,
    });
    expect(st1.currentLevel).toBe("L2_SECOND_ORDER_IMPLICATIONS");

    // Level 2: Second-order implications
    const ex2 = engine.evaluateCycle("c1", "Distributed Locking");
    expect(ex2.level).toBe("L2_SECOND_ORDER_IMPLICATIONS");
    expect(ex2.inquiry).toContain("Level 2 Second-Order Implications");

    const st2 = engine.submitResponse("c1", "Downstream blast radius bounded by lease timeout", {
      isSatisfactory: true,
    });
    expect(st2.currentLevel).toBe("L3_EMERGENT_PARADIGMS");

    // Level 3: Emergent paradigms
    const ex3 = engine.evaluateCycle("c1", "Distributed Locking");
    expect(ex3.level).toBe("L3_EMERGENT_PARADIGMS");
    expect(ex3.inquiry).toContain("Level 3 Emergent Paradigms");

    const st3 = engine.submitResponse("c1", "Enables zero-contention horizontal scale", {
      isSatisfactory: true,
      consensusReached: true,
    });
    expect(st3.consensusReached).toBe(true);

    // Record consensus
    const res = engine.recordConsensus(
      "c1",
      "Distributed Locking",
      "Lease-based Raft Locking",
      PARETO_PRIORITY_LEVELS.SIMPLICITY_AND_MAINTAINABILITY,
      "Single active lease per partition",
    );
    expect(res.consensusReached).toBe(true);
    expect(engine.getState().currentLevel).toBe("L1_TRADE_OFF_VERIFICATION");
  });

  it("tracks consecutive impasse cycles and triggers Empirical Crucible escalation when > 2 cycles", () => {
    const engine = new SocraticLadderingEngine();

    // Cycle 1 impasse
    engine.evaluateCycle("c-imp-1", "Controversial Optimization");
    let state = engine.submitResponse("c-imp-1", "Unsatisfactory response", {
      isSatisfactory: false,
      reason: "Contradicts invariants",
    });
    expect(state.consecutiveImpasseCycles).toBe(1);
    expect(state.activeExchange?.requiresCrucible).toBe(false);

    // Cycle 2 impasse
    engine.evaluateCycle("c-imp-2", "Controversial Optimization");
    state = engine.submitResponse("c-imp-2", "Still unsatisfactory", {
      isSatisfactory: false,
      reason: "No benchmark data",
    });
    expect(state.consecutiveImpasseCycles).toBe(2);
    expect(state.activeExchange?.requiresCrucible).toBe(false);

    // Cycle 3 impasse (exceeds threshold 2)
    engine.evaluateCycle("c-imp-3", "Controversial Optimization");
    state = engine.submitResponse("c-imp-3", "Third failed attempt", {
      isSatisfactory: false,
      reason: "Complete deadlock",
    });
    expect(state.consecutiveImpasseCycles).toBe(3);
    expect(state.consecutiveImpasseCycles).toBeGreaterThan(IMPASSE_CRUCIBLE_THRESHOLD);
    expect(state.activeExchange?.requiresCrucible).toBe(true);

    // Evaluating next cycle now flags empirical crucible requirement in the inquiry
    const exCrucible = engine.evaluateCycle("c-imp-4", "Controversial Optimization");
    expect(exCrucible.requiresCrucible).toBe(true);
    expect(exCrucible.inquiry).toContain("IMPASSE DETECTED");
    expect(exCrucible.inquiry).toContain("Empirical Crucible");

    // Explicit escalation
    const directEscalation = engine.escalateToCrucible(
      "c-imp-5",
      "Architectural conflict between two competing paradigms",
    );
    expect(directEscalation.requiresCrucible).toBe(true);
  });

  describe("Pre-Declared Pareto Arbitration", () => {
    const engine = new SocraticLadderingEngine();

    it("Priority 1 (UX Delight & Correctness) always beats lower priorities", () => {
      const p1Approach = {
        name: "User-Friendly Zero-Error Validator",
        satisfiesPriority: PARETO_PRIORITY_LEVELS.UX_DELIGHT_AND_CORRECTNESS,
        cognitiveComplexityScore: 4,
      };
      const p2Approach = {
        name: "Simple Raw Script",
        satisfiesPriority: PARETO_PRIORITY_LEVELS.SIMPLICITY_AND_MAINTAINABILITY,
        cognitiveComplexityScore: 2,
      };

      const result = engine.arbitratePareto(p1Approach, p2Approach);
      expect(result.winner).toBe("User-Friendly Zero-Error Validator");
      expect(result.winningLevel).toBe(1);
      expect(result.loser).toBe("Simple Raw Script");
      expect(result.rationale).toContain("Priority 1");
    });

    it("Correctness gate: Approach with errors automatically loses to error-free approach", () => {
      const buggyP1 = {
        name: "Crashing UI Component",
        satisfiesPriority: PARETO_PRIORITY_LEVELS.UX_DELIGHT_AND_CORRECTNESS,
        hasErrors: true,
      };
      const cleanP2 = {
        name: "Robust Baseline Handler",
        satisfiesPriority: PARETO_PRIORITY_LEVELS.SIMPLICITY_AND_MAINTAINABILITY,
        hasErrors: false,
      };

      const result = engine.arbitratePareto(buggyP1, cleanP2);
      expect(result.winner).toBe("Robust Baseline Handler");
      expect(result.winningLevel).toBe(1);
      expect(result.loser).toBe("Crashing UI Component");
      expect(result.rationale).toContain("contains runtime or structural errors");
    });

    it("Priority 2 (Simplicity & Maintainability) unconditionally beats marginal performance gains (< 15%)", () => {
      const simplicity = {
        name: "Simple In-Memory Store",
        satisfiesPriority: PARETO_PRIORITY_LEVELS.SIMPLICITY_AND_MAINTAINABILITY,
        cognitiveComplexityScore: 2,
      };
      const marginalPerf = {
        name: "Complex Multi-Tier Cache",
        satisfiesPriority: PARETO_PRIORITY_LEVELS.SCALABILITY_GEQ_15_PERCENT,
        perfGainPercent: 12, // < 15% threshold
        cognitiveComplexityScore: 8,
      };

      const result = engine.arbitratePareto(simplicity, marginalPerf);
      expect(result.winner).toBe("Simple In-Memory Store");
      expect(result.winningLevel).toBe(2);
      expect(result.loser).toBe("Complex Multi-Tier Cache");
      expect(result.rationale).toContain("below the 15% scalability threshold");
      expect(result.rationale).toContain("Marginal gains lose unconditionally to simplicity");
    });

    it("Priority 3 (Performance Scalability >= 15%) beats Priority 4 (Speculative Abstraction)", () => {
      const scalableApproach = {
        name: "Sharded Worker Pool",
        satisfiesPriority: PARETO_PRIORITY_LEVELS.SCALABILITY_GEQ_15_PERCENT,
        perfGainPercent: 35, // >= 15% threshold
        cognitiveComplexityScore: 5,
      };
      const speculativeApproach = {
        name: "Universal Extensible Plugin Meta-Framework",
        satisfiesPriority: PARETO_PRIORITY_LEVELS.SPECULATIVE_ABSTRACTION,
        cognitiveComplexityScore: 9,
      };

      const result = engine.arbitratePareto(scalableApproach, speculativeApproach);
      expect(result.winner).toBe("Sharded Worker Pool");
      expect(result.winningLevel).toBe(3);
      expect(result.loser).toBe("Universal Extensible Plugin Meta-Framework");
      expect(result.losingLevel).toBe(4);
    });

    it("Tie-breaking in Priority 2: lower cognitive complexity wins", () => {
      const approachA = {
        name: "Minimal 30-Line Resolver",
        satisfiesPriority: PARETO_PRIORITY_LEVELS.SIMPLICITY_AND_MAINTAINABILITY,
        cognitiveComplexityScore: 3,
        perfGainPercent: 5,
      };
      const approachB = {
        name: "Moderate 150-Line Resolver",
        satisfiesPriority: PARETO_PRIORITY_LEVELS.SIMPLICITY_AND_MAINTAINABILITY,
        cognitiveComplexityScore: 7,
        perfGainPercent: 5,
      };

      const result = engine.arbitratePareto(approachA, approachB);
      expect(result.winner).toBe("Minimal 30-Line Resolver");
      expect(result.loser).toBe("Moderate 150-Line Resolver");
      expect(result.rationale).toContain("lower cognitive complexity score (3 vs 7)");
    });

    it("Tie-breaking in Priority 3: higher performance gain wins", () => {
      const approachA = {
        name: "Lock-Free Ring Buffer",
        satisfiesPriority: PARETO_PRIORITY_LEVELS.SCALABILITY_GEQ_15_PERCENT,
        perfGainPercent: 40,
        cognitiveComplexityScore: 6,
      };
      const approachB = {
        name: "Batched Channel Buffer",
        satisfiesPriority: PARETO_PRIORITY_LEVELS.SCALABILITY_GEQ_15_PERCENT,
        perfGainPercent: 22,
        cognitiveComplexityScore: 6,
      };

      const result = engine.arbitratePareto(approachA, approachB);
      expect(result.winner).toBe("Lock-Free Ring Buffer");
      expect(result.loser).toBe("Batched Channel Buffer");
      expect(result.rationale).toContain("higher throughput gain (40% vs 22%)");
    });
  });
});
