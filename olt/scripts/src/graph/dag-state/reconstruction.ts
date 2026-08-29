import type { JsonObject } from "../../core/contracts/index.ts";
import { isRecord } from "../../requirements/predicates.ts";
import { computeConcurrencyWaves, type TaskScopeInput } from "../scope-analyzer.ts";
import { computeDagCriticalPath } from "./critical-path.ts";
import { applyEvent, type DagReconstructionState } from "./event-applier.ts";
import type { ActiveAgentState, DynamicDagState, DynamicTaskState } from "./types.ts";

function initTasksFromGraph(
  initialGraph: Record<string, unknown> | null,
  taskMap: Map<string, DynamicTaskState>,
): number {
  if (!initialGraph || !isRecord(initialGraph) || !Array.isArray(initialGraph.nodes)) {
    return 1;
  }
  const currentRevision = typeof initialGraph.revision === "number" ? initialGraph.revision : 1;
  const nodes = initialGraph.nodes as Record<string, unknown>[];
  const edges = Array.isArray(initialGraph.edges)
    ? (initialGraph.edges as Record<string, unknown>[])
    : [];

  for (const node of nodes) {
    if (isRecord(node) && node.type === "task" && typeof node.id === "string") {
      const id = node.id;
      const deps: string[] = [];
      for (const edge of edges) {
        if (
          isRecord(edge) &&
          edge.type === "depends_on" &&
          edge.source === id &&
          typeof edge.target === "string"
        ) {
          deps.push(edge.target);
        }
      }
      const writeScope = Array.isArray(node.write_scope)
        ? node.write_scope.filter((s): s is string => typeof s === "string")
        : [];

      taskMap.set(id, {
        id,
        label: typeof node.label === "string" ? node.label : id,
        status: typeof node.status === "string" ? node.status : "ready",
        role: typeof node.role === "string" ? node.role : "implementer",
        dependencies: deps,
        writeScope,
        assignedAgent: null,
        origin: "static",
        createdAtSeq: 0,
        updatedAtSeq: 0,
        round: 1,
        attempt: 1,
        executionState: "idle",
        validatorId:
          typeof node.paired_validator_id === "string" ? node.paired_validator_id : undefined,
      });
    }
  }
  return currentRevision;
}

export function reconstructDynamicDagState(
  events: readonly JsonObject[],
  initialGraph: Record<string, unknown> | null = null,
): DynamicDagState {
  const taskMap = new Map<string, DynamicTaskState>();
  const agentMap = new Map<string, ActiveAgentState>();
  const stateRef: DagReconstructionState = { currentRevision: 1, totalBranches: 0 };
  stateRef.currentRevision = initTasksFromGraph(initialGraph, taskMap);

  for (let seq = 0; seq < events.length; seq++) {
    applyEvent(events[seq]!, seq, taskMap, agentMap, stateRef);
  }

  const tasksList = Array.from(taskMap.values());
  const activeAgentsList = Array.from(agentMap.values());

  const taskScopeInputs: TaskScopeInput[] = tasksList.map((t) => ({
    taskId: t.id,
    writeScope: t.writeScope,
    dependencies: t.dependencies,
  }));
  const depsMap = new Map<string, Set<string>>();
  for (const t of tasksList) {
    depsMap.set(t.id, new Set(t.dependencies));
  }

  const waves = computeConcurrencyWaves(taskScopeInputs, depsMap);

  const taskNodes: Record<string, unknown>[] = tasksList.map((t) => ({
    id: t.id,
    type: "task",
    write_scope: t.writeScope,
    role: t.role,
  }));
  const taskEdges: Record<string, unknown>[] = [];
  for (const t of tasksList) {
    for (const dep of t.dependencies) {
      taskEdges.push({
        source: t.id,
        target: dep,
        type: "depends_on",
      });
    }
  }
  const cp = computeDagCriticalPath(taskNodes, taskEdges);

  let readyCount = 0;
  let leasedCount = 0;
  let submittedCount = 0;
  let validatingCount = 0;
  let doneCount = 0;
  let failedCount = 0;

  for (const t of tasksList) {
    if (t.status === "ready" || t.status === "proposed") readyCount++;
    else if (t.status === "leased") leasedCount++;
    else if (t.status === "submitted") submittedCount++;
    else if (t.status === "validating") validatingCount++;
    else if (t.status === "done") doneCount++;
    else if (t.status === "failed" || t.status === "changes_requested") failedCount++;
  }

  return {
    revision: stateRef.currentRevision,
    totalEvents: events.length,
    tasks: tasksList,
    activeAgents: activeAgentsList,
    waves,
    criticalPath: cp.criticalPath,
    executionSummary: {
      totalTasks: tasksList.length,
      readyTasks: readyCount,
      leasedTasks: leasedCount,
      submittedTasks: submittedCount,
      validatingTasks: validatingCount,
      doneTasks: doneCount,
      failedTasks: failedCount,
      totalBranches: stateRef.totalBranches,
      activeAgentsCount: activeAgentsList.length,
    },
  };
}
