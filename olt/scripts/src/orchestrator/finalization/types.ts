import type { RecycleAssessment } from "../../mind/archival/recycler/index.ts";
import type { LoopRunnerOptions, LoopSummary } from "../types.ts";

export type FinalizationStepName =
  | "git_add"
  | "git_status"
  | "git_commit"
  | "git_push"
  | "global_sync";

export type FinalizationStepStatus = "success" | "skipped" | "failed";

export interface FinalizationStepResult {
  readonly step: FinalizationStepName;
  readonly executed: boolean;
  readonly status: FinalizationStepStatus;
  readonly command: string;
  readonly stdout?: string | undefined;
  readonly stderr?: string | undefined;
  readonly exitCode?: number | null | undefined;
  readonly durationMs: number;
  readonly reason?: string | undefined;
}

export interface GitRunnerResult {
  readonly status: number | null;
  readonly stdout: string;
  readonly stderr: string;
}

export type GitRunner = (
  args: readonly string[],
  cwd: string,
) => GitRunnerResult | Promise<GitRunnerResult>;

export type SyncRunner = (
  command: string,
  cwd: string,
) => GitRunnerResult | Promise<GitRunnerResult>;

export interface BackgroundFinalizationOptions {
  readonly repoPath: string;
  readonly runRoot?: string | undefined;
  readonly runId?: string | undefined;
  readonly actor?: string | undefined;
  readonly commitMessage?: string | undefined;
  readonly branch?: string | undefined;
  readonly remote?: string | undefined;
  readonly skipPush?: boolean | undefined;
  readonly skipSync?: boolean | undefined;
  readonly syncCommand?: string | undefined;
  readonly gitRunner?: GitRunner | undefined;
  readonly syncRunner?: SyncRunner | undefined;
  readonly isMainThread?: boolean | undefined;
  readonly executionTier?: number | undefined;
  readonly throwOnError?: boolean | undefined;
  readonly state?: Record<string, unknown> | undefined;
  readonly now?: Date | string | number | undefined;
}

export interface ZeroMainThreadSpilloverVerification {
  readonly compliant: boolean;
  readonly executionTier: number;
  readonly executedInBackground: boolean;
  readonly mainThreadSpillover: boolean;
  readonly gitOperationsEnclosed: boolean;
  readonly globalSyncEnclosed: boolean;
  readonly verifiedAt: string;
  readonly message: string;
}

export interface BackgroundFinalizationResult {
  readonly success: boolean;
  readonly actor: string;
  readonly repoPath: string;
  readonly runId?: string | undefined;
  readonly runRoot?: string | undefined;
  readonly executedAt: string;
  readonly durationMs: number;
  readonly steps: readonly FinalizationStepResult[];
  readonly committed: boolean;
  readonly pushed: boolean;
  readonly synced: boolean;
  readonly commitSha?: string | undefined;
  readonly zeroMainThreadSpillover: boolean;
  readonly spilloverVerification: ZeroMainThreadSpilloverVerification;
  readonly recyclingAssessment?: RecycleAssessment | undefined;
  readonly markdown: string;
  readonly error?: string | undefined;
}

export interface SupervisionLoopRunnerOptions extends LoopRunnerOptions {
  readonly autoFinalizeOnConvergence?: boolean | undefined;
  readonly commitMessageTemplate?: string | undefined;
  readonly branch?: string | undefined;
  readonly remote?: string | undefined;
  readonly skipPush?: boolean | undefined;
  readonly skipSync?: boolean | undefined;
  readonly syncCommand?: string | undefined;
  readonly gitRunner?: GitRunner | undefined;
  readonly syncRunner?: SyncRunner | undefined;
  readonly onFinalizationComplete?: ((result: BackgroundFinalizationResult) => void) | undefined;
}

export interface SupervisionLoopSummary extends LoopSummary {
  readonly finalization?: BackgroundFinalizationResult | undefined;
  readonly recyclingAssessment?: RecycleAssessment | undefined;
  readonly zeroMainThreadSpillover: boolean;
}
