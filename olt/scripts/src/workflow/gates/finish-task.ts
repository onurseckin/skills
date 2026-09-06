import { HarnessError } from "../../core/errors/index.ts";
import { taskIn, transition } from "../task-state.ts";
import { systemClock, type Clock, type TransactionPort } from "../types.ts";
import { applicableGates, taskHasPassedGate, workflowGates } from "./gate-policy.ts";
import { requirementExecutionState } from "../authority/index.ts";
import { assertAttemptsClosed } from "../lease/attempt-state.ts";
import { everyApplicableDomainPassed } from "../review/validation-state.ts";
import { taskClassificationTexts } from "../review/role-evidence.ts";

import {
  MIN_ADVERSARIAL_PROBES,
  MANDATORY_COGNITIVE_PUSHBACKS,
} from "../../reporting/doctor/pushback-quotas-engine.ts";

export { MIN_ADVERSARIAL_PROBES, MANDATORY_COGNITIVE_PUSHBACKS };

export function countTaskProbes(task: Record<string, unknown>): number {
  let count = 0;
  if (Array.isArray(task["adversarial_probes"])) count += task["adversarial_probes"].length;
  else if (typeof task["adversarial_probes"] === "number") count += task["adversarial_probes"];
  else if (Array.isArray(task["probes"])) count += task["probes"].length;
  else if (typeof task["probes"] === "number") count += task["probes"];

  if (typeof task["probe_round"] === "number" && task["probe_round"] > count) {
    count = task["probe_round"];
  }

  const reviewHistory = task["review_history"];
  if (Array.isArray(reviewHistory)) {
    const historyAdv = reviewHistory.filter(
      (entry) =>
        typeof entry === "object" &&
        entry !== null &&
        ((entry as Record<string, unknown>)["channel"] === "adversarial" ||
          (entry as Record<string, unknown>)["verdict"] === "probe"),
    ).length;
    if (historyAdv > count) count = historyAdv;
  }

  if (Array.isArray(task["cognitive_pushbacks"])) {
    const cog = task["cognitive_pushbacks"].length;
    if (cog > count) count = cog;
  } else if (
    typeof task["cognitive_pushbacks"] === "number" &&
    task["cognitive_pushbacks"] > count
  ) {
    count = task["cognitive_pushbacks"];
  }

  if (Array.isArray(task["pushbacks"])) {
    const push = task["pushbacks"].length;
    if (push > count) count = push;
  } else if (typeof task["pushbacks"] === "number" && task["pushbacks"] > count) {
    count = task["pushbacks"];
  }

  if (
    typeof task["cognitive_rounds_completed"] === "number" &&
    task["cognitive_rounds_completed"] > count
  ) {
    count = task["cognitive_rounds_completed"];
  }

  return count;
}

export function finishTask(
  port: TransactionPort,
  taskId: string,
  actor: string,
  clock: Clock = systemClock,
) {
  const now = clock.now();
  return port.transact(actor, "task-finished", { task_id: taskId }, (draft) => {
    const task = taskIn(draft, taskId);
    if (task.status !== "validated" && task.status !== "gating") {
      throw new HarnessError("INVALID_STATE", "only validated or gating tasks can finish");
    }
    assertAttemptsClosed(task, "finish");
    const classificationTexts = taskClassificationTexts(draft, task);
    if (!task.report || !everyApplicableDomainPassed(task, classificationTexts)) {
      throw new HarnessError("INVALID_STATE", "task lacks a passing review and report");
    }
    if ((task.findings ?? []).some((finding) => finding.status === "open")) {
      throw new HarnessError("INVALID_STATE", "task has open findings");
    }
    if (applicableGates(draft, task).some((gate) => !taskHasPassedGate(task, gate.id))) {
      throw new HarnessError("INVALID_STATE", "mandatory task gates have not passed");
    }

    const rawTask = task as Record<string, unknown>;
    const hasBypass =
      rawTask["bypass_quotas"] === true ||
      rawTask["skip_quotas"] === true ||
      rawTask["skip_pushback_quotas"] === true ||
      rawTask["bypass_cognitive_pushback"] === true ||
      rawTask["no_op"] !== undefined ||
      (draft as Record<string, unknown>)["bypass_quotas"] === true ||
      ((draft as Record<string, unknown>)["policy"] as Record<string, unknown> | undefined)?.[
        "bypass_quotas"
      ] === true ||
      ((draft as Record<string, unknown>)["policy"] as Record<string, unknown> | undefined)?.[
        "skip_pushback_quotas"
      ] === true;

    if (!hasBypass) {
      const probeCount = countTaskProbes(rawTask);
      if (probeCount < MIN_ADVERSARIAL_PROBES) {
        throw new HarnessError(
          "INVALID_STATE",
          "Cognitive deepening protocol not satisfied: task has insufficient probes/pushbacks (requires >= 5)",
        );
      }
    }

    transition(task, "done", actor, now, "review and mandatory gates passed");
    for (const candidate of Object.values(draft.tasks)) {
      if (
        candidate.status === "proposed" &&
        candidate.dependencies.length > 0 &&
        candidate.dependencies.every((depId) => draft.tasks[depId]?.status === "done")
      ) {
        transition(candidate, "ready", actor, now, "dependencies satisfied");
      }
    }
    for (const requirement of draft.requirements) {
      if (requirementExecutionState(requirement) !== "executable") continue;
      const covering = Object.values(draft.tasks).filter((candidate) =>
        candidate.requirement_ids.includes(requirement.id),
      );
      if (
        covering.length > 0 &&
        covering.every((candidate) => candidate.status === "done") &&
        covering.every(
          (candidate) =>
            candidate.report &&
            everyApplicableDomainPassed(candidate, taskClassificationTexts(draft, candidate)),
        ) &&
        workflowGates(draft)
          .filter(
            (gate) =>
              gate.scope === "task" &&
              gate.mandatory &&
              gate.requirement_ids.includes(requirement.id),
          )
          .every((gate) =>
            covering.every(
              (candidate) =>
                !candidate.requirement_ids.includes(requirement.id) ||
                taskHasPassedGate(candidate, gate.id),
            ),
          )
      ) {
        requirement.status = "satisfied";
        requirement.evidence = covering.map((candidate) => `task:${candidate.id}`);
      }
    }
  });
}
