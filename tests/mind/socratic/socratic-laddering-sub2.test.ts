import { describe, expect, it } from "bun:test";
import {
  DIALECTICAL_LEVELS,
  HistoricalDebateMemory,
  IMPASSE_CRUCIBLE_THRESHOLD,
  PARETO_PRIORITY_LEVELS,
  SCALABILITY_THRESHOLD_PERCENT,
  SocraticLadderingEngine,
  type ParetoApproachInput,
  type StrategicCommitment,
} from "../../../olt/scripts/src/mind/auditing/socratic/index.ts";

describe("SocraticLadderingEngine", () => {


describe("Pre-Declared Pareto Arbitration", () => {
    const engine = new SocraticLadderingEngine();

    it("Priority 1 (UX Delight & Correctness) always beats lower priorities", () => {
      const p1: ParetoApproachInput = {
        name: "Delightful Zero-Error Experience",
        satisfiesPriority: PARETO_PRIORITY_LEVELS.UX_DELIGHT_AND_CORRECTNESS,
        cognitiveComplexityScore: 3,
      };
      const p2: ParetoApproachInput = {
        name: "Minimalist Script",
        satisfiesPriority: PARETO_PRIORITY_LEVELS.SIMPLICITY_AND_MAINTAINABILITY,
        cognitiveComplexityScore: 1,
      };

      const result = engine.arbitratePareto(p1, p2);
      expect(result.winner).toBe("Delightful Zero-Error Experience");
      expect(result.winningLevel).toBe(PARETO_PRIORITY_LEVELS.UX_DELIGHT_AND_CORRECTNESS);
      expect(result.loser).toBe("Minimalist Script");
      expect(result.losingLevel).toBe(PARETO_PRIORITY_LEVELS.SIMPLICITY_AND_MAINTAINABILITY);
    });

    it("Solutions with runtime errors forfeit unconditionally to error-free solutions", () => {
      const buggyP1: ParetoApproachInput = {
        name: "Crashing Polished UI",
        satisfiesPriority: PARETO_PRIORITY_LEVELS.UX_DELIGHT_AND_CORRECTNESS,
        hasErrors: true,
      };
      const cleanP2: ParetoApproachInput = {
        name: "Rock-Solid Baseline Flow",
        satisfiesPriority: PARETO_PRIORITY_LEVELS.SIMPLICITY_AND_MAINTAINABILITY,
        hasErrors: false,
      };

      const result = engine.arbitratePareto(buggyP1, cleanP2);
      expect(result.winner).toBe("Rock-Solid Baseline Flow");
      expect(result.loser).toBe("Crashing Polished UI");
      expect(result.rationale).toContain("contains runtime or structural errors");
    });

    it("Priority 2 (Simplicity & Maintainability) unconditionally beats marginal gains (< 15%)", () => {
      const simplicity: ParetoApproachInput = {
        name: "Clean In-Memory Map",
        satisfiesPriority: PARETO_PRIORITY_LEVELS.SIMPLICITY_AND_MAINTAINABILITY,
        cognitiveComplexityScore: 2,
      };
      const marginalPerf: ParetoApproachInput = {
        name: "Complex Multi-Tier Sharded Hash Ring",
        satisfiesPriority: PARETO_PRIORITY_LEVELS.SCALABILITY_GEQ_15_PERCENT,
        perfGainPercent: 11, // Less than 15% threshold
        cognitiveComplexityScore: 9,
      };

      const result = engine.arbitratePareto(simplicity, marginalPerf);
      expect(result.winner).toBe("Clean In-Memory Map");
      expect(result.winningLevel).toBe(PARETO_PRIORITY_LEVELS.SIMPLICITY_AND_MAINTAINABILITY);
      expect(result.loser).toBe("Complex Multi-Tier Sharded Hash Ring");
      expect(result.rationale).toContain(
        `below the ${SCALABILITY_THRESHOLD_PERCENT}% scalability threshold`,
      );
      expect(result.rationale).toContain("Marginal gains lose unconditionally to simplicity");
    });

    it("Priority 3 (Scalability >= 15%) beats Priority 4 (Speculative Abstraction)", () => {
      const scalable: ParetoApproachInput = {
        name: "Parallel Worker Pool",
        satisfiesPriority: PARETO_PRIORITY_LEVELS.SCALABILITY_GEQ_15_PERCENT,
        perfGainPercent: 28, // >= 15%
        cognitiveComplexityScore: 4,
      };
      const speculative: ParetoApproachInput = {
        name: "Universal Meta-Factory Framework",
        satisfiesPriority: PARETO_PRIORITY_LEVELS.SPECULATIVE_ABSTRACTION,
        cognitiveComplexityScore: 8,
      };

      const result = engine.arbitratePareto(scalable, speculative);
      expect(result.winner).toBe("Parallel Worker Pool");
      expect(result.winningLevel).toBe(PARETO_PRIORITY_LEVELS.SCALABILITY_GEQ_15_PERCENT);
      expect(result.loser).toBe("Universal Meta-Factory Framework");
      expect(result.losingLevel).toBe(PARETO_PRIORITY_LEVELS.SPECULATIVE_ABSTRACTION);
    });

    it("Tie-breaking: selects lower cognitive complexity when priorities are equal", () => {
      const simpleA: ParetoApproachInput = {
        name: "Compact Handler (40 LOC)",
        satisfiesPriority: PARETO_PRIORITY_LEVELS.SIMPLICITY_AND_MAINTAINABILITY,
        cognitiveComplexityScore: 2,
      };
      const complexB: ParetoApproachInput = {
        name: "Verbose Handler (200 LOC)",
        satisfiesPriority: PARETO_PRIORITY_LEVELS.SIMPLICITY_AND_MAINTAINABILITY,
        cognitiveComplexityScore: 7,
      };

      const result = engine.arbitratePareto(simpleA, complexB);
      expect(result.winner).toBe("Compact Handler (40 LOC)");
      expect(result.loser).toBe("Verbose Handler (200 LOC)");
      expect(result.rationale).toContain("lower cognitive complexity score (2 vs 7)");
    });
  });
});
