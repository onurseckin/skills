import { HarnessError } from "../../errors/harness-error.ts";
import { workflowPort } from "../../integration/store-ports.ts";
import { refreshHandoffOnEscalation } from "../../reporting/handoff.ts";
import { loadRun } from "../../store/index.ts";
import { tokenDigest } from "../../workflow/lease/token.ts";
import { recordReview } from "../../workflow/review/record-review.ts";
import { systemClock, type TaskRecord } from "../../workflow/types.ts";
import { formatTaskRejectBrief } from "../formatters/index.ts";
import { textFlag, type Flags } from "../options.ts";
import {
  buildReviewFinding,
  nextFindingRound,
  parseSeverity,
  resolveFindingRequirement,
} from "./task-finding-input.ts";
import {
  collectTaskScreenshots,
  persistReviewReport,
  resolveCheckIds,
  reviewPolicyFor,
} from "./task-review-support.ts";

export async function taskRejectCommand(flags: Flags): Promise<Record<string, unknown>> {
  const [run, taskId, validator, token, reason] = [
    textFlag(flags, "run")!,
    textFlag(flags, "task")!,
    textFlag(flags, "validator")!,
    textFlag(flags, "token")!,
    textFlag(flags, "reason")!,
  ];
  // The remediation is the validator's instruction, not a restatement of the defect: echoing the
  // reason back under the remediation label would file the observation as the fix.
  const remediation = textFlag(flags, "remediation", false) ?? textFlag(flags, "finding", false);
  if (remediation === undefined) {
    throw new HarnessError(
      "INVALID_ARGUMENT",
      "--remediation is required: state what would fix the defect",
    );
  }
  const severity = parseSeverity(textFlag(flags, "severity")!, "severity");
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

  const round = nextFindingRound(taskBefore);
  const findingObj = buildReviewFinding({
    taskId,
    findingId:
      customFindingId ??
      (round > 1 ? `finding-${taskId}-reject-${round}` : `finding-${taskId}-reject`),
    round,
    requirementId: resolveFindingRequirement(taskBefore, textFlag(flags, "requirement", false)),
    severity,
    checkIds,
    summary: reason,
    remediation,
  });

  const reviewPayload: Record<string, unknown> = {
    verdict: "reject",
    validation_token: token,
    requirement_ids: taskBefore.requirement_ids,
    checks: checkIds.map((id) => ({ command_id: id })),
    findings: [findingObj],
  };

  const state = recordReview(
    workflowPort(run),
    taskId,
    validator,
    reviewPayload,
    systemClock,
    reviewPolicyFor(loaded.runRoot).maxRepairRounds,
  );
  const taskScreenshots = collectTaskScreenshots(loaded.runRoot, taskId, validator, checkIds);
  const screenshotPaths = taskScreenshots.map((s) => s.path);

  const reportData = {
    task_id: taskId,
    validator,
    // The bearer token stays out of the report; the digest is enough to verify which token signed it.
    token_digest: tokenDigest(token),
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

  const handoffPath = refreshHandoffOnEscalation(run, state.tasks[taskId]!.status);
  const findingId = String(findingObj.id);
  const markdown = formatTaskRejectBrief({
    taskId,
    validator,
    findingId,
    issue: reason,
    status: state.tasks[taskId]!.status,
  });
  return {
    markdown,
    run_root: run,
    task: state.tasks[taskId]!,
    finding_id: findingId,
    finding: findingObj,
    report_path: reportPath,
    screenshots: screenshotPaths,
    screenshot_records: taskScreenshots,
    ...(handoffPath === undefined ? {} : { handoff_path: handoffPath }),
  };
}
