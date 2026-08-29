
function clampScore(score: number): number {
  return Math.max(MIN_COGNITIVE_SCORE, Math.min(MAX_COGNITIVE_SCORE, score));
}


export function extractSystemMetricsFromState(
  state: unknown,
  customFiles?: readonly string[] | undefined,
): SystemStateMetrics {
  const tasks = extractTasksFromState(state);
  let completedTasks = 0;
  let readyTasks = 0;
  let pendingTasks = 0;
  let failedTasks = 0;
  let falseBarrierCount = 0;

  for (const t of tasks) {
    const status = String(t.status || "").toLowerCase();
    if (status === "done" || status === "completed") completedTasks++;
    else if (status === "ready") readyTasks++;
    else if (status === "failed") failedTasks++;
    else pendingTasks++;
  }

  const files = customFiles ?? [];
  const totalFiles = files.length;

  return {
    totalTasks: tasks.length,
    completedTasks,
    readyTasks,
    pendingTasks,
    failedTasks,
    totalFiles,
    hasCycles: false,
    falseBarrierCount,
  };
}


export function extractTasksFromState(state: unknown): Array<Record<string, unknown>> {
  if (!state || typeof state !== "object") return [];
  const s = state as Record<string, unknown>;
  if (Array.isArray(s.tasks)) {
    return s.tasks.filter((t): t is Record<string, unknown> => typeof t === "object" && t !== null);
  }
  if (s.tasks && typeof s.tasks === "object") {
    return Object.values(s.tasks).filter((t): t is Record<string, unknown> => typeof t === "object" && t !== null);
  }
  return [];
}

import { HarnessError } from "../../../core/errors/index.ts";
import {
  MIN_COGNITIVE_SCORE,
  MAX_COGNITIVE_SCORE,
} from "./hyper-cognition-chunk1.ts";
import type {
  CognitiveAuditFinding,
  CognitiveAuditResult,
  CognitiveScoreVector,
} from "./hyper-cognition-chunk1.ts";
import type {
  SystemStateMetrics,
  DimensionalWeights,
} from "./hyper-cognition-chunk2.ts";
import { DEFAULT_DIMENSIONAL_WEIGHTS } from "./hyper-cognition-chunk2.ts";


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
