import type {
  CoordinatorPushbackCause,
  TaskStatus,
  ValidatorDomain,
} from "../../core/contracts/index.ts";

export interface SuperficialityDetectionResult {
  readonly isSuperficial: boolean;
  readonly matchedPatterns: readonly string[];
  readonly reason: string | null;
  readonly confidenceScore: number;
}

export interface DomainBatchingDetectionResult {
  readonly isBatched: boolean;
  readonly reasons: readonly string[];
  readonly domainsEvaluated: readonly ValidatorDomain[];
  readonly violatingDomains: readonly ValidatorDomain[];
}

export interface CounterfactualEvidenceEvaluation {
  readonly isSufficient: boolean;
  readonly hypothesisCount: number;
  readonly falsificationCheckCount: number;
  readonly details: string;
}

export type ScepticismViolationType =
  | "superficial_claim"
  | "domain_batching"
  | "missing_counterfactual_evidence"
  | "unsubstantiated_verdict"
  | "stagnant_repair"
  | "repetition_across_tasks"
  | "empty_rationale";

export interface ScepticismViolation {
  readonly type: ScepticismViolationType;
  readonly message: string;
  readonly domain?: ValidatorDomain | undefined;
  readonly taskId?: string | undefined;
  readonly details?: Readonly<Record<string, string | number | boolean>> | undefined;
}

export interface TaskVerificationCheckInput {
  readonly command?: string | undefined;
  readonly command_id?: string | undefined;
  readonly status?: string | undefined;
  readonly output?: string | undefined;
  readonly exit_code?: number | undefined;
}

export interface TaskVerificationEvidenceItem {
  readonly kind?: string | undefined;
  readonly description?: string | undefined;
  readonly diff?: string | undefined;
  readonly data?: string | undefined;
}

export interface CounterfactualEvidenceItem {
  readonly hypothesis?: string | undefined;
  readonly negativeCheck?: string | undefined;
  readonly falsified?: boolean | undefined;
  readonly observation?: string | undefined;
}

export interface TaskVerificationEvidenceInput {
  readonly taskId: string;
  readonly requirementIds?: readonly string[] | undefined;
  readonly filesChanged?: readonly string[] | undefined;
  readonly summary?: string | undefined;
  readonly checks?: readonly TaskVerificationCheckInput[] | undefined;
  readonly evidence?: readonly TaskVerificationEvidenceItem[] | undefined;
  readonly counterfactualEvidence?: readonly CounterfactualEvidenceItem[] | undefined;
  readonly notes?: string | undefined;
  readonly domainEvidence?: Readonly<Record<string, unknown>> | undefined;
}

export interface ScepticismAuditOptions {
  readonly maxAcceptableSuperficialityScore?: number | undefined;
  readonly requireCounterfactual?: boolean | undefined;
  readonly requiredDomains?: readonly ValidatorDomain[] | undefined;
  readonly previousSummary?: string | undefined;
  readonly previousFilesChanged?: readonly string[] | undefined;
}

export interface TaskVerificationAuditResult {
  readonly valid: boolean;
  readonly scepticismScore: number;
  readonly violations: readonly ScepticismViolation[];
  readonly rejectionReasons: readonly string[];
  readonly superficiality: SuperficialityDetectionResult;
  readonly domainBatching: DomainBatchingDetectionResult;
  readonly counterfactual: CounterfactualEvidenceEvaluation;
  readonly recommendedAction: "accept" | "pushback_procedural" | "pushback_substantive";
  readonly correctiveGuidance: readonly string[];
}

export interface PushbackRoundRecord {
  readonly round: number;
  readonly id: string;
  readonly timestamp: string;
  readonly coordinatorId: string;
  readonly validatorId: string;
  readonly domain: ValidatorDomain;
  readonly cause: CoordinatorPushbackCause;
  readonly observation: string;
  readonly remediation: string;
  readonly rejectionReasons: readonly string[];
  readonly previousEvidenceDigest?: string | undefined;
  readonly previousEvidenceSummary?: string | undefined;
  readonly correctiveGuidance: readonly string[];
  readonly statusAfter: TaskStatus;
}

export interface PushbackHistory {
  readonly taskId: string;
  readonly currentRound: number;
  readonly maxRepairRounds: number;
  readonly rounds: readonly PushbackRoundRecord[];
  readonly isExhausted: boolean;
  readonly lastCause?: CoordinatorPushbackCause | undefined;
  readonly unresolvedRejectionReasons: readonly string[];
}

export interface RepairProgressionEvaluation {
  readonly progressMade: boolean;
  readonly stagnant: boolean;
  readonly addressedReasons: readonly string[];
  readonly unaddressedReasons: readonly string[];
  readonly correctiveGuidance: readonly string[];
  readonly diffSummary?: string | undefined;
}

export interface ValidatedReviewPushback {
  readonly validatorId: string;
  readonly domain: ValidatorDomain;
  readonly cause: CoordinatorPushbackCause;
  readonly observation: string;
  readonly remediation: string;
  readonly guidance: readonly string[];
  readonly rejectionReasons: readonly string[];
  readonly maxRepairRounds: number;
}
