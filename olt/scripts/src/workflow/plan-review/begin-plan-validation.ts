import { HarnessError } from "../../errors/harness-error.ts";
import { newLeaseToken, tokenDigest } from "../lease/token.ts";
import { requireText, utc } from "../task-state.ts";
import { systemClock, type Clock, type TransactionPort, type WorkflowState } from "../types.ts";
import { assertPlanValidatorIndependent } from "./identity.ts";
import { currentPlanDigest } from "./plan-digest.ts";

const MIN_WINDOW = 5;
const MAX_WINDOW = 86_400;
const DEFAULT_WINDOW = 1_200;

export interface BeginPlanValidationOptions {
  clock?: Clock;
  leaseSeconds?: number;
}

export function beginPlanValidation(
  port: TransactionPort,
  validatorId: string,
  options: BeginPlanValidationOptions = {},
): { state: WorkflowState; token: string } {
  validatorId = requireText(validatorId, "validator_id");
  const seconds = options.leaseSeconds ?? DEFAULT_WINDOW;
  if (!Number.isSafeInteger(seconds) || seconds < MIN_WINDOW || seconds > MAX_WINDOW) {
    throw new HarnessError(
      "INVALID_ARGUMENT",
      `lease_seconds must be an integer from ${MIN_WINDOW} to ${MAX_WINDOW}`,
    );
  }
  const now = (options.clock ?? systemClock).now();
  const token = newLeaseToken();
  const state = port.transact(validatorId, "plan-validation-started", {}, (draft) => {
    assertPlanValidatorIndependent(draft, validatorId);
    const revision = draft.graph_revision ?? 1;
    const digest = currentPlanDigest(draft);
    const current = draft.plan_validation;
    if (current && current.status !== "reviewed" && current.status !== "expired") {
      if (current.graph_revision === revision) {
        throw new HarnessError(
          "INVALID_STATE",
          "a plan validation is already active for this graph revision",
        );
      }
      current.status = "expired";
      const historical = draft.plan_validation_history?.find(
        (entry) => entry.attempt === current.attempt && entry.validator_id === current.validator_id,
      );
      if (historical) historical.status = "expired";
    }
    const history = draft.plan_validation_history ?? [];
    if (
      history.some(
        (entry) =>
          entry.validator_id === validatorId &&
          entry.graph_revision === revision &&
          entry.status === "reviewed",
      )
    ) {
      throw new HarnessError(
        "INVALID_STATE",
        "this validator already recorded a verdict for this graph revision",
      );
    }
    const attempt = history.length + 1;
    const assignment = {
      validator_id: validatorId,
      token_digest: tokenDigest(token),
      attempt,
      status: "assigned",
      started_at: utc(now),
      deadline_at: utc(new Date(now.valueOf() + seconds * 1_000)),
      graph_revision: revision,
      plan_digest: digest,
    } as const;
    draft.plan_validation_history ??= [];
    draft.plan_validation_history.push({ ...assignment });
    draft.plan_validation = { ...assignment };
  });
  return { state, token };
}
