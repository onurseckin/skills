import type { HarnessEvent } from "../../../core/contracts/index.ts";
import { HarnessError } from "../../../core/errors/index.ts";
import type {
  CognitiveAuditFinding,
  CognitiveAuditResult,
  CognitiveScoreVector,
  HyperCognitivePulseReport,
  OptimizationProposal,
  PlanEnhancementHarvest,
  ProactiveQuestionCycle,
} from "./types.ts";
import type {
  HyperCognitionEngine,
  HyperCognitionEngineOptions,
  HyperPulseInput,
  MindPulseContext,
  QuestionCycleInput,
  SystemStateMetrics,
} from "./state.ts";
import { computeCognitiveScoreVector, runAutonomousAuditLoop } from "./gap-analysis.ts";
import {
  executeProactiveSelfQuestioningCycle,
  harvestPlanEnhancementsDuringPulse,
} from "./planner.ts";
import { evaluateCadenceHyperPulse, generateOptimizationProposals } from "./evolution.ts";

function isNonblank(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

export function createHyperCognitionEngine(
  options: HyperCognitionEngineOptions,
): HyperCognitionEngine {
  if (!isNonblank(options.repoRoot)) {
    throw new HarnessError("INVALID_ARGUMENT", "repoRoot must be a non-blank string");
  }

  const scoreHistory: CognitiveScoreVector[] = [];

  return {
    options,
    runAutonomousAuditLoop(state: unknown, customFiles?: readonly string[]): CognitiveAuditResult {
      return runAutonomousAuditLoop(state, customFiles);
    },
    executeProactiveSelfQuestioningCycle(input: QuestionCycleInput): ProactiveQuestionCycle {
      return executeProactiveSelfQuestioningCycle(input);
    },
    harvestPlanEnhancementsDuringPulse(context: MindPulseContext): PlanEnhancementHarvest {
      return harvestPlanEnhancementsDuringPulse(context);
    },
    generateOptimizationProposals(
      findings: readonly CognitiveAuditFinding[],
      scoreVector: CognitiveScoreVector,
    ): readonly OptimizationProposal[] {
      return generateOptimizationProposals(findings, scoreVector);
    },
    computeCognitiveScoreVector(
      findings: readonly CognitiveAuditFinding[],
      metrics: SystemStateMetrics,
    ): CognitiveScoreVector {
      return computeCognitiveScoreVector(findings, metrics);
    },
    evaluateCadenceHyperPulse(input: HyperPulseInput): HyperCognitivePulseReport {
      const report = evaluateCadenceHyperPulse(input);
      scoreHistory.push(report.scoreVector);
      return report;
    },
    integratePulseCadence(
      pulseEvent: HarnessEvent,
      currentState: unknown,
    ): HyperCognitivePulseReport {
      const pulseId =
        typeof pulseEvent.kind === "string" && pulseEvent.kind.length > 0
          ? `${pulseEvent.kind}-${pulseEvent.sequence}`
          : `pulse-${Date.now()}`;

      const pulseInput: HyperPulseInput = {
        pulseId,
        state: currentState,
        pulseNumber: pulseEvent.sequence,
        timestamp: pulseEvent.timestamp,
      };

      return this.evaluateCadenceHyperPulse(pulseInput);
    },
    getHistoricalScoreTrend(): readonly CognitiveScoreVector[] {
      return [...scoreHistory];
    },
  };
}

function hashCode(str: string): number {
  let hash = 0;
  for (let i = 0; i < str.length; i += 1) {
    const char = str.charCodeAt(i);
    hash = (hash << 5) - hash + char;
    hash = hash & hash; // Convert to 32bit integer
  }
  return hash;
}
