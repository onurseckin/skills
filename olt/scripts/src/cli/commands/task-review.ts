import { applicableValidatorDomains } from "../../core/contracts/index.ts";
import { readRegularFileNoFollow } from "../../core/no-follow.ts";
import { HarnessError } from "../../core/errors/index.ts";
import { workflowPort } from "../../integration/store-ports.ts";
import { isValidatorDomain } from "../../packets/role-contract.ts";
import { refreshHandoffOnEscalation } from "../../reporting/handoff.ts";
import { loadRun } from "../../engine/store/index.ts";
import { tokenDigest } from "../../workflow/lease/token.ts";
import { gateRunEvidence, probeRoundsRecorded } from "../../workflow/review/pass-preconditions.ts";
import { recordReview } from "../../workflow/review/record-review.ts";
import {
  assertRoleArtifactPresent,
  classifiesAsUiTask,
  gateReviewPayload,
  taskClassificationTexts,
} from "../../workflow/review/role-evidence.ts";
import { isUiScope } from "../../validation/dual-channel-analyzer/index.ts";
import {
  validateChecklistCoverage,
  type ChecklistCoverageReport,
} from "../../workflow/review/validate-review.ts";
import { systemClock, type TaskRecord, type WorkflowState } from "../../workflow/types.ts";
import {
  DEFAULT_MAX_MICRO_CYCLES,
  formatMicroCycleFeedback,
  getLatestMicroCycle,
  getOpenMicroCycles,
  markMicroCycleAddressed,
  recordMicroCycleCritique,
} from "../../workflow/review/micro-cycle.ts";
import {
  assertReviewProtocolSatisfied,
  projectTaskReviewState,
  ReviewProtocolEngine,
  type ReviewChannelKind,
} from "../../policy/review-protocol.ts";
import { formatTaskRejectBrief, formatTaskReviewPassBrief } from "../formatters/index.ts";
import { boolFlag, integerFlag, textFlag, type Flags } from "../options.ts";
import {
  assertNoResolutions,
  assertOpenFindingsAnswered,
  resolutionProofs,
} from "./review-resolutions.ts";
import {
  buildReviewFinding,
  failingVerdictInput,
  nextFindingRound,
  resolveFindingRequirement,
} from "./task-finding-input.ts";
import {
  collectCompanionManifests,
  collectTaskScreenshots,
  dualChannelRefusalMessage,
  finalizePassingTask,
  persistReviewReport,
  resolveCheckIds,
  reviewPolicyFor,
  runDualChannelAudit,
} from "./task-review-support.ts";

type ChecklistCoverageResult =
  | ({ applicable: true } & ChecklistCoverageReport)
  | { applicable: false; reason: string };

function resolveChecklistCoverage(flags: Flags): ChecklistCoverageResult {
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

function gateEvidenceSummary(state: WorkflowState, task: TaskRecord): string {
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

export async function taskReviewCommand(flags: Flags): Promise<Record<string, unknown>> {
  const isMicroCycle = boolFlag(flags, "micro-cycle") || boolFlag(flags, "in-lease");
  const [run, taskId, validator, token, status] = [
    textFlag(flags, "run")!,
    textFlag(flags, "task")!,
    textFlag(flags, "validator")!,
    textFlag(flags, "token")!,
    textFlag(flags, "status")!,
  ];
  const customFindingId = textFlag(flags, "finding-id", false);
  if (status !== "pass" && status !== "fail") {
    throw new HarnessError("INVALID_ARGUMENT", "--status must be pass or fail");
  }
  const checklistCoverage = resolveChecklistCoverage(flags);
  if (status === "fail") assertNoResolutions(flags);
  const failure = status === "fail" ? failingVerdictInput(flags) : undefined;
  const summary = failure ? failure.observation : textFlag(flags, "summary", false);

  if (isMicroCycle && status === "fail") {
    const reason =
      failure?.observation !== undefined
        ? failure.observation
        : summary !== undefined
          ? summary
          : "Micro-cycle critique";
    const remediation =
      failure?.remediation !== undefined
        ? failure.remediation
        : textFlag(flags, "remediation", false);
    const defect =
      failure?.observation !== undefined
        ? failure.observation
        : textFlag(flags, "defect", false) !== undefined
          ? textFlag(flags, "defect", false)
          : reason;
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

  const loaded = loadRun(run);
  const taskBefore = ((loaded.state.tasks ?? {}) as Record<string, TaskRecord>)[taskId];
  if (!taskBefore) throw new HarnessError("INVALID_ARGUMENT", `unknown task ${taskId}`);
  assertValidReviewer(validator, taskBefore);

  const explicitEvidence = textFlag(flags, "evidence", false) ?? textFlag(flags, "checks", false);
  const checkIds = resolveCheckIds(
    explicitEvidence,
    loaded.state.commands,
    taskId,
    validator,
    true,
  );

  const isPass = status === "pass";
  if (isPass && summary !== undefined) {
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
  const openFindings = (taskBefore.findings ?? []).filter((f) => f.status === "open");
  const resolutions = isPass ? resolutionProofs(flags, taskId, openFindings) : [];
  if (isPass) assertOpenFindingsAnswered(taskId, openFindings, resolutions);

  const requireSemanticDepth = boolFlag(flags, "require-semantic-depth");
  const isUiScopeCandidate = isUiScope(taskBefore.write_scope);
  const isUiCandidate = classifiesAsUiTask(
    loaded.state as unknown as WorkflowState,
    taskBefore,
    isUiScopeCandidate,
  );

  const taskScreenshots = isUiCandidate
    ? collectTaskScreenshots(loaded.runRoot, taskId, validator, checkIds)
    : [];
  const companionManifests = isUiCandidate ? collectCompanionManifests(loaded.runRoot, taskId) : [];
  const dualChannel = isUiCandidate
    ? runDualChannelAudit(loaded.runRoot, taskBefore, taskScreenshots, companionManifests, {
        requireSemanticDepth,
      })
    : {
        isUiTask: false,
        passed: true,
        mode: "non_ui_skipped" as const,
        findings: [],
        proofs: [],
        summary: "Task does not touch UI or frontend scopes. Visual validation bypassed.",
      };

  if (isPass && dualChannel.isUiTask && !dualChannel.passed) {
    throw new HarnessError("INVALID_STATE", dualChannelRefusalMessage(taskId, dualChannel));
  }
  const isUiTask = classifiesAsUiTask(
    loaded.state as unknown as WorkflowState,
    taskBefore,
    dualChannel.isUiTask,
  );
  assertRoleArtifactPresent(taskId, isUiTask, {
    hasArtifact:
      taskScreenshots.some((s) => s.bytes >= 1024) ||
      dualChannel.proofs.length > 0 ||
      companionManifests.length > 0,
    screenshots: taskScreenshots,
    manifests: companionManifests,
  });

  const findingObj =
    failure === undefined
      ? null
      : buildReviewFinding({
          taskId,
          findingId: customFindingId,
          round: nextFindingRound(taskBefore),
          requirementId: resolveFindingRequirement(
            taskBefore,
            textFlag(flags, "requirement", false),
          ),
          severity: failure.severity,
          checkIds,
          summary: failure.observation,
          remediation: failure.remediation,
          ...(failure.revalidation === undefined ? {} : { revalidation: failure.revalidation }),
        });

  const reviewPayload: Record<string, unknown> = {
    verdict: isPass ? "pass" : "reject",
    validation_token: token,
    requirement_ids: taskBefore.requirement_ids,
    checks: checkIds.map((id) => ({ command_id: id })),
    findings: findingObj === null ? [] : [findingObj],
    ...(resolutions.length === 0 ? {} : { resolved_findings: resolutions }),
  };

  const policy = reviewPolicyFor(loaded.runRoot, validator);
  if (isPass) {
    assertReviewProtocolSatisfied(
      taskBefore,
      policy.reviewProtocol,
      resolutions.map((r) => r.finding_id),
    );
  }

  let state = recordReview(
    workflowPort(run),
    taskId,
    validator,
    reviewPayload,
    systemClock,
    policy.maxRepairRounds,
    policy.minProbes,
  );

  const kindFlag = textFlag(flags, "kind", false);
  const channelKind: ReviewChannelKind =
    kindFlag === "cognitive"
      ? "cognitive"
      : kindFlag === "adversarial"
        ? "adversarial"
        : isPass
          ? "cognitive"
          : "adversarial";

  const engine = new ReviewProtocolEngine(policy.reviewProtocol);
  const updatedTaskBeforeSave = state.tasks[taskId];
  if (updatedTaskBeforeSave) {
    engine.recordEntry(updatedTaskBeforeSave, {
      round: isPass
        ? (updatedTaskBeforeSave.probe_round ?? 0) + 1
        : (updatedTaskBeforeSave.repair_round ?? 1),
      channel: channelKind,
      actor_id: validator,
      verdict: isPass ? "pass" : "reject",
      findings_count: findingObj !== null ? 1 : 0,
      summary:
        summary ?? (isPass ? "Validation passed" : (failure?.observation ?? "Changes requested")),
    });
  }

  if (findingObj === null) {
    state = finalizePassingTask(run, taskId, validator, checkIds, state);
  }

  const openCycles = getOpenMicroCycles(state.tasks[taskId] ?? taskBefore);
  if (openCycles.length > 0) {
    state = markMicroCycleAddressed(workflowPort(run), taskId, validator);
  }

  const unblocked = isPass
    ? Object.values(state.tasks)
        .filter(
          (o) =>
            (o.status === "proposed" || o.status === "ready") && o.dependencies.includes(taskId),
        )
        .map((o) => o.id)
    : [];

  const screenshotPaths = taskScreenshots.map((s) => s.path);

  const rawReportData = {
    task_id: taskId,
    validator,
    token_digest: tokenDigest(token),
    status,
    verdict: isPass ? "pass" : "reject",
    ...(summary === undefined ? {} : { summary }),
    created_at: new Date().toISOString(),
    checks: checkIds,
    findings: findingObj === null ? [] : [findingObj],
    task_scope_findings: findingObj === null ? [] : [findingObj],
    checklist_coverage: checklistCoverage,
    resolved_findings: resolutions,
    unblocked,
    task: state.tasks[taskId],
    screenshots: screenshotPaths,
    screenshot_records: taskScreenshots,
    companion_manifests: companionManifests,
    dual_channel_audit: dualChannel,
  };
  const reportData = gateReviewPayload(taskId, isUiTask, rawReportData);
  const reportPath = persistReviewReport(loaded.runRoot, taskId, reportData, isUiTask);

  const handoffPath = refreshHandoffOnEscalation(run, state.tasks[taskId]!.status);
  const findingId = findingObj === null ? null : String(findingObj.id);
  const finalTask = state.tasks[taskId]!;
  const passedDomains = new Set(
    (finalTask.validations ?? [])
      .filter((entry) => entry.verdict === "pass")
      .map((entry) => entry.domain),
  );
  const outstandingDomains = applicableValidatorDomains(
    finalTask.write_scope,
    taskClassificationTexts(state, finalTask),
  ).filter((domain) => !passedDomains.has(domain));
  const markdown =
    failure === undefined || findingObj === null
      ? formatTaskReviewPassBrief({
          taskId,
          validator,
          gateSummary: gateEvidenceSummary(state, finalTask),
          unblockedTasks: unblocked,
          reportPath: `${run}/reports/${taskId}-review.json`,
          probeRounds: probeRoundsRecorded(finalTask),
          taskStatus: finalTask.status,
          outstandingDomains,
        })
      : formatTaskRejectBrief({
          taskId,
          validator,
          findingId: String(findingObj.id),
          issue: failure.observation,
          status: state.tasks[taskId]!.status,
        });

  return {
    markdown,
    run_root: run,
    task: state.tasks[taskId]!,
    verdict: status,
    unblocked,
    report_path: reportPath,
    screenshots: isUiTask ? screenshotPaths : [],
    screenshot_records: isUiTask ? taskScreenshots : [],
    companion_manifests: isUiTask ? companionManifests : [],
    dual_channel_audit: dualChannel,
    probe_rounds: probeRoundsRecorded(state.tasks[taskId]!),
    min_adversarial_probes: policy.minProbes,
    resolved_findings: resolutions,
    checklist_coverage: checklistCoverage,
    ...(handoffPath === undefined ? {} : { handoff_path: handoffPath }),
    ...(findingObj === null ? {} : { finding_id: findingId, finding: findingObj }),
  };
}
