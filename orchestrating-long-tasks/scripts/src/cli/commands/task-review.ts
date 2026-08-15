import { HarnessError } from "../../errors/harness-error.ts";
import { workflowPort } from "../../integration/store-ports.ts";
import { loadRun } from "../../store/index.ts";
import { attachGateResult } from "../../workflow/gates/attach-result.ts";
import { finishTask } from "../../workflow/gates/finish-task.ts";
import { applicableGates } from "../../workflow/gates/gate-policy.ts";
import { beginValidation } from "../../workflow/review/begin-validation.ts";
import { recordReview } from "../../workflow/review/record-review.ts";
import type { TaskRecord } from "../../workflow/types.ts";
import {
  formatTaskRejectBrief,
  formatTaskReviewPassBrief,
  formatValidationStartBrief,
} from "../formatters/index.ts";
import { assertFlags, textFlag, type Flags } from "../options.ts";

export async function taskValidateStartCommand(flags: Flags): Promise<Record<string, unknown>> {
  assertFlags(flags, ["run", "task", "validator", "lease-duration"]);
  const [run, taskId, validator] = [textFlag(flags, "run")!, textFlag(flags, "task")!, textFlag(flags, "validator")!];
  const state = beginValidation(workflowPort(run), taskId, validator);
  const task = state.tasks[taskId]!;
  const token = typeof task.validation_token === "string" ? task.validation_token : "tok_val";
  delete task.validation_token;

  const markdown = formatValidationStartBrief({ taskId, validator, token, gates: [`bun test ${task.write_scope[0] ?? ""}`] });
  return { markdown, run_root: run, token, task };
}

export async function taskReviewCommand(flags: Flags): Promise<Record<string, unknown>> {
  assertFlags(flags, ["run", "task", "validator", "token", "status", "summary", "evidence", "checks"]);
  const [run, taskId, validator, token, status] = [
    textFlag(flags, "run")!, textFlag(flags, "task")!, textFlag(flags, "validator")!, textFlag(flags, "token")!, textFlag(flags, "status")!,
  ];
  const summary = textFlag(flags, "summary", false) ?? `Validation ${status}`;
  if (status !== "pass" && status !== "fail") throw new HarnessError("INVALID_ARGUMENT", "--status must be pass or fail");

  const taskBefore = ((loadRun(run).state.tasks ?? {}) as Record<string, TaskRecord>)[taskId];
  if (!taskBefore) throw new HarnessError("INVALID_ARGUMENT", `unknown task ${taskId}`);

  const explicitEvidence = textFlag(flags, "evidence", false) ?? textFlag(flags, "checks", false);
  const checkIds = explicitEvidence
    ? explicitEvidence.split(",").map((s) => s.trim()).filter(Boolean)
    : (Object.values(loadRun(run).state.commands ?? {}) as { id: string; actor?: string; task_id?: string; exit_code?: number }[])
        .filter((c) => c.task_id === taskId && c.actor === validator && c.exit_code === 0)
        .map((c) => c.id);

  const isPass = status === "pass";
  const reviewPayload: Record<string, unknown> = {
    verdict: isPass ? "pass" : "reject",
    validation_token: token,
    requirement_ids: taskBefore.requirement_ids,
    checks: checkIds.map((id) => ({ command_id: id })),
    findings: isPass ? [] : [{
      id: `finding-${taskId}-01`,
      requirement_id: taskBefore.requirement_ids[0] ?? `req-${taskId}`,
      severity: "important",
      evidence: checkIds.length > 0 ? checkIds.map((id) => ({ kind: "command", reference: id })) : [{ kind: "failure", detail: summary }],
      observation: summary,
      remediation: "Correct implementation to satisfy requirements and pass gates.",
      revalidation: `Run gate tests for ${taskId}`,
    }],
  };

  let state = recordReview(workflowPort(run), taskId, validator, reviewPayload);
  if (isPass) {
    const currentTask = state.tasks[taskId];
    if (currentTask) {
      for (const gate of applicableGates(state, currentTask)) {
        const matchingCmd = checkIds.find((id) => {
          const cmd = state.commands[id];
          return cmd && (cmd.gate_id === gate.id || !cmd.gate_id);
        });
        if (matchingCmd) {
          try { state = attachGateResult(workflowPort(run), taskId, gate.id, matchingCmd, validator); } catch {}
        }
      }
      try { state = finishTask(workflowPort(run), taskId, validator); } catch {}
    }
  }

  const unblocked = isPass
    ? Object.values(state.tasks).filter((o) => (o.status === "proposed" || o.status === "ready") && o.dependencies.includes(taskId)).map((o) => o.id)
    : [];

  const markdown = isPass
    ? formatTaskReviewPassBrief({ taskId, validator, gateSummary: `${summary} (passed with exit code 0)`, unblockedTasks: unblocked, reportPath: `${run}/reports/${taskId}-review.json` })
    : formatTaskRejectBrief({ taskId, validator, findingId: `finding-${taskId}-01`, issue: summary });

  return { markdown, run_root: run, task: state.tasks[taskId]!, verdict: status, unblocked };
}

export async function taskRejectCommand(flags: Flags): Promise<Record<string, unknown>> {
  assertFlags(flags, ["run", "task", "validator", "token", "reason", "finding", "evidence", "checks"]);
  const [run, taskId, validator, token, reason] = [
    textFlag(flags, "run")!, textFlag(flags, "task")!, textFlag(flags, "validator")!, textFlag(flags, "token")!, textFlag(flags, "reason")!,
  ];
  const finding = textFlag(flags, "finding", false) ?? reason;
  const taskBefore = ((loadRun(run).state.tasks ?? {}) as Record<string, TaskRecord>)[taskId];
  if (!taskBefore) throw new HarnessError("INVALID_ARGUMENT", `unknown task ${taskId}`);

  const explicitEvidence = textFlag(flags, "evidence", false) ?? textFlag(flags, "checks", false);
  const checkIds = explicitEvidence
    ? explicitEvidence.split(",").map((s) => s.trim()).filter(Boolean)
    : (Object.values(loadRun(run).state.commands ?? {}) as { id: string; actor?: string; task_id?: string; exit_code?: number }[])
        .filter((c) => c.task_id === taskId && c.actor === validator)
        .map((c) => c.id);
  const findingId = `finding-${taskId}-reject`;

  const reviewPayload: Record<string, unknown> = {
    verdict: "reject",
    validation_token: token,
    requirement_ids: taskBefore.requirement_ids,
    checks: checkIds.map((id) => ({ command_id: id })),
    findings: [{
      id: findingId,
      requirement_id: taskBefore.requirement_ids[0] ?? `req-${taskId}`,
      severity: "critical",
      evidence: checkIds.length > 0 ? checkIds.map((id) => ({ kind: "command", reference: id })) : [{ kind: "failure", detail: reason }],
      observation: reason,
      remediation: finding,
      revalidation: `Run gate tests for ${taskId}`,
    }],
  };


  const state = recordReview(workflowPort(run), taskId, validator, reviewPayload);
  const markdown = formatTaskRejectBrief({ taskId, validator, findingId, issue: reason });
  return { markdown, run_root: run, task: state.tasks[taskId]!, finding_id: findingId };
}
