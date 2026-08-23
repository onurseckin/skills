import { describe, expect, it } from "bun:test";
import { HarnessError } from "../../../orchestrating-long-tasks/scripts/src/errors/harness-error.ts";
import type { HarnessEvent } from "../../../orchestrating-long-tasks/scripts/src/contracts/capsule.ts";
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
} from "../../../orchestrating-long-tasks/scripts/src/mind/hyper-cognition.ts";

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
      expect(vector.typeSafetyScore).toBe(100);
      expect(vector.astPurityScore).toBe(100);
      expect(vector.dagConcurrencyScore).toBe(100);
      expect(vector.compositeScore).toBeLessThanOrEqual(100);
      expect(vector.compositeScore).toBeGreaterThanOrEqual(0);
    });

    it("clamps scores to MIN_COGNITIVE_SCORE on severe failure cascades", () => {
      const severeFindings: CognitiveAuditFinding[] = [
        ...Array.from({ length: 10 }, (_, i) => ({
          id: `F-SEVERE-TYPE-${i}`,
          dimension: "type_safety" as CognitiveAuditDimension,
          severity: "critical" as const,
          ruleId: "RULE-SEVERE-TYPE",
          description: "Catastrophic type breakdown",
          remediation: "Rewrite",
          scoreImpact: 20,
          timestamp: new Date().toISOString(),
        })),
        ...Array.from({ length: 10 }, (_, i) => ({
          id: `F-SEVERE-DAG-${i}`,
          dimension: "dag_concurrency" as CognitiveAuditDimension,
          severity: "critical" as const,
          ruleId: "RULE-SEVERE-DAG",
          description: "Catastrophic DAG blockage",
          remediation: "Rebuild",
          scoreImpact: 20,
          timestamp: new Date().toISOString(),
        })),
      ];

      const metrics: SystemStateMetrics = {
        totalTasks: 10,
        completedTasks: 0,
        readyTasks: 0,
        pendingTasks: 0,
        failedTasks: 10,
        totalFiles: 20,
        hasCycles: true,
        falseBarrierCount: 5,
        astViolationCount: 10,
        untypedFieldCount: 10,
      };

      const vector = computeCognitiveScoreVector(severeFindings, metrics);
      expect(vector.typeSafetyScore).toBe(MIN_COGNITIVE_SCORE);
      expect(vector.dagConcurrencyScore).toBe(MIN_COGNITIVE_SCORE);
      expect(vector.compositeScore).toBeLessThan(30);
    });
  });

  describe("executeProactiveSelfQuestioningCycle", () => {
    it("executes a cycle for a specific question ID", () => {
      const state = {
        tasks: {
          "task-1": { id: "task-1", status: "ready", dependencies: [], write_scope: ["a.ts"] },
          "task-2": { id: "task-2", status: "ready", dependencies: [], write_scope: ["b.ts"] },
        },
      };

      const cycle = executeProactiveSelfQuestioningCycle({
        cycleId: "CYC-001",
        questionId: "PQ-DAG_CONCURRENCY-1",
        state,
        overrideHypothesis: "Hypothesis: concurrency can be doubled",
      });

      expect(cycle.cycleId).toBe("CYC-001");
      expect(cycle.questionId).toBe("PQ-DAG_CONCURRENCY-1");
      expect(cycle.dimension).toBe("dag_concurrency");
      expect(cycle.flavorDimension).toBe("better");
      expect(cycle.hypothesis).toBe("Hypothesis: concurrency can be doubled");
      expect(cycle.investigationFindings.length).toBeGreaterThan(0);
      expect(cycle.synthesizedProposals.length).toBeGreaterThan(0);
      expect(cycle.synthesizedProposals[0]?.dimension).toBe("dag_concurrency");
    });

    it("falls back gracefully when selecting questions by hash", () => {
      const state = { tasks: {} };
      const cycle = executeProactiveSelfQuestioningCycle({
        cycleId: "ANY-UNIQUE-CYCLE-KEY",
        state,
      });

      expect(cycle.questionId).toBeDefined();
      expect(cycle.questionText.length).toBeGreaterThan(10);
      expect(cycle.synthesizedProposals.length).toBeGreaterThan(0);
    });
  });

  describe("harvestPlanEnhancementsDuringPulse", () => {
    it("harvests subtasks when wide write scopes are encountered", () => {
      const state = {
        tasks: {
          "task-wide": {
            id: "task-wide",
            status: "ready",
            dependencies: [],
            write_scope: ["file1.ts", "file2.ts", "file3.ts"],
            gate_command: "bun test tests/wide.test.ts",
          },
        },
      };

      const harvest = harvestPlanEnhancementsDuringPulse({
        pulseId: "PULSE-42",
        state,
      });

      expect(harvest.harvestId).toBe("HARVEST-PULSE-42");
      expect(harvest.pulseId).toBe("PULSE-42");
      expect(harvest.suggestedSubtasks).toHaveLength(3);
      expect(harvest.suggestedSubtasks[0]?.taskId).toBe("task-wide-sub-1");
      expect(harvest.suggestedSubtasks[0]?.writeScope).toEqual(["file1.ts"]);
      expect(harvest.suggestedSubtasks[0]?.gateCommand).toBe("bun test tests/wide.test.ts");
      expect(harvest.identifiedBottlenecks.length).toBe(1);
      expect(harvest.parallelizableLanes).toContain("Lane-task-wide");
    });

    it("preserves applied status default as false", () => {
      const harvest = harvestPlanEnhancementsDuringPulse({
        pulseId: "PULSE-100",
        state: { tasks: {} },
      });
      expect(harvest.applied).toBeFalse();
      expect(harvest.suggestedSubtasks).toHaveLength(0);
    });
  });

  describe("generateOptimizationProposals", () => {
    it("generates targeted proposals for low score vectors and audit findings", () => {
      const findings: CognitiveAuditFinding[] = [
        {
          id: "F-CRIT-1",
          dimension: "performance",
          severity: "critical",
          ruleId: "RULE-PERF-CHOKE",
          targetPath: "src/engine.ts",
          description: "Execution bottleneck in engine loop",
          remediation: "Optimize dispatch algorithm",
          scoreImpact: 25,
          timestamp: new Date().toISOString(),
        },
      ];

      const scoreVector = {
        simplicityScore: 90,
        performanceScore: 60,
        observabilityScore: 90,
        typeSafetyScore: 70, // low
        astPurityScore: 65, // low
        dagConcurrencyScore: 55, // low
        compositeScore: 71,
        evaluatedAt: new Date().toISOString(),
      };

      const proposals = generateOptimizationProposals(findings, scoreVector);
      expect(proposals.length).toBeGreaterThanOrEqual(4);

      const concurrencyProp = proposals.find((p) => p.dimension === "dag_concurrency");
      expect(concurrencyProp).toBeDefined();

      const astProp = proposals.find((p) => p.dimension === "ast_purity");
      expect(astProp).toBeDefined();

      const findingProp = proposals.find((p) => p.id === "PROP-FINDING-F-CRIT-1");
      expect(findingProp).toBeDefined();
      expect(findingProp?.targetFiles).toEqual(["src/engine.ts"]);
      expect(findingProp?.scoreBoost).toBe(25);
    });
  });

  describe("evaluateCadenceHyperPulse & integratePulseCadence", () => {
    it("returns IMMEDIATE_ROLLOVER when active ready tasks are waiting", () => {
      const state = {
        tasks: {
          "task-ready-1": {
            id: "task-ready-1",
            status: "ready",
            dependencies: [],
            write_scope: ["src/active.ts"],
            gate_command: "bun test",
          },
        },
      };

      const input: HyperPulseInput = {
        pulseId: "PULSE-ROLLOVER-TEST",
        state,
      };

      const report = evaluateCadenceHyperPulse(input);
      expect(report.cadenceAction).toBe("IMMEDIATE_ROLLOVER");
      expect(report.rationale).toContain("Active ready tasks (1) present");
    });

    it("returns PROACTIVE_REPLAN when critical audit issues are found", () => {
      const state = {
        tasks: {
          "task-broken": {
            id: "task-broken",
            status: "ready",
            dependencies: [],
            write_scope: ["src/broken.ts"],
            gate_command: "", // missing gate command triggers critical
          },
        },
      };

      const input: HyperPulseInput = {
        pulseId: "PULSE-CRIT-TEST",
        state,
      };

      const report = evaluateCadenceHyperPulse(input);
      expect(report.cadenceAction).toBe("PROACTIVE_REPLAN");
      expect(report.auditResult.criticalCount).toBeGreaterThanOrEqual(1);
    });

    it("integrates pulse cadence events through engine and tracks historical trend", () => {
      const engine = createHyperCognitionEngine({ repoRoot: "/workspace" });

      const state = {
        tasks: {
          "t-1": {
            id: "t-1",
            status: "done",
            dependencies: [],
            write_scope: ["src/done.ts"],
            gate_command: "bun test",
          },
        },
      };

      const mockEvent: HarnessEvent = {
        schema: "harness.event",
        version: 1,
        run_id: "run-gen3",
        capsule_id: "cap-1",
        sequence: 10,
        timestamp: new Date().toISOString(),
        actor: "mind",
        kind: "mind-pulse-completed",
        payload: {},
        previous_hash: null,
        hash: "hash-123",
        projection: null,
        projection_patch: [],
        revision: 1,
      };

      const report = engine.integratePulseCadence(mockEvent, state);
      expect(report.pulseId).toBe("mind-pulse-completed-10");
      expect(report.scoreVector.compositeScore).toBeGreaterThanOrEqual(80);

      const trend = engine.getHistoricalScoreTrend();
      expect(trend).toHaveLength(1);
      expect(trend[0]?.compositeScore).toBe(report.scoreVector.compositeScore);
    });
  });

  describe("formatHyperCognitionBrief", () => {
    it("renders formatted markdown brief with all required sections", () => {
      const state = {
        tasks: {
          "task-a": {
            id: "task-a",
            status: "ready",
            dependencies: [],
            write_scope: ["src/a.ts"],
            gate_command: "bun test",
          },
        },
      };

      const report = evaluateCadenceHyperPulse({
        pulseId: "PULSE-BRIEF-TEST",
        state,
      });

      const brief = formatHyperCognitionBrief(report);
      expect(brief).toContain("### Hyper-Active Mind Cognition Pulse Report: `PULSE-BRIEF-TEST`");
      expect(brief).toContain("#### Multidimensional Cognitive Scores");
      expect(brief).toContain("#### Proactive Self-Questioning");
      expect(brief).toContain("#### Autonomous Audit Findings");
      expect(brief).toContain("#### Harvested Plan Enhancements");
      expect(brief).toContain("#### Optimization Proposals");
    });
  });

  describe("validateHyperCognitiveReport", () => {
    it("validates compliant reports without error", () => {
      const state = { tasks: {} };
      const report = evaluateCadenceHyperPulse({ pulseId: "P-VAL-1", state });
      const validated = validateHyperCognitiveReport(report);
      expect(validated.pulseId).toBe("P-VAL-1");
    });

    it("throws INTEGRITY error on null, non-record, or missing critical fields", () => {
      expect(() => validateHyperCognitiveReport(null)).toThrow(HarnessError);
      expect(() => validateHyperCognitiveReport("string")).toThrow(HarnessError);
      expect(() =>
        validateHyperCognitiveReport({
          pulseId: "", // empty
          pulseTimestamp: "2026-08-23T00:00:00Z",
        }),
      ).toThrow(HarnessError);

      try {
        validateHyperCognitiveReport({
          pulseId: "P-INVALID",
          pulseTimestamp: "2026-08-23T00:00:00Z",
          activeQuestions: "not-an-array",
        });
        expect(true).toBeFalse();
      } catch (err: unknown) {
        expect(err).toBeInstanceOf(HarnessError);
        expect((err as HarnessError).code).toBe("INTEGRITY");
      }
    });
  });
});
