import { applicableValidatorDomains } from "../../core/contracts/index.ts";
import { HarnessError } from "../../core/errors/index.ts";
import { loadRun } from "../../engine/store/index.ts";
import { workflowPort } from "../../integration/store-ports.ts";
import { ReviewProtocolEngine, assertReviewProtocolSatisfied, type ReviewChannelKind } from "../../policy/review-protocol.ts";
import { refreshHandoffOnEscalation } from "../../reporting/handoff.ts";
import { isUiScope } from "../../validation/dual-channel-analyzer/index.ts";
import { getOpenMicroCycles, markMicroCycleAddressed } from "../../workflow/review/micro-cycle.ts";
import { probeRoundsRecorded } from "../../workflow/review/pass-preconditions.ts";
import { recordReview } from "../../workflow/review/record-review.ts";
import { assertRoleArtifactPresent, classifiesAsUiTask, gateReviewPayload, taskClassificationTexts } from "../../workflow/review/role-evidence.ts";
import { systemClock, type TaskRecord, type WorkflowState } from "../../workflow/types.ts";
import { boolFlag, textFlag, type Flags } from "../options.ts";
import { assertNoResolutions, assertOpenFindingsAnswered, resolutionProofs } from "./review-resolutions.ts";
import { buildReviewFinding, failingVerdictInput, nextFindingRound, resolveFindingRequirement } from "./task-finding-input.ts";
import {
  assembleReviewReportData,
  assertDualUiGateApproval,
  assertValidReviewer,
  assertValidSummary,
  formatReviewBrief,
  handleMicroCycleReview,
  resolveChecklistCoverage,
} from "./task-review-helpers.ts";
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

export { assertValidReviewer } from "./task-review-helpers.ts";

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
  if (status !== "pass" && status !== "fail") throw new HarnessError("INVALID_ARGUMENT", "--status must be pass or fail");

  const checklistCoverage = resolveChecklistCoverage(flags);
  if (status === "fail") assertNoResolutions(flags);
  const failure = status === "fail" ? failingVerdictInput(flags) : undefined;
  const summary = failure ? failure.observation : textFlag(flags, "summary", false);

  if (isMicroCycle && status === "fail") return handleMicroCycleReview(run, taskId, validator, flags, summary);

  const loaded = loadRun(run);
  const taskBefore = ((loaded.state.tasks ?? {}) as Record<string, TaskRecord>)[taskId];
  if (!taskBefore) throw new HarnessError("INVALID_ARGUMENT", `unknown task ${taskId}`);
  assertValidReviewer(validator, taskBefore);

  const explicitEvidence = textFlag(flags, "evidence", false) ?? textFlag(flags, "checks", false);
  const checkIds = resolveCheckIds(explicitEvidence, loaded.state.commands, taskId, validator, true);

  const isPass = status === "pass";
  if (isPass) assertValidSummary(summary);
  const openFindings = (taskBefore.findings ?? []).filter((f) => f.status === "open");
  const resolutions = isPass ? resolutionProofs(flags, taskId, openFindings) : [];
  if (isPass) assertOpenFindingsAnswered(taskId, openFindings, resolutions);

  const isUiCandidate = classifiesAsUiTask(
    loaded.state as unknown as WorkflowState,
    taskBefore,
    isUiScope(taskBefore.write_scope),
  );

  const taskScreenshots = isUiCandidate ? collectTaskScreenshots(loaded.runRoot, taskId, validator, checkIds) : [];
  const companionManifests = isUiCandidate ? collectCompanionManifests(loaded.runRoot, taskId) : [];
  const dualChannel = isUiCandidate
    ? runDualChannelAudit(loaded.runRoot, taskBefore, taskScreenshots, companionManifests, {
        requireSemanticDepth: boolFlag(flags, "require-semantic-depth"),
      })
    : { isUiTask: false, passed: true, mode: "non_ui_skipped" as const, findings: [], proofs: [], summary: "Non-UI skipped" };

  if (isPass && dualChannel.isUiTask && !dualChannel.passed) {
    throw new HarnessError("INVALID_STATE", dualChannelRefusalMessage(taskId, dualChannel));
  }
  const isUiTask = classifiesAsUiTask(loaded.state as unknown as WorkflowState, taskBefore, dualChannel.isUiTask);
  assertRoleArtifactPresent(taskId, isUiTask, {
    hasArtifact: taskScreenshots.some((s) => s.bytes >= 1024) || dualChannel.proofs.length > 0 || companionManifests.length > 0,
    screenshots: taskScreenshots,
    manifests: companionManifests,
  });

  if (isPass && isUiTask) {
    const screenshotRecords = taskScreenshots.map((s) => ({
      name: s.name,
      path: s.path,
      viewport: (s as unknown as Record<string, unknown>)["viewport"] as string | undefined,
      sizeBytes: s.bytes,
    }));
    assertDualUiGateApproval(
      taskId,
      isUiTask,
      { taskId, writeScope: taskBefore.write_scope, screenshots: screenshotRecords },
      { taskId, critique: summary ?? "Visual qualitative inspection completed.", screenshotsReviewed: taskScreenshots.map((s) => s.path), canExecuteShell: false },
    );
  }

  const findingObj = failure === undefined ? null : buildReviewFinding({
    taskId,
    findingId: customFindingId,
    round: nextFindingRound(taskBefore),
    requirementId: resolveFindingRequirement(taskBefore, textFlag(flags, "requirement", false)),
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
  if (isPass) assertReviewProtocolSatisfied(taskBefore, policy.reviewProtocol, resolutions.map((r) => r.finding_id));

  let state = recordReview(workflowPort(run), taskId, validator, reviewPayload, systemClock, policy.maxRepairRounds, policy.minProbes);

  const kindFlag = textFlag(flags, "kind", false);
  const channelKind: ReviewChannelKind = kindFlag === "cognitive" ? "cognitive" : kindFlag === "adversarial" ? "adversarial" : isPass ? "cognitive" : "adversarial";

  const engine = new ReviewProtocolEngine(policy.reviewProtocol);
  const updatedTask = state.tasks[taskId];
  if (updatedTask) {
    engine.recordEntry(updatedTask, {
      round: isPass ? (updatedTask.probe_round ?? 0) + 1 : (updatedTask.repair_round ?? 1),
      channel: channelKind,
      actor_id: validator,
      verdict: isPass ? "pass" : "reject",
      findings_count: findingObj !== null ? 1 : 0,
      summary: summary ?? (isPass ? "Validation passed" : (failure?.observation ?? "Changes requested")),
    });
  }

  if (
    findingObj === null &&
    (state.tasks[taskId]?.status === "validated" || state.tasks[taskId]?.status === "gating")
  ) {
    state = finalizePassingTask(run, taskId, validator, checkIds, state);
  }

  const openCycles = getOpenMicroCycles(state.tasks[taskId] ?? taskBefore);
  if (openCycles.length > 0) state = markMicroCycleAddressed(workflowPort(run), taskId, validator);

  const unblocked = isPass
    ? Object.values(state.tasks).filter((o) => (o.status === "proposed" || o.status === "ready") && o.dependencies.includes(taskId)).map((o) => o.id)
    : [];

  const screenshotPaths = taskScreenshots.map((s) => s.path);
  const rawReportData = assembleReviewReportData({
    taskId,
    validator,
    token,
    status,
    isPass,
    summary,
    checkIds,
    findingObj,
    checklistCoverage,
    resolutions,
    unblocked,
    task: state.tasks[taskId],
    screenshotPaths,
    taskScreenshots,
    companionManifests,
    dualChannel,
  });
  const reportData = gateReviewPayload(taskId, isUiTask, rawReportData);
  const reportPath = persistReviewReport(loaded.runRoot, taskId, reportData, isUiTask);

  const handoffPath = refreshHandoffOnEscalation(run, state.tasks[taskId]!.status);
  const findingId = findingObj === null ? null : String(findingObj.id);
  const finalTask = state.tasks[taskId]!;
  const passedDomains = new Set((finalTask.validations ?? []).filter((entry) => entry.verdict === "pass").map((entry) => entry.domain));
  const outstandingDomains = applicableValidatorDomains(
    finalTask.write_scope,
    taskClassificationTexts(state, finalTask),
  ).filter((domain) => !passedDomains.has(domain));

  const markdown = formatReviewBrief({ run, taskId, validator, state, finalTask, unblocked, outstandingDomains, failure, findingObj });

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
