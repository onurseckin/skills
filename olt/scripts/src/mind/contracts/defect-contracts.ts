export type {
  AggregatedDefect,
  DefectCategory,
  DefectContext,
  DefectCuration,
  DefectEntry,
  DefectOccurrence,
  DefectRecordInput,
  DefectResolutionProof,
  DefectSeverity,
  DefectStatus,
  EmpiricalFailureProof,
} from "../../logging/defects/index.ts";

export type DefectType =
  | "CODE_HEALTH"
  | "DOCUMENTATION"
  | "INVARIANT_BREACH"
  | "TEST_FAILURE"
  | "BEHAVIORAL_REGRESSION"
  | "SECURITY_RISK"
  | "MODULARITY_VIOLATION"
  | "TYPE_DRIFT"
  | "SCHEMA_MISMATCH"
  | "RUNTIME_ERROR"
  | "LIFECYCLE_ORDERING"
  | "DOCTOR_FINDING";

export type DefectCurationClass = "FIRST_PARTY" | "FOREIGN_REPO" | "BENIGN_NOISE" | "DEFERRED";

export interface DefectDiscriminatorOptions {
  readonly includeAgent?: boolean | undefined;
  readonly includeCategory?: boolean | undefined;
  readonly customExtractor?:
    | ((entry: import("../../logging/defects/index.ts").DefectEntry) => string)
    | undefined;
}

export interface DefectAggregateMetrics {
  readonly total: number;
  readonly open: number;
  readonly resolved: number;
  readonly completed: number;
  readonly critical: number;
  readonly high: number;
  readonly medium: number;
  readonly low: number;
}

export interface SyncDoctorDefectOptions {
  readonly defectsPath?: string | undefined;
  readonly customPath?: string | undefined;
  readonly runId?: string | undefined;
  readonly commitSha?: string | undefined;
  readonly timestamp?: string | undefined;
  readonly autoReopen?: boolean | undefined;
  readonly failureProof?:
    | import("../../logging/defects/index.ts").EmpiricalFailureProof
    | undefined;
  readonly dryRun?: boolean | undefined;
  readonly requireStrictProof?: boolean | undefined;
}

export interface SyncDefectResult {
  readonly totalFindings: number;
  readonly newlyCreated: number;
  readonly reopened: number;
  readonly existingUpdated: number;
  readonly unchanged: number;
  readonly defects: readonly import("../../logging/defects/index.ts").DefectEntry[];
  readonly pushed_count?: number;
  readonly reopened_count?: number;
  readonly skipped_count?: number;
  readonly total_findings?: number;
  readonly defects_file?: string;
}
