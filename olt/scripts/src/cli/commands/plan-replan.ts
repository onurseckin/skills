import { basename, resolve } from "node:path";
import { readFileSync } from "node:fs";
import { getHarnessConfig } from "../../core/config/harness-config.ts";
import { HarnessError } from "../../core/errors/harness-error.ts";
import { dependencyMap } from "../../graph/dependency-map.ts";
import { normalizeScopePath } from "../../graph/scope-analyzer.ts";
import { projectPlan } from "../../graph/project-plan.ts";
import { guardPlanRevision } from "../../graph/revision-guard.ts";
import { isRecord } from "../../requirements/predicates.ts";
import { recordTopology } from "../../engine/scheduler/index.ts";
import { loadRun } from "../../engine/store/index.ts";
import { transact } from "../../engine/store/transaction.ts";
import { formatPlanReplanBrief } from "../formatters/index.ts";
import { partitionFindingsIntoScopes } from "../../workflow/scope-partitioner.ts";
import { utc } from "../../workflow/task-state.ts";
import type { Finding } from "../../core/contracts/workflow.ts";
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
    tasks: state.tasks,
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

  const priorGraphRevision =
    isRecord(state.graph) && typeof state.graph.revision === "number"
      ? state.graph.revision
      : undefined;
  const currentRev = (state.graph_revision as number | undefined) ?? priorGraphRevision ?? 1;
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
      if (!isRecord(draft.graph)) {
        throw new HarnessError(
          "INVALID_STATE",
          "plan:replan requires a compiled plan; run plan:compile first",
        );
      }

      draft.plan_history ??= [];
      (draft.plan_history as Record<string, unknown>[]).push({
        revision: currentRev,
        tasks_count: Object.keys(draft.tasks ?? {}).length,
        archived_at: utc(new Date()),
      });

      const newGraph = structuredClone(draft.graph) as Record<string, unknown>;
      const nodes = newGraph.nodes as Record<string, unknown>[];
      const edges = newGraph.edges as Record<string, unknown>[];
      const gates = ((newGraph.gates as GateRuntime[] | undefined) ?? []) as GateRuntime[];
      newGraph.gates = gates;

      let createdOrder = nodes.reduce((max, node) => {
        return node.type === "task" && typeof node.created_order === "number"
          ? Math.max(max, node.created_order)
          : max;
      }, 0);

      for (const { cluster, gate, requirementIds } of resolved) {
        createdOrder += 1;
        const taskId = cluster.taskId;
        const artifactId = `artifact-${taskId}`;
        const uniqueRequirementIds = [...new Set(requirementIds)];

        nodes.push({
          id: artifactId,
          type: "artifact",
          label: `Artifact for ${cluster.label}`,
        });
        nodes.push({
          id: taskId,
          type: "task",
          label: cluster.label,
          requirement_ids: uniqueRequirementIds,
          write_scope: cluster.writeScope.map(normalizeScopePath),
          resource_scope: [],
          artifact_ids: [artifactId],
          status: "ready",
          priority: 50,
          effort: cluster.effort,
          created_order: createdOrder,
        });
        edges.push({ source: taskId, target: artifactId, type: "produces" });

        const gateId = `gate-${taskId}`;
        if (!gates.some((g) => g.id === gateId)) {
          gates.push({
            id: gateId,
            command: [...gate.argv],
            cwd: ".",
            scope: "task",
            requirement_ids: uniqueRequirementIds,
            mandatory: true,
          });
        }
      }

      newGraph.revision = nextRev;

      const dependencies = dependencyMap(newGraph);
      guardPlanRevision(
        draft as unknown as Record<string, unknown>,
        draft.requirements as Record<string, unknown>,
        newGraph,
        dependencies,
      );
      projectPlan(
        draft as unknown as Record<string, unknown>,
        draft.requirements as Record<string, unknown>,
        newGraph,
        dependencies,
      );

      const draftTasks = draft.tasks as Record<string, TaskRecord>;
      for (const { cluster, gate, requirementIds } of resolved) {
        const revalidation = gate.argv.join(" ");
        const task = draftTasks[cluster.taskId];
        if (!task) {
          throw new HarnessError(
            "INTEGRITY",
            `projected plan is missing repair task ${cluster.taskId}`,
          );
        }
        task.repair_round = repairRound;
        task.history = [
          {
            at: utc(new Date()),
            actor,
            from: "proposed",
            to: "ready",
            reason: `Injected in Repair Wave ${repairRound}`,
            attempt: 1,
          },
        ];
        task.findings = cluster.findings.map((finding, index): Finding => ({
          id: finding.id,
          requirement_id: requirementIds[index]!,
          severity: finding.severity === "suggestion" ? "minor" : finding.severity,
          observation: finding.observation,
          evidence: [],
          remediation: finding.remediation,
          revalidation,
          status: "open",
        }));
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

  const repoRoot = resolve(run, "..", "..");
  const config = getHarnessConfig(repoRoot, run);
  recordTopology(run, actor, config);

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
