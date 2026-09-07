import { JsonObject } from "../../../core/contracts/index.ts";
import { jsonDigest } from "../provenance/index.ts";
import type { TaskRecord, ValidationAttempt } from "../../index.ts";

export interface ValidatorReceipt extends JsonObject {
  actor: string;
  role: "implementer" | "cognitive_validator";
  receipt_sha256: string;
  timestamp: string;
}

export interface TwoKeyValidatorPairing extends JsonObject {
  implementer_receipt: ValidatorReceipt;
  cognitive_validator_receipt: ValidatorReceipt;
}

export function verifyTwoKeyValidatorPairing(pairing: TwoKeyValidatorPairing): {
  valid: boolean;
  reason?: string;
} {
  const imp = pairing.implementer_receipt;
  const cog = pairing.cognitive_validator_receipt;

  if (!imp || imp.role !== "implementer" || !imp.receipt_sha256) {
    return { valid: false, reason: "Missing or invalid Implementer test receipt." };
  }

  if (!cog || cog.role !== "cognitive_validator" || !cog.receipt_sha256) {
    return { valid: false, reason: "Missing or invalid Cognitive Validator audit receipt." };
  }

  if (imp.actor === cog.actor) {
    return {
      valid: false,
      reason: "Implementer and Cognitive Validator must be independent actors.",
    };
  }

  return { valid: true };
}

function passingValidation(task: TaskRecord): ValidationAttempt | undefined {
  return [...(task.validations ?? []), ...(task.validation_history ?? [])].find(
    (entry) => entry.verdict === "pass",
  );
}

function implementerReceipt(task: TaskRecord): ValidatorReceipt | undefined {
  if (!task.original_implementer || !task.report) return undefined;
  const attempt = [...task.attempts]
    .reverse()
    .find((candidate) => candidate.agent_id === task.original_implementer);
  const timestamp = attempt && typeof attempt.submitted_at === "string" ? attempt.submitted_at : "";
  return {
    actor: task.original_implementer,
    role: "implementer",
    receipt_sha256: jsonDigest(task.report),
    timestamp,
  };
}

function cognitiveValidatorReceipt(entry: ValidationAttempt): ValidatorReceipt {
  return {
    actor: entry.validator_id,
    role: "cognitive_validator",
    receipt_sha256: jsonDigest({
      verdict: entry.verdict ?? null,
      checks: entry.checks ?? [],
      reviewed_requirement_ids: entry.reviewed_requirement_ids ?? [],
    }),
    timestamp: entry.started_at,
  };
}

export function deriveTaskTwoKeyPairing(task: TaskRecord): TwoKeyValidatorPairing | undefined {
  const imp = implementerReceipt(task);
  const validation = passingValidation(task);
  if (!imp || !validation) return undefined;
  return {
    implementer_receipt: imp,
    cognitive_validator_receipt: cognitiveValidatorReceipt(validation),
  };
}

export function taskTwoKeyValidatorPairingIssues(task: TaskRecord): string[] {
  const imp = implementerReceipt(task);
  if (!imp) {
    return [`task ${task.id} lacks an independent Implementer test receipt`];
  }
  const validation = passingValidation(task);
  if (!validation) {
    return [`task ${task.id} lacks an independent Cognitive Validator audit receipt`];
  }
  const result = verifyTwoKeyValidatorPairing({
    implementer_receipt: imp,
    cognitive_validator_receipt: cognitiveValidatorReceipt(validation),
  });
  return result.valid
    ? []
    : [`task ${task.id} two-key validator pairing invalid: ${result.reason}`];
}
