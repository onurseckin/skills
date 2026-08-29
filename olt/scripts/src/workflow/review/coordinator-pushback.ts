import {
  isCoordinatorPushbackCause,
  isValidatorDomain,
  type CoordinatorPushback,
  type CoordinatorPushbackCause,
  type ValidatorDomain,
} from "../../core/contracts/index.ts";
import { MAX_REPAIR_ROUNDS } from "../../core/config/contracts.ts";
import { HarnessError } from "../../core/errors/index.ts";
import { requireText, taskIn, transition, utc } from "../task-state.ts";
import { systemClock, type Clock, type TransactionPort, type WorkflowState } from "../types.ts";
import { archiveOpenValidations } from "./validation-state.ts";

export interface CoordinatorPushbackInput {
  readonly validatorId: string;
  readonly domain: ValidatorDomain;
  readonly cause: CoordinatorPushbackCause;
  readonly observation: string;
  readonly remediation: string;
}

export function validateCoordinatorPushbackInput(value: unknown): CoordinatorPushbackInput {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new HarnessError("INVALID_ARGUMENT", "coordinator pushback must be an object");
  }
  const raw = value as Record<string, unknown>;
  const validatorId = requireText(raw.validator_id, "validator_id");
  const domain = raw.domain;
  if (typeof domain !== "string" || !isValidatorDomain(domain)) {
    throw new HarnessError(
      "INVALID_ARGUMENT",
      `domain must be a recognized validator domain, got: ${JSON.stringify(raw.domain)}`,
    );
  }
  const cause = raw.cause;
  if (!isCoordinatorPushbackCause(cause)) {
    throw new HarnessError(
      "INVALID_ARGUMENT",
      "cause must be 'procedural' (the review was not properly evidenced) or 'substantive' (the work itself is wrong)",
    );
  }
  const observation = requireText(raw.observation, "observation");
  const remediation = requireText(raw.remediation, "remediation");
  return { validatorId, domain, cause, observation, remediation };
}

export function recordCoordinatorPushback(
  port: TransactionPort,
  taskId: string,
  coordinatorId: string,
  input: unknown,
  clock: Clock = systemClock,
  maxRepairRounds: number = MAX_REPAIR_ROUNDS,
): WorkflowState {
  requireText(coordinatorId, "coordinator_id");
  const parsed = validateCoordinatorPushbackInput(input);
  const now = clock.now();
  return port.transact(
    coordinatorId,
    "coordinator-pushback-recorded",
    {
      task_id: taskId,
      validator_id: parsed.validatorId,
      domain: parsed.domain,
      cause: parsed.cause,
    },
    (draft) => {
      const task = taskIn(draft, taskId);
      if (task.status !== "validated") {
        throw new HarnessError(
          "INVALID_STATE",
          `cannot push back on ${taskId}: task status is ${task.status}, not validated; a ` +
            `coordinator can only contest a standing pass that has not yet been finalized`,
        );
      }
      const target = (task.validations ?? []).find(
        (entry) =>
          entry.validator_id === parsed.validatorId &&
          entry.domain === parsed.domain &&
          entry.verdict === "pass",
      );
      if (!target) {
        throw new HarnessError(
          "INVALID_ARGUMENT",
          `no recorded pass from validator ${parsed.validatorId} in domain ${parsed.domain} on ` +
            `${taskId} to push back on`,
        );
      }
      const existing = (task.coordinator_pushbacks as CoordinatorPushback[] | undefined) ?? [];
      const record: CoordinatorPushback = {
        id: `cpb-${taskId}-${existing.length + 1}`,
        validator_id: parsed.validatorId,
        domain: parsed.domain,
        cause: parsed.cause,
        observation: parsed.observation,
        remediation: parsed.remediation,
        review_round: task.repair_round,
        created_at: utc(now),
      };
      task.coordinator_pushbacks = [...existing, record];
      archiveOpenValidations(task);

      if (parsed.cause === "procedural") {
        transition(
          task,
          "validating",
          coordinatorId,
          now,
          `coordinator pushback (procedural): ${parsed.observation}`,
        );
        return;
      }

      if (!task.original_implementer) {
        throw new HarnessError(
          "INVALID_STATE",
          "task has no original implementer to reassign for a substantive coordinator pushback",
        );
      }
      task.repair_round += 1;
      task.repair_assignee = task.original_implementer;
      const exhausted = task.repair_round >= maxRepairRounds;
      transition(
        task,
        exhausted ? "escalated" : "changes_requested",
        coordinatorId,
        now,
        `coordinator pushback (substantive): ${parsed.observation}`,
      );
    },
  );
}
