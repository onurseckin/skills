export const CHARTER_AUDIT_PASSED = "CHARTER_AUDIT_PASSED" as const;
export const CHARTER_UNRESOLVED_GOALS = "CHARTER_UNRESOLVED_GOALS" as const;
export const CHARTER_BUDGET_EXCEEDED = "CHARTER_BUDGET_EXCEEDED" as const;
export const CHARTER_INTEGRITY_DRIFT = "CHARTER_INTEGRITY_DRIFT" as const;
export const CHARTER_SCOPE_VIOLATION = "CHARTER_SCOPE_VIOLATION" as const;
export const CHARTER_PROHIBITION_VIOLATION = "CHARTER_PROHIBITION_VIOLATION" as const;
export const DEFECT_MIND_AUDITING_MISSING_STATE_CHARTER =
  "defect-mind-auditing-missing-state-charter" as const;

export const CANONICAL_CHARTER_GOAL_IDS = Object.freeze(["G1", "G2", "G3"] as const);
export const STANDARD_CHARTER_GOALS = CANONICAL_CHARTER_GOAL_IDS;

export interface CharterAuditOptions {
  readonly repoRoot?: string | undefined;
  readonly customCharterPath?: string | undefined;
  readonly pinnedSha256?: string | undefined;
  readonly enforceBudgets?: boolean | undefined;
  readonly referencedGoals?: readonly string[] | undefined;
  readonly requiredGoals?: readonly string[] | undefined;
  readonly checkStandardGoals?: boolean | undefined;
  readonly touchedPaths?: readonly string[] | undefined;
  readonly budgetUsage?: CharterBudgetUsageMetrics | undefined;
  readonly hasOwnerAuthorization?: boolean | undefined;
}

export interface CharterBudgetUsageMetrics {
  readonly agentsInFlight?: number | undefined;
  readonly roundsSpent?: number | undefined;
  readonly wallClockMsSpent?: number | undefined;
  readonly openProposalsCount?: number | undefined;
}

export interface CharterGoalAuditResult {
  readonly valid: boolean;
  readonly definedGoals: readonly string[];
  readonly referencedGoals: readonly string[];
  readonly unmappedGoals: readonly string[];
  readonly missingRequiredGoals?: readonly string[] | undefined;
  readonly findings: readonly string[];
}

export interface CharterBudgetComplianceResult {
  readonly compliant: boolean;
  readonly violations: readonly string[];
  readonly metrics: CharterBudgetUsageMetrics;
}

export interface CharterIntegrityAuditResult {
  readonly intact: boolean;
  readonly pinnedSha256: string;
  readonly currentSha256: string;
  readonly driftDetected: boolean;
  readonly authorized: boolean;
  readonly findings: readonly string[];
}

export interface CharterRepoRootsAuditResult {
  readonly valid: boolean;
  readonly allowedRoots: readonly string[];
  readonly outOfBoundsPaths: readonly string[];
  readonly findings: readonly string[];
}

export interface CharterProhibitionAuditResult {
  readonly permitted: boolean;
  readonly matchedProhibitions: readonly string[];
  readonly findings: readonly string[];
}

export interface CharterAuditReport {
  readonly valid: boolean;
  readonly charterSha256: string;
  readonly goalAudit: CharterGoalAuditResult;
  readonly integrityAudit: CharterIntegrityAuditResult;
  readonly repoRootsAudit: CharterRepoRootsAuditResult;
  readonly budgetAudit?: CharterBudgetComplianceResult | undefined;
  readonly findings: readonly string[];
  readonly timestamp: string;
}
