/**
 * Dynamic DAG Subagent Relationship & Live Branch Expansion Visualizer (p44)
 * View-layer presentation subsystem for rendering active subagent allocations,
 * dynamic branch sub-task expansions, and active coordinates across Sugiyama and Living Tracer graphs.
 * Strictly preserves view-layer isolation (never mutates RMS mathematical graph state or GDUI graph.json schema).
 */
import type { SugiyamaEdge, SugiyamaNode, SugiyamaSubtask } from "./sugiyama-dag.ts";
import {
  buildSugiyamaDagReport,
  formatCoordinates,
  formatStatusBadge,
  formatSubagentAllocation,
  getStatusBadge,
  getStatusGlyph,
  renderRoundedNodeBox,
  renderSugiyamaDag,
  type SugiyamaDagReport,
  type SugiyamaRenderOptions,
} from "./sugiyama-dag.ts";
import type { DynamicDagState, DynamicTaskState } from "./living-tracer.ts";

export {
  buildSugiyamaDagReport,
  formatCoordinates,
  formatStatusBadge,
  formatSubagentAllocation,
  getStatusBadge,
  getStatusGlyph,
  renderRoundedNodeBox,
  renderSugiyamaDag,
  type SugiyamaDagReport,
  type SugiyamaEdge,
  type SugiyamaNode,
  type SugiyamaRenderOptions,
  type SugiyamaSubtask,
};

export interface DynamicDagViewOptions extends SugiyamaRenderOptions {
  readonly includeSubagentAllocations?: boolean | undefined;
  readonly includeBranchExpansions?: boolean | undefined;
  readonly includeCoordinates?: boolean | undefined;
}

/**
 * Renders subagent relationship pair: [● IMPLEMENTER: <agent-id> ──► VALIDATOR: <agent-id>]
 */
export function renderSubagentRelationship(
  implementerId: string,
  validatorId: string,
  role = "IMPLEMENTER",
): string {
  return formatSubagentAllocation(implementerId, validatorId, role);
}

/**
 * Renders dynamically expanded branch sub-tasks and live relationship arrows.
 */
export function renderBranchExpansionHierarchy(
  _parentTaskId: string,
  subtasks: readonly (SugiyamaSubtask | DynamicTaskState | string)[],
  options: {
    readonly branchId?: string | undefined;
    readonly indent?: string | undefined;
  } = {},
): string[] {
  const indent = options.indent ?? "";
  const lines: string[] = [];
  const header = options.branchId
    ? `${indent}↳ Dynamic Branch [${options.branchId}] (${subtasks.length} sub-tasks):`
    : `${indent}↳ Dynamic Sub-tasks (${subtasks.length}):`;
  lines.push(header);

  for (let i = 0; i < subtasks.length; i++) {
    const sub = subtasks[i]!;
    const isLast = i === subtasks.length - 1;
    const arrow = isLast ? `${indent}  └──►` : `${indent}  ├──►`;

    if (typeof sub === "string") {
      lines.push(`${arrow} [${sub}]`);
    } else {
      const subId = sub.id;
      const subStatus = formatStatusBadge(sub.status ?? "ready");
      const impl =
        "assignedAgent" in sub && sub.role !== "validator"
          ? sub.assignedAgent
          : "implementerAgent" in sub && typeof sub.implementerAgent === "string"
            ? sub.implementerAgent
            : null;
      const val =
        "validatorId" in sub && typeof sub.validatorId === "string"
          ? sub.validatorId
          : "validatorAgent" in sub && typeof sub.validatorAgent === "string"
            ? sub.validatorAgent
            : "assignedAgent" in sub && sub.role === "validator"
              ? sub.assignedAgent
              : null;
      const alloc = formatSubagentAllocation(impl, val, sub.role ?? "IMPLEMENTER");
      const allocText = alloc ? ` ${alloc}` : "";
      const coords =
        "coordinates" in sub && sub.coordinates ? ` ${formatCoordinates(sub.coordinates)}` : "";
      lines.push(`${arrow} [${subId}] ${subStatus}${coords}${allocText}`);
    }
  }

  return lines;
}

/**
 * Converts telemetry dynamic DAG state into Sugiyama nodes and edges for layered rendering.
 */
export function dynamicDagStateToSugiyama(dynamicDag: DynamicDagState): {
  nodes: SugiyamaNode[];
  edges: SugiyamaEdge[];
} {
  const nodes: SugiyamaNode[] = [];
  const edges: SugiyamaEdge[] = [];

  for (const task of dynamicDag.tasks.values()) {
    const coords = task.coordinates ? task.coordinates : { wave: task.round, lane: 1 };

    nodes.push({
      id: task.id,
      label: task.label,
      status: task.status,
      dependencies: task.dependencies,
      writeScope: task.writeScope,
      assignedAgent: task.assignedAgent,
      assignedRole: task.role,
      assignedTool: task.activeTool,
      validatorId: task.validatorId,
      coordinates: coords,
      round: task.round,
      probeRound: task.probeRound,
      branchId: task.branchId,
      parentTaskId: task.repairForTaskId ?? undefined,
      dynamicOrigin: task.origin,
    });

    for (const depId of task.dependencies) {
      edges.push({
        from: depId,
        to: task.id,
        type: "declared_dep",
      });
    }
  }

  return { nodes, edges };
}

/**
 * High-level dynamic DAG view visualizer that renders Sugiyama layered graphs with subagent allocations and live branch expansions.
 * @param nodesOrState - Array of SugiyamaNode records or a DynamicDagState map
 * @param edgesOrOptions - Array of SugiyamaEdge records or DynamicDagViewOptions
 * @param options - Optional rendering and view formatting options
 * @returns SugiyamaDagReport containing ascii and markdown renders
 */
export function renderDynamicDagView(
  nodesOrState: readonly SugiyamaNode[] | DynamicDagState,
  edgesOrOptions?: readonly SugiyamaEdge[] | DynamicDagViewOptions,
  options?: DynamicDagViewOptions,
): SugiyamaDagReport {
  if ("tasks" in nodesOrState && nodesOrState.tasks instanceof Map) {
    const { nodes, edges } = dynamicDagStateToSugiyama(nodesOrState);
    const opts = (edgesOrOptions as DynamicDagViewOptions | undefined) ?? {};
    return buildSugiyamaDagReport(nodes, edges, opts);
  }

  const nodes = nodesOrState as readonly SugiyamaNode[];
  const edges = (edgesOrOptions as readonly SugiyamaEdge[] | undefined) ?? [];
  return buildSugiyamaDagReport(nodes, edges, options ?? {});
}
