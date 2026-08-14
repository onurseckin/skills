import { readPlanObject } from "../../graph/read-plan.ts";
import { HarnessError } from "../../errors/harness-error.ts";
import { workflowPort } from "../../integration/store-ports.ts";
import { recordAuthorityDecision } from "../../workflow/authority/index.ts";
import { attachGateResult } from "../../workflow/gates/attach-result.ts";
import { finishTask } from "../../workflow/gates/finish-task.ts";
import { claimTask } from "../../workflow/lease/claim.ts";
import { heartbeat } from "../../workflow/lease/heartbeat.ts";
import { recoverStale } from "../../workflow/lease/recover-stale.ts";
import { releaseLease } from "../../workflow/lease/release.ts";
import { assignReplacementRepairer } from "../../workflow/review/assign-repairer.ts";
import { beginValidation } from "../../workflow/review/begin-validation.ts";
import { recordReview } from "../../workflow/review/record-review.ts";
import { submitTask } from "../../workflow/submission/submit.ts";
import { actorFlag, assertFlags, integerFlag, textFlag, type Flags } from "../options.ts";

export function claimCommand(flags: Flags): Record<string, unknown> {
  assertFlags(flags, ["run", "task", "agent", "role", "lease-seconds"]);
  const run = textFlag(flags, "run")!;
  const leaseSeconds = integerFlag(flags, "lease-seconds", { minimum: 5, maximum: 86_400 });
  const result = claimTask(
    workflowPort(run),
    textFlag(flags, "task")!,
    textFlag(flags, "agent")!,
    textFlag(flags, "role")!,
    leaseSeconds === undefined ? {} : { leaseSeconds },
  );
  return { run_root: run, token: result.token, task: result.state.tasks[textFlag(flags, "task")!] };
}

export function heartbeatCommand(flags: Flags): Record<string, unknown> {
  assertFlags(flags, ["run", "task", "agent", "token"]);
  const run = textFlag(flags, "run")!;
  const state = heartbeat(
    workflowPort(run),
    textFlag(flags, "task")!,
    textFlag(flags, "agent")!,
    textFlag(flags, "token")!,
  );
  return { run_root: run, task: state.tasks[textFlag(flags, "task")!] };
}

export async function submitCommand(flags: Flags): Promise<Record<string, unknown>> {
  assertFlags(flags, ["run", "task", "agent", "token", "report"]);
  const run = textFlag(flags, "run")!;
  const result = submitTask(
    workflowPort(run),
    textFlag(flags, "task")!,
    textFlag(flags, "agent")!,
    textFlag(flags, "token")!,
    await readPlanObject(textFlag(flags, "report")!, "submission report"),
  );
  return {
    run_root: run,
    orphaned: result.orphaned,
    task: result.state.tasks[textFlag(flags, "task")!],
  };
}

export function validationStartCommand(flags: Flags): Record<string, unknown> {
  assertFlags(flags, ["run", "task", "validator"]);
  const run = textFlag(flags, "run")!;
  const state = beginValidation(
    workflowPort(run),
    textFlag(flags, "task")!,
    textFlag(flags, "validator")!,
  );
  const task = state.tasks[textFlag(flags, "task")!]!;
  const token = task.validation_token;
  delete task.validation_token;
  return { run_root: run, token, task };
}

export async function reviewCommand(flags: Flags): Promise<Record<string, unknown>> {
  assertFlags(flags, ["run", "task", "validator", "token", "review"]);
  const run = textFlag(flags, "run")!;
  const review = await readPlanObject(textFlag(flags, "review")!, "validator review");
  review.validation_token = textFlag(flags, "token")!;
  const state = recordReview(
    workflowPort(run),
    textFlag(flags, "task")!,
    textFlag(flags, "validator")!,
    review,
  );
  return { run_root: run, task: state.tasks[textFlag(flags, "task")!] };
}

export function gateCommand(flags: Flags): Record<string, unknown> {
  assertFlags(flags, ["run", "task", "gate", "command-id", "actor"]);
  const run = textFlag(flags, "run")!;
  const state = attachGateResult(
    workflowPort(run),
    textFlag(flags, "task")!,
    textFlag(flags, "gate")!,
    textFlag(flags, "command-id")!,
    actorFlag(flags),
  );
  return { run_root: run, task: state.tasks[textFlag(flags, "task")!] };
}

export function finishCommand(flags: Flags): Record<string, unknown> {
  assertFlags(flags, ["run", "task", "actor"]);
  const run = textFlag(flags, "run")!;
  const state = finishTask(workflowPort(run), textFlag(flags, "task")!, actorFlag(flags));
  return { run_root: run, task: state.tasks[textFlag(flags, "task")!] };
}

export function recoverCommand(flags: Flags): Record<string, unknown> {
  assertFlags(flags, ["run", "actor", "grace-seconds"]);
  const run = textFlag(flags, "run")!;
  const graceSeconds = integerFlag(flags, "grace-seconds", { minimum: 0, maximum: 86_400 });
  return {
    run_root: run,
    state: recoverStale(
      workflowPort(run),
      actorFlag(flags),
      undefined,
      graceSeconds === undefined ? {} : { graceSeconds },
    ),
  };
}

export function releaseCommand(flags: Flags): Record<string, unknown> {
  assertFlags(flags, ["run", "task", "agent", "token"]);
  const run = textFlag(flags, "run")!;
  const state = releaseLease(
    workflowPort(run),
    textFlag(flags, "task")!,
    textFlag(flags, "agent")!,
    textFlag(flags, "token")!,
  );
  return { run_root: run, task: state.tasks[textFlag(flags, "task")!] };
}

export function assignRepairerCommand(flags: Flags): Record<string, unknown> {
  assertFlags(flags, ["run", "task", "repairer", "reason", "evidence", "actor"]);
  const run = textFlag(flags, "run")!;
  const reason = textFlag(flags, "reason")!;
  if (!(["repeated_failure", "stale", "unavailable"] as string[]).includes(reason)) {
    throw new HarnessError(
      "INVALID_ARGUMENT",
      "--reason must be repeated_failure, stale, or unavailable",
    );
  }
  const state = assignReplacementRepairer(
    workflowPort(run),
    textFlag(flags, "task")!,
    textFlag(flags, "repairer")!,
    actorFlag(flags),
    reason as "repeated_failure" | "stale" | "unavailable",
    textFlag(flags, "evidence")!,
  );
  return { run_root: run, task: state.tasks[textFlag(flags, "task")!] };
}

export function authorityDecisionCommand(flags: Flags): Record<string, unknown> {
  assertFlags(flags, ["run", "requirement", "actor", "decision", "rationale"]);
  const decision = textFlag(flags, "decision")!;
  if (decision !== "grant" && decision !== "decline") {
    throw new HarnessError("INVALID_ARGUMENT", "--decision must be grant or decline");
  }
  const run = textFlag(flags, "run")!;
  const state = recordAuthorityDecision(
    workflowPort(run),
    textFlag(flags, "requirement")!,
    actorFlag(flags),
    { decision, rationale: textFlag(flags, "rationale")! },
  );
  return {
    run_root: run,
    requirement: state.requirements.find(({ id }) => id === textFlag(flags, "requirement")!),
  };
}
