export const DEFAULT_SOFT_DRAIN_THRESHOLD = 15.0;

export interface TaskAdmissionDecision {
  readonly allowed: boolean;
  readonly reason?: string | undefined;
}

export interface SubagentSpawnDecision {
  readonly allowed: boolean;
  readonly reason?: string | undefined;
}

export interface SoftExitExecutionParams {
  readonly runRoot: string;
  readonly repoRoot: string;
  readonly lowestQuota: number;
}

export interface SoftExitExecutionResult {
  readonly handoffPath: string;
  readonly stagedCommitSha?: string | undefined;
  readonly error?: string | undefined;
}

export interface SoftDrainStatus {
  readonly active: boolean;
  readonly threshold: number;
  readonly lowestQuota: number;
  readonly reason?: string | undefined;
}
