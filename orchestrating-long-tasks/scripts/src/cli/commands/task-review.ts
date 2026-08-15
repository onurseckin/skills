import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
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
  const [run, taskId, validator] = [
    textFlag(flags, "run")!,
    textFlag(flags, "task")!,
    textFlag(flags, "validator")!,
  ];
  const state = beginValidation(workflowPort(run), taskId, validator);
  const task = state.tasks[taskId]!;
  const token = typeof task.validation_token === "string" ? task.validation_token : "tok_val";
  delete task.validation_token;

  const markdown = formatValidationStartBrief({
    taskId,
    validator,
    token,
    gates: [`bun test ${task.write_scope[0] ?? ""}`],
  });
  return { markdown, run_root: run, token, task };
}

export async function taskReviewCommand(flags: Flags): Promise<Record<string, unknown>> {
  assertFlags(flags, [
    "run",
    "task",
    "validator",
    "token",
    "status",
    "summary",
    "finding-id",
    "evidence",
    "checks",
  ]);
  const [run, taskId, validator, token, status] = [
    textFlag(flags, "run")!,
    textFlag(flags, "task")!,
    textFlag(flags, "validator")!,
    textFlag(flags, "token")!,
    textFlag(flags, "status")!,
  ];
  const summary = textFlag(flags, "summary", false) ?? `Validation ${status}`;
  const customFindingId = textFlag(flags, "finding-id", false);
  if (status !== "pass" && status !== "fail")
    throw new HarnessError("INVALID_ARGUMENT", "--status must be pass or fail");

  const loaded = loadRun(run);
  const taskBefore = ((loaded.state.tasks ?? {}) as Record<string, TaskRecord>)[taskId];
  if (!taskBefore) throw new HarnessError("INVALID_ARGUMENT", `unknown task ${taskId}`);

  const explicitEvidence = textFlag(flags, "evidence", false) ?? textFlag(flags, "checks", false);
  const checkIds = explicitEvidence
    ? explicitEvidence
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean)
    : (
        Object.values(loaded.state.commands ?? {}) as {
          id: string;
          actor?: string;
          task_id?: string;
          exit_code?: number;
        }[]
      )
        .filter((c) => c.task_id === taskId && c.actor === validator && c.exit_code === 0)
        .map((c) => c.id);

  const isPass = status === "pass";
  const openFindings = (taskBefore.findings ?? []).filter((f) => f.status === "open");
  const round = Math.max(
    (taskBefore.repair_round ?? 0) + 1,
    (taskBefore.findings ?? []).length + 1,
  );
  const findingId =
    customFindingId ??
    (round > 1 ? `finding-${taskId}-${String(round).padStart(2, "0")}` : `finding-${taskId}-01`);

  const findingObj = {
    id: findingId,
    requirement_id: taskBefore.requirement_ids[0] ?? `req-${taskId}`,
    severity: "important",
    evidence:
      checkIds.length > 0
        ? checkIds.map((id) => ({ kind: "command", reference: id }))
        : [{ kind: "failure", detail: summary }],
    observation: summary,
    remediation: "Correct implementation to satisfy requirements and pass gates.",
    revalidation: `Run gate tests for ${taskId}`,
  };

  const reviewPayload: Record<string, unknown> = {
    verdict: isPass ? "pass" : "reject",
    validation_token: token,
    requirement_ids: taskBefore.requirement_ids,
    checks: checkIds.map((id) => ({ command_id: id })),
    findings: isPass ? [] : [findingObj],
    resolved_findings:
      isPass && openFindings.length > 0
        ? openFindings.map((f) => ({
            finding_id: f.id,
            method: "verification_passed",
            evidence: checkIds.map((id) => ({ command_id: id })),
          }))
        : undefined,
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
          try {
            state = attachGateResult(workflowPort(run), taskId, gate.id, matchingCmd, validator);
          } catch {}
        }
      }
      try {
        state = finishTask(workflowPort(run), taskId, validator);
      } catch {}
    }
  }

  // Persist finding to disk if validation failed
  if (!isPass) {
    const findingsDir = join(loaded.runRoot, "findings");
    mkdirSync(findingsDir, { recursive: true });
    writeFileSync(
      join(findingsDir, `${findingId}.json`),
      JSON.stringify(findingObj, null, 2),
      "utf-8",
    );
  }

  const unblocked = isPass
    ? Object.values(state.tasks)
        .filter(
          (o) =>
            (o.status === "proposed" || o.status === "ready") && o.dependencies.includes(taskId),
        )
        .map((o) => o.id)
    : [];

  // Persist review report to disk
  const reportsDir = join(loaded.runRoot, "reports");
  mkdirSync(reportsDir, { recursive: true });
  const reportPath = join(reportsDir, `${taskId}-review.json`);
  const reportData = {
    task_id: taskId,
    validator,
    token,
    status,
    verdict: isPass ? "pass" : "reject",
    summary,
    created_at: new Date().toISOString(),
    checks: checkIds,
    findings: isPass ? [] : [findingObj],
    resolved_findings: reviewPayload.resolved_findings ?? [],
    unblocked,
    task: state.tasks[taskId],
  };
  writeFileSync(reportPath, JSON.stringify(reportData, null, 2), "utf-8");

  const markdown = isPass
    ? formatTaskReviewPassBrief({
        taskId,
        validator,
        gateSummary: `${summary} (passed with exit code 0)`,
        unblockedTasks: unblocked,
        reportPath: `${run}/reports/${taskId}-review.json`,
      })
    : formatTaskRejectBrief({
        taskId,
        validator,
        findingId,
        issue: summary,
      });

  return {
    markdown,
    run_root: run,
    task: state.tasks[taskId]!,
    verdict: status,
    unblocked,
    report_path: reportPath,
    ...(isPass ? {} : { finding_id: findingId, finding: findingObj }),
  };
}

export async function taskRejectCommand(flags: Flags): Promise<Record<string, unknown>> {
  assertFlags(flags, [
    "run",
    "task",
    "validator",
    "token",
    "reason",
    "finding",
    "finding-id",
    "evidence",
    "checks",
  ]);
  const [run, taskId, validator, token, reason] = [
    textFlag(flags, "run")!,
    textFlag(flags, "task")!,
    textFlag(flags, "validator")!,
    textFlag(flags, "token")!,
    textFlag(flags, "reason")!,
  ];
  const finding = textFlag(flags, "finding", false) ?? reason;
  const customFindingId = textFlag(flags, "finding-id", false);

  const loaded = loadRun(run);
  const taskBefore = ((loaded.state.tasks ?? {}) as Record<string, TaskRecord>)[taskId];
  if (!taskBefore) throw new HarnessError("INVALID_ARGUMENT", `unknown task ${taskId}`);

  const explicitEvidence = textFlag(flags, "evidence", false) ?? textFlag(flags, "checks", false);
  const checkIds = explicitEvidence
    ? explicitEvidence
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean)
    : (
        Object.values(loaded.state.commands ?? {}) as {
          id: string;
          actor?: string;
          task_id?: string;
          exit_code?: number;
        }[]
      )
        .filter((c) => c.task_id === taskId && c.actor === validator)
        .map((c) => c.id);

  const round = Math.max(
    (taskBefore.repair_round ?? 0) + 1,
    (taskBefore.findings ?? []).length + 1,
  );
  const findingId =
    customFindingId ??
    (round > 1 ? `finding-${taskId}-reject-${round}` : `finding-${taskId}-reject`);

  const findingObj = {
    id: findingId,
    requirement_id: taskBefore.requirement_ids[0] ?? `req-${taskId}`,
    severity: "critical",
    evidence:
      checkIds.length > 0
        ? checkIds.map((id) => ({ kind: "command", reference: id }))
        : [{ kind: "failure", detail: reason }],
    observation: reason,
    remediation: finding,
    revalidation: `Run gate tests for ${taskId}`,
  };

  const reviewPayload: Record<string, unknown> = {
    verdict: "reject",
    validation_token: token,
    requirement_ids: taskBefore.requirement_ids,
    checks: checkIds.map((id) => ({ command_id: id })),
    findings: [findingObj],
  };

  const state = recordReview(workflowPort(run), taskId, validator, reviewPayload);

  // Persist finding to disk
  const findingsDir = join(loaded.runRoot, "findings");
  mkdirSync(findingsDir, { recursive: true });
  const findingPath = join(findingsDir, `${findingId}.json`);
  writeFileSync(findingPath, JSON.stringify(findingObj, null, 2), "utf-8");

  // Persist review report to disk
  const reportsDir = join(loaded.runRoot, "reports");
  mkdirSync(reportsDir, { recursive: true });
  const reportPath = join(reportsDir, `${taskId}-review.json`);
  const reportData = {
    task_id: taskId,
    validator,
    token,
    status: "fail",
    verdict: "reject",
    summary: reason,
    created_at: new Date().toISOString(),
    checks: checkIds,
    findings: [findingObj],
    task: state.tasks[taskId],
  };
  writeFileSync(reportPath, JSON.stringify(reportData, null, 2), "utf-8");

  const markdown = formatTaskRejectBrief({ taskId, validator, findingId, issue: reason });
  return {
    markdown,
    run_root: run,
    task: state.tasks[taskId]!,
    finding_id: findingId,
    finding: findingObj,
    report_path: reportPath,
  };
}
