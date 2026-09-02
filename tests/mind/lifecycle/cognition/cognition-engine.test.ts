import { describe, expect, it } from "bun:test";
import type { HarnessEvent } from "../../../../olt/scripts/src/core/contracts/index.ts";
import { HarnessError } from "../../../../olt/scripts/src/core/errors/index.ts";
import { createHyperCognitionEngine } from "../../../../olt/scripts/src/mind/lifecycle/cognition/engine.ts";
import type {
  CognitiveAuditFinding,
  HyperPulseInput,
  MindPulseContext,
  QuestionCycleInput,
  SystemStateMetrics,
} from "../../../../olt/scripts/src/mind/lifecycle/cognition/state.ts";

describe("Cognition Engine Coverage Suite", () => {
  describe("createHyperCognitionEngine validation", () => {
    it("instantiates engine with complete configuration options", () => {
      const engine = createHyperCognitionEngine({
        repoRoot: "/repos/skills",
        capsuleRoot: "/repos/skills/.capsules/run-42",
        auditIntervalMs: 60_000,
        strictPurity: true,
        minScoreThreshold: 80,
      });

      expect(engine.options.repoRoot).toBe("/repos/skills");
      expect(engine.options.capsuleRoot).toBe("/repos/skills/.capsules/run-42");
      expect(engine.options.auditIntervalMs).toBe(60_000);
      expect(engine.options.strictPurity).toBe(true);
      expect(engine.options.minScoreThreshold).toBe(80);
      expect(engine.getHistoricalScoreTrend()).toEqual([]);
    });

    it("throws HarnessError INVALID_ARGUMENT when repoRoot is empty string", () => {
      expect(() => createHyperCognitionEngine({ repoRoot: "" })).toThrow(HarnessError);
      try {
        createHyperCognitionEngine({ repoRoot: "" });
      } catch (err: unknown) {
        expect(err).toBeInstanceOf(HarnessError);
        const harnessErr = err as HarnessError;
        expect(harnessErr.code).toBe("INVALID_ARGUMENT");
        expect(harnessErr.message).toBe("repoRoot must be a non-blank string");
      }
    });

    it("throws HarnessError INVALID_ARGUMENT when repoRoot is whitespace", () => {
      expect(() => createHyperCognitionEngine({ repoRoot: "   \t\n  " })).toThrow(HarnessError);
    });

    it("throws HarnessError INVALID_ARGUMENT when repoRoot is non-string", () => {
      const invalid = { repoRoot: 12345 } as unknown as { repoRoot: string };
      expect(() => createHyperCognitionEngine(invalid)).toThrow(HarnessError);
    });
  });

  describe("Cognition engine delegation operations", () => {
    const engine = createHyperCognitionEngine({ repoRoot: "/repos/skills" });

    it("delegates runAutonomousAuditLoop accurately", () => {
      const state = {
        tasks: {
          t1: {
            id: "t1",
            status: "ready",
            dependencies: [],
            write_scope: ["src/a.ts"],
            gate_command: "bun test",
          },
        },
      };

      const result = engine.runAutonomousAuditLoop(state, ["src/a.ts"]);
      expect(result.auditedTasksCount).toBe(1);
      expect(result.auditedFilesCount).toBe(1);
      expect(result.score).toBeGreaterThan(0);
      expect(result.findings).toBeDefined();
    });

    it("delegates executeProactiveSelfQuestioningCycle", () => {
      const input: QuestionCycleInput = {
        cycleId: "cycle-coverage-1",
        state: { tasks: {} },
        repositoryFiles: ["src/index.ts"],
      };

      const cycle = engine.executeProactiveSelfQuestioningCycle(input);
      expect(cycle.cycleId).toBe("cycle-coverage-1");
      expect(cycle.dimension).toBeDefined();
      expect(cycle.questionText).toBeDefined();
      expect(cycle.hypothesis).toBeDefined();
      expect(Array.isArray(cycle.investigationFindings)).toBe(true);
      expect(Array.isArray(cycle.synthesizedProposals)).toBe(true);
    });

    it("delegates harvestPlanEnhancementsDuringPulse", () => {
      const context: MindPulseContext = {
        pulseId: "pulse-harvest-1",
        state: { tasks: {} },
        pulseNumber: 1,
      };

      const harvest = engine.harvestPlanEnhancementsDuringPulse(context);
      expect(harvest.pulseId).toBe("pulse-harvest-1");
      expect(Array.isArray(harvest.suggestedSubtasks)).toBe(true);
      expect(Array.isArray(harvest.identifiedBottlenecks)).toBe(true);
      expect(typeof harvest.applied).toBe("boolean");
    });

    it("delegates generateOptimizationProposals and computeCognitiveScoreVector", () => {
      const findings: readonly CognitiveAuditFinding[] = [
        {
          id: "F-COV-1",
          dimension: "simplicity",
          severity: "warning",
          ruleId: "RULE-EMPTY-WRITE-SCOPE",
          description: "Empty write scope",
          remediation: "Add scope",
          scoreImpact: 10,
          timestamp: new Date().toISOString(),
        },
      ];

      const metrics: SystemStateMetrics = {
        totalTasks: 2,
        completedTasks: 1,
        readyTasks: 1,
        pendingTasks: 0,
        failedTasks: 0,
        totalFiles: 5,
        hasCycles: false,
        falseBarrierCount: 0,
        astViolationCount: 0,
        untypedFieldCount: 0,
      };

      const scoreVector = engine.computeCognitiveScoreVector(findings, metrics);
      expect(scoreVector.simplicityScore).toBe(90);
      expect(scoreVector.compositeScore).toBeGreaterThan(0);

      const proposals = engine.generateOptimizationProposals(findings, scoreVector);
      expect(Array.isArray(proposals)).toBe(true);
      expect(proposals.length).toBeGreaterThanOrEqual(1);
    });
  });

  describe("Pulse cadence evaluation and historical tracking", () => {
    it("accumulates pulse scores and maintains defensive copy in getHistoricalScoreTrend", () => {
      const engine = createHyperCognitionEngine({ repoRoot: "/repos/skills" });
      expect(engine.getHistoricalScoreTrend()).toHaveLength(0);

      const pulseInput1: HyperPulseInput = {
        pulseId: "pulse-trend-1",
        state: { tasks: {} },
        pulseNumber: 1,
        timestamp: "2026-09-01T12:00:00.000Z",
      };

      const report1 = engine.evaluateCadenceHyperPulse(pulseInput1);
      expect(report1.pulseId).toBe("pulse-trend-1");
      expect(engine.getHistoricalScoreTrend()).toHaveLength(1);
      expect(engine.getHistoricalScoreTrend()[0]).toEqual(report1.scoreVector);

      const trendCopy = engine.getHistoricalScoreTrend() as CognitiveAuditFinding[];
      trendCopy.pop();
      expect(engine.getHistoricalScoreTrend()).toHaveLength(1);

      const pulseInput2: HyperPulseInput = {
        pulseId: "pulse-trend-2",
        state: { tasks: {} },
        pulseNumber: 2,
        timestamp: "2026-09-01T12:05:00.000Z",
      };

      const report2 = engine.evaluateCadenceHyperPulse(pulseInput2);
      expect(report2.pulseId).toBe("pulse-trend-2");
      expect(engine.getHistoricalScoreTrend()).toHaveLength(2);
    });

    it("integrates pulse cadence with formatted pulse event", () => {
      const engine = createHyperCognitionEngine({ repoRoot: "/repos/skills" });
      const pulseEvent: HarnessEvent = {
        id: "evt-123",
        kind: "cadence_audit",
        sequence: 7,
        timestamp: "2026-09-01T14:30:00.000Z",
        source: "mind_orchestrator",
        payload: {},
      };

      const report = engine.integratePulseCadence(pulseEvent, { tasks: {} });
      expect(report.pulseId).toBe("cadence_audit-7");
      expect(report.pulseTimestamp).toBe("2026-09-01T14:30:00.000Z");
      expect(engine.getHistoricalScoreTrend()).toHaveLength(1);
    });

    it("integrates pulse cadence with fallback pulseId when kind is blank or non-string", () => {
      const engine = createHyperCognitionEngine({ repoRoot: "/repos/skills" });
      const pulseEventBlankKind: HarnessEvent = {
        id: "evt-blank",
        kind: "",
        sequence: 1,
        timestamp: "2026-09-01T15:00:00.000Z",
        source: "mind_orchestrator",
        payload: {},
      };

      const reportBlank = engine.integratePulseCadence(pulseEventBlankKind, { tasks: {} });
      expect(reportBlank.pulseId.startsWith("pulse-")).toBe(true);

      const pulseEventNonStringKind = {
        id: "evt-null",
        kind: undefined,
        sequence: 2,
        timestamp: "2026-09-01T15:05:00.000Z",
        source: "mind_orchestrator",
        payload: {},
      } as unknown as HarnessEvent;

      const reportNonString = engine.integratePulseCadence(pulseEventNonStringKind, {
        tasks: {},
      });
      expect(reportNonString.pulseId.startsWith("pulse-")).toBe(true);
      expect(engine.getHistoricalScoreTrend()).toHaveLength(2);
    });
  });
});
