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
describe("GenuineValueEvaluator", () => {
    it("approves genuine value tasks matching valid pillars and free of churn", () => {
      const task: TaskEvaluationInput = {
        id: "TASK-101",
        title: "Fix state synchronization race condition",
        description: "Eliminate intermittent deadlock between watchdog and scheduler",
        proposedPillars: ["VERIFIED_DEFECT_ELIMINATION", "ARCHITECTURAL_SIMPLIFICATION"],
        diff: {
          filesChanged: 2,
          linesAdded: 45,
          linesRemoved: 60,
          defectReportRef: "DEFECT-SYNC-01",
          cognitiveComplexityDelta: -3,
        },
      };

      const result = evaluateTaskValue(task);

      expect(result.isGenuineValue).toBe(true);
      expect(result.satisfiesPillars.length).toBe(2);
      expect(result.churnViolations.length).toBe(0);
      expect(result.rejectionNotice).toBeNull();
      expect(result.score).toBeGreaterThanOrEqual(75);
    });

    it("rejects tasks proposing zero genuine value pillars", () => {
      const task: TaskEvaluationInput = {
        id: "TASK-102",
        title: "Random cosmetic overhaul",
        description: "Reformatting internal function signatures",
        proposedPillars: [],
      };

      const result = evaluateTaskValue(task);

      expect(result.isGenuineValue).toBe(false);
      expect(result.satisfiesPillars.length).toBe(0);
      expect(result.rejectionNotice).not.toBeNull();
      expect(result.rejectionNotice).toContain("ZERO GENUINE VALUE PILLARS SATISFIED");
      expect(result.rejectionNotice).toContain("MANDATED ACTION & REDIRECTION");
      expect(result.score).toBeLessThanOrEqual(40);
    });

    it("rejects tasks contaminated with synthetic churn even if pillars were proposed", () => {
      const task: TaskEvaluationInput = {
        id: "TASK-103",
        title: "Introduce universal wrapper interface",
        description: "Wrap existing clients in speculative multi-tier abstractions",
        proposedPillars: ["FUNCTIONAL_EXPANSION"],
        diff: {
          filesChanged: 5,
          linesAdded: 150,
          linesRemoved: 10,
          introducesWrapperLayers: true,
          cognitiveComplexityDelta: 8,
        },
      };

      const result = evaluateTaskValue(task);

      expect(result.isGenuineValue).toBe(false);
      expect(result.churnViolations.length).toBeGreaterThan(0);
      expect(result.churnViolations[0]?.type).toBe("ABSTRACTION_BLOAT");
      expect(result.rejectionNotice).not.toBeNull();
      expect(result.rejectionNotice).toContain("SYNTHETIC CHURN VIOLATIONS DETECTED");
      expect(result.rejectionNotice).toContain("ABSTRACTION_BLOAT");
      expect(result.rejectionNotice).toContain("MANDATED ACTION & REDIRECTION");
      expect(result.score).toBeLessThanOrEqual(40);
    });

    it("formats a complete, structured rejection notice citing the Master Blueprint", () => {
      const task: TaskEvaluationInput = {
        id: "TASK-104",
        title: "Cosmetic variable renames across 10 files",
        description: "Renaming variables for subjective aesthetics",
        proposedPillars: [],
        diff: {
          filesChanged: 10,
          linesAdded: 80,
          linesRemoved: 80,
          isRenameOnly: true,
        },
      };

      const notice = buildRejectionNotice(
        task,
        [],
        [
          {
            type: "COSMETIC_CHURN",
            description: "Variable renames without functional delta",
            evidence: "isRenameOnly=true, filesChanged=10",
            severity: "HIGH",
          },
        ],
      );

      expect(notice).toContain("ANTI-MAKE-WORK AUDIT: TASK INITIATIVE REJECTED");
      expect(notice).toContain("TASK-104");
      expect(notice).toContain("ZERO GENUINE VALUE PILLARS SATISFIED");
      expect(notice).toContain("COSMETIC_CHURN");
      expect(notice).toContain("Master Strategic Blueprint Section 11");
    });
  });
});
