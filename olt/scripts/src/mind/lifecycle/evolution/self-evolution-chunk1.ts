import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";

import { dirname, join, resolve } from "node:path";

import { HarnessError } from "../../../core/errors/index.ts";

import { isTestEnvironment, resolveCapsulesDir, resolveScratchDir } from "../../../core/shared/paths.ts";

import { drainPendingFeedbacks, readFeedbackQueue, type FeedbackItem } from "../../feedback-queue.ts";

import {
  applyIntervalJitter,
  calculateExponentialBackoff,
  DEFAULT_BASE_INTERVAL_MS,
  DEFAULT_MAX_INTERVAL_MS,
} from "../../interval.ts";

import {
  generatePlanRevisionFromSignals,
  type PlanRevisionProposal,
  type PlanRevisionSignal,
  type PlanRevisionSignalType,
} from "../../proposal.ts";

import {
  discoverTasks,
  proposeCandidateEvolutions,
  type CandidateEvolutionProposal,
  type DiscoveredTaskPlan,
  type TaskDiscoveryOptions,
  type TaskDiscoveryResult,
} from "../../task-discovery.ts";

import {
  enqueueTasksBatch,
  getQueueStats,
  readTaskQueue,
  type NewTaskQueueInput,
  type TaskPriority,
  type TaskQueueItem,
  type TaskQueueStats,
} from "../../task-queue.ts";


export const PERPETUAL_NON_STOPPING_CADENCE = "infinite_autonomous" as const;

export const NON_STOPPING_RULE =
  "Autonomous perpetual Mind loops never terminate when idle; self-evolution engine continuously synthesizes improvement tasks" as const;

export const CLOSING_FORBIDDEN_IDLE_MIND =
  "Mind loop cannot be closed or terminated when idle; self-evolution engine must engage" as const;


export const DEFAULT_EVOLUTION_BASE_INTERVAL_MS = 900_000;
 // 15 minutes
export const DEFAULT_EVOLUTION_MAX_INTERVAL_MS = 14_400_000;
 // 4 hours

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
