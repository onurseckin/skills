import type { HarnessEvent } from "../../../core/contracts/index.ts";
import { isRecord } from "../../../requirements/predicates.ts";
import {
  MIN_COGNITIVE_SCORE,
  MAX_COGNITIVE_SCORE,
  type CognitiveAuditFinding,
  type CognitiveAuditResult,
  type CognitiveScoreVector,
  type HyperCognitivePulseReport,
  type OptimizationProposal,
  type PlanEnhancementHarvest,
  type ProactiveQuestionCycle,
} from "./types.ts";

export interface SystemStateMetrics {
  readonly totalTasks: number;
  readonly completedTasks: number;
  readonly readyTasks: number;
  readonly pendingTasks: number;
  readonly failedTasks: number;
  readonly totalFiles: number;
  readonly hasCycles: boolean;
  readonly falseBarrierCount: number;
  readonly astViolationCount: number;
  readonly untypedFieldCount: number;
}

export interface MindPulseContext {
  readonly pulseId: string;
  readonly state: unknown;
  readonly repositoryFiles?: readonly string[] | undefined;
  readonly pulseNumber?: number | undefined;
  readonly timestamp?: string | undefined;
}

export interface QuestionCycleInput {
  readonly cycleId: string;
  readonly questionId?: string | undefined;
  readonly state: unknown;
  readonly repositoryFiles?: readonly string[] | undefined;
  readonly overrideHypothesis?: string | undefined;
  readonly timestamp?: string | undefined;
}

export interface HyperPulseInput {
  readonly pulseId: string;
  readonly state: unknown;
  readonly repositoryFiles?: readonly string[] | undefined;
  readonly pulseNumber?: number | undefined;
  readonly previousScores?: readonly CognitiveScoreVector[] | undefined;
  readonly timestamp?: string | undefined;
}

export interface HyperCognitionEngineOptions {
  readonly repoRoot: string;
  readonly capsuleRoot?: string | undefined;
  readonly auditIntervalMs?: number | undefined;
  readonly strictPurity?: boolean | undefined;
  readonly minScoreThreshold?: number | undefined;
}

export interface HyperCognitionEngine {
  readonly options: HyperCognitionEngineOptions;
  runAutonomousAuditLoop(state: unknown, customFiles?: readonly string[]): CognitiveAuditResult;
  executeProactiveSelfQuestioningCycle(input: QuestionCycleInput): ProactiveQuestionCycle;
  harvestPlanEnhancementsDuringPulse(context: MindPulseContext): PlanEnhancementHarvest;
  generateOptimizationProposals(
    findings: readonly CognitiveAuditFinding[],
    scoreVector: CognitiveScoreVector,
  ): readonly OptimizationProposal[];
  computeCognitiveScoreVector(
    findings: readonly CognitiveAuditFinding[],
    metrics: SystemStateMetrics,
  ): CognitiveScoreVector;
  evaluateCadenceHyperPulse(input: HyperPulseInput): HyperCognitivePulseReport;
  integratePulseCadence(pulseEvent: HarnessEvent, currentState: unknown): HyperCognitivePulseReport;
  getHistoricalScoreTrend(): readonly CognitiveScoreVector[];
}

export interface DimensionalWeights {
  readonly simplicity: number;
  readonly performance: number;
  readonly observability: number;
  readonly type_safety: number;
  readonly ast_purity: number;
  readonly dag_concurrency: number;
}

export const DEFAULT_DIMENSIONAL_WEIGHTS: DimensionalWeights = {
  simplicity: 0.15,
  performance: 0.2,
  observability: 0.15,
  type_safety: 0.2,
  ast_purity: 0.15,
  dag_concurrency: 0.15,
};

function clampScore(score: number): number {
  if (score < MIN_COGNITIVE_SCORE) {
    return MIN_COGNITIVE_SCORE;
  }
  if (score > MAX_COGNITIVE_SCORE) {
    return MAX_COGNITIVE_SCORE;
  }
  return Math.round(score * 100) / 100;
}

function extractTasksFromState(state: unknown): Array<{
  id: string;
  status: string;
  dependencies: string[];
  write_scope: string[];
  gate_command?: string | undefined;
}> {
  if (!isRecord(state)) {
    return [];
  }
  const tasksObj = state["tasks"];
  if (!isRecord(tasksObj)) {
    return [];
  }
  const results: Array<{
    id: string;
    status: string;
    dependencies: string[];
    write_scope: string[];
    gate_command?: string | undefined;
  }> = [];

  for (const [key, value] of Object.entries(tasksObj)) {
    if (isRecord(value)) {
      const id = typeof value["id"] === "string" && value["id"].length > 0 ? value["id"] : key;
      const status = typeof value["status"] === "string" ? value["status"] : "unknown";
      const dependencies = Array.isArray(value["dependencies"])
        ? value["dependencies"].filter((d: unknown): d is string => typeof d === "string")
        : [];
      const writeScope = Array.isArray(value["write_scope"])
        ? value["write_scope"].filter((s: unknown): s is string => typeof s === "string")
        : [];
      const gateCommand =
        typeof value["gate_command"] === "string" ? value["gate_command"] : undefined;

      results.push({
        id,
        status,
        dependencies,
        write_scope: writeScope,
        gate_command: gateCommand,
      });
    }
  }

  return results;
}

function extractSystemMetricsFromState(
  state: unknown,
  customFiles?: readonly string[] | undefined,
): SystemStateMetrics {
  const tasks = extractTasksFromState(state);
  let completed = 0;
  let ready = 0;
  let pending = 0;
  let failed = 0;

  for (const task of tasks) {
    if (task.status === "done" || task.status === "succeeded" || task.status === "satisfied") {
      completed += 1;
    } else if (task.status === "ready" || task.status === "leased") {
      ready += 1;
    } else if (task.status === "pending" || task.status === "draft") {
      pending += 1;
    } else if (
      task.status === "failed" ||
      task.status === "rejected" ||
      task.status === "changes_requested"
    ) {
      failed += 1;
    }
  }

  let totalFiles = 0;
  if (customFiles !== undefined) {
    totalFiles = customFiles.length;
  }

  let falseBarriers = 0;
  for (const task of tasks) {
    if (task.dependencies.length > 0) {
      for (const depId of task.dependencies) {
        const depTask = tasks.find((t) => t.id === depId);
        if (depTask !== undefined) {
          const hasOverlappingScope = task.write_scope.some((scopeA) =>
            depTask.write_scope.some((scopeB) => scopeA === scopeB),
          );
          if (
            !hasOverlappingScope &&
            task.write_scope.length > 0 &&
            depTask.write_scope.length > 0
          ) {
            falseBarriers += 1;
          }
        }
      }
    }
  }

  return {
    totalTasks: tasks.length,
    completedTasks: completed,
    readyTasks: ready,
    pendingTasks: pending,
    failedTasks: failed,
    totalFiles,
    hasCycles: false,
    falseBarrierCount: falseBarriers,
    astViolationCount: 0,
    untypedFieldCount: 0,
  };
}
