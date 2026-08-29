import {
  generatePlanRevisionFromSignals,
  type PlanRevisionProposal,
  type PlanRevisionSignal,
  type PlanRevisionSignalType,
} from "../../proposals/proposal/index.ts";
import type {
  DiscoveredTaskPlan,
  LoadBalancingAssignment,
  LoadBalancingPlan,
  OrchestratorNodeInfo,
} from "./types.ts";

/**
 * Distributes tasks across orchestrator nodes, ensuring disjoint write scopes and balanced workload.
 */
export function balanceOrchestratorLoad(
  orchestrators: readonly OrchestratorNodeInfo[],
  tasks: readonly {
    readonly id: string;
    readonly write_scope: readonly string[];
    readonly weight?: number | undefined;
  }[],
  options: { readonly maxTasksPerOrchestrator?: number | undefined } = {},
): LoadBalancingPlan {
  if (orchestrators.length === 0) {
    return {
      assignments: [],
      isBalanced: true,
      loadVarianceBefore: 0,
      loadVarianceAfter: 0,
      scopeCollisionsAvoided: 0,
    };
  }

  const maxCap = options.maxTasksPerOrchestrator ?? 5;
  const assignmentsMap = new Map<string, { taskIds: string[]; writeScopes: string[] }>();
  for (const orch of orchestrators) {
    assignmentsMap.set(orch.id, {
      taskIds: [...orch.assignedTaskIds],
      writeScopes: [...orch.assignedWriteScopes],
    });
  }

  let scopeCollisionsAvoided = 0;

  // Calculate variance before
  const loadsBefore = Array.from(assignmentsMap.values()).map((a) => a.taskIds.length);
  const meanBefore = loadsBefore.reduce((a, b) => a + b, 0) / loadsBefore.length;
  const varianceBefore =
    loadsBefore.reduce((acc, l) => acc + Math.pow(l - meanBefore, 2), 0) / loadsBefore.length;

  // Assign unassigned tasks or balance overloaded nodes
  for (const task of tasks) {
    const currentlyAssignedOrchId = Array.from(assignmentsMap.entries()).find(([, val]) =>
      val.taskIds.includes(task.id),
    )?.[0];

    if (!currentlyAssignedOrchId) {
      // Find orchestrator with matching write scope first, or lowest load
      let bestOrchId = orchestrators[0]!.id;
      let lowestLoad = Infinity;

      for (const orch of orchestrators) {
        const entry = assignmentsMap.get(orch.id)!;
        const currentCount = entry.taskIds.length;
        const hasMatchingScope = task.write_scope.some((s) => entry.writeScopes.includes(s));

        if (hasMatchingScope && currentCount < maxCap) {
          bestOrchId = orch.id;
          scopeCollisionsAvoided++;
          break;
        }

        if (currentCount < lowestLoad) {
          lowestLoad = currentCount;
          bestOrchId = orch.id;
        }
      }

      const targetEntry = assignmentsMap.get(bestOrchId)!;
      targetEntry.taskIds.push(task.id);
      for (const s of task.write_scope) {
        if (!targetEntry.writeScopes.includes(s)) {
          targetEntry.writeScopes.push(s);
        }
      }
    }
  }

  // Calculate variance after
  const loadsAfter = Array.from(assignmentsMap.values()).map((a) => a.taskIds.length);
  const meanAfter = loadsAfter.reduce((a, b) => a + b, 0) / loadsAfter.length;
  const varianceAfter =
    loadsAfter.reduce((acc, l) => acc + Math.pow(l - meanAfter, 2), 0) / loadsAfter.length;

  const assignments: LoadBalancingAssignment[] = Array.from(assignmentsMap.entries()).map(
    ([orchId, data]) => ({
      orchestratorId: orchId,
      taskIds: data.taskIds,
      writeScopes: data.writeScopes,
      loadScore: data.taskIds.length,
    }),
  );

  return {
    assignments,
    isBalanced: varianceAfter <= 1.0,
    loadVarianceBefore: Number(varianceBefore.toFixed(2)),
    loadVarianceAfter: Number(varianceAfter.toFixed(2)),
    scopeCollisionsAvoided,
  };
}

/**
 * Synthesizes dynamic plan revisions from cognitive discoveries and active queue state.
 */
export function synthesizeDynamicPlanRevisions(params: {
  readonly discoveries?:
    | readonly {
        readonly category?: string;
        readonly severity?: string;
        readonly description?: string;
        readonly file?: string;
        readonly targetFile?: string;
      }[]
    | undefined;
  readonly signals?: readonly PlanRevisionSignal[] | undefined;
  readonly activePlans?: readonly DiscoveredTaskPlan[] | undefined;
  readonly maxRevisions?: number | undefined;
  readonly actor?: string | undefined;
}): {
  readonly revisions: readonly PlanRevisionProposal[];
  readonly summary: string;
} {
  const signalList: PlanRevisionSignal[] = [...(params.signals ?? [])];

  if (params.discoveries) {
    for (const disc of params.discoveries) {
      let sigType: PlanRevisionSignalType = "QUIESCENCE_EVOLUTION";
      if (disc.category === "TEST_COVERAGE" || disc.category === "test_coverage") {
        sigType = "TEST_REGRESSION";
      } else if (disc.category === "COGNITIVE_GAP" || disc.category === "cognitive_gap") {
        sigType = "COGNITIVE_OVERLOAD";
      } else if (disc.category === "DEFECT_REMEDIATION" || disc.category === "defect_remediation") {
        sigType = "DEFECT_SURGE";
      } else if (disc.category === "CODE_QUALITY" || disc.category === "code_quality") {
        sigType = "SCOPE_COLLISION";
      }

      const sev =
        disc.severity === "CRITICAL" ? "CRITICAL" : disc.severity === "HIGH" ? "HIGH" : "MEDIUM";
      const targetScope = disc.file ?? disc.targetFile ?? "olt/scripts/src/mind";

      signalList.push({
        signalType: sigType,
        source: disc.file ?? disc.category ?? "discovery_scan",
        severity: sev,
        evidence: disc.description ?? "Cognitive discovery trigger",
        affectedWriteScopes: [targetScope],
        charterGoalId: "goal-continuous-evolution",
      });
    }
  }

  const revisions = generatePlanRevisionFromSignals(signalList, {
    maxRevisionsPerSignal: 2,
  });

  const summary = `Synthesized ${revisions.length} dynamic plan revision proposal(s) from ${signalList.length} evolutionary signal(s).`;
  return { revisions, summary };
}
