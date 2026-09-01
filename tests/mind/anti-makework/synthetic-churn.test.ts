import { describe, expect, it } from "bun:test";
import {
  GENUINE_VALUE_PILLARS,
  GENUINE_VALUE_PILLAR_DEFINITIONS,
  SYNTHETIC_CHURN_TYPES,
  SyntheticChurnDetector,
  GenuineValueEvaluator,
  type DiffAnalysisInput,
  type TaskEvaluationInput,
} from "../../../olt/scripts/src/mind/auditing/anti-makework/index.ts";

describe("Anti-Make-Work & Synthetic Churn Detection", () => {
  describe("Five Pillars of Genuine Value", () => {
    it("recognizes all five canonical pillars with empirical criteria", () => {
      expect(GENUINE_VALUE_PILLARS).toHaveLength(5);
      expect(GENUINE_VALUE_PILLARS).toContain("USER_FACING_DELIGHT_AND_POLISH");
      expect(GENUINE_VALUE_PILLARS).toContain("VERIFIED_DEFECT_ELIMINATION");
      expect(GENUINE_VALUE_PILLARS).toContain("MEASURABLE_PERFORMANCE_GAIN");
      expect(GENUINE_VALUE_PILLARS).toContain("ARCHITECTURAL_SIMPLIFICATION");
      expect(GENUINE_VALUE_PILLARS).toContain("FUNCTIONAL_EXPANSION");

      for (const pillar of GENUINE_VALUE_PILLARS) {
        const def = GENUINE_VALUE_PILLAR_DEFINITIONS[pillar];
        expect(def).toBeDefined();
        expect(def.title.length).toBeGreaterThan(0);
        expect(def.description.length).toBeGreaterThan(0);
        expect(def.empiricalCriterion.length).toBeGreaterThan(0);
      }
    });

    it("verifies SYNTHETIC_CHURN_TYPES constant", () => {
      expect(SYNTHETIC_CHURN_TYPES).toEqual([
        "COSMETIC_CHURN",
        "ABSTRACTION_BLOAT",
        "SPECULATIVE_REFACTORING",
      ]);
    });
  });

  describe("SyntheticChurnDetector", () => {
    describe("Cosmetic Churn Detection", () => {
      it("flags diffs with only symbol renames or file moves as COSMETIC_CHURN", () => {
        const renameDiff: DiffAnalysisInput = {
          filesChanged: 5,
          linesAdded: 60,
          linesRemoved: 60,
          isRenameOnly: true,
        };

        const violation = SyntheticChurnDetector.detectCosmeticChurn(renameDiff);
        expect(violation).not.toBeNull();
        expect(violation?.type).toBe("COSMETIC_CHURN");
        expect(violation?.severity).toBe("HIGH");
        expect(violation?.description).toContain("symbol renames");
      });

      it("flags diffs with only comment / formatting changes as COSMETIC_CHURN", () => {
        const commentDiff: DiffAnalysisInput = {
          filesChanged: 2,
          linesAdded: 120,
          linesRemoved: 10,
          isCommentOnly: true,
        };

        const violation = SyntheticChurnDetector.detectCosmeticChurn(commentDiff);
        expect(violation).not.toBeNull();
        expect(violation?.type).toBe("COSMETIC_CHURN");
        expect(violation?.description).toContain("comment, docstring, or whitespace");
      });

      it("returns null for functional / non-cosmetic diffs", () => {
        const functionalDiff: DiffAnalysisInput = {
          filesChanged: 2,
          linesAdded: 45,
          linesRemoved: 10,
          isRenameOnly: false,
          isCommentOnly: false,
        };

        expect(SyntheticChurnDetector.detectCosmeticChurn(functionalDiff)).toBeNull();
      });
    });

    describe("Abstraction Bloat Detection", () => {
      it("flags wrapper layers and unnecessary indirection as ABSTRACTION_BLOAT", () => {
        const wrapperDiff: DiffAnalysisInput = {
          filesChanged: 4,
          linesAdded: 150,
          linesRemoved: 20,
          introducesWrapperLayers: true,
          cognitiveComplexityDelta: 6,
        };

        const violation = SyntheticChurnDetector.detectAbstractionBloat(wrapperDiff);
        expect(violation).not.toBeNull();
        expect(violation?.type).toBe("ABSTRACTION_BLOAT");
        expect(violation?.severity).toBe("CRITICAL");
        expect(violation?.description).toContain("unnecessary wrapper layers");
      });

      it("flags large cognitive complexity increases without defect reports or benchmarks", () => {
        const bloatedDiff: DiffAnalysisInput = {
          filesChanged: 3,
          linesAdded: 200,
          linesRemoved: 40,
          cognitiveComplexityDelta: 12,
        };

        const violation = SyntheticChurnDetector.detectAbstractionBloat(bloatedDiff);
        expect(violation).not.toBeNull();
        expect(violation?.type).toBe("ABSTRACTION_BLOAT");
        expect(violation?.description).toContain("substantial cognitive complexity increase");
      });

      it("permits complexity increase when justified by measurable benchmark gains", () => {
        const justifiedDiff: DiffAnalysisInput = {
          filesChanged: 2,
          linesAdded: 80,
          linesRemoved: 30,
          cognitiveComplexityDelta: 4,
          benchmarkDeltaPercent: 25,
        };

        expect(SyntheticChurnDetector.detectAbstractionBloat(justifiedDiff)).toBeNull();
      });
    });

    describe("Speculative Refactoring Detection", () => {
      it("flags rewrites of stable code without defect reports or benchmark justifications", () => {
        const speculativeDiff: DiffAnalysisInput = {
          filesChanged: 4,
          linesAdded: 120,
          linesRemoved: 100,
          defectReportRef: null,
          benchmarkDeltaPercent: 0,
          cognitiveComplexityDelta: 0,
        };

        const violation = SyntheticChurnDetector.detectSpeculativeRefactoring(speculativeDiff);
        expect(violation).not.toBeNull();
        expect(violation?.type).toBe("SPECULATIVE_REFACTORING");
        expect(violation?.description).toContain("rewriting stable code");
      });

      it("permits refactoring when anchored to an empirical defect report", () => {
        const defectFixedDiff: DiffAnalysisInput = {
          filesChanged: 4,
          linesAdded: 80,
          linesRemoved: 60,
          defectReportRef: "DEFECT-AUTH-042",
        };

        expect(SyntheticChurnDetector.detectSpeculativeRefactoring(defectFixedDiff)).toBeNull();
      });

      it("permits refactoring when it achieves architectural simplification (complexity reduction)", () => {
        const simplifiedDiff: DiffAnalysisInput = {
          filesChanged: 5,
          linesAdded: 30,
          linesRemoved: 140,
          cognitiveComplexityDelta: -8,
        };

        expect(SyntheticChurnDetector.detectSpeculativeRefactoring(simplifiedDiff)).toBeNull();
      });
    });

    describe("analyzeTaskForChurn Aggregator", () => {
      it("aggregates multiple churn violations simultaneously", () => {
        const multiChurnDiff: DiffAnalysisInput = {
          filesChanged: 6,
          linesAdded: 250,
          linesRemoved: 180,
          introducesWrapperLayers: true,
          cognitiveComplexityDelta: 10,
        };

        const violations = SyntheticChurnDetector.analyzeTaskForChurn(multiChurnDiff);
        expect(violations.length).toBeGreaterThanOrEqual(2);
        const types = violations.map((v) => v.type);
        expect(types).toContain("ABSTRACTION_BLOAT");
        expect(types).toContain("SPECULATIVE_REFACTORING");
      });
    });
  });

  describe("GenuineValueEvaluator", () => {
    it("returns isGenuineValue: true and high score for legitimate value tasks", () => {
      const validTask: TaskEvaluationInput = {
        id: "task-val-1",
        title: "Eliminate race condition in session state and add tests",
        description: "Fix verified data race with mutex and unit tests",
        proposedPillars: ["VERIFIED_DEFECT_ELIMINATION", "MEASURABLE_PERFORMANCE_GAIN"],
        diff: {
          filesChanged: 2,
          linesAdded: 40,
          linesRemoved: 15,
          defectReportRef: "DEFECT-RACE-001",
          benchmarkDeltaPercent: 18,
          cognitiveComplexityDelta: -2,
        },
      };

      const result = GenuineValueEvaluator.evaluateTask(validTask);

      expect(result.isGenuineValue).toBe(true);
      expect(result.satisfiesPillars).toHaveLength(2);
      expect(result.churnViolations).toHaveLength(0);
      expect(result.rejectionNotice).toBeNull();
      expect(result.score).toBeGreaterThanOrEqual(80);
    });

    it("returns isGenuineValue: false and RejectionNotice when task lacks genuine pillars", () => {
      const noPillarsTask: TaskEvaluationInput = {
        id: "task-makework-1",
        title: "Random cosmetic shuffle",
        description: "Moving folders around without reason",
        proposedPillars: [],
      };

      const result = GenuineValueEvaluator.evaluateTask(noPillarsTask);

      expect(result.isGenuineValue).toBe(false);
      expect(result.satisfiesPillars).toHaveLength(0);
      expect(result.score).toBeLessThanOrEqual(40);
      expect(result.rejectionNotice).not.toBeNull();
      expect(result.rejectionNotice).toContain("ANTI-MAKE-WORK AUDIT: TASK INITIATIVE REJECTED");
      expect(result.rejectionNotice).toContain("ZERO GENUINE VALUE PILLARS SATISFIED");
      expect(result.rejectionNotice).toContain("MANDATED ACTION & REDIRECTION");
    });

    it("returns isGenuineValue: false and RejectionNotice when synthetic churn is detected", () => {
      const churnTask: TaskEvaluationInput = {
        id: "task-churn-1",
        title: "Rename all internal interfaces and add meta wrappers",
        description: "Cosmetic rename and wrapper addition",
        proposedPillars: ["ARCHITECTURAL_SIMPLIFICATION"],
        diff: {
          filesChanged: 8,
          linesAdded: 200,
          linesRemoved: 180,
          isRenameOnly: true,
          introducesWrapperLayers: true,
          cognitiveComplexityDelta: 10,
        },
      };

      const result = GenuineValueEvaluator.evaluateTask(churnTask);

      expect(result.isGenuineValue).toBe(false);
      expect(result.churnViolations.length).toBeGreaterThan(0);
      expect(result.score).toBeLessThanOrEqual(40);
      expect(result.rejectionNotice).not.toBeNull();
      expect(result.rejectionNotice).toContain("SYNTHETIC CHURN VIOLATIONS DETECTED");
      expect(result.rejectionNotice).toContain("COSMETIC_CHURN");
    });
  });
});
