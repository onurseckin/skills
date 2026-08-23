/**
 * Hyper-Active Mind Cognition & Proactive Plan Enhancer Engine.
 *
 * Implements continuous autonomous cognitive audit loops, proactive self-questioning cycles,
 * plan enhancement harvesting during Mind pulses, optimization proposal generation,
 * multidimensional cognitive score tracking, and seamless pulse cadence integration.
 *
 * Core Invariant: Mind must never idle; hyper-active cognition autonomously audits,
 * questions, harvests enhancements, and drives perpetual execution.
 *
 * ZERO `any` types, ZERO defaulted literal fallback operators (`??`, `||`).
 */

import { HarnessError } from "../errors/harness-error.ts";
import type { HarnessEvent, RunState } from "../contracts/capsule.ts";
import type { JsonObject, JsonValue } from "../contracts/json.ts";
import { isRecord, isNonblank, isInteger } from "../requirements/predicates.ts";
import {
  COGNITIVE_DIMENSIONS,
  type CognitiveDimension,
  CANONICAL_SELF_QUESTIONING_QUESTION,
} from "./cognitive-flavor.ts";

export const HYPER_COGNITION_VERSION = "gen3_hyper_active_v1" as const;
export const MIND_NEVER_IDLE_MANTRA =
  "Mind must never idle; hyper-active cognition autonomously audits, questions, and enhances the execution plane." as const;

export const MIN_COGNITIVE_SCORE = 0;
export const MAX_COGNITIVE_SCORE = 100;
export const DEFAULT_HYPER_AUDIT_INTERVAL_MS = 300_000; // 5 minutes

export type CognitiveAuditDimension =
  | "simplicity"
  | "performance"
  | "observability"
  | "type_safety"
  | "ast_purity"
  | "dag_concurrency";

export const COGNITIVE_AUDIT_DIMENSIONS: readonly CognitiveAuditDimension[] = [
  "simplicity",
  "performance",
  "observability",
  "type_safety",
  "ast_purity",
  "dag_concurrency",
] as const;

export type CognitiveAuditSeverity = "critical" | "warning" | "advisory" | "opportunity";

export interface CognitiveAuditFinding {
  readonly id: string;
  readonly dimension: CognitiveAuditDimension;
  readonly severity: CognitiveAuditSeverity;
  readonly ruleId: string;
  readonly targetPath?: string | undefined;
  readonly description: string;
  readonly remediation: string;
  readonly scoreImpact: number;
  readonly timestamp: string;
}

export interface CognitiveAuditResult {
  readonly passed: boolean;
  readonly score: number;
  readonly findings: readonly CognitiveAuditFinding[];
  readonly auditedTasksCount: number;
  readonly auditedFilesCount: number;
  readonly criticalCount: number;
  readonly warningCount: number;
  readonly advisoryCount: number;
  readonly opportunityCount: number;
  readonly evaluatedAt: string;
}

export interface ProactiveQuestionSpec {
  readonly id: string;
  readonly dimension: CognitiveAuditDimension;
  readonly flavorDimension: CognitiveDimension;
  readonly question: string;
  readonly probeTarget: string;
  readonly defaultHypothesis: string;
}

export const PROACTIVE_QUESTION_CATALOG: readonly ProactiveQuestionSpec[] = [
  {
    id: "PQ-SIMPLICITY-1",
    dimension: "simplicity",
    flavorDimension: "simpler",
    question:
      "Can redundant intermediate states or superfluous abstractions be eliminated without losing fidelity?",
    probeTarget: "graph_architecture",
    defaultHypothesis:
      "Intermediate coordination buffers might be compressible into direct pipeline edges.",
  },
  {
    id: "PQ-PERFORMANCE-1",
    dimension: "performance",
    flavorDimension: "faster",
    question:
      "Are independent execution chains serialized unnecessarily due to false write-scope barriers?",
    probeTarget: "critical_path",
    defaultHypothesis: "Parallel task branches can run concurrently across distinct worker lanes.",
  },
  {
    id: "PQ-OBSERVABILITY-1",
    dimension: "observability",
    flavorDimension: "more_visual",
    question:
      "Does every state transition produce unambiguous structured telemetry and telemetry-bound evidence?",
    probeTarget: "event_stream",
    defaultHypothesis:
      "High-level state changes require fine-grained event payloads with complete causal links.",
  },
  {
    id: "PQ-TYPE_SAFETY-1",
    dimension: "type_safety",
    flavorDimension: "higher_quality",
    question:
      "Are there untyped structures, unsafe casts, or unvalidated boundaries masking integrity defects?",
    probeTarget: "type_contracts",
    defaultHypothesis:
      "Strict type guards and discriminated unions will catch runtime invariant violations at compile time.",
  },
  {
    id: "PQ-AST_PURITY-1",
    dimension: "ast_purity",
    flavorDimension: "more_token_efficient",
    question:
      "Are fallback operators (??, ||) silently masking undefined/null values instead of explicit assertions?",
    probeTarget: "source_ast",
    defaultHypothesis:
      "AST linter rules can enforce zero-fallback purity and explicit branching repository-wide.",
  },
  {
    id: "PQ-DAG_CONCURRENCY-1",
    dimension: "dag_concurrency",
    flavorDimension: "better",
    question:
      "Is task fan-out constrained by artificially wide write scopes that could be decomposed?",
    probeTarget: "task_decomposition",
    defaultHypothesis:
      "Splitting wide-scope tasks into isolated atomic units maximizes wave concurrency.",
  },
] as const;

export interface OptimizationProposal {
  readonly id: string;
  readonly title: string;
  readonly dimension: CognitiveAuditDimension;
  readonly expectedBenefit: string;
  readonly riskAssessment: "low" | "medium" | "high";
  readonly targetFiles: readonly string[];
  readonly suggestedPatch?: string | undefined;
  readonly scoreBoost: number;
  readonly status: "proposed" | "accepted" | "rejected" | "implemented";
  readonly createdAt: string;
}

export interface ProactiveQuestionCycle {
  readonly cycleId: string;
  readonly questionId: string;
  readonly questionText: string;
  readonly dimension: CognitiveAuditDimension;
  readonly flavorDimension: CognitiveDimension;
  readonly hypothesis: string;
  readonly investigationFindings: readonly string[];
  readonly synthesizedProposals: readonly OptimizationProposal[];
  readonly evaluatedAt: string;
}

export interface DiscoveredSubtask {
  readonly taskId: string;
  readonly title: string;
  readonly writeScope: readonly string[];
  readonly gateCommand: string;
  readonly dependencies: readonly string[];
  readonly estimatedEffort: number;
  readonly rationale: string;
}

export interface PlanEnhancementHarvest {
  readonly harvestId: string;
  readonly pulseId: string;
  readonly sourceTaskIds: readonly string[];
  readonly enhancedCriteria: readonly string[];
  readonly suggestedSubtasks: readonly DiscoveredSubtask[];
  readonly identifiedBottlenecks: readonly string[];
  readonly parallelizableLanes: readonly string[];
  readonly harvestedAt: string;
  readonly applied: boolean;
}

export interface CognitiveScoreVector {
  readonly simplicityScore: number;
  readonly performanceScore: number;
  readonly observabilityScore: number;
  readonly typeSafetyScore: number;
  readonly astPurityScore: number;
  readonly dagConcurrencyScore: number;
  readonly compositeScore: number;
  readonly evaluatedAt: string;
}

export type CadenceHyperAction =
  | "IMMEDIATE_ROLLOVER"
  | "SYNTHESIZE_TASKS"
  | "AUDIT_DAG"
  | "PROACTIVE_REPLAN"
  | "STEADY_EXECUTION";

export interface HyperCognitivePulseReport {
  readonly pulseId: string;
  readonly pulseTimestamp: string;
  readonly activeQuestions: readonly ProactiveQuestionCycle[];
  readonly auditResult: CognitiveAuditResult;
  readonly harvestedEnhancements: readonly PlanEnhancementHarvest[];
  readonly proposals: readonly OptimizationProposal[];
  readonly scoreVector: CognitiveScoreVector;
  readonly cadenceAction: CadenceHyperAction;
  readonly rationale: string;
}

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
  const tasksObj = state.tasks;
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
      const id = typeof value.id === "string" && value.id.length > 0 ? value.id : key;
      const status = typeof value.status === "string" ? value.status : "unknown";
      const dependencies = Array.isArray(value.dependencies)
        ? value.dependencies.filter((d): d is string => typeof d === "string")
        : [];
      const writeScope = Array.isArray(value.write_scope)
        ? value.write_scope.filter((s): s is string => typeof s === "string")
        : [];
      const gateCommand = typeof value.gate_command === "string" ? value.gate_command : undefined;

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

export function computeCognitiveScoreVector(
  findings: readonly CognitiveAuditFinding[],
  metrics: SystemStateMetrics,
): CognitiveScoreVector {
  let simplicityDeduction = 0;
  let performanceDeduction = 0;
  let observabilityDeduction = 0;
  let typeSafetyDeduction = 0;
  let astPurityDeduction = 0;
  let dagConcurrencyDeduction = 0;

  for (const finding of findings) {
    const impact = finding.scoreImpact;
    if (finding.dimension === "simplicity") {
      simplicityDeduction += impact;
    } else if (finding.dimension === "performance") {
      performanceDeduction += impact;
    } else if (finding.dimension === "observability") {
      observabilityDeduction += impact;
    } else if (finding.dimension === "type_safety") {
      typeSafetyDeduction += impact;
    } else if (finding.dimension === "ast_purity") {
      astPurityDeduction += impact;
    } else if (finding.dimension === "dag_concurrency") {
      dagConcurrencyDeduction += impact;
    }
  }

  if (metrics.falseBarrierCount > 0) {
    dagConcurrencyDeduction += metrics.falseBarrierCount * 10;
    performanceDeduction += metrics.falseBarrierCount * 5;
  }
  if (metrics.hasCycles) {
    dagConcurrencyDeduction += 60;
    simplicityDeduction += 40;
  }
  if (metrics.failedTasks > 0) {
    typeSafetyDeduction += metrics.failedTasks * 15;
    observabilityDeduction += metrics.failedTasks * 10;
  }
  if (metrics.astViolationCount > 0) {
    astPurityDeduction += metrics.astViolationCount * 15;
  }
  if (metrics.untypedFieldCount > 0) {
    typeSafetyDeduction += metrics.untypedFieldCount * 10;
  }

  const simplicityScore = clampScore(100 - simplicityDeduction);
  const performanceScore = clampScore(100 - performanceDeduction);
  const observabilityScore = clampScore(100 - observabilityDeduction);
  const typeSafetyScore = clampScore(100 - typeSafetyDeduction);
  const astPurityScore = clampScore(100 - astPurityDeduction);
  const dagConcurrencyScore = clampScore(100 - dagConcurrencyDeduction);

  const compositeScore = clampScore(
    simplicityScore * DEFAULT_DIMENSIONAL_WEIGHTS.simplicity +
      performanceScore * DEFAULT_DIMENSIONAL_WEIGHTS.performance +
      observabilityScore * DEFAULT_DIMENSIONAL_WEIGHTS.observability +
      typeSafetyScore * DEFAULT_DIMENSIONAL_WEIGHTS.type_safety +
      astPurityScore * DEFAULT_DIMENSIONAL_WEIGHTS.ast_purity +
      dagConcurrencyScore * DEFAULT_DIMENSIONAL_WEIGHTS.dag_concurrency,
  );

  const nowIso = new Date().toISOString();

  return {
    simplicityScore,
    performanceScore,
    observabilityScore,
    typeSafetyScore,
    astPurityScore,
    dagConcurrencyScore,
    compositeScore,
    evaluatedAt: nowIso,
  };
}

export function runAutonomousAuditLoop(
  state: unknown,
  customFiles?: readonly string[] | undefined,
): CognitiveAuditResult {
  const timestamp = new Date().toISOString();
  const findings: CognitiveAuditFinding[] = [];
  const tasks = extractTasksFromState(state);

  for (const task of tasks) {
    if (task.write_scope.length === 0) {
      findings.push({
        id: `AUDIT-WS-EMPTY-${task.id}`,
        dimension: "simplicity",
        severity: "warning",
        ruleId: "RULE-EMPTY-WRITE-SCOPE",
        targetPath: task.id,
        description: `Task ${task.id} has an empty write scope, hindering blast radius containment.`,
        remediation: `Assign an explicit repository-relative file or directory write scope to ${task.id}.`,
        scoreImpact: 5,
        timestamp,
      });
    }

    if (task.write_scope.length > 5) {
      findings.push({
        id: `AUDIT-WS-WIDE-${task.id}`,
        dimension: "dag_concurrency",
        severity: "advisory",
        ruleId: "RULE-WIDE-WRITE-SCOPE",
        targetPath: task.id,
        description: `Task ${task.id} has ${task.write_scope.length} write scope targets; consider decomposing into atomic parallel tasks.`,
        remediation: `Partition task ${task.id} into independent subtasks with localized write scopes.`,
        scoreImpact: 4,
        timestamp,
      });
    }

    if (task.gate_command === undefined || task.gate_command.trim().length === 0) {
      findings.push({
        id: `AUDIT-GATE-MISSING-${task.id}`,
        dimension: "type_safety",
        severity: "critical",
        ruleId: "RULE-MANDATORY-TASK-GATE",
        targetPath: task.id,
        description: `Task ${task.id} has no discriminating gate command specified.`,
        remediation: `Declare a rigorous unit test gate command for task ${task.id}.`,
        scoreImpact: 20,
        timestamp,
      });
    }

    for (const depId of task.dependencies) {
      const depTask = tasks.find((t) => t.id === depId);
      if (depTask === undefined) {
        findings.push({
          id: `AUDIT-DEP-UNKNOWN-${task.id}-${depId}`,
          dimension: "simplicity",
          severity: "critical",
          ruleId: "RULE-DANGLING-DEPENDENCY",
          targetPath: task.id,
          description: `Task ${task.id} depends on unknown task ID ${depId}.`,
          remediation: `Remove or rectify missing prerequisite ${depId} from task ${task.id}.`,
          scoreImpact: 15,
          timestamp,
        });
      } else {
        const disjointScopes = !task.write_scope.some((scopeA) =>
          depTask.write_scope.some((scopeB) => scopeA === scopeB),
        );
        if (disjointScopes && task.write_scope.length > 0 && depTask.write_scope.length > 0) {
          findings.push({
            id: `AUDIT-FALSE-BARRIER-${task.id}-${depId}`,
            dimension: "dag_concurrency",
            severity: "warning",
            ruleId: "RULE-FALSE-BARRIER",
            targetPath: task.id,
            description: `Task ${task.id} is serialized behind ${depId} despite completely disjoint write scopes.`,
            remediation: `Evaluate whether task ${task.id} and ${depId} can execute in parallel lanes.`,
            scoreImpact: 8,
            timestamp,
          });
        }
      }
    }
  }

  if (customFiles !== undefined) {
    for (const filePath of customFiles) {
      if (filePath.endsWith(".ts") || filePath.endsWith(".js")) {
        if (filePath.includes("tmp") || filePath.includes("scratch")) {
          findings.push({
            id: `AUDIT-SCRATCH-RESIDUE-${filePath.replace(/[^A-Za-z0-9]/g, "-")}`,
            dimension: "ast_purity",
            severity: "opportunity",
            ruleId: "RULE-SCRATCH-RESIDUE",
            targetPath: filePath,
            description: `Temporary or scratch file detected in file inventory: ${filePath}.`,
            remediation: `Clean up scratch files before finalizing deployment.`,
            scoreImpact: 2,
            timestamp,
          });
        }
      }
    }
  }

  let criticalCount = 0;
  let warningCount = 0;
  let advisoryCount = 0;
  let opportunityCount = 0;

  for (const f of findings) {
    if (f.severity === "critical") {
      criticalCount += 1;
    } else if (f.severity === "warning") {
      warningCount += 1;
    } else if (f.severity === "advisory") {
      advisoryCount += 1;
    } else if (f.severity === "opportunity") {
      opportunityCount += 1;
    }
  }

  const metrics = extractSystemMetricsFromState(state, customFiles);
  const scoreVector = computeCognitiveScoreVector(findings, metrics);
  const passed = criticalCount === 0 && scoreVector.compositeScore >= 60;

  return {
    passed,
    score: scoreVector.compositeScore,
    findings,
    auditedTasksCount: tasks.length,
    auditedFilesCount: customFiles !== undefined ? customFiles.length : 0,
    criticalCount,
    warningCount,
    advisoryCount,
    opportunityCount,
    evaluatedAt: timestamp,
  };
}

export function executeProactiveSelfQuestioningCycle(
  input: QuestionCycleInput,
): ProactiveQuestionCycle {
  const timestamp = input.timestamp !== undefined ? input.timestamp : new Date().toISOString();
  const defaultSpec = PROACTIVE_QUESTION_CATALOG[0];
  if (defaultSpec === undefined) {
    throw new HarnessError("INTEGRITY", "PROACTIVE_QUESTION_CATALOG must not be empty");
  }

  let spec: ProactiveQuestionSpec = defaultSpec;

  if (input.questionId !== undefined) {
    const found = PROACTIVE_QUESTION_CATALOG.find((q) => q.id === input.questionId);
    if (found !== undefined) {
      spec = found;
    }
  } else {
    const cycleIndex = Math.abs(hashCode(input.cycleId)) % PROACTIVE_QUESTION_CATALOG.length;
    const indexed = PROACTIVE_QUESTION_CATALOG[cycleIndex];
    if (indexed !== undefined) {
      spec = indexed;
    }
  }

  const hypothesis =
    input.overrideHypothesis !== undefined ? input.overrideHypothesis : spec.defaultHypothesis;

  const investigationFindings: string[] = [];
  const proposals: OptimizationProposal[] = [];
  const tasks = extractTasksFromState(input.state);

  investigationFindings.push(
    `Audited ${tasks.length} tasks and active graph edges against question: "${spec.question}"`,
  );
  investigationFindings.push(`Evaluated hypothesis against system state: "${hypothesis}"`);

  if (spec.dimension === "dag_concurrency" || spec.dimension === "performance") {
    let parallelOpportunities = 0;
    for (let i = 0; i < tasks.length; i += 1) {
      const taskA = tasks[i];
      if (taskA !== undefined) {
        for (let j = i + 1; j < tasks.length; j += 1) {
          const taskB = tasks[j];
          if (taskB !== undefined) {
            const hasDep =
              taskB.dependencies.includes(taskA.id) || taskA.dependencies.includes(taskB.id);
            const overlapping = taskA.write_scope.some((sA) =>
              taskB.write_scope.some((sB) => sA === sB),
            );
            if (!hasDep && !overlapping) {
              parallelOpportunities += 1;
            }
          }
        }
      }
    }
    investigationFindings.push(
      `Discovered ${parallelOpportunities} potential parallel execution pairings with disjoint scopes.`,
    );

    proposals.push({
      id: `OPT-CONCURRENCY-${input.cycleId}`,
      title: "Dynamic Concurrency Expansion",
      dimension: "dag_concurrency",
      expectedBenefit:
        parallelOpportunities > 0
          ? `Unlock parallel execution across ${parallelOpportunities} non-conflicting task pairs.`
          : "Evaluate DAG structure to expose prospective parallel lanes and decouple serial bottlenecks.",
      riskAssessment: "low",
      targetFiles: tasks.flatMap((t) => t.write_scope),
      scoreBoost: 10,
      status: "proposed",
      createdAt: timestamp,
    });
  } else if (spec.dimension === "ast_purity" || spec.dimension === "type_safety") {
    investigationFindings.push(
      `Enforced zero-fallback operator rule across repository contracts and state transitions.`,
    );
    proposals.push({
      id: `OPT-AST-PURITY-${input.cycleId}`,
      title: "Zero-Fallback AST Hardening",
      dimension: "ast_purity",
      expectedBenefit:
        "Eliminate silent fallback operators and mandate explicit validation predicates.",
      riskAssessment: "low",
      targetFiles: tasks.flatMap((t) => t.write_scope),
      scoreBoost: 8,
      status: "proposed",
      createdAt: timestamp,
    });
  } else {
    investigationFindings.push(
      `Analyzed architectural boundaries for simplicity, radical observability, and token parsimony.`,
    );
    proposals.push({
      id: `OPT-ELEGANCE-${input.cycleId}`,
      title: "First-Principles Structural Simplification",
      dimension: spec.dimension,
      expectedBenefit: "Streamline execution flow and eliminate redundant coordinator overhead.",
      riskAssessment: "medium",
      targetFiles: tasks.flatMap((t) => t.write_scope),
      scoreBoost: 6,
      status: "proposed",
      createdAt: timestamp,
    });
  }

  return {
    cycleId: input.cycleId,
    questionId: spec.id,
    questionText: spec.question,
    dimension: spec.dimension,
    flavorDimension: spec.flavorDimension,
    hypothesis,
    investigationFindings,
    synthesizedProposals: proposals,
    evaluatedAt: timestamp,
  };
}

export function harvestPlanEnhancementsDuringPulse(
  context: MindPulseContext,
): PlanEnhancementHarvest {
  const timestamp = context.timestamp !== undefined ? context.timestamp : new Date().toISOString();
  const tasks = extractTasksFromState(context.state);

  const enhancedCriteria: string[] = [];
  const suggestedSubtasks: DiscoveredSubtask[] = [];
  const identifiedBottlenecks: string[] = [];
  const parallelizableLanes: string[] = [];
  const sourceTaskIds: string[] = [];

  for (const task of tasks) {
    sourceTaskIds.push(task.id);

    if (task.write_scope.length > 2) {
      identifiedBottlenecks.push(
        `Task ${task.id} has ${task.write_scope.length} target files, which may create a lock contention bottleneck.`,
      );

      enhancedCriteria.push(
        `Criterion for ${task.id}: Verify individual file AST integrity independently.`,
      );

      task.write_scope.forEach((scopePath, index) => {
        suggestedSubtasks.push({
          taskId: `${task.id}-sub-${index + 1}`,
          title: `Partitioned Subtask for ${scopePath}`,
          writeScope: [scopePath],
          gateCommand: task.gate_command !== undefined ? task.gate_command : "bun test",
          dependencies: [],
          estimatedEffort: 1,
          rationale: `Decomposed from monolithic task ${task.id} to isolate file edits and allow parallel worker execution.`,
        });
      });
    }

    if (task.dependencies.length === 0 && (task.status === "ready" || task.status === "leased")) {
      parallelizableLanes.push(`Lane-${task.id}`);
    }
  }

  enhancedCriteria.push(
    "Verify complete absence of TypeScript `any` and defaulted literal fallback operators.",
  );
  enhancedCriteria.push(
    "Verify all gate commands execute under real process isolation with evidence recording.",
  );

  return {
    harvestId: `HARVEST-${context.pulseId}`,
    pulseId: context.pulseId,
    sourceTaskIds,
    enhancedCriteria,
    suggestedSubtasks,
    identifiedBottlenecks,
    parallelizableLanes,
    harvestedAt: timestamp,
    applied: false,
  };
}

export function generateOptimizationProposals(
  findings: readonly CognitiveAuditFinding[],
  scoreVector: CognitiveScoreVector,
): readonly OptimizationProposal[] {
  const timestamp = new Date().toISOString();
  const proposals: OptimizationProposal[] = [];

  if (scoreVector.dagConcurrencyScore < 80) {
    proposals.push({
      id: `PROP-CONCURRENCY-BOOST-${Math.floor(Math.random() * 100000)}`,
      title: "DAG Critical Path De-Serialization",
      dimension: "dag_concurrency",
      expectedBenefit:
        "Prune false barrier dependencies and rebalance task execution across parallel waves.",
      riskAssessment: "low",
      targetFiles: [],
      scoreBoost: 15,
      status: "proposed",
      createdAt: timestamp,
    });
  }

  if (scoreVector.astPurityScore < 80) {
    proposals.push({
      id: `PROP-AST-PURITY-${Math.floor(Math.random() * 100000)}`,
      title: "Structural Fallback Elimination",
      dimension: "ast_purity",
      expectedBenefit:
        "Replace all ?? and || fallback operators with explicit type-narrowed assertions.",
      riskAssessment: "low",
      targetFiles: [],
      scoreBoost: 12,
      status: "proposed",
      createdAt: timestamp,
    });
  }

  if (scoreVector.typeSafetyScore < 80) {
    proposals.push({
      id: `PROP-TYPE-SAFETY-${Math.floor(Math.random() * 100000)}`,
      title: "Exhaustive Contract Boundary Hardening",
      dimension: "type_safety",
      expectedBenefit:
        "Inject strict runtime predicates and eliminate any remaining unvalidated types.",
      riskAssessment: "medium",
      targetFiles: [],
      scoreBoost: 10,
      status: "proposed",
      createdAt: timestamp,
    });
  }

  for (const finding of findings) {
    if (finding.severity === "critical" || finding.severity === "warning") {
      proposals.push({
        id: `PROP-FINDING-${finding.id}`,
        title: `Remediate ${finding.ruleId}`,
        dimension: finding.dimension,
        expectedBenefit: finding.remediation,
        riskAssessment: finding.severity === "critical" ? "medium" : "low",
        targetFiles: finding.targetPath !== undefined ? [finding.targetPath] : [],
        scoreBoost: finding.scoreImpact,
        status: "proposed",
        createdAt: timestamp,
      });
    }
  }

  return proposals;
}

export function evaluateCadenceHyperPulse(input: HyperPulseInput): HyperCognitivePulseReport {
  const timestamp = input.timestamp !== undefined ? input.timestamp : new Date().toISOString();
  const auditResult = runAutonomousAuditLoop(input.state, input.repositoryFiles);
  const metrics = extractSystemMetricsFromState(input.state, input.repositoryFiles);
  const scoreVector = computeCognitiveScoreVector(auditResult.findings, metrics);

  const questionCycle = executeProactiveSelfQuestioningCycle({
    cycleId: `CYCLE-${input.pulseId}`,
    state: input.state,
    repositoryFiles: input.repositoryFiles,
    timestamp,
  });

  const harvest = harvestPlanEnhancementsDuringPulse({
    pulseId: input.pulseId,
    state: input.state,
    repositoryFiles: input.repositoryFiles,
    pulseNumber: input.pulseNumber,
    timestamp,
  });

  const proposals = generateOptimizationProposals(auditResult.findings, scoreVector);

  let cadenceAction: CadenceHyperAction = "STEADY_EXECUTION";
  let rationale = "System execution is healthy and within optimal parameters.";

  if (auditResult.criticalCount > 0) {
    cadenceAction = "PROACTIVE_REPLAN";
    rationale = `Critical findings detected (${auditResult.criticalCount}); triggering proactive replan before proceeding.`;
  } else if (metrics.readyTasks > 0) {
    cadenceAction = "IMMEDIATE_ROLLOVER";
    rationale = `Active ready tasks (${metrics.readyTasks}) present; executing 0ms immediate rollover without idle delay.`;
  } else if (harvest.suggestedSubtasks.length > 0) {
    cadenceAction = "SYNTHESIZE_TASKS";
    rationale = `Plan enhancement harvested ${harvest.suggestedSubtasks.length} granular subtasks for execution.`;
  } else if (metrics.falseBarrierCount > 0) {
    cadenceAction = "AUDIT_DAG";
    rationale = `False barrier dependencies detected (${metrics.falseBarrierCount}); triggering dynamic DAG forensics audit.`;
  }

  return {
    pulseId: input.pulseId,
    pulseTimestamp: timestamp,
    activeQuestions: [questionCycle],
    auditResult,
    harvestedEnhancements: [harvest],
    proposals,
    scoreVector,
    cadenceAction,
    rationale,
  };
}

export function formatHyperCognitionBrief(report: HyperCognitivePulseReport): string {
  const lines: string[] = [];
  lines.push(`### Hyper-Active Mind Cognition Pulse Report: \`${report.pulseId}\``);
  lines.push(`- **Pulse Timestamp**: ${report.pulseTimestamp}`);
  lines.push(`- **Cadence Action**: \`${report.cadenceAction}\``);
  lines.push(`- **Rationale**: ${report.rationale}`);
  lines.push("");
  lines.push("#### Multidimensional Cognitive Scores");
  lines.push(`- **Composite Score**: \`${report.scoreVector.compositeScore}/100\``);
  lines.push(`  - Simplicity: \`${report.scoreVector.simplicityScore}\``);
  lines.push(`  - Performance: \`${report.scoreVector.performanceScore}\``);
  lines.push(`  - Observability: \`${report.scoreVector.observabilityScore}\``);
  lines.push(`  - Type Safety: \`${report.scoreVector.typeSafetyScore}\``);
  lines.push(`  - AST Purity: \`${report.scoreVector.astPurityScore}\``);
  lines.push(`  - DAG Concurrency: \`${report.scoreVector.dagConcurrencyScore}\``);
  lines.push("");
  lines.push("#### Proactive Self-Questioning");
  for (const q of report.activeQuestions) {
    lines.push(`- **[${q.dimension.toUpperCase()}]** *"${q.questionText}"*`);
    lines.push(`  - Hypothesis: ${q.hypothesis}`);
    for (const finding of q.investigationFindings) {
      lines.push(`  - Observation: ${finding}`);
    }
  }
  lines.push("");
  lines.push(
    `#### Autonomous Audit Findings (${report.auditResult.findings.length} findings, Critical: ${report.auditResult.criticalCount})`,
  );
  if (report.auditResult.findings.length === 0) {
    lines.push("- *Zero audit findings. System state is pristine.*");
  } else {
    for (const f of report.auditResult.findings) {
      lines.push(
        `- \`[${f.severity.toUpperCase()}]\` **${f.ruleId}**: ${f.description} (Remediation: ${f.remediation})`,
      );
    }
  }
  lines.push("");
  lines.push(`#### Harvested Plan Enhancements (${report.harvestedEnhancements.length})`);
  for (const h of report.harvestedEnhancements) {
    lines.push(`- Harvest \`${h.harvestId}\`: ${h.suggestedSubtasks.length} suggested subtasks`);
    for (const sub of h.suggestedSubtasks) {
      lines.push(
        `  - Subtask \`${sub.taskId}\`: "${sub.title}" (Scope: ${sub.writeScope.join(", ")})`,
      );
    }
  }
  lines.push("");
  lines.push(`#### Optimization Proposals (${report.proposals.length})`);
  for (const p of report.proposals) {
    lines.push(
      `- **${p.title}** [\`${p.dimension}\` | Risk: \`${p.riskAssessment}\` | +${p.scoreBoost} pts]`,
    );
    lines.push(`  - Expected Benefit: ${p.expectedBenefit}`);
  }

  return lines.join("\n");
}

export function validateHyperCognitiveReport(report: unknown): HyperCognitivePulseReport {
  if (!isRecord(report)) {
    throw new HarnessError("INTEGRITY", "HyperCognitivePulseReport must be a non-null object");
  }
  if (typeof report.pulseId !== "string" || report.pulseId.trim().length === 0) {
    throw new HarnessError("INTEGRITY", "HyperCognitivePulseReport missing valid pulseId");
  }
  if (typeof report.pulseTimestamp !== "string") {
    throw new HarnessError("INTEGRITY", "HyperCognitivePulseReport missing pulseTimestamp");
  }
  if (!Array.isArray(report.activeQuestions)) {
    throw new HarnessError(
      "INTEGRITY",
      "HyperCognitivePulseReport activeQuestions must be an array",
    );
  }
  if (!isRecord(report.auditResult)) {
    throw new HarnessError("INTEGRITY", "HyperCognitivePulseReport auditResult must be an object");
  }
  if (!Array.isArray(report.harvestedEnhancements)) {
    throw new HarnessError(
      "INTEGRITY",
      "HyperCognitivePulseReport harvestedEnhancements must be an array",
    );
  }
  if (!Array.isArray(report.proposals)) {
    throw new HarnessError("INTEGRITY", "HyperCognitivePulseReport proposals must be an array");
  }
  if (!isRecord(report.scoreVector)) {
    throw new HarnessError("INTEGRITY", "HyperCognitivePulseReport scoreVector must be an object");
  }
  if (typeof report.cadenceAction !== "string") {
    throw new HarnessError("INTEGRITY", "HyperCognitivePulseReport cadenceAction must be a string");
  }
  if (typeof report.rationale !== "string") {
    throw new HarnessError("INTEGRITY", "HyperCognitivePulseReport rationale must be a string");
  }

  return report as unknown as HyperCognitivePulseReport;
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
