import { HarnessError } from "../../errors/harness-error.ts";
import { workflowPort } from "../../integration/store-ports.ts";
import { loadRun } from "../../store/index.ts";
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
  // Only explicitly cited commands become evidence: a probe must not vacuum up unrelated runs.
  const citedEvidence = textFlag(flags, "evidence", false);
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
    buildProbeDemand({ taskId, round, index, requirementId, demand, commandIds, revalidation }),
  );
  const state = recordProbe(workflowPort(run), taskId, validator, {
    validation_token: token,
    findings,
  });
  const policy = reviewPolicyFor(loaded.runRoot);
  const demandSummaries = findings.map((finding) => ({
    id: String(finding.id),
    demand: String(finding.observation),
  }));
  const reportData = {
    task_id: taskId,
    validator,
    verdict: "probe",
    round,
    created_at: new Date().toISOString(),
    demands: findings,
    cited_commands: commandIds,
    task: state.tasks[taskId],
  };
  const reportPath = persistProbeReport(loaded.runRoot, taskId, round, reportData);

  const markdown = formatTaskProbeBrief({
    taskId,
    validator,
    round,
    demands: demandSummaries,
    repairRound: state.tasks[taskId]!.repair_round,
    ...(policy.legacyRejectionWarning ? { warning: policy.legacyRejectionWarning } : {}),
  });
  return {
    markdown,
    run_root: run,
    task: state.tasks[taskId]!,
    verdict: "probe",
    probe_round: round,
    repair_round: state.tasks[taskId]!.repair_round,
    min_adversarial_probes: policy.minProbes,
    finding_ids: demandSummaries.map((demand) => demand.id),
    findings,
    report_path: reportPath,
    ...(policy.legacyRejectionWarning ? { warning: policy.legacyRejectionWarning } : {}),
  };
}
