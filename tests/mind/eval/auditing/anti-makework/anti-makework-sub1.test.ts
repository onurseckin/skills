import { describe, expect, it } from "bun:test";
import {
  GENUINE_VALUE_PILLARS,
  GENUINE_VALUE_PILLAR_DEFINITIONS,
  SYNTHETIC_CHURN_TYPES,
  SyntheticChurnDetector,
  detectCosmeticChurn,
  detectAbstractionBloat,
  detectSpeculativeRefactoring,
  analyzeTaskForChurn,
  GenuineValueEvaluator,
  evaluateTaskValue,
  buildRejectionNotice,
  type DiffAnalysisInput,
  type TaskEvaluationInput,
} from "../../../../../olt/scripts/src/mind/auditing/anti-makework/index.ts";

describe("Anti-Make-Work Safeguards & Synthetic Churn Detection", () => {


describe("Pillars & Definitions", () => {
    it("exports the Five Pillars of Genuine Value", () => {
      expect(GENUINE_VALUE_PILLARS.length).toBe(5);
      expect(GENUINE_VALUE_PILLARS).toContain("USER_FACING_DELIGHT_AND_POLISH");
      expect(GENUINE_VALUE_PILLARS).toContain("VERIFIED_DEFECT_ELIMINATION");
      expect(GENUINE_VALUE_PILLARS).toContain("MEASURABLE_PERFORMANCE_GAIN");
      expect(GENUINE_VALUE_PILLARS).toContain("ARCHITECTURAL_SIMPLIFICATION");
      expect(GENUINE_VALUE_PILLARS).toContain("FUNCTIONAL_EXPANSION");
    });

    it("provides complete definitions and empirical criteria for every pillar", () => {
      for (const pillar of GENUINE_VALUE_PILLARS) {
        const def = GENUINE_VALUE_PILLAR_DEFINITIONS[pillar];
        expect(def).toBeDefined();
        expect(def.title.length).toBeGreaterThan(0);
        expect(def.description.length).toBeGreaterThan(0);
        expect(def.empiricalCriterion.length).toBeGreaterThan(0);
      }
    });

    it("exports the three synthetic churn types", () => {
      expect(SYNTHETIC_CHURN_TYPES.length).toBe(3);
      expect(SYNTHETIC_CHURN_TYPES).toContain("COSMETIC_CHURN");
      expect(SYNTHETIC_CHURN_TYPES).toContain("ABSTRACTION_BLOAT");
      expect(SYNTHETIC_CHURN_TYPES).toContain("SPECULATIVE_REFACTORING");
    });
  });

describe("SyntheticChurnDetector", () => {
    describe("detectCosmeticChurn", () => {
      it("detects rename-only cosmetic changes", () => {
        const diff: DiffAnalysisInput = {
          filesChanged: 2,
          linesAdded: 15,
          linesRemoved: 15,
          isRenameOnly: true,
        };

        const violation = detectCosmeticChurn(diff);
        expect(violation).not.toBeNull();
        expect(violation?.type).toBe("COSMETIC_CHURN");
        expect(violation?.severity).toBe("MEDIUM");
        expect(violation?.description).toContain("symbol renames");
      });

      it("assigns HIGH severity to massive rename-only churn", () => {
        const diff: DiffAnalysisInput = {
          filesChanged: 8,
          linesAdded: 100,
          linesRemoved: 100,
          isRenameOnly: true,
        };

        const violation = detectCosmeticChurn(diff);
        expect(violation).not.toBeNull();
        expect(violation?.severity).toBe("HIGH");
      });

      it("detects comment-only cosmetic churn", () => {
        const diff: DiffAnalysisInput = {
          filesChanged: 1,
          linesAdded: 20,
          linesRemoved: 5,
          isCommentOnly: true,
        };

        const violation = detectCosmeticChurn(diff);
        expect(violation).not.toBeNull();
        expect(violation?.type).toBe("COSMETIC_CHURN");
        expect(violation?.description).toContain("comment");
      });

      it("returns null when changes are not cosmetic", () => {
        const diff: DiffAnalysisInput = {
          filesChanged: 2,
          linesAdded: 40,
          linesRemoved: 10,
          isRenameOnly: false,
          isCommentOnly: false,
          defectReportRef: "DEFECT-101",
        };

        const violation = detectCosmeticChurn(diff);
        expect(violation).toBeNull();
      });
    });

    describe("detectAbstractionBloat", () => {
      it("detects wrapper layer introduction and cognitive complexity increase", () => {
        const diff: DiffAnalysisInput = {
          filesChanged: 4,
          linesAdded: 120,
          linesRemoved: 10,
          introducesWrapperLayers: true,
          cognitiveComplexityDelta: 6,
        };

        const violation = detectAbstractionBloat(diff);
        expect(violation).not.toBeNull();
        expect(violation?.type).toBe("ABSTRACTION_BLOAT");
        expect(violation?.severity).toBe("CRITICAL");
        expect(violation?.description).toContain("wrapper layers");
      });

      it("detects substantial complexity increase without defect report or benchmark", () => {
        const diff: DiffAnalysisInput = {
          filesChanged: 3,
          linesAdded: 80,
          linesRemoved: 20,
          cognitiveComplexityDelta: 10,
          benchmarkDeltaPercent: 0,
        };

        const violation = detectAbstractionBloat(diff);
        expect(violation).not.toBeNull();
        expect(violation?.type).toBe("ABSTRACTION_BLOAT");
        expect(violation?.severity).toBe("HIGH");
      });

      it("allows complexity increase when backed by measurable benchmark gain", () => {
        const diff: DiffAnalysisInput = {
          filesChanged: 3,
          linesAdded: 80,
          linesRemoved: 20,
          cognitiveComplexityDelta: 4,
          benchmarkDeltaPercent: 25,
          introducesWrapperLayers: false,
        };

        const violation = detectAbstractionBloat(diff);
        expect(violation).toBeNull();
      });
    });

    describe("detectSpeculativeRefactoring", () => {
      it("flags rewriting stable code without defect report or benchmark justifications", () => {
        const diff: DiffAnalysisInput = {
          filesChanged: 5,
          linesAdded: 180,
          linesRemoved: 160,
          benchmarkDeltaPercent: 0,
          cognitiveComplexityDelta: 0,
        };

        const violation = detectSpeculativeRefactoring(diff);
        expect(violation).not.toBeNull();
        expect(violation?.type).toBe("SPECULATIVE_REFACTORING");
        expect(violation?.severity).toBe("CRITICAL");
        expect(violation?.description).toContain("rewriting stable code");
      });

      it("does not flag refactoring when backed by a verified defect report", () => {
        const diff: DiffAnalysisInput = {
          filesChanged: 4,
          linesAdded: 90,
          linesRemoved: 70,
          defectReportRef: "DEFECT-909-RACE-CONDITION",
        };

        const violation = detectSpeculativeRefactoring(diff);
        expect(violation).toBeNull();
      });

      it("does not flag refactoring that yields measurable benchmark gain", () => {
        const diff: DiffAnalysisInput = {
          filesChanged: 3,
          linesAdded: 60,
          linesRemoved: 50,
          benchmarkDeltaPercent: 30,
        };

        const violation = detectSpeculativeRefactoring(diff);
        expect(violation).toBeNull();
      });

      it("does not flag refactoring that simplifies cognitive complexity", () => {
        const diff: DiffAnalysisInput = {
          filesChanged: 4,
          linesAdded: 30,
          linesRemoved: 110,
          cognitiveComplexityDelta: -8,
        };

        const violation = detectSpeculativeRefactoring(diff);
        expect(violation).toBeNull();
      });
    });

    describe("analyzeTaskForChurn", () => {
      it("aggregates multiple violations simultaneously", () => {
        const diff: DiffAnalysisInput = {
          filesChanged: 6,
          linesAdded: 250,
          linesRemoved: 180,
          introducesWrapperLayers: true,
          cognitiveComplexityDelta: 9,
          benchmarkDeltaPercent: 0,
        };

        const violations = analyzeTaskForChurn(diff);
        expect(violations.length).toBe(2);
        const types = violations.map((v) => v.type);
        expect(types).toContain("ABSTRACTION_BLOAT");
        expect(types).toContain("SPECULATIVE_REFACTORING");
      });
    });
  });
});
