import { HarnessError } from "../../errors/harness-error.ts";
import { taskIn, transition } from "../task-state.ts";
import { systemClock, type Clock, type TransactionPort } from "../types.ts";
import { applicableGates, taskHasPassedGate, workflowGates } from "./gate-policy.ts";
import { requirementExecutionState } from "../authority/index.ts";
import { assertAttemptsClosed } from "../lease/attempt-state.ts";
import { everyApplicableDomainPassed } from "../review/validation-state.ts";
import { taskClassificationTexts } from "../review/role-evidence.ts";

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
