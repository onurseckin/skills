import { HarnessError } from "../../core/errors/harness-error.ts";
import { workflowPort } from "../../integration/store-ports.ts";
import { loadRun } from "../../engine/store/index.ts";
import { ReviewProtocolEngine, type ReviewChannelKind } from "../../policy/review-protocol.ts";
import { probeRoundsRecorded } from "../../workflow/review/pass-preconditions.ts";
import { recordProbe } from "../../workflow/review/record-probe.ts";
import type { TaskRecord } from "../../workflow/types.ts";
import { formatTaskProbeBrief } from "../formatters/index.ts";
import { listFlag, textFlag, type Flags } from "../options.ts";
import {
  buildProbeDemand,
  persistProbeReport,
  resolveFindingRequirement,
  reviewPolicyFor,
} from "./task-review-support.ts";

export async function taskProbeCommand(flags: Flags): Promise<Record<string, unknown>> {
  const [run, taskId, validator, token] = [
    textFlag(flags, "run")!,
    textFlag(flags, "task")!,
    textFlag(flags, "validator")!,
    textFlag(flags, "token")!,
  ];
  const demands = listFlag(flags, "demand", true)!;
  const revalidation = textFlag(flags, "revalidation", false);
  const citedEvidence = textFlag(flags, "evidence", false);
  const kindFlag = textFlag(flags, "kind", false);
  const channelKind: ReviewChannelKind = kindFlag === "adversarial" ? "adversarial" : "cognitive";
  const commandIds = citedEvidence
    ? citedEvidence
        .split(",")
        .map((id) => id.trim())
        .filter(Boolean)
    : [];

  const loaded = loadRun(run);
  const taskBefore = ((loaded.state.tasks ?? {}) as Record<string, TaskRecord>)[taskId];
  if (!taskBefore) throw new HarnessError("INVALID_ARGUMENT", `unknown task ${taskId}`);
  const requirementId = resolveFindingRequirement(
    taskBefore,
    textFlag(flags, "requirement", false),
  );
  const round = probeRoundsRecorded(taskBefore) + 1;

  const findings = demands.map((demand, index) =>
    buildProbeDemand({
      taskId,
      round,
      index,
      requirementId,
      demand,
      commandIds,
      revalidation,
      kind: channelKind === "cognitive" ? "cognitive_probe" : "adversarial_probe",
    }),
  );

  const state = recordProbe(workflowPort(run), taskId, validator, {
    validation_token: token,
    findings,
  });
  const policy = reviewPolicyFor(loaded.runRoot, validator);
  const engine = new ReviewProtocolEngine(policy.reviewProtocol);
  const updatedTask = state.tasks[taskId]!;

  engine.recordEntry(updatedTask, {
    round,
    channel: channelKind,
    actor_id: validator,
    verdict: "probe",
    probe_demands_count: findings.length,
    summary: `Probe round ${round} (${channelKind}): ${findings.map((f) => String(f.observation)).join("; ")}`,
  });

  const demandSummaries = findings.map((finding) => ({
    id: String(finding.id),
    demand: String(finding.observation),
  }));
  const reportData = {
    task_id: taskId,
    validator,
    verdict: "probe",
    channel: channelKind,
    round,
    created_at: new Date().toISOString(),
    demands: findings,
    cited_commands: commandIds,
    task: updatedTask,
  };
  const reportPath = persistProbeReport(loaded.runRoot, taskId, round, reportData);

  const markdown = formatTaskProbeBrief({
    taskId,
    validator,
    round,
    demands: demandSummaries,
    repairRound: updatedTask.repair_round,
  });
  return {
    markdown,
    run_root: run,
    task: updatedTask,
    verdict: "probe",
    channel: channelKind,
    probe_round: round,
    repair_round: updatedTask.repair_round,
    min_adversarial_probes: policy.minProbes,
    finding_ids: demandSummaries.map((demand) => demand.id),
    findings,
    report_path: reportPath,
    review_state: (updatedTask as Record<string, unknown>)["review_state"],
  };
}
