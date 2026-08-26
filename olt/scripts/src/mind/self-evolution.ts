import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { HarnessError } from "../core/errors/harness-error.ts";
import { isTestEnvironment, resolveCapsulesDir, resolveScratchDir } from "../core/shared/paths.ts";
import { drainPendingFeedbacks, readFeedbackQueue, type FeedbackItem } from "./feedback-queue.ts";
import {
  applyIntervalJitter,
  calculateExponentialBackoff,
  DEFAULT_BASE_INTERVAL_MS,
  DEFAULT_MAX_INTERVAL_MS,
} from "./interval.ts";
import {
  generatePlanRevisionFromSignals,
  type PlanRevisionProposal,
  type PlanRevisionSignal,
  type PlanRevisionSignalType,
} from "./proposal.ts";
import {
  discoverTasks,
  proposeCandidateEvolutions,
  type CandidateEvolutionProposal,
  type DiscoveredTaskPlan,
  type TaskDiscoveryOptions,
  type TaskDiscoveryResult,
} from "./task-discovery.ts";
import {
  enqueueTasksBatch,
  getQueueStats,
  readTaskQueue,
  type NewTaskQueueInput,
  type TaskPriority,
  type TaskQueueItem,
  type TaskQueueStats,
} from "./task-queue.ts";

export const PERPETUAL_NON_STOPPING_CADENCE = "infinite_autonomous" as const;
export const NON_STOPPING_RULE =
  "Autonomous perpetual Mind loops never terminate when idle; self-evolution engine continuously synthesizes improvement tasks" as const;
export const CLOSING_FORBIDDEN_IDLE_MIND =
  "Mind loop cannot be closed or terminated when idle; self-evolution engine must engage" as const;

export const DEFAULT_EVOLUTION_BASE_INTERVAL_MS = 900_000; // 15 minutes
export const DEFAULT_EVOLUTION_MAX_INTERVAL_MS = 14_400_000; // 4 hours

export type SelfEvolutionMode =
  | "MODE_A_AUTONOMIC_DISCOVERY"
  | "MODE_B_FEEDBACK_INTAKE"
  | "MODE_C_INVARIANT_HARDENING"
  | "QUEUE_ACTIVE";

export type CadencePhase =
  | "IDLE"
  | "DISCOVERING"
  | "SYNTHESIZING"
  | "ENQUEUING"
  | "EVOLVING"
  | "EVALUATING"
  | "PERPETUAL_REST";

export type SupervisoryRoleTier = 1 | 2 | 3;
export type OrchestratorNodeStatus = "ACTIVE" | "IDLE" | "OVERLOADED" | "DRAINING";
export type HierarchyScalingDirection = "SCALE_OUT" | "SCALE_IN" | "REBALANCE" | "STEADY";

export interface OrchestratorNodeInfo {
  readonly id: string;
  readonly role: "orchestrator" | "coordinator";
  readonly tier: 1 | 2;
  readonly domainSlug: string;
  readonly assignedTaskIds: readonly string[];
  readonly assignedWriteScopes: readonly string[];
  readonly capacity: number;
  readonly currentLoad: number;
  readonly status: OrchestratorNodeStatus;
}

export interface ScalingThresholds {
  readonly maxTasksPerTier1Orchestrator: number;
  readonly maxTasksPerTier2Coordinator: number;
  readonly scaleOutLoadThreshold: number;
  readonly scaleInLoadThreshold: number;
  readonly maxTier1Limit: number;
  readonly maxTier2Limit: number;
  readonly minTier1Limit: number;
  readonly minTier2Limit: number;
}

export const DEFAULT_SCALING_THRESHOLDS: ScalingThresholds = {
  maxTasksPerTier1Orchestrator: 5,
  maxTasksPerTier2Coordinator: 3,
  scaleOutLoadThreshold: 1.2,
  scaleInLoadThreshold: 0.3,
  maxTier1Limit: 8,
  maxTier2Limit: 16,
  minTier1Limit: 1,
  minTier2Limit: 1,
};

export interface HierarchyCapacityMetrics {
  readonly activeTier1Count: number;
  readonly activeTier2Count: number;
  readonly activeTier3Workers: number;
  readonly totalPendingTasks: number;
  readonly totalInProgressTasks: number;
  readonly tier1LoadRatio: number;
  readonly tier2LoadRatio: number;
  readonly tier3Utilization: number;
  readonly recommendedTier1Count: number;
  readonly recommendedTier2Count: number;
  readonly scalingDirection: HierarchyScalingDirection;
  readonly reasons: readonly string[];
}

export interface HierarchyScalingDecision {
  readonly action: HierarchyScalingDirection;
  readonly newTier1Count: number;
  readonly newTier2Count: number;
  readonly spawnsRecommended: readonly {
    readonly role: "orchestrator" | "coordinator";
    readonly domainSlug: string;
  }[];
  readonly drainsRecommended: readonly string[];
  readonly reason: string;
}

export interface LoadBalancingAssignment {
  readonly orchestratorId: string;
  readonly taskIds: readonly string[];
  readonly writeScopes: readonly string[];
  readonly loadScore: number;
}

export interface LoadBalancingPlan {
  readonly assignments: readonly LoadBalancingAssignment[];
  readonly isBalanced: boolean;
  readonly loadVarianceBefore: number;
  readonly loadVarianceAfter: number;
  readonly scopeCollisionsAvoided: number;
}

export interface SelfEvolutionCadenceState {
  readonly generation: number;
  readonly cycle: number;
  readonly phase: CadencePhase;
  readonly lastCycleAt: string | null;
  readonly consecutiveIdlePulses: number;
  readonly totalTasksSynthesized: number;
  readonly totalTasksCompleted: number;
  readonly quiescenceStreak: number;
  readonly currentIntervalMs: number;
  readonly nextWakeAt: string;
  readonly infiniteCadenceEnforced: true;
}

export interface PerpetualCadenceEvaluation {
  readonly cadence: typeof PERPETUAL_NON_STOPPING_CADENCE;
  readonly mode: SelfEvolutionMode;
  readonly canEvolve: boolean;
  readonly reason: string;
  readonly queueActive: boolean;
  readonly pendingFeedbackCount: number;
  readonly activeTasksCount: number;
  readonly nextWakeAt: string;
  readonly nextIntervalMs: number;
  readonly nextInstruction: string;
  readonly closing_permitted: false;
  readonly hierarchyMetrics?: HierarchyCapacityMetrics | undefined;
}

export interface EvolutionLedgerEntry {
  readonly cycleId: string;
  readonly generation: number;
  readonly cycleNumber: number;
  readonly timestamp: string;
  readonly mode: SelfEvolutionMode;
  readonly discoveriesCount: number;
  readonly taskIds: readonly string[];
  readonly feedbackIds: readonly string[];
  readonly durationMs: number;
  readonly summary: string;
  readonly planRevisionsCount?: number | undefined;
  readonly scalingAction?: HierarchyScalingDirection | undefined;
}

export interface EvolutionHistoryStats {
  readonly totalCycles: number;
  readonly totalTasks: number;
  readonly totalFeedbackIngested: number;
  readonly cyclesByMode: Readonly<Record<SelfEvolutionMode, number>>;
}

export interface SelfEvolutionCycleOptions {
  readonly runRoot?: string | undefined;
  readonly actor?: string | undefined;
  readonly generation?: number | undefined;
  readonly cycleNumber?: number | undefined;
  readonly taskQueuePath?: string | undefined;
  readonly feedbackQueuePath?: string | undefined;
  readonly charterPath?: string | undefined;
  readonly historyPath?: string | undefined;
  readonly maxTasksPerCycle?: number | undefined;
  readonly autoEnqueue?: boolean | undefined;
  readonly baseIntervalMs?: number | undefined;
  readonly maxIntervalMs?: number | undefined;
  readonly workspaceRoot?: string | undefined;
  readonly sourceRoots?: readonly string[] | undefined;
  readonly testRoots?: readonly string[] | undefined;
  readonly capsulesDir?: string | undefined;
  readonly now?: string | number | Date | undefined;
  readonly orchestrators?: readonly OrchestratorNodeInfo[] | undefined;
  readonly externalSignals?: readonly PlanRevisionSignal[] | undefined;
}

export interface SelfEvolutionCycleResult {
  readonly cycleId: string;
  readonly generation: number;
  readonly cycleNumber: number;
  readonly timestamp: string;
  readonly mode: SelfEvolutionMode;
  readonly discoveriesCount: number;
  readonly synthesizedTasks: readonly DiscoveredTaskPlan[];
  readonly candidateProposals: readonly CandidateEvolutionProposal[];
  readonly planRevisions: readonly PlanRevisionProposal[];
  readonly enqueuedTasks: readonly TaskQueueItem[];
  readonly admittedFeedbackIds: readonly string[];
  readonly hierarchyMetrics: HierarchyCapacityMetrics;
  readonly scalingDecision: HierarchyScalingDecision;
  readonly cadenceState: SelfEvolutionCadenceState;
  readonly nextRecommendedCommand: string;
  readonly summary: string;
  readonly durationMs: number;
}

export function resolveEvolutionHistoryPath(customPath?: string): string {
  if (customPath && customPath.trim()) {
    return resolve(customPath.trim());
  }
  if (isTestEnvironment()) {
    return join(resolveScratchDir(), "EVOLUTION_HISTORY.jsonl");
  }
  return join(resolveCapsulesDir(), "EVOLUTION_HISTORY.jsonl");
}

export function readEvolutionHistory(customPath?: string): readonly EvolutionLedgerEntry[] {
  const filePath = resolveEvolutionHistoryPath(customPath);
  if (!existsSync(filePath)) {
    return [];
  }

  try {
    const raw = readFileSync(filePath, "utf8");
    const lines = raw
      .split("\n")
      .map((l) => l.trim())
      .filter(Boolean);
    const entries: EvolutionLedgerEntry[] = [];

    for (const line of lines) {
      if (!line) continue;
      try {
        const parsed = JSON.parse(line) as Record<string, unknown>;
        if (typeof parsed["cycleId"] === "string" && typeof parsed["mode"] === "string") {
          entries.push({
            cycleId: String(parsed["cycleId"]),
            generation: typeof parsed["generation"] === "number" ? parsed["generation"] : 1,
            cycleNumber: typeof parsed["cycleNumber"] === "number" ? parsed["cycleNumber"] : 1,
            timestamp:
              typeof parsed["timestamp"] === "string"
                ? parsed["timestamp"]
                : new Date().toISOString(),
            mode: parsed["mode"] as SelfEvolutionMode,
            discoveriesCount:
              typeof parsed["discoveriesCount"] === "number" ? parsed["discoveriesCount"] : 0,
            taskIds: Array.isArray(parsed["taskIds"])
              ? (parsed["taskIds"] as readonly string[])
              : [],
            feedbackIds: Array.isArray(parsed["feedbackIds"])
              ? (parsed["feedbackIds"] as readonly string[])
              : [],
            durationMs: typeof parsed["durationMs"] === "number" ? parsed["durationMs"] : 0,
            summary: typeof parsed["summary"] === "string" ? parsed["summary"] : "",
            planRevisionsCount:
              typeof parsed["planRevisionsCount"] === "number"
                ? parsed["planRevisionsCount"]
                : undefined,
            scalingAction:
              typeof parsed["scalingAction"] === "string"
                ? (parsed["scalingAction"] as HierarchyScalingDirection)
                : undefined,
          });
        }
      } catch {
        // Skip malformed log line
      }
    }

    return entries;
  } catch {
    return [];
  }
}

export function recordEvolutionCycle(entry: EvolutionLedgerEntry, customPath?: string): void {
  const filePath = resolveEvolutionHistoryPath(customPath);
  const dir = dirname(filePath);
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
  }

  const line = JSON.stringify(entry) + "\n";
  const existing = existsSync(filePath) ? readFileSync(filePath, "utf8") : "";
  writeFileSync(filePath, existing + line, "utf8");
}

export function getEvolutionStats(history: readonly EvolutionLedgerEntry[]): EvolutionHistoryStats {
  const cyclesByMode: Record<SelfEvolutionMode, number> = {
    MODE_A_AUTONOMIC_DISCOVERY: 0,
    MODE_B_FEEDBACK_INTAKE: 0,
    MODE_C_INVARIANT_HARDENING: 0,
    QUEUE_ACTIVE: 0,
  };

  let totalTasks = 0;
  let totalFeedback = 0;

  for (const entry of history) {
    if (cyclesByMode[entry.mode] !== undefined) {
      cyclesByMode[entry.mode]++;
    }
    totalTasks += entry.taskIds.length;
    totalFeedback += entry.feedbackIds.length;
  }

  return {
    totalCycles: history.length,
    totalTasks,
    totalFeedbackIngested: totalFeedback,
    cyclesByMode,
  };
}

/**
 * Enforces the perpetual non-stopping cadence invariant for the Mind loop.
 * Guarantees that no agent or process can terminate or close an idle Mind loop.
 */
export function enforcePerpetualNonStoppingCadence(params: {
  readonly actor: string;
  readonly runRoot?: string | undefined;
  readonly isTerminal?: boolean | undefined;
}): {
  readonly cadence: typeof PERPETUAL_NON_STOPPING_CADENCE;
  readonly allowed: boolean;
  readonly nextInstruction: string;
  readonly message: string;
  readonly closing_permitted: false;
} {
  const runArg = params.runRoot ? ` --run ${params.runRoot}` : "";
  const nextInstruction = `bun harness.ts mind:wake${runArg}`;

  return {
    cadence: PERPETUAL_NON_STOPPING_CADENCE,
    allowed: true,
    nextInstruction,
    message: NON_STOPPING_RULE,
    closing_permitted: false,
  };
}

/**
 * Calculates current supervisory hierarchy capacity across Tier 1 Orchestrators and Tier 2 Coordinators.
 */
export function calculateHierarchyCapacity(params: {
  readonly taskQueue?: readonly TaskQueueItem[] | undefined;
  readonly orchestrators?: readonly OrchestratorNodeInfo[] | undefined;
  readonly activeWorkersCount?: number | undefined;
  readonly maxWorkersCapacity?: number | undefined;
  readonly thresholds?: Partial<ScalingThresholds> | undefined;
}): HierarchyCapacityMetrics {
  const thresholds: ScalingThresholds = {
    ...DEFAULT_SCALING_THRESHOLDS,
    ...(params.thresholds ?? {}),
  };

  const tasks = params.taskQueue ?? [];
  const pendingTasks = tasks.filter(
    (t) => t.status === "PENDING" || t.status === "ADMITTED",
  ).length;
  const inProgressTasks = tasks.filter(
    (t) => t.status === "IN_PROGRESS" || t.status === "RUNNING",
  ).length;
  const totalActiveTasks = pendingTasks + inProgressTasks;

  const orchestratorList = params.orchestrators ?? [];
  const tier1Orchestrators = orchestratorList.filter(
    (o) => o.tier === 1 && o.status !== "DRAINING",
  );
  const tier2Coordinators = orchestratorList.filter((o) => o.tier === 2 && o.status !== "DRAINING");

  const activeTier1Count = Math.max(tier1Orchestrators.length, 1);
  const activeTier2Count = Math.max(tier2Coordinators.length, 1);
  const activeTier3Workers = params.activeWorkersCount ?? inProgressTasks;
  const maxTier3 = params.maxWorkersCapacity ?? 10;

  const tier1LoadRatio = Number((totalActiveTasks / activeTier1Count).toFixed(2));
  const tier2LoadRatio = Number((totalActiveTasks / activeTier2Count).toFixed(2));
  const tier3Utilization = Number((activeTier3Workers / Math.max(maxTier3, 1)).toFixed(2));

  const recommendedTier1Count = Math.min(
    thresholds.maxTier1Limit,
    Math.max(
      thresholds.minTier1Limit,
      Math.ceil(totalActiveTasks / thresholds.maxTasksPerTier1Orchestrator),
    ),
  );

  const recommendedTier2Count = Math.min(
    thresholds.maxTier2Limit,
    Math.max(
      thresholds.minTier2Limit,
      Math.ceil(totalActiveTasks / thresholds.maxTasksPerTier2Coordinator),
    ),
  );

  const reasons: string[] = [];
  let scalingDirection: HierarchyScalingDirection = "STEADY";

  if (
    tier1LoadRatio > thresholds.scaleOutLoadThreshold ||
    recommendedTier1Count > activeTier1Count
  ) {
    scalingDirection = "SCALE_OUT";
    reasons.push(
      `Tier 1 orchestrator load ratio (${tier1LoadRatio}) exceeds scale-out threshold (${thresholds.scaleOutLoadThreshold}); recommend scaling to ${recommendedTier1Count} orchestrator(s)`,
    );
  } else if (totalActiveTasks === 0 && activeTier1Count > thresholds.minTier1Limit) {
    scalingDirection = "SCALE_IN";
    reasons.push(
      `Queue is quiescent with ${activeTier1Count} active orchestrator(s); recommend scaling in to baseline ${thresholds.minTier1Limit}`,
    );
  } else if (
    tier1LoadRatio < thresholds.scaleInLoadThreshold &&
    activeTier1Count > thresholds.minTier1Limit &&
    recommendedTier1Count < activeTier1Count
  ) {
    scalingDirection = "SCALE_IN";
    reasons.push(
      `Tier 1 orchestrator load ratio (${tier1LoadRatio}) is below scale-in threshold (${thresholds.scaleInLoadThreshold}); recommend scaling down to ${recommendedTier1Count} orchestrator(s)`,
    );
  } else {
    // Check load variance across active nodes
    if (orchestratorList.length > 1) {
      const loads = orchestratorList.map((o) => o.currentLoad);
      const minLoad = Math.min(...loads);
      const maxLoad = Math.max(...loads);
      if (maxLoad - minLoad >= 3) {
        scalingDirection = "REBALANCE";
        reasons.push(
          `Load imbalance detected (min: ${minLoad}, max: ${maxLoad}); rebalancing recommended`,
        );
      } else {
        reasons.push(
          `Hierarchy capacity steady (${activeTier1Count} T1, ${activeTier2Count} T2; load ratio ${tier1LoadRatio})`,
        );
      }
    } else {
      reasons.push(
        `Hierarchy capacity steady (${activeTier1Count} T1, ${activeTier2Count} T2; load ratio ${tier1LoadRatio})`,
      );
    }
  }

  return {
    activeTier1Count,
    activeTier2Count,
    activeTier3Workers,
    totalPendingTasks: pendingTasks,
    totalInProgressTasks: inProgressTasks,
    tier1LoadRatio,
    tier2LoadRatio,
    tier3Utilization,
    recommendedTier1Count,
    recommendedTier2Count,
    scalingDirection,
    reasons,
  };
}

/**
 * Evaluates hierarchy scaling metrics and generates concrete spawn or drain directives.
 */
export function evaluateHierarchyScaling(
  metrics: HierarchyCapacityMetrics,
  customThresholds?: Partial<ScalingThresholds>,
): HierarchyScalingDecision {
  const thresholds: ScalingThresholds = {
    ...DEFAULT_SCALING_THRESHOLDS,
    ...(customThresholds ?? {}),
  };

  const spawns: { readonly role: "orchestrator" | "coordinator"; readonly domainSlug: string }[] =
    [];
  const drains: string[] = [];

  if (metrics.scalingDirection === "SCALE_OUT") {
    const neededTier1 = Math.max(0, metrics.recommendedTier1Count - metrics.activeTier1Count);
    for (let i = 0; i < neededTier1; i++) {
      spawns.push({
        role: "orchestrator",
        domainSlug: `orchestrator_scaled-t1-${Date.now().toString().slice(-4)}-${i + 1}`,
      });
    }

    const neededTier2 = Math.max(0, metrics.recommendedTier2Count - metrics.activeTier2Count);
    for (let i = 0; i < neededTier2; i++) {
      spawns.push({
        role: "coordinator",
        domainSlug: `coordinator_scaled-t2-${Date.now().toString().slice(-4)}-${i + 1}`,
      });
    }

    return {
      action: "SCALE_OUT",
      newTier1Count: metrics.recommendedTier1Count,
      newTier2Count: metrics.recommendedTier2Count,
      spawnsRecommended: spawns,
      drainsRecommended: [],
      reason: metrics.reasons.join("; "),
    };
  }

  if (metrics.scalingDirection === "SCALE_IN") {
    return {
      action: "SCALE_IN",
      newTier1Count: metrics.recommendedTier1Count,
      newTier2Count: metrics.recommendedTier2Count,
      spawnsRecommended: [],
      drainsRecommended: drains,
      reason: metrics.reasons.join("; "),
    };
  }

  return {
    action: metrics.scalingDirection,
    newTier1Count: metrics.activeTier1Count,
    newTier2Count: metrics.activeTier2Count,
    spawnsRecommended: [],
    drainsRecommended: [],
    reason: metrics.reasons.join("; "),
  };
}

/**
 * Distributes tasks across orchestrator nodes, ensuring disjoint write scopes and balanced workload.
 */
export function balanceOrchestratorLoad(
  orchestrators: readonly OrchestratorNodeInfo[],
  tasks: readonly {
    readonly id: string;
    readonly write_scope: readonly string[];
    readonly weight?: number | undefined;
  }[],
  options: { readonly maxTasksPerOrchestrator?: number | undefined } = {},
): LoadBalancingPlan {
  if (orchestrators.length === 0) {
    return {
      assignments: [],
      isBalanced: true,
      loadVarianceBefore: 0,
      loadVarianceAfter: 0,
      scopeCollisionsAvoided: 0,
    };
  }

  const maxCap = options.maxTasksPerOrchestrator ?? 5;
  const assignmentsMap = new Map<string, { taskIds: string[]; writeScopes: string[] }>();
  for (const orch of orchestrators) {
    assignmentsMap.set(orch.id, {
      taskIds: [...orch.assignedTaskIds],
      writeScopes: [...orch.assignedWriteScopes],
    });
  }

  let scopeCollisionsAvoided = 0;

  // Calculate variance before
  const loadsBefore = Array.from(assignmentsMap.values()).map((a) => a.taskIds.length);
  const meanBefore = loadsBefore.reduce((a, b) => a + b, 0) / loadsBefore.length;
  const varianceBefore =
    loadsBefore.reduce((acc, l) => acc + Math.pow(l - meanBefore, 2), 0) / loadsBefore.length;

  // Assign unassigned tasks or balance overloaded nodes
  for (const task of tasks) {
    const currentlyAssignedOrchId = Array.from(assignmentsMap.entries()).find(([, val]) =>
      val.taskIds.includes(task.id),
    )?.[0];

    if (!currentlyAssignedOrchId) {
      // Find orchestrator with matching write scope first, or lowest load
      let bestOrchId = orchestrators[0]!.id;
      let lowestLoad = Infinity;

      for (const orch of orchestrators) {
        const entry = assignmentsMap.get(orch.id)!;
        const currentCount = entry.taskIds.length;
        const hasMatchingScope = task.write_scope.some((s) => entry.writeScopes.includes(s));

        if (hasMatchingScope && currentCount < maxCap) {
          bestOrchId = orch.id;
          scopeCollisionsAvoided++;
          break;
        }

        if (currentCount < lowestLoad) {
          lowestLoad = currentCount;
          bestOrchId = orch.id;
        }
      }

      const targetEntry = assignmentsMap.get(bestOrchId)!;
      targetEntry.taskIds.push(task.id);
      for (const s of task.write_scope) {
        if (!targetEntry.writeScopes.includes(s)) {
          targetEntry.writeScopes.push(s);
        }
      }
    }
  }

  // Calculate variance after
  const loadsAfter = Array.from(assignmentsMap.values()).map((a) => a.taskIds.length);
  const meanAfter = loadsAfter.reduce((a, b) => a + b, 0) / loadsAfter.length;
  const varianceAfter =
    loadsAfter.reduce((acc, l) => acc + Math.pow(l - meanAfter, 2), 0) / loadsAfter.length;

  const assignments: LoadBalancingAssignment[] = Array.from(assignmentsMap.entries()).map(
    ([orchId, data]) => ({
      orchestratorId: orchId,
      taskIds: data.taskIds,
      writeScopes: data.writeScopes,
      loadScore: data.taskIds.length,
    }),
  );

  return {
    assignments,
    isBalanced: varianceAfter <= 1.0,
    loadVarianceBefore: Number(varianceBefore.toFixed(2)),
    loadVarianceAfter: Number(varianceAfter.toFixed(2)),
    scopeCollisionsAvoided,
  };
}

/**
 * Synthesizes dynamic plan revisions from cognitive discoveries and active queue state.
 */
export function synthesizeDynamicPlanRevisions(params: {
  readonly discoveries?:
    | readonly {
        readonly category?: string;
        readonly severity?: string;
        readonly description?: string;
        readonly file?: string;
        readonly targetFile?: string;
      }[]
    | undefined;
  readonly signals?: readonly PlanRevisionSignal[] | undefined;
  readonly activePlans?: readonly DiscoveredTaskPlan[] | undefined;
  readonly maxRevisions?: number | undefined;
  readonly actor?: string | undefined;
}): {
  readonly revisions: readonly PlanRevisionProposal[];
  readonly summary: string;
} {
  const signalList: PlanRevisionSignal[] = [...(params.signals ?? [])];

  if (params.discoveries) {
    for (const disc of params.discoveries) {
      let sigType: PlanRevisionSignalType = "QUIESCENCE_EVOLUTION";
      if (disc.category === "TEST_COVERAGE" || disc.category === "test_coverage") {
        sigType = "TEST_REGRESSION";
      } else if (disc.category === "COGNITIVE_GAP" || disc.category === "cognitive_gap") {
        sigType = "COGNITIVE_OVERLOAD";
      } else if (disc.category === "DEFECT_REMEDIATION" || disc.category === "defect_remediation") {
        sigType = "DEFECT_SURGE";
      } else if (disc.category === "CODE_QUALITY" || disc.category === "code_quality") {
        sigType = "SCOPE_COLLISION";
      }

      const sev =
        disc.severity === "CRITICAL" ? "CRITICAL" : disc.severity === "HIGH" ? "HIGH" : "MEDIUM";
      const targetScope = disc.file ?? disc.targetFile ?? "olt/scripts/src/mind";

      signalList.push({
        signalType: sigType,
        source: disc.file ?? disc.category ?? "discovery_scan",
        severity: sev,
        evidence: disc.description ?? "Cognitive discovery trigger",
        affectedWriteScopes: [targetScope],
        charterGoalId: "goal-continuous-evolution",
      });
    }
  }

  const revisions = generatePlanRevisionFromSignals(signalList, {
    maxRevisionsPerSignal: 2,
  });

  const summary = `Synthesized ${revisions.length} dynamic plan revision proposal(s) from ${signalList.length} evolutionary signal(s).`;
  return { revisions, summary };
}

/**
 * Evaluates current Mind cadence state to decide whether self-evolution should engage.
 */
export function evaluatePerpetualCadence(params: {
  readonly taskQueuePath?: string | undefined;
  readonly feedbackQueuePath?: string | undefined;
  readonly state?: Partial<SelfEvolutionCadenceState> | undefined;
  readonly baseIntervalMs?: number | undefined;
  readonly maxIntervalMs?: number | undefined;
  readonly now?: string | number | Date | undefined;
  readonly runRoot?: string | undefined;
  readonly orchestrators?: readonly OrchestratorNodeInfo[] | undefined;
}): PerpetualCadenceEvaluation {
  const nowMs = params.now !== undefined ? new Date(params.now).getTime() : Date.now();
  const queueItems = readTaskQueue(params.taskQueuePath);
  const activeTasks = queueItems.filter(
    (t) =>
      t.status === "PENDING" ||
      t.status === "ADMITTED" ||
      t.status === "IN_PROGRESS" ||
      t.status === "RUNNING",
  );

  const feedbacks = readFeedbackQueue(params.feedbackQueuePath);
  const pendingFeedbacks = feedbacks.filter((f) => f.status === "PENDING");

  const baseInterval = params.baseIntervalMs ?? DEFAULT_EVOLUTION_BASE_INTERVAL_MS;
  const maxInterval = params.maxIntervalMs ?? DEFAULT_EVOLUTION_MAX_INTERVAL_MS;
  const streak = params.state?.quiescenceStreak ?? 0;

  const rawBackoff = calculateExponentialBackoff(baseInterval, maxInterval, streak);
  const nextIntervalMs = applyIntervalJitter(rawBackoff);
  const nextWakeAt = new Date(nowMs + nextIntervalMs).toISOString();
  const runArg = params.runRoot ? ` --run ${params.runRoot}` : "";

  const hierarchyMetrics = calculateHierarchyCapacity({
    taskQueue: queueItems,
    orchestrators: params.orchestrators,
  });

  if (activeTasks.length > 0) {
    return {
      cadence: PERPETUAL_NON_STOPPING_CADENCE,
      mode: "QUEUE_ACTIVE",
      canEvolve: false,
      reason: `Queue has ${activeTasks.length} active task(s) in progress; proceeding with task execution`,
      queueActive: true,
      pendingFeedbackCount: pendingFeedbacks.length,
      activeTasksCount: activeTasks.length,
      nextWakeAt,
      nextIntervalMs,
      nextInstruction: `bun harness.ts queue:wave${runArg}`,
      closing_permitted: false,
      hierarchyMetrics,
    };
  }

  if (pendingFeedbacks.length > 0) {
    return {
      cadence: PERPETUAL_NON_STOPPING_CADENCE,
      mode: "MODE_B_FEEDBACK_INTAKE",
      canEvolve: true,
      reason: `Found ${pendingFeedbacks.length} pending feedback item(s); initiating Mode B feedback intake`,
      queueActive: false,
      pendingFeedbackCount: pendingFeedbacks.length,
      activeTasksCount: 0,
      nextWakeAt,
      nextIntervalMs,
      nextInstruction: `bun harness.ts mind:self-evolve${runArg}`,
      closing_permitted: false,
      hierarchyMetrics,
    };
  }

  return {
    cadence: PERPETUAL_NON_STOPPING_CADENCE,
    mode: "MODE_A_AUTONOMIC_DISCOVERY",
    canEvolve: true,
    reason: "Task and feedback queues are clear; engaging Mode A autonomic task discovery",
    queueActive: false,
    pendingFeedbackCount: 0,
    activeTasksCount: 0,
    nextWakeAt,
    nextIntervalMs,
    nextInstruction: `bun harness.ts mind:self-evolve${runArg}`,
    closing_permitted: false,
    hierarchyMetrics,
  };
}

/**
 * Formats a concise markdown brief of self-evolution cycle execution.
 */
export function formatSelfEvolutionBrief(result: SelfEvolutionCycleResult): string {
  const lines: string[] = [
    `### Self-Evolution Cycle: ${result.cycleId}`,
    `- **Mode**: \`${result.mode}\``,
    `- **Generation**: ${result.generation} (Cycle ${result.cycleNumber})`,
    `- **Synthesized Tasks**: ${result.synthesizedTasks.length}`,
    `- **Candidate Proposals**: ${result.candidateProposals.length}`,
    `- **Plan Revisions**: ${result.planRevisions.length}`,
    `- **Enqueued Tasks**: ${result.enqueuedTasks.length}`,
    `- **Admitted Feedback**: ${result.admittedFeedbackIds.length}`,
    `- **Hierarchy Scaling**: \`${result.scalingDecision.action}\` (T1: ${result.hierarchyMetrics.activeTier1Count}, T2: ${result.hierarchyMetrics.activeTier2Count})`,
    `- **Duration**: ${result.durationMs}ms`,
    `- **Next Recommended Command**: \`${result.nextRecommendedCommand}\``,
  ];

  if (result.synthesizedTasks.length > 0) {
    lines.push("", "#### Synthesized Tasks:");
    for (const task of result.synthesizedTasks.slice(0, 5)) {
      lines.push(`- **${task.id}**: ${task.label}`);
    }
  }

  return lines.join("\n");
}

/**
 * Executes a full self-evolution cycle in an idle Mind loop.
 */
export function runSelfEvolutionCycle(
  options: SelfEvolutionCycleOptions = {},
): SelfEvolutionCycleResult {
  const startTime = Date.now();
  const nowIso =
    options.now !== undefined ? new Date(options.now).toISOString() : new Date().toISOString();
  const generation = options.generation ?? 1;
  const cycleNumber = options.cycleNumber ?? 1;
  const maxTasks = options.maxTasksPerCycle ?? 5;
  const cycleId = `cycle-gen${generation}-${cycleNumber}-${Date.now().toString().slice(-6)}`;

  // Evaluate cadence
  const evaluation = evaluatePerpetualCadence({
    taskQueuePath: options.taskQueuePath,
    feedbackQueuePath: options.feedbackQueuePath,
    baseIntervalMs: options.baseIntervalMs,
    maxIntervalMs: options.maxIntervalMs,
    now: options.now,
    runRoot: options.runRoot,
    orchestrators: options.orchestrators,
  });

  let mode: SelfEvolutionMode = evaluation.mode;
  let synthesizedTasks: readonly DiscoveredTaskPlan[] = [];
  let candidateProposals: readonly CandidateEvolutionProposal[] = [];
  let enqueuedTasks: readonly TaskQueueItem[] = [];
  const admittedFeedbackIds: string[] = [];
  let discoveriesCount = 0;

  if (mode === "MODE_B_FEEDBACK_INTAKE") {
    const discoveryResult = discoverTasks({
      feedbackQueuePath: options.feedbackQueuePath,
      taskQueuePath: options.taskQueuePath,
      enableCodeQualityScan: false,
      enableTestCoverageScan: false,
      enableCognitiveGapScan: false,
      enableDormantCriteriaScan: false,
      enableFeedbackQueueScan: true,
      enableDefectScan: false,
      maxTasks,
      autoEnqueue: options.autoEnqueue !== false,
      actor: options.actor,
    });

    synthesizedTasks = discoveryResult.synthesizedPlans;
    candidateProposals = discoveryResult.candidateProposals;
    enqueuedTasks = discoveryResult.enqueuedTasks;

    const drained = drainPendingFeedbacks(
      { markAs: "ADMITTED", limit: maxTasks },
      options.feedbackQueuePath,
    );

    for (const fb of drained) {
      admittedFeedbackIds.push(fb.id);
    }
    discoveriesCount = drained.length;
  } else {
    const discoveryResult = discoverTasks({
      workspaceRoot: options.workspaceRoot,
      sourceRoots: options.sourceRoots,
      testRoots: options.testRoots,
      charterPath: options.charterPath,
      feedbackQueuePath: options.feedbackQueuePath,
      taskQueuePath: options.taskQueuePath,
      capsulesDir: options.capsulesDir,
      enableCodeQualityScan: true,
      enableTestCoverageScan: true,
      enableCognitiveGapScan: true,
      enableDormantCriteriaScan: true,
      enableFeedbackQueueScan: false,
      enableDefectScan: true,
      maxTasks,
      autoEnqueue: options.autoEnqueue !== false,
      actor: options.actor,
    });

    synthesizedTasks = discoveryResult.synthesizedPlans;
    candidateProposals = discoveryResult.candidateProposals;
    enqueuedTasks = discoveryResult.enqueuedTasks;
    discoveriesCount = discoveryResult.discoveries.length;
    if (discoveryResult.discoveries.length === 0) {
      mode = "MODE_C_INVARIANT_HARDENING";
    }
  }

  // Synthesize dynamic plan revisions
  const planRevisionSynthesis = synthesizeDynamicPlanRevisions({
    signals: options.externalSignals,
    activePlans: synthesizedTasks,
    actor: options.actor,
  });
  const planRevisions = planRevisionSynthesis.revisions;

  // Calculate hierarchy metrics and scaling decision
  const hierarchyMetrics =
    evaluation.hierarchyMetrics ??
    calculateHierarchyCapacity({
      taskQueue: enqueuedTasks,
      orchestrators: options.orchestrators,
    });

  const scalingDecision = evaluateHierarchyScaling(hierarchyMetrics);

  const durationMs = Date.now() - startTime;
  const runArg = options.runRoot ? ` --run ${options.runRoot}` : "";
  const nextRecommendedCommand =
    enqueuedTasks.length > 0
      ? `bun harness.ts queue:wave${runArg}`
      : `bun harness.ts mind:wake${runArg}`;

  const summary = `Self-Evolution Cycle ${cycleId} (${mode}): synthesized ${synthesizedTasks.length} task(s), proposed ${candidateProposals.length} evolution(s), generated ${planRevisions.length} plan revision(s), scaling action [${scalingDecision.action}], enqueued ${enqueuedTasks.length} into queue in ${durationMs}ms.`;

  // Update cadence state
  const cadenceState: SelfEvolutionCadenceState = {
    generation,
    cycle: cycleNumber,
    phase: enqueuedTasks.length > 0 ? "EVOLVING" : "PERPETUAL_REST",
    lastCycleAt: nowIso,
    consecutiveIdlePulses:
      enqueuedTasks.length === 0 ? (evaluation.activeTasksCount === 0 ? 1 : 0) : 0,
    totalTasksSynthesized: synthesizedTasks.length,
    totalTasksCompleted: 0,
    quiescenceStreak: enqueuedTasks.length === 0 ? 1 : 0,
    currentIntervalMs: evaluation.nextIntervalMs,
    nextWakeAt: evaluation.nextWakeAt,
    infiniteCadenceEnforced: true,
  };

  // Record ledger entry
  const ledgerEntry: EvolutionLedgerEntry = {
    cycleId,
    generation,
    cycleNumber,
    timestamp: nowIso,
    mode,
    discoveriesCount,
    taskIds: synthesizedTasks.map((t) => t.id),
    feedbackIds: admittedFeedbackIds,
    durationMs,
    summary,
    planRevisionsCount: planRevisions.length,
    scalingAction: scalingDecision.action,
  };

  recordEvolutionCycle(ledgerEntry, options.historyPath);

  return {
    cycleId,
    generation,
    cycleNumber,
    timestamp: nowIso,
    mode,
    discoveriesCount,
    synthesizedTasks,
    candidateProposals,
    planRevisions,
    enqueuedTasks,
    admittedFeedbackIds,
    hierarchyMetrics,
    scalingDecision,
    cadenceState,
    nextRecommendedCommand,
    summary,
    durationMs,
  };
}

export const executeSelfEvolutionStep = runSelfEvolutionCycle;
