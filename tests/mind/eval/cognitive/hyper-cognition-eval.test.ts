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

describe("Hyper-Active Mind Cognition Engine (Evaluation & Pulse)", () => {
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
          pulseId: "",
          pulseTimestamp: "2026-08-23T00:00:00Z",
        }),
      ).toThrow(HarnessError);
    });
  });
});
