import { MAX_REPAIR_ROUNDS } from "../config/constants.ts";
import type { JsonObject } from "../contracts/json.ts";
import {
  isCoordinatorPushbackCause,
  isValidatorDomain,
  type CoordinatorPushback,
  type CoordinatorPushbackCause,
  type ValidatorDomain,
} from "../contracts/workflow.ts";
import { HarnessError } from "../errors/harness-error.ts";
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
import { systemClock, type Clock, type TransactionPort, type WorkflowState } from "../workflow/types.ts";

export type { CoordinatorPushbackInput } from "../workflow/review/coordinator-pushback.ts";
export type { CoordinatorPushback, CoordinatorPushbackCause, ValidatorDomain };

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
}

export interface PushbackExecutionResult {
  readonly taskId: string;
  readonly status: string;
  readonly cause: CoordinatorPushbackCause;
  readonly pushbackRecord: CoordinatorPushback;
  readonly repairAssignee?: string | undefined;
  readonly repairRound: number;
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
  input: CoordinatorPushbackInput | { validatorId?: string | undefined; validator_id?: string | undefined; domain: ValidatorDomain; cause: CoordinatorPushbackCause; observation: string; remediation: string },
  clock: Clock = systemClock,
  maxRepairRounds: number = MAX_REPAIR_ROUNDS,
): WorkflowState {
  validatePushbackEvidence(input.cause, input.observation, input.remediation);

  const rawValidatorId = "validatorId" in input && typeof input.validatorId === "string"
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
  } = options;

  if (!isValidatorDomain(domain)) {
    throw new HarnessError(
      "INVALID_ARGUMENT",
      `Invalid validator domain '${String(domain)}'`,
    );
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
