import { MAX_REPAIR_ROUNDS } from "../../core/config/contracts.ts";
import {
  isCoordinatorPushbackCause,
  isValidatorDomain,
} from "../../core/contracts/index.ts";
import { HarnessError } from "../../core/errors/index.ts";
import type { ValidatedReviewPushback } from "./types.ts";

export function validateReviewPushbackInput(value: unknown): ValidatedReviewPushback {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new HarnessError("INVALID_ARGUMENT", "coordinator pushback must be an object");
  }

  const raw = value as Record<string, unknown>;

  const rawValidatorId =
    "validator_id" in raw && typeof raw.validator_id === "string"
      ? raw.validator_id
      : "validatorId" in raw && typeof raw.validatorId === "string"
        ? raw.validatorId
        : "";

  if (rawValidatorId.trim().length === 0) {
    throw new HarnessError("INVALID_ARGUMENT", "validator_id is required for review pushback");
  }

  const rawDomain = typeof raw.domain === "string" ? raw.domain : "";
  if (!isValidatorDomain(rawDomain)) {
    throw new HarnessError(
      "INVALID_ARGUMENT",
      `domain must be a recognized validator domain, got: ${JSON.stringify(raw.domain)}`,
    );
  }

  const rawCause = raw.cause;
  if (!isCoordinatorPushbackCause(rawCause)) {
    throw new HarnessError(
      "INVALID_ARGUMENT",
      "cause must be 'procedural' (the review was not properly evidenced) or 'substantive' (the work itself is wrong)",
    );
  }

  const observation = typeof raw.observation === "string" ? raw.observation.trim() : "";
  if (observation.length === 0) {
    throw new HarnessError(
      "INVALID_ARGUMENT",
      "Coordinator pushback requires a non-empty observation explaining the rationale.",
    );
  }

  const remediation = typeof raw.remediation === "string" ? raw.remediation.trim() : "";
  if (remediation.length === 0) {
    throw new HarnessError(
      "INVALID_ARGUMENT",
      "Coordinator pushback requires a non-empty remediation plan.",
    );
  }

  const guidance: string[] = [];
  if (Array.isArray(raw.guidance)) {
    for (const g of raw.guidance) {
      if (typeof g === "string" && g.trim().length > 0) {
        guidance.push(g.trim());
      }
    }
  }

  const rejectionReasons: string[] = [];
  if (Array.isArray(raw.rejection_reasons)) {
    for (const r of raw.rejection_reasons) {
      if (typeof r === "string" && r.trim().length > 0) {
        rejectionReasons.push(r.trim());
      }
    }
  }

  const maxRepairRounds =
    typeof raw.max_repair_rounds === "number" && raw.max_repair_rounds > 0
      ? raw.max_repair_rounds
      : typeof raw.maxRepairRounds === "number" && raw.maxRepairRounds > 0
        ? raw.maxRepairRounds
        : MAX_REPAIR_ROUNDS;

  return {
    validatorId: rawValidatorId,
    domain: rawDomain,
    cause: rawCause,
    observation,
    remediation,
    guidance,
    rejectionReasons,
    maxRepairRounds,
  };
}

export function validateReviewPushbackCriteria(
  taskId: string,
  coordinatorId: string,
  input: unknown,
): void {
  if (!taskId || typeof taskId !== "string" || taskId.trim().length === 0) {
    throw new HarnessError("INVALID_ARGUMENT", "taskId is required for review pushback");
  }
  if (!coordinatorId || typeof coordinatorId !== "string" || coordinatorId.trim().length === 0) {
    throw new HarnessError("INVALID_ARGUMENT", "coordinatorId is required for review pushback");
  }
  validateReviewPushbackInput(input);
}
