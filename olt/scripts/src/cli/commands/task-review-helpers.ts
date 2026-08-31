import { readRegularFileNoFollow } from "../../core/no-follow.ts";
import { HarnessError } from "../../core/errors/index.ts";
import { isValidatorDomain } from "../../packets/role-contract.ts";
import { workflowPort } from "../../integration/store-ports.ts";
import { gateRunEvidence, probeRoundsRecorded } from "../../workflow/review/pass-preconditions.ts";
import {
  DEFAULT_MAX_MICRO_CYCLES,
  formatMicroCycleFeedback,
  getLatestMicroCycle,
  recordMicroCycleCritique,
} from "../../workflow/review/micro-cycle.ts";
import {
  validateChecklistCoverage,
  type ChecklistCoverageReport,
} from "../../workflow/review/validate-review.ts";
import type { TaskRecord, WorkflowState } from "../../workflow/types.ts";
import { formatTaskRejectBrief, formatTaskReviewPassBrief } from "../formatters/index.ts";
import { integerFlag, textFlag, type Flags } from "../options.ts";
import { failingVerdictInput, type ReviewFindingParams } from "./task-finding-input.ts";
import {
  evaluateDualUiGates,
  type DualUiAuditResult,
  type UiCognitiveInspectionInput,
  type UiMechanicInspectionInput,
} from "../../validation/ui/index.ts";
import { tokenDigest } from "../../workflow/lease/token.ts";
import type { ScreenshotRecord } from "../../reporting/screenshot-types.ts";
import type {
  CompanionManifestData,
  DualChannelAuditResult,
} from "../../validation/dual-channel-analyzer/index.ts";

export type ChecklistCoverageResult =
  | ({ applicable: true } & ChecklistCoverageReport)
  | { applicable: false; reason: string };

export function resolveChecklistCoverage(flags: Flags): ChecklistCoverageResult {
  const domain = textFlag(flags, "checklist-domain", false);
  const reportPath = textFlag(flags, "checklist-report", false);
  if (domain === undefined && reportPath === undefined) {
    return {
      applicable: false,
      reason:
        "no --checklist-domain was named for this review; no standing checklist coverage applies",
    };
  }
  if (domain === undefined || reportPath === undefined) {
    throw new HarnessError(
      "INVALID_ARGUMENT",
      "--checklist-domain and --checklist-report must be given together",
    );
  }
  if (!isValidatorDomain(domain)) {
    throw new HarnessError(
      "INVALID_ARGUMENT",
      `--checklist-domain is not a recognized validator domain: ${domain}`,
    );
  }
  let bytes: Uint8Array;
  try {
    bytes = readRegularFileNoFollow(reportPath);
  } catch (error) {
    throw new HarnessError(
      "INVALID_ARGUMENT",
      `--checklist-report is unreadable: ${reportPath}: ${String(error)}`,
    );
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes));
  } catch (error) {
    throw new HarnessError(
      "INVALID_ARGUMENT",
      `--checklist-report is not valid JSON: ${reportPath}: ${String(error)}`,
    );
  }
  return { applicable: true, ...validateChecklistCoverage(domain, parsed) };
}

export function gateEvidenceSummary(state: WorkflowState, task: TaskRecord): string {
  const evidence = gateRunEvidence(state, task);
  if (evidence.length === 0) return "no mandatory gate applies to this task";
  return evidence
    .map(({ gate_id, run }) =>
      run === undefined
        ? `${gate_id}: no recorded run`
        : `${gate_id}: ${run.command_id} exited ${run.exit_code === null ? run.status : run.exit_code}`,
    )
    .join("; ");
}

export function assertValidReviewer(callerId: string, task: TaskRecord): void {
  const pairedValidatorId = (task.lease as { readonly paired_validator_id?: string } | undefined)
    ?.paired_validator_id;
  if (pairedValidatorId && callerId !== pairedValidatorId) {
    throw new HarnessError(
      "INVALID_ARGUMENT",
      `Reviewer Authorization Failed: Caller '${callerId}' is not the assigned paired validator ('${pairedValidatorId}') for task '${task.id}'.`,
    );
  }
}

export function assertValidSummary(summary: string | undefined): void {
  if (summary === undefined) return;
  const trimmedSummary = summary.trim().toLowerCase();
  const genericSignOffs = new Set([
    "looks good",
    "lgtm",
    "all good",
    "passed",
    "pass",
    "ok",
    "fine",
    "done",
    "approved",
    "verified",
    "no issues",
    "all tests pass",
    "rubber stamp",
    "n/a",
    "none",
  ]);
  if (trimmedSummary.length < 12 || genericSignOffs.has(trimmedSummary)) {
    throw new HarnessError(
      "INVALID_ARGUMENT",
      "validator summary cannot be a superficial rubber-stamp or generic sign-off; provide concrete evidence and verification details",
    );
  }
}

export function assertDualUiGateApproval(
  taskId: string,
  isUiTask: boolean,
  mechanicInput: UiMechanicInspectionInput,
  cognitiveInput: UiCognitiveInspectionInput,
): DualUiAuditResult {
  if (!isUiTask) {
    return evaluateDualUiGates({ isUiTask: false });
  }

  const result = evaluateDualUiGates({
    isUiTask: true,
    mechanicInput,
    cognitiveInput,
  });

  if (!result.passed) {
    const errorDetails = result.defects.map((d) => `[${d.pillar}] ${d.message}`).join("; ");
    throw new HarnessError(
      "INVALID_STATE",
      `cannot pass UI task ${taskId}: Dual UI Validator Separation mandate not satisfied (mode: ${result.mode}): ${errorDetails || result.summary}`,
    );
  }

  return result;
}

export function handleMicroCycleReview(
  run: string,
  taskId: string,
  validator: string,
  flags: Flags,
  summary?: string,
): Record<string, unknown> {
  const failure = failingVerdictInput(flags);
  const reason = failure?.observation ?? summary ?? "Micro-cycle critique";
  const remediation = failure?.remediation ?? textFlag(flags, "remediation", false);
  const defect = failure?.observation ?? textFlag(flags, "defect", false) ?? reason;
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

export function assembleReviewReportData(params: {
  taskId: string;
  validator: string;
  token: string;
  status: string;
  isPass: boolean;
  summary?: string | undefined;
  checkIds: readonly string[];
  findingObj: Record<string, unknown> | null;
  checklistCoverage: ChecklistCoverageResult;
  resolutions: readonly unknown[];
  unblocked: readonly string[];
  task?: TaskRecord | undefined;
  screenshotPaths: readonly string[];
  taskScreenshots: readonly ScreenshotRecord[];
  companionManifests: readonly CompanionManifestData[];
  dualChannel: DualChannelAuditResult;
}): Record<string, unknown> {
  const findingArray = params.findingObj === null ? [] : [params.findingObj];
  return {
    task_id: params.taskId,
    validator: params.validator,
    token_digest: tokenDigest(params.token),
    status: params.status,
    verdict: params.isPass ? "pass" : "reject",
    ...(params.summary === undefined ? {} : { summary: params.summary }),
    created_at: new Date().toISOString(),
    checks: params.checkIds,
    findings: findingArray,
    task_scope_findings: findingArray,
    checklist_coverage: params.checklistCoverage,
    resolved_findings: params.resolutions,
    unblocked: params.unblocked,
    task: params.task,
    screenshots: params.screenshotPaths,
    screenshot_records: params.taskScreenshots,
    companion_manifests: params.companionManifests,
    dual_channel_audit: params.dualChannel,
  };
}

export function formatReviewBrief(params: {
  run: string;
  taskId: string;
  validator: string;
  state: WorkflowState;
  finalTask: TaskRecord;
  unblocked: readonly string[];
  outstandingDomains: readonly string[];
  failure?: { observation: string } | undefined;
  findingObj: Record<string, unknown> | null;
}): string {
  if (params.failure === undefined || params.findingObj === null) {
    return formatTaskReviewPassBrief({
      taskId: params.taskId,
      validator: params.validator,
      gateSummary: gateEvidenceSummary(params.state, params.finalTask),
      unblockedTasks: [...params.unblocked],
      reportPath: `${params.run}/reports/${params.taskId}-review.json`,
      probeRounds: probeRoundsRecorded(params.finalTask),
      taskStatus: params.finalTask.status,
      outstandingDomains: [...params.outstandingDomains],
    });
  }
  return formatTaskRejectBrief({
    taskId: params.taskId,
    validator: params.validator,
    findingId: String(params.findingObj.id),
    issue: params.failure.observation,
    status: params.state.tasks[params.taskId]!.status,
  });
}
