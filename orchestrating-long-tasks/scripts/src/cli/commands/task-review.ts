import { HarnessError } from "../../errors/harness-error.ts";
import { workflowPort } from "../../integration/store-ports.ts";
import { loadRun } from "../../store/index.ts";
import { beginValidation } from "../../workflow/review/begin-validation.ts";
import { recordReview } from "../../workflow/review/record-review.ts";
import type { TaskRecord } from "../../workflow/types.ts";
import {
  formatTaskRejectBrief,
  formatTaskReviewPassBrief,
  formatValidationStartBrief,
} from "../formatters/index.ts";
import { assertFlags, textFlag, type Flags } from "../options.ts";
import {
  buildReviewFinding,
  collectTaskScreenshots,
  finalizePassingTask,
  persistFindingFile,
  persistReviewReport,
  resolveCheckIds,
} from "./task-review-support.ts";

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
  if (status !== "pass" && status !== "fail") {
    throw new HarnessError("INVALID_ARGUMENT", "--status must be pass or fail");
  }

  const loaded = loadRun(run);
  const taskBefore = ((loaded.state.tasks ?? {}) as Record<string, TaskRecord>)[taskId];
  if (!taskBefore) throw new HarnessError("INVALID_ARGUMENT", `unknown task ${taskId}`);

  const explicitEvidence = textFlag(flags, "evidence", false) ?? textFlag(flags, "checks", false);
  const checkIds = resolveCheckIds(
    explicitEvidence,
    loaded.state.commands,
    taskId,
    validator,
    true,
  );

  const isPass = status === "pass";
  const openFindings = (taskBefore.findings ?? []).filter((f) => f.status === "open");
  const round = Math.max(
    (taskBefore.repair_round ?? 0) + 1,
    (taskBefore.findings ?? []).length + 1,
  );

  const findingObj = buildReviewFinding({
    taskId,
    findingId: customFindingId,
    round,
    requirementId: taskBefore.requirement_ids[0] ?? `req-${taskId}`,
    severity: "important",
    checkIds,
    summary,
    remediation: "Correct implementation to satisfy requirements and pass gates.",
  });

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
    state = finalizePassingTask(run, taskId, validator, checkIds, state);
  } else {
    persistFindingFile(loaded.runRoot, findingObj);
  }

  const unblocked = isPass
    ? Object.values(state.tasks)
        .filter(
          (o) =>
            (o.status === "proposed" || o.status === "ready") && o.dependencies.includes(taskId),
        )
        .map((o) => o.id)
    : [];

  const taskScreenshots = collectTaskScreenshots(loaded.runRoot, taskId, validator, checkIds);
  const screenshotPaths = taskScreenshots.map((s) => s.report_path);

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
    screenshots: screenshotPaths,
    screenshot_records: taskScreenshots,
  };
  const reportPath = persistReviewReport(loaded.runRoot, taskId, reportData);

  const findingId = String(findingObj.id);
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
    screenshots: screenshotPaths,
    screenshot_records: taskScreenshots,
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
  const checkIds = resolveCheckIds(
    explicitEvidence,
    loaded.state.commands,
    taskId,
    validator,
    false,
  );

  const round = Math.max(
    (taskBefore.repair_round ?? 0) + 1,
    (taskBefore.findings ?? []).length + 1,
  );
  const findingObj = buildReviewFinding({
    taskId,
    findingId:
      customFindingId ??
      (round > 1 ? `finding-${taskId}-reject-${round}` : `finding-${taskId}-reject`),
    round,
    requirementId: taskBefore.requirement_ids[0] ?? `req-${taskId}`,
    severity: "critical",
    checkIds,
    summary: reason,
    remediation: finding,
  });

  const reviewPayload: Record<string, unknown> = {
    verdict: "reject",
    validation_token: token,
    requirement_ids: taskBefore.requirement_ids,
    checks: checkIds.map((id) => ({ command_id: id })),
    findings: [findingObj],
  };

  const state = recordReview(workflowPort(run), taskId, validator, reviewPayload);
  persistFindingFile(loaded.runRoot, findingObj);

  const taskScreenshots = collectTaskScreenshots(loaded.runRoot, taskId, validator, checkIds);
  const screenshotPaths = taskScreenshots.map((s) => s.report_path);

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
    screenshots: screenshotPaths,
    screenshot_records: taskScreenshots,
  };
  const reportPath = persistReviewReport(loaded.runRoot, taskId, reportData);

  const findingId = String(findingObj.id);
  const markdown = formatTaskRejectBrief({ taskId, validator, findingId, issue: reason });
  return {
    markdown,
    run_root: run,
    task: state.tasks[taskId]!,
    finding_id: findingId,
    finding: findingObj,
    report_path: reportPath,
    screenshots: screenshotPaths,
    screenshot_records: taskScreenshots,
  };
}
