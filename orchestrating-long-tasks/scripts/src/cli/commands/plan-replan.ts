import { basename } from "node:path";
import { readFileSync } from "node:fs";
import { HarnessError } from "../../errors/harness-error.ts";
import { loadRun } from "../../store/index.ts";
import { transact } from "../../store/transaction.ts";
import { formatPlanReplanBrief } from "../formatters/index.ts";
import { partitionFindingsIntoScopes } from "../../workflow/scope-partitioner.ts";
import { utc } from "../../workflow/task-state.ts";
import type { TaskRecord, GateRuntime } from "../../workflow/types.ts";
import { actorFlag, integerFlag, textFlag, type Flags } from "../options.ts";
import { collectReplanFindings } from "./plan-replan-findings.ts";
import {
  parseGateArgv,
  readPlanBindings,
  resolveClusterFindingRequirement,
  resolveClusterGate,
  type GateSource,
} from "./plan-replan-bindings.ts";

export function planReplanCommand(flags: Flags): Record<string, unknown> {
  const run = textFlag(flags, "run")!;
  const actor = actorFlag(flags);
  const roundFlag = integerFlag(flags, "round");
  const gateFlag = textFlag(flags, "gate", false);
  // An absent --gate stays absent. The gate becomes the repair task's mandatory proof, so a
  // convenient default would be recorded as a measurement of something nobody chose to run.
  const flagGate = gateFlag === undefined ? undefined : parseGateArgv(gateFlag);
  if (gateFlag !== undefined && flagGate === undefined)
    throw new HarnessError("INVALID_ARGUMENT", "--gate must name a command");

  const loaded = loadRun(run);
  const state = loaded.state;
  const bindings = readPlanBindings(state);

  const findingsToPartition = collectReplanFindings({
    inline: textFlag(flags, "findings", false),
    file: textFlag(flags, "findings-file", false),
    readFile: (path) => readFileSync(path, "utf-8"),
    recorded: state.completion_review,
  });
  if (findingsToPartition.length === 0)
    throw new HarnessError("INVALID_STATE", "no findings available for replanning");

  const currentTasks = Object.values(
    (state.tasks ?? {}) as Record<string, { repair_round?: number }>,
  );
  const maxRound = Math.max(0, ...currentTasks.map((t) => t.repair_round ?? 0));
  const repairRound = roundFlag ?? maxRound + 1;

  const clusters = partitionFindingsIntoScopes(findingsToPartition, repairRound);
  if (clusters.length === 0)
    throw new HarnessError("INVALID_STATE", "scope partitioner generated 0 clusters");

  // Both bindings resolve before the transaction: a cluster the harness cannot bind to a real gate
  // and a real requirement must abort the replan rather than reach state carrying a stand-in.
  const resolved = clusters.map((cluster) => {
    const gate = resolveClusterGate(bindings, {
      taskId: cluster.taskId,
      writeScope: cluster.writeScope,
      declared: cluster.findings
        .map((finding) => parseGateArgv(finding.revalidation_gate ?? null))
        .filter((argv): argv is string[] => argv !== undefined),
      flagGate,
    });
    return {
      cluster,
      gate,
      requirementIds: cluster.findings.map((finding) =>
        resolveClusterFindingRequirement(
          bindings,
          finding.requirement_id,
          finding.id,
          cluster.writeScope,
        ),
      ),
    };
  });

  const currentRev = (state.graph_revision as number | undefined) ?? 1;
  const nextRev = currentRev + 1;

  let totalTasksCount = 0;

  transact(
    run,
    actor,
    "plan-recompiled",
    {
      revision: nextRev,
      new_tasks: clusters.map((c) => c.taskId),
      repair_round: repairRound,
    },
    (draft) => {
      draft.plan_history ??= [];
      (draft.plan_history as Record<string, unknown>[]).push({
        revision: currentRev,
        tasks_count: Object.keys(draft.tasks ?? {}).length,
        archived_at: utc(new Date()),
      });

      draft.tasks ??= {};
      const draftTasks = draft.tasks as Record<string, TaskRecord>;

      for (const { cluster, gate, requirementIds } of resolved) {
        const revalidation = gate.argv.join(" ");
        draftTasks[cluster.taskId] = {
          id: cluster.taskId,
          status: "ready",
          requirement_ids: [...new Set(requirementIds)],
          write_scope: [...cluster.writeScope],
          dependencies: [],
          attempts: [],
          history: [
            {
              at: utc(new Date()),
              actor,
              from: "proposed",
              to: "ready",
              reason: `Injected in Repair Wave ${repairRound}`,
              attempt: 1,
            },
          ],
          repair_round: repairRound,
          findings: cluster.findings.map((finding, index) => ({
            id: finding.id,
            requirement_id: requirementIds[index]!,
            severity: finding.severity === "suggestion" ? "minor" : finding.severity,
            observation: finding.observation,
            evidence: [],
            remediation: finding.remediation,
            revalidation,
            status: "open",
          })),
        };

        draft.gates ??= [];
        const gateList = draft.gates as GateRuntime[];
        const gateId = `gate-${cluster.taskId}`;
        if (!gateList.some((g) => g.id === gateId)) {
          gateList.push({
            id: gateId,
            command: [...gate.argv],
            cwd: ".",
            scope: "task",
            requirement_ids: draftTasks[cluster.taskId]!.requirement_ids,
            mandatory: true,
          });
        }
      }

      if (draft.completion_critic) {
        if (draft.completion_critic_history) {
          const hist = (
            draft.completion_critic_history as { attempt: number; status: string }[]
          ).find((h) => h.attempt === (draft.completion_critic as { attempt?: number })?.attempt);
          if (hist) hist.status = "expired";
        }
        delete (draft as { completion_critic?: unknown }).completion_critic;
      }

      delete (draft as { completion_review?: unknown }).completion_review;
      draft.graph_revision = nextRev;
      totalTasksCount = Object.keys(draftTasks).length;
    },
  );

  const markdown = formatPlanReplanBrief({
    revision: nextRev,
    repairRound,
    newTasksCount: clusters.length,
    repairTasks: resolved.map(({ cluster, gate }) => ({
      id: cluster.taskId,
      writeScope: cluster.writeScope,
      findingsCount: cluster.findings.length,
      gate: gate.argv.join(" "),
      gateSource: gate.source,
    })),
    runId: basename(run),
  });

  return {
    markdown,
    run_root: run,
    revision: nextRev,
    repair_round: repairRound,
    new_tasks: clusters.map((c) => c.taskId),
    repair_tasks: resolved.map(({ cluster, gate, requirementIds }) => ({
      ...cluster,
      gateCommand: gate.argv,
      gate_source: gate.source satisfies GateSource,
      requirement_ids: [...new Set(requirementIds)],
    })),
    total_tasks: totalTasksCount,
  };
}
