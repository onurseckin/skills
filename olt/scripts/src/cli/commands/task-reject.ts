import { HarnessError } from "../../core/errors/harness-error.ts";
import { workflowPort } from "../../integration/store-ports.ts";
import { refreshHandoffOnEscalation } from "../../reporting/handoff.ts";
import { loadRun } from "../../engine/store/index.ts";
import { tokenDigest } from "../../workflow/lease/token.ts";
import { recordReview } from "../../workflow/review/record-review.ts";
import { systemClock, type TaskRecord, type WorkflowState } from "../../workflow/types.ts";
import {
  DEFAULT_MAX_MICRO_CYCLES,
  formatMicroCycleFeedback,
  getLatestMicroCycle,
  recordMicroCycleCritique,
} from "../../workflow/review/micro-cycle.ts";
import { formatTaskRejectBrief } from "../formatters/index.ts";
import { boolFlag, integerFlag, textFlag, type Flags } from "../options.ts";
import {
  buildReviewFinding,
  nextFindingRound,
  parseSeverity,
  resolveFindingRequirement,
} from "./task-finding-input.ts";
import {
  assertRoleArtifactPresent,
  classifiesAsUiTask,
  gateReviewPayload,
} from "../../workflow/review/role-evidence.ts";
import { isUiScope } from "../../validation/dual-channel-analyzer.ts";
import {
  collectTaskScreenshots,
  persistReviewReport,
  resolveCheckIds,
  reviewPolicyFor,
} from "./task-review-support.ts";

import { ReviewProtocolEngine, type ReviewChannelKind } from "../../policy/review-protocol.ts";

export async function taskRejectCommand(flags: Flags): Promise<Record<string, unknown>> {
  const isMicroCycle = boolFlag(flags, "micro-cycle") || boolFlag(flags, "in-lease");
  const [run, taskId, validator, reason] = [
    textFlag(flags, "run")!,
    textFlag(flags, "task")!,
    textFlag(flags, "validator")!,
    textFlag(flags, "reason")!,
  ];
  const kindFlag = textFlag(flags, "kind", false);
  const channelKind: ReviewChannelKind = kindFlag === "cognitive" ? "cognitive" : "adversarial";

  if (isMicroCycle) {
    const remediation = textFlag(flags, "remediation", false) ?? textFlag(flags, "finding", false);
    const defect = textFlag(flags, "defect", false) ?? reason;
    const maxRounds = integerFlag(flags, "max-rounds", { minimum: 1, maximum: 50 });

    const state = recordMicroCycleCritique(workflowPort(run), taskId, validator, reason, {
      ...(remediation !== undefined ? { remediation } : {}),
      ...(defect !== undefined ? { defect } : {}),
      ...(maxRounds !== undefined ? { maxRounds } : {}),
    });

    const updatedTask = state.tasks[taskId]!;
    const latestRecord = getLatestMicroCycle(updatedTask);
    const round = latestRecord?.round ?? updatedTask.micro_cycle_round ?? 1;
    const markdown = latestRecord
      ? formatMicroCycleFeedback(
          taskId,
          latestRecord,
          maxRounds ?? DEFAULT_MAX_MICRO_CYCLES,
          state.repairToken,
        )
      : `### 🔄 Micro-Cycle Feedback (Round ${round})\n\nValidator: ${validator}\nCritique: ${reason}${
          state.repairToken ? `\n\nRepair Lease Token: ${state.repairToken}` : ""
        }`;

    return {
      micro_cycle: true,
      round,
      markdown,
      run_root: run,
      task: updatedTask,
      ...(latestRecord ? { micro_cycle_record: latestRecord } : {}),
      ...(remediation !== undefined ? { remediation } : {}),
      ...(state.repairToken !== undefined ? { repair_token: state.repairToken } : {}),
    };
  }

  const token = textFlag(flags, "token", false);
  if (token === undefined) {
    throw new HarnessError("INVALID_ARGUMENT", "--token is required");
  }
  const remediation = textFlag(flags, "remediation", false) ?? textFlag(flags, "finding", false);
  if (remediation === undefined) {
    throw new HarnessError(
      "INVALID_ARGUMENT",
      "--remediation is required: state what would fix the defect",
    );
  }
  const severityFlag = textFlag(flags, "severity", false);
  if (severityFlag === undefined) {
    throw new HarnessError(
      "INVALID_ARGUMENT",
      "--severity is required: critical, important or minor",
    );
  }
  const severity = parseSeverity(severityFlag, "severity");
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

  const policy = reviewPolicyFor(loaded.runRoot, validator);
  const state = recordReview(
    workflowPort(run),
    taskId,
    validator,
    reviewPayload,
    systemClock,
    policy.maxRepairRounds,
    policy.minProbes,
  );

  const engine = new ReviewProtocolEngine(policy.reviewProtocol);
  const updatedTask = state.tasks[taskId]!;
  engine.recordEntry(updatedTask, {
    round: updatedTask.repair_round ?? 1,
    channel: channelKind,
    actor_id: validator,
    verdict: "reject",
    findings_count: 1,
    summary: reason,
  });
  const isUiTask = classifiesAsUiTask(
    loaded.state as unknown as WorkflowState,
    taskBefore,
    isUiScope(taskBefore.write_scope),
  );
  const taskScreenshots = collectTaskScreenshots(loaded.runRoot, taskId, validator, checkIds);
  const screenshotPaths = taskScreenshots.map((s) => s.path);

  const rawReportData = {
    task_id: taskId,
    validator,
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
  const reportData = gateReviewPayload(taskId, isUiTask, rawReportData);
  const reportPath = persistReviewReport(loaded.runRoot, taskId, reportData, isUiTask);

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
