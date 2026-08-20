import { HarnessError } from "../../errors/harness-error.ts";
import { workflowPort } from "../../integration/store-ports.ts";
import { refreshHandoffOnEscalation } from "../../reporting/handoff.ts";
import { loadRun } from "../../store/index.ts";
import { tokenDigest } from "../../workflow/lease/token.ts";
import { gateRunEvidence, probeRoundsRecorded } from "../../workflow/review/pass-preconditions.ts";
import { recordReview } from "../../workflow/review/record-review.ts";
import { systemClock, type TaskRecord, type WorkflowState } from "../../workflow/types.ts";
import { formatTaskRejectBrief, formatTaskReviewPassBrief } from "../formatters/index.ts";
import { textFlag, type Flags } from "../options.ts";
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
  collectTaskScreenshots,
  finalizePassingTask,
  persistReviewReport,
  resolveCheckIds,
  reviewPolicyFor,
} from "./task-review-support.ts";

/** Reads the gate ledger back to the validator: a gate nobody ran says so, in those words. */
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

export async function taskReviewCommand(flags: Flags): Promise<Record<string, unknown>> {
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
  // The shape of the call is judged before its content: --resolve on a failing verdict is a
  // contradiction, and saying so is more use than demanding the finding fields first.
  if (status === "fail") assertNoResolutions(flags);
  // A failing review is a claim about a specific defect. Its severity and its remediation are the
  // validator's judgement; substituting either would file the harness's sentence under the
  // validator's name, so both are demanded and neither has a default.
  const failure = status === "fail" ? failingVerdictInput(flags) : undefined;
  // The summary is the validator's own sentence. A pass that came without one has none, and
  // "Validation pass" was a sentence the harness wrote and then filed under the validator's name.
  const summary = failure ? failure.observation : textFlag(flags, "summary", false);

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
  const resolutions = isPass ? resolutionProofs(flags, taskId, openFindings) : [];
  if (isPass) assertOpenFindingsAnswered(taskId, openFindings, resolutions);

  // A passing review carries no finding, so the requirement binding is only resolved when one is
  // actually recorded; a multi-requirement task would otherwise be forced to name a requirement to
  // sign off on work that has no defect to bind.
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

  const policy = reviewPolicyFor(loaded.runRoot);
  let state = recordReview(
    workflowPort(run),
    taskId,
    validator,
    reviewPayload,
    systemClock,
    policy.maxRepairRounds,
    policy.minProbes,
  );
  if (findingObj === null) {
    state = finalizePassingTask(run, taskId, validator, checkIds, state);
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
  const screenshotPaths = taskScreenshots.map((s) => s.path);

  const reportData = {
    task_id: taskId,
    validator,
    // The bearer token stays out of the report; the digest is enough to verify which token signed it.
    token_digest: tokenDigest(token),
    status,
    verdict: isPass ? "pass" : "reject",
    // Absent when the validator wrote none; the field is not filled in on its behalf.
    ...(summary === undefined ? {} : { summary }),
    created_at: new Date().toISOString(),
    checks: checkIds,
    findings: findingObj === null ? [] : [findingObj],
    resolved_findings: resolutions,
    unblocked,
    task: state.tasks[taskId],
    screenshots: screenshotPaths,
    screenshot_records: taskScreenshots,
  };
  const reportPath = persistReviewReport(loaded.runRoot, taskId, reportData);

  const handoffPath = refreshHandoffOnEscalation(run, state.tasks[taskId]!.status);
  const findingId = findingObj === null ? null : String(findingObj.id);
  const markdown =
    failure === undefined || findingObj === null
      ? formatTaskReviewPassBrief({
          taskId,
          validator,
          // What the harness recorded for each gate, not a composed sentence. "(passed with exit
          // code 0)" asserted an exit code nothing here had read, and a task whose gate was never
          // run printed it too.
          gateSummary: gateEvidenceSummary(state, state.tasks[taskId]!),
          unblockedTasks: unblocked,
          reportPath: `${run}/reports/${taskId}-review.json`,
          probeRounds: probeRoundsRecorded(state.tasks[taskId]!),
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
    screenshots: screenshotPaths,
    screenshot_records: taskScreenshots,
    probe_rounds: probeRoundsRecorded(state.tasks[taskId]!),
    min_adversarial_probes: policy.minProbes,
    resolved_findings: resolutions,
    ...(handoffPath === undefined ? {} : { handoff_path: handoffPath }),
    ...(policy.legacyRejectionWarning ? { warning: policy.legacyRejectionWarning } : {}),
    ...(findingObj === null ? {} : { finding_id: findingId, finding: findingObj }),
  };
}
