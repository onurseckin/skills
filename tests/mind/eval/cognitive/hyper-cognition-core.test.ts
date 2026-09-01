import { describe, expect, it } from "bun:test";
import { HarnessError } from "../../../../olt/scripts/src/core/errors/index.ts";
import type { HarnessEvent } from "../../../../olt/scripts/src/core/contracts/index.ts";
import {
  COGNITIVE_AUDIT_DIMENSIONS,
  DEFAULT_DIMENSIONAL_WEIGHTS,
  DEFAULT_HYPER_AUDIT_INTERVAL_MS,
  HYPER_COGNITION_VERSION,
  MAX_COGNITIVE_SCORE,
  MIN_COGNITIVE_SCORE,
  MIND_NEVER_IDLE_MANTRA,
  PROACTIVE_QUESTION_CATALOG,
  computeCognitiveScoreVector,
  createHyperCognitionEngine,
  evaluateCadenceHyperPulse,
  executeProactiveSelfQuestioningCycle,
  formatHyperCognitionBrief,
  generateOptimizationProposals,
  harvestPlanEnhancementsDuringPulse,
  runAutonomousAuditLoop,
  validateHyperCognitiveReport,
  type CognitiveAuditDimension,
  type CognitiveAuditFinding,
  type HyperCognitionEngine,
  type HyperPulseInput,
  type SystemStateMetrics,
} from "../../../../olt/scripts/src/mind/lifecycle/cognition/index.ts";

describe("Hyper-Active Mind Cognition Engine", () => {
  describe("Constants, Matrix & Taxonomy", () => {
    it("defines canonical version and perpetual non-idle mantra", () => {
      expect(HYPER_COGNITION_VERSION).toBe("gen3_hyper_active_v1");
      expect(MIND_NEVER_IDLE_MANTRA).toContain("Mind must never idle");
      expect(MIN_COGNITIVE_SCORE).toBe(0);
      expect(MAX_COGNITIVE_SCORE).toBe(100);
      expect(DEFAULT_HYPER_AUDIT_INTERVAL_MS).toBe(300_000);
    });

    it("defines exactly 6 cognitive audit dimensions", () => {
      expect(COGNITIVE_AUDIT_DIMENSIONS).toHaveLength(6);
      expect(COGNITIVE_AUDIT_DIMENSIONS).toContain("simplicity");
      expect(COGNITIVE_AUDIT_DIMENSIONS).toContain("performance");
      expect(COGNITIVE_AUDIT_DIMENSIONS).toContain("observability");
      expect(COGNITIVE_AUDIT_DIMENSIONS).toContain("type_safety");
      expect(COGNITIVE_AUDIT_DIMENSIONS).toContain("ast_purity");
      expect(COGNITIVE_AUDIT_DIMENSIONS).toContain("dag_concurrency");
    });

    it("has balanced dimensional weights summing to 1.0", () => {
      const sum =
        DEFAULT_DIMENSIONAL_WEIGHTS.simplicity +
        DEFAULT_DIMENSIONAL_WEIGHTS.performance +
        DEFAULT_DIMENSIONAL_WEIGHTS.observability +
        DEFAULT_DIMENSIONAL_WEIGHTS.type_safety +
        DEFAULT_DIMENSIONAL_WEIGHTS.ast_purity +
        DEFAULT_DIMENSIONAL_WEIGHTS.dag_concurrency;

      expect(Math.abs(sum - 1.0)).toBeLessThan(0.0001);
    });

    it("defines a comprehensive catalog of proactive questions across all dimensions", () => {
      expect(PROACTIVE_QUESTION_CATALOG.length).toBeGreaterThanOrEqual(6);
      for (const dim of COGNITIVE_AUDIT_DIMENSIONS) {
        const matching = PROACTIVE_QUESTION_CATALOG.filter((q) => q.dimension === dim);
        expect(matching.length).toBeGreaterThanOrEqual(1);
        for (const spec of matching) {
          expect(spec.id.length).toBeGreaterThan(0);
          expect(spec.question.length).toBeGreaterThan(15);
          expect(spec.probeTarget.length).toBeGreaterThan(0);
          expect(spec.defaultHypothesis.length).toBeGreaterThan(10);
        }
      }
    });
  });

  describe("createHyperCognitionEngine", () => {
    it("instantiates an engine with valid options", () => {
      const engine = createHyperCognitionEngine({
        repoRoot: "/repos/skills",
        capsuleRoot: "/repos/skills/.capsules/run-1",
        strictPurity: true,
      });

      expect(engine).toBeDefined();
      expect(engine.options.repoRoot).toBe("/repos/skills");
      expect(engine.getHistoricalScoreTrend()).toEqual([]);
    });

    it("throws INVALID_ARGUMENT when repoRoot is blank", () => {
      try {
        createHyperCognitionEngine({ repoRoot: "   " });
        expect(true).toBeFalse();
      } catch (err: unknown) {
        expect(err).toBeInstanceOf(HarnessError);
        const harnessErr = err as HarnessError;
        expect(harnessErr.code).toBe("INVALID_ARGUMENT");
        expect(harnessErr.message).toContain("repoRoot must be a non-blank string");
      }
    });
  });

  describe("runAutonomousAuditLoop", () => {
    it("passes with high score for a pristine task state", () => {
      const state = {
        tasks: {
          "task-1": {
            id: "task-1",
            status: "ready",
            dependencies: [],
            write_scope: ["src/a.ts", "tests/a.test.ts"],
            gate_command: "bun test tests/a.test.ts",
          },
          "task-2": {
            id: "task-2",
            status: "pending",
            dependencies: ["task-1"],
            write_scope: ["src/a.ts", "src/b.ts"],
            gate_command: "bun test tests/b.test.ts",
          },
        },
      };

      const result = runAutonomousAuditLoop(state, ["src/a.ts", "src/b.ts", "tests/a.test.ts"]);
      expect(result.passed).toBeTrue();
      expect(result.score).toBeGreaterThanOrEqual(90);
      expect(result.criticalCount).toBe(0);
      expect(result.auditedTasksCount).toBe(2);
      expect(result.auditedFilesCount).toBe(3);
    });

    it("detects empty write scopes as warnings", () => {
      const state = {
        tasks: {
          "task-empty": {
            id: "task-empty",
            status: "ready",
            dependencies: [],
            write_scope: [],
            gate_command: "bun test",
          },
        },
      };

      const result = runAutonomousAuditLoop(state);
      expect(result.warningCount).toBe(1);
      const finding = result.findings.find((f) => f.ruleId === "RULE-EMPTY-WRITE-SCOPE");
      expect(finding).toBeDefined();
      expect(finding?.dimension).toBe("simplicity");
      expect(finding?.severity).toBe("warning");
    });

    it("detects missing gate commands as critical failures", () => {
      const state = {
        tasks: {
          "task-no-gate": {
            id: "task-no-gate",
            status: "ready",
            dependencies: [],
            write_scope: ["src/code.ts"],
            gate_command: "",
          },
        },
      };

      const result = runAutonomousAuditLoop(state);
      expect(result.passed).toBeFalse();
      expect(result.criticalCount).toBe(1);
      const finding = result.findings.find((f) => f.ruleId === "RULE-MANDATORY-TASK-GATE");
      expect(finding).toBeDefined();
      expect(finding?.dimension).toBe("type_safety");
      expect(finding?.scoreImpact).toBe(20);
    });

    it("detects dangling dependencies on missing tasks", () => {
      const state = {
        tasks: {
          "task-with-broken-dep": {
            id: "task-with-broken-dep",
            status: "ready",
            dependencies: ["non-existent-task-999"],
            write_scope: ["src/mod.ts"],
            gate_command: "bun test",
          },
        },
      };

      const result = runAutonomousAuditLoop(state);
      expect(result.passed).toBeFalse();
      expect(result.criticalCount).toBe(1);
      const finding = result.findings.find((f) => f.ruleId === "RULE-DANGLING-DEPENDENCY");
      expect(finding).toBeDefined();
      expect(finding?.description).toContain("non-existent-task-999");
    });

    it("detects false barrier serializations between disjoint write scopes", () => {
      const state = {
        tasks: {
          "task-a": {
            id: "task-a",
            status: "done",
            dependencies: [],
            write_scope: ["src/alpha.ts"],
            gate_command: "bun test test/alpha.test.ts",
          },
          "task-b": {
            id: "task-b",
            status: "ready",
            dependencies: ["task-a"],
            write_scope: ["src/beta.ts"], // completely disjoint from alpha.ts
            gate_command: "bun test test/beta.test.ts",
          },
        },
      };

      const result = runAutonomousAuditLoop(state);
      const falseBarrier = result.findings.find((f) => f.ruleId === "RULE-FALSE-BARRIER");
      expect(falseBarrier).toBeDefined();
      expect(falseBarrier?.dimension).toBe("dag_concurrency");
      expect(falseBarrier?.severity).toBe("warning");
    });

    it("detects scratch/tmp files in inventory as opportunities", () => {
      const state = { tasks: {} };
      const files = ["src/main.ts", "src/scratch-calc.ts", "tmp-patch.js"];

      const result = runAutonomousAuditLoop(state, files);
      expect(result.opportunityCount).toBe(2);
      const scratchFinding = result.findings.find((f) => f.ruleId === "RULE-SCRATCH-RESIDUE");
      expect(scratchFinding).toBeDefined();
      expect(scratchFinding?.dimension).toBe("ast_purity");
    });
  });

  describe("computeCognitiveScoreVector", () => {
    it("computes accurate composite and dimensional scores with bounded clamping", () => {
      const findings: CognitiveAuditFinding[] = [
        {
          id: "F-1",
          dimension: "simplicity",
          severity: "warning",
          ruleId: "RULE-TEST",
          description: "Test simplicity",
          remediation: "Fix",
          scoreImpact: 10,
          timestamp: new Date().toISOString(),
        },
        {
          id: "F-2",
          dimension: "performance",
          severity: "warning",
          ruleId: "RULE-TEST-2",
          description: "Test perf",
          remediation: "Fix",
          scoreImpact: 15,
          timestamp: new Date().toISOString(),
        },
      ];

      const metrics: SystemStateMetrics = {
        totalTasks: 5,
        completedTasks: 2,
        readyTasks: 2,
        pendingTasks: 1,
        failedTasks: 0,
        totalFiles: 10,
        hasCycles: false,
        falseBarrierCount: 0,
        astViolationCount: 0,
        untypedFieldCount: 0,
      };

      const vector = computeCognitiveScoreVector(findings, metrics);
      expect(vector.simplicityScore).toBe(90);
      expect(vector.performanceScore).toBe(85);
      expect(vector.observabilityScore).toBe(100);
    });
  });
});
