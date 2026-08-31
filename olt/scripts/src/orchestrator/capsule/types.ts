import type { JsonValue } from "../../core/contracts/index.ts";
import type { BehavioralForensicsReport, CompanionPairingResult } from "../types.ts";

export type { BehavioralForensicsReport, CompanionPairingResult };

export type CapsuleExecutionStatus =
  | "pending"
  | "ready"
  | "running"
  | "converged"
  | "failed"
  | "blocked"
  | "cancelled";

export type AntiSequentialityViolationType =
  | "ARTIFICIAL_SEQUENTIAL_BOTTLENECK"
  | "UNJUSTIFIED_DEPENDENCY"
  | "SCOPE_COLLISION_WITHOUT_WORKTREE_ISOLATION"
  | "CAPACITY_STARVATION_NEGLECT"
  | "BATCHED_MONOLITH_VIOLATION";

export interface AntiSequentialityViolation {
  readonly type: AntiSequentialityViolationType;
  readonly capsuleIds: readonly string[];
  readonly message: string;
  readonly remedy: string;
}

export interface AntiSequentialityReport {
  readonly compliant: boolean;
  readonly violations: readonly AntiSequentialityViolation[];
  readonly parallelismRatio: number;
  readonly concurrencyFactor: number;
  readonly independentLanesCount: number;
  readonly criticalPathLength: number;
  readonly totalCapsules: number;
  readonly diagnostics: readonly string[];
}

export interface CapsuleSpec {
  readonly id: string;
  readonly repoPath: string;
  readonly capsulePath?: string | undefined;
  readonly writeScope: readonly string[];
  readonly dependencies?: readonly string[] | undefined;
  readonly priority?: number | undefined;
  readonly prompt?: string | undefined;
  readonly worktreePath?: string | undefined;
  readonly metadata?: Readonly<Record<string, JsonValue>> | undefined;
}

export interface CapsuleExecutionResult {
  readonly capsuleId: string;
  readonly status: CapsuleExecutionStatus;
  readonly startedAt: string;
  readonly completedAt: string;
  readonly durationMs: number;
  readonly gatePassed?: boolean | undefined;
  readonly findingsCount?: number | undefined;
  readonly summary?: string | undefined;
  readonly error?: string | undefined;
}

export interface CapsuleExecutionInput {
  readonly spec: CapsuleSpec;
  readonly signal?: AbortSignal | undefined;
}

export interface CapsuleExecutor {
  executeCapsule(input: CapsuleExecutionInput): Promise<CapsuleExecutionResult>;
}

export interface MultiCapsuleSummary {
  readonly totalCapsules: number;
  readonly convergedCount: number;
  readonly failedCount: number;
  readonly blockedCount: number;
  readonly cancelledCount: number;
  readonly overallStatus: "converged" | "failed" | "partial" | "cancelled";
  readonly startedAt: string;
  readonly completedAt: string;
  readonly durationMs: number;
  readonly concurrencyLimit: number;
  readonly independentWavesCount: number;
  readonly results: Readonly<Record<string, CapsuleExecutionResult>>;
  readonly antiSequentialityReport: AntiSequentialityReport;
  markdownSummary: string;
  readonly companionPairing?: CompanionPairingResult | undefined;
  readonly behavioralForensicsSummary?: BehavioralForensicsReport | undefined;
}

export interface CapsuleStateChangeEvent {
  readonly capsuleId: string;
  readonly previousStatus: CapsuleExecutionStatus;
  readonly newStatus: CapsuleExecutionStatus;
  readonly timestamp: string;
  readonly reason?: string | undefined;
  readonly error?: string | undefined;
}

export interface MultiCapsuleOrchestratorOptions {
  readonly maxParallelCapsules?: number | undefined;
  readonly strictAntiSequentiality?: boolean | undefined;
  readonly allowScopeOverlapInIsolatedWorktrees?: boolean | undefined;
  readonly outputDir?: string | undefined;
  readonly actor?: string | undefined;
  readonly executor?: CapsuleExecutor | undefined;
  readonly onCapsuleStateChange?: ((event: CapsuleStateChangeEvent) => void) | undefined;
  readonly onAntiSequentialityViolation?:
    | ((violation: AntiSequentialityViolation) => void)
    | undefined;
  readonly onBehavioralForensics?: ((report: BehavioralForensicsReport) => void) | undefined;
  readonly skillAuditorCompanion?: boolean | undefined;
  readonly strictAuditorPolicy?: boolean | undefined;
}
