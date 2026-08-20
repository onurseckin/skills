import { HarnessError } from "../../errors/harness-error.ts";
import type { Finding } from "../../contracts/workflow.ts";
import type { JsonObject } from "../../contracts/json.ts";
import { jsonCopy, requireText, taskIn, utc } from "../task-state.ts";
import { systemClock, type Clock, type TransactionPort } from "../types.ts";
import { tokenMatches } from "../lease/token.ts";
import { probeRoundsRecorded } from "./pass-preconditions.ts";
import { validateFindings } from "./validate-review.ts";
import { validationForValidator } from "./validation-state.ts";

export interface ProbeInput extends JsonObject {
  findings: Finding[];
}

export function validateProbe(value: unknown): ProbeInput {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new HarnessError("INVALID_ARGUMENT", "probe must be an object");
  }
  const probe = value as Record<string, unknown>;
  if (!Array.isArray(probe.findings) || probe.findings.length === 0) {
    // The whole point of the probe is the demand it carries; an empty probe would be a ritual.
    throw new HarnessError("INVALID_ARGUMENT", "a probe requires at least one demand");
  }
  return jsonCopy({ findings: probe.findings } as ProbeInput);
}

/**
 * An adversarial probe demands proof; it does not claim a defect. The task therefore stays in
 * `validating` under the same validator, `repair_round` is untouched, and the demands are closed
 * later by the revalidation proof any passing review already has to supply.
 */
export function recordProbe(
  port: TransactionPort,
  taskId: string,
  validatorId: string,
  probeValue: unknown,
  clock: Clock = systemClock,
) {
  const now = clock.now();
  const round = probeRoundsRecorded(taskIn(port.read(), taskId)) + 1;
  const probe = validateProbe(probeValue);
  // Ids are read for the event payload before the transaction opens, so they are checked here too.
  const findingIds = probe.findings.map((finding) => requireText(finding.id, "finding.id"));
  return port.transact(
    validatorId,
    "probe-recorded",
    { task_id: taskId, round, finding_ids: findingIds },
    (draft) => {
      const task = taskIn(draft, taskId);
      const mine = task.status === "validating" ? validationForValidator(task, validatorId) : undefined;
      if (!mine) {
        throw new HarnessError("INVALID_STATE", "validator does not own the current validation");
      }
      const token =
        typeof probeValue === "object" && probeValue !== null && !Array.isArray(probeValue)
          ? (probeValue as Record<string, unknown>).validation_token
          : undefined;
      if (!tokenMatches(token, mine.token_digest)) {
        throw new HarnessError("INVALID_STATE", "validator authentication token is invalid");
      }
      if (probeRoundsRecorded(task) + 1 !== round) {
        throw new HarnessError("INVALID_STATE", "probe round changed during the transaction");
      }
      validateFindings(task, probe.findings, { required: "probe_demand" });
      task.findings ??= [];
      task.findings.push(
        ...probe.findings.map(
          (finding) =>
            ({
              ...finding,
              status: "open",
              probe_round: round,
              demanded_at: utc(now),
            }) as Finding,
        ),
      );
      task.probe_round = round;
      mine.verdict = "probe";
    },
  );
}
