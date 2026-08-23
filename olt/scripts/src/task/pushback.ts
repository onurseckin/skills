import { MAX_REPAIR_ROUNDS } from "../core/config/constants.ts";
import type { JsonObject } from "../core/contracts/json.ts";
import {
  isCoordinatorPushbackCause,
  isValidatorDomain,
  type CoordinatorPushback,
  type CoordinatorPushbackCause,
  type ValidatorDomain,
} from "../core/contracts/workflow.ts";
import { HarnessError } from "../core/errors/harness-error.ts";
import {
  assertNoUnfulfilledDemands,
  evaluateUnfulfilledDemands,
  type UnfulfilledDemandEvaluationOptions,
} from "../platform/unfulfilled-demand.ts";
import type { UnfulfilledDemandPushbackReport } from "../platform/types.ts";
import {
  recordCoordinatorPushback,
  type CoordinatorPushbackInput,
} from "../workflow/review/coordinator-pushback.ts";
import {
  systemClock,
  type Clock,
  type TransactionPort,
  type WorkflowState,
} from "../workflow/types.ts";
import {
  auditTaskVerificationEvidence,
  appendPushbackRound,
  createPushbackHistory,
  detectDomainBatching,
  evaluateCounterfactualEvidence,
  evaluateRepairProgression,
  generateCorrectiveGuidance,
  isRepairExhausted,
  rejectSuperficialClaims,
  validateReviewPushbackCriteria,
  validateReviewPushbackInput,
  type CounterfactualEvidenceEvaluation,
  type CounterfactualEvidenceItem,
  type DomainBatchingDetectionResult,
  type PushbackHistory,
  type PushbackRoundRecord,
  type RepairProgressionEvaluation,
  type ScepticismAuditOptions,
  type ScepticismViolation,
  type ScepticismViolationType,
  type SuperficialityDetectionResult,
  type TaskVerificationAuditResult,
  type TaskVerificationCheckInput,
  type TaskVerificationEvidenceInput,
  type TaskVerificationEvidenceItem,
  type ValidatedReviewPushback,
} from "../authority/review-pushback.ts";

export type { CoordinatorPushbackInput } from "../workflow/review/coordinator-pushback.ts";
export type { CoordinatorPushback, CoordinatorPushbackCause, ValidatorDomain };
export type {
  CounterfactualEvidenceEvaluation,
  CounterfactualEvidenceItem,
  DomainBatchingDetectionResult,
  PushbackHistory,
  PushbackRoundRecord,
  RepairProgressionEvaluation,
  ScepticismAuditOptions,
  ScepticismViolation,
  ScepticismViolationType,
  SuperficialityDetectionResult,
  TaskVerificationAuditResult,
  TaskVerificationCheckInput,
  TaskVerificationEvidenceInput,
  TaskVerificationEvidenceItem,
  ValidatedReviewPushback,
};
export {
  auditTaskVerificationEvidence,
  appendPushbackRound,
  createPushbackHistory,
  detectDomainBatching,
  evaluateCounterfactualEvidence,
  evaluateRepairProgression,
  generateCorrectiveGuidance,
  isRepairExhausted,
  rejectSuperficialClaims,
  validateReviewPushbackCriteria,
  validateReviewPushbackInput,
};

export interface PushbackContestOptions {
  readonly taskId: string;
  readonly coordinatorId: string;
  readonly validatorId: string;
  readonly domain: ValidatorDomain;
  readonly cause: CoordinatorPushbackCause;
  readonly observation: string;
  readonly remediation: string;
  readonly clock?: Clock | undefined;
  readonly maxRepairRounds?: number | undefined;
  readonly guidance?: readonly string[] | undefined;
  readonly rejectionReasons?: readonly string[] | undefined;
}

export interface PushbackExecutionResult {
  readonly taskId: string;
  readonly status: string;
  readonly cause: CoordinatorPushbackCause;
  readonly pushbackRecord: CoordinatorPushback;
  readonly repairAssignee?: string | undefined;
  readonly repairRound: number;
  readonly pushbackHistory?: PushbackHistory | undefined;
  readonly auditResult?: TaskVerificationAuditResult | undefined;
}

export function isProceduralPushback(cause: unknown): cause is "procedural" {
  return cause === "procedural";
}

export function isSubstantivePushback(cause: unknown): cause is "substantive" {
  return cause === "substantive";
}

export function validatePushbackEvidence(
  cause: CoordinatorPushbackCause,
  observation: string,
  remediation: string,
): void {
  if (!isCoordinatorPushbackCause(cause)) {
    throw new HarnessError(
      "INVALID_ARGUMENT",
      `Invalid pushback cause '${String(cause)}'. Must be 'procedural' or 'substantive'.`,
    );
  }
  if (!observation || typeof observation !== "string" || observation.trim().length === 0) {
    throw new HarnessError(
      "INVALID_ARGUMENT",
      "Coordinator pushback requires a non-empty observation explaining the rationale.",
    );
  }
  if (!remediation || typeof remediation !== "string" || remediation.trim().length === 0) {
    throw new HarnessError(
      "INVALID_ARGUMENT",
      "Coordinator pushback requires a non-empty remediation plan.",
    );
  }
}

export function executeCoordinatorPushback(
  port: TransactionPort,
  taskId: string,
  coordinatorId: string,
  input:
    | CoordinatorPushbackInput
    | {
        validatorId?: string | undefined;
        validator_id?: string | undefined;
        domain: ValidatorDomain;
        cause: CoordinatorPushbackCause;
        observation: string;
        remediation: string;
        guidance?: readonly string[] | undefined;
        rejection_reasons?: readonly string[] | undefined;
      },
  clock: Clock = systemClock,
  maxRepairRounds: number = MAX_REPAIR_ROUNDS,
): WorkflowState {
  validatePushbackEvidence(input.cause, input.observation, input.remediation);

  const rawValidatorId =
    "validatorId" in input && typeof input.validatorId === "string"
      ? input.validatorId
      : "validator_id" in input && typeof input.validator_id === "string"
        ? input.validator_id
        : "";

  const payload = {
    validator_id: rawValidatorId,
    domain: input.domain,
    cause: input.cause,
    observation: input.observation,
    remediation: input.remediation,
  };

  return recordCoordinatorPushback(port, taskId, coordinatorId, payload, clock, maxRepairRounds);
}

export function contestValidatorVerdict(
  port: TransactionPort,
  options: PushbackContestOptions,
): WorkflowState {
  const {
    taskId,
    coordinatorId,
    validatorId,
    domain,
    cause,
    observation,
    remediation,
    clock = systemClock,
    maxRepairRounds = MAX_REPAIR_ROUNDS,
    guidance,
    rejectionReasons,
  } = options;

  if (!isValidatorDomain(domain)) {
    throw new HarnessError("INVALID_ARGUMENT", `Invalid validator domain '${String(domain)}'`);
  }

  return executeCoordinatorPushback(
    port,
    taskId,
    coordinatorId,
    {
      validatorId,
      domain,
      cause,
      observation,
      remediation,
      ...(guidance !== undefined ? { guidance } : {}),
      ...(rejectionReasons !== undefined ? { rejection_reasons: rejectionReasons } : {}),
    },
    clock,
    maxRepairRounds,
  );
}

export function evaluatePushbackReport(
  state: JsonObject,
  options?: UnfulfilledDemandEvaluationOptions | undefined,
): UnfulfilledDemandPushbackReport {
  return evaluateUnfulfilledDemands(state, options);
}

export function assertPushbackSafety(
  state: JsonObject,
  options?: UnfulfilledDemandEvaluationOptions | undefined,
): void {
  assertNoUnfulfilledDemands(state, options);
}
