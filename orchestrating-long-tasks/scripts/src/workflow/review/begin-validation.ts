import { applicableValidatorDomains, isValidatorDomain, type ValidatorDomain } from "../../contracts/workflow.ts";
import { HarnessError } from "../../errors/harness-error.ts";
import { newLeaseToken, tokenDigest } from "../lease/token.ts";
import { requireText, taskIn, transition, utc } from "../task-state.ts";
import { systemClock, type Clock, type TransactionPort } from "../types.ts";
import { openValidations } from "./validation-state.ts";

const MIN_VALIDATION_WINDOW = 5;
const MAX_VALIDATION_WINDOW = 86_400;
const DEFAULT_VALIDATION_WINDOW = 1_200;

/**
 * B12.2: which domain this validator opens. An explicit `domainInput` must be one the task's write
 * scope actually draws (`applicableValidatorDomains`) — a validator dispatched for a domain the task
 * never touches is a caller mistake, not a legitimate broadening. Omitted, the domain is DERIVED:
 * the first applicable domain nobody has an open attempt against yet, so a coordinator dispatching
 * one validator per applicable domain never has to remember `--validator-domain` for any of them.
 */
function resolveDomain(
  taskId: string,
  writeScope: readonly string[],
  openDomains: ReadonlySet<ValidatorDomain>,
  domainInput: string | undefined,
): ValidatorDomain {
  const applicable = applicableValidatorDomains(writeScope);
  if (domainInput !== undefined) {
    if (!isValidatorDomain(domainInput)) {
      throw new HarnessError("INVALID_ARGUMENT", `unrecognized validator domain: ${domainInput}`);
    }
    if (!applicable.includes(domainInput)) {
      throw new HarnessError(
        "INVALID_STATE",
        `validator domain ${domainInput} is not applicable to ${taskId}'s write scope`,
      );
    }
    return domainInput;
  }
  const unclaimed = applicable.filter((candidate) => !openDomains.has(candidate));
  if (unclaimed.length === 0) {
    throw new HarnessError(
      "INVALID_STATE",
      `every validator domain applicable to ${taskId} already has an open validation`,
    );
  }
  return unclaimed[0]!;
}

export function beginValidation(
  port: TransactionPort,
  taskId: string,
  validatorId: string,
  clock: Clock = systemClock,
  // Seconds until the validation deadline; --lease-duration on task:validate-start. Bounds mirror
  // claimTask's ClaimOptions.leaseSeconds, the implementer-side equivalent of this same window.
  leaseSeconds?: number,
  // B12.2: --validator-domain on task:validate-start. Undefined derives the domain from the task's
  // write scope instead (see resolveDomain above).
  domainInput?: string,
) {
  validatorId = requireText(validatorId, "validator_id");
  if (
    leaseSeconds !== undefined &&
    (!Number.isSafeInteger(leaseSeconds) ||
      leaseSeconds < MIN_VALIDATION_WINDOW ||
      leaseSeconds > MAX_VALIDATION_WINDOW)
  ) {
    throw new HarnessError(
      "INVALID_ARGUMENT",
      `lease_seconds must be an integer from ${MIN_VALIDATION_WINDOW} to ${MAX_VALIDATION_WINDOW}`,
    );
  }
  const windowMs = (leaseSeconds ?? DEFAULT_VALIDATION_WINDOW) * 1_000;
  const now = clock.now();
  const token = newLeaseToken();
  const state = port.transact(validatorId, "validation-started", { task_id: taskId }, (draft) => {
    const task = taskIn(draft, taskId);
    // Multiple domain validators share a task's `validating` window (B12.2): the first opens it,
    // every later domain joins the window already open rather than being refused as "not submitted".
    if (task.status !== "submitted" && task.status !== "validating") {
      throw new HarnessError("INVALID_STATE", "task is not submitted");
    }
    const open = openValidations(task);
    if (
      task.original_implementer === validatorId ||
      task.attempts.some((attempt) => attempt.agent_id === validatorId) ||
      open.some((entry) => entry.validator_id === validatorId) ||
      (task.validation_history ?? []).some((entry) => entry.validator_id === validatorId) ||
      task.history.some((entry) => entry.to === "validating" && entry.actor === validatorId)
    ) {
      throw new HarnessError("INVALID_STATE", "validator must be independent from implementers");
    }
    const openDomains = new Set(open.map((entry) => entry.domain));
    const domain = resolveDomain(taskId, task.write_scope, openDomains, domainInput);
    if (openDomains.has(domain)) {
      throw new HarnessError(
        "INVALID_STATE",
        `validator domain ${domain} already has an open validation for ${taskId}`,
      );
    }
    task.validations ??= [];
    task.validations.push({
      validator_id: validatorId,
      domain,
      token_digest: tokenDigest(token),
      attempt: task.repair_round + 1,
      started_at: utc(now),
      deadline_at: utc(new Date(now.valueOf() + windowMs)),
    });
    if (task.status === "submitted") {
      transition(task, "validating", validatorId, now, "independent validation started");
    }
  });
  state.tasks[taskId]!.validation_token = token;
  return state;
}
