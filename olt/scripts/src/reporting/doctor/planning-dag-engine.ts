import { listTrackWorktrees } from "../../workflow/worktree/index.ts";
import {
  collectAllEdges,
  extractDependencyId,
  extractDependencyList,
  findCycles,
  populateNodesMap,
  resolveTier,
} from "./planning-dag-helpers.ts";
import {
  computeDoctorEnginePassed,
  type DoctorCheckEngineResult,
  type DoctorDiagnosticFinding,
} from "./types.ts";

export { extractDependencyId, extractDependencyList };

export type PlanningDagDependencyItem =
  | string
  | {
      readonly id?: string | undefined;
      readonly optional?: boolean | undefined;
    };

export interface PlanningDagNodeInput {
  readonly id: string;
  readonly dependencies?: readonly PlanningDagDependencyItem[] | undefined;
  readonly deps?: readonly PlanningDagDependencyItem[] | undefined;
  readonly status?: string | undefined;
  readonly tier?: number | string | undefined;
  readonly role?: string | undefined;
  readonly agentId?: string | undefined;
}

export interface PlanningDagEdgeInput {
  readonly from: string;
  readonly to: string;
}

export interface PlanningDagGraphInput {
  readonly nodes?: readonly (PlanningDagNodeInput | unknown)[] | undefined;
  readonly edges?: readonly (PlanningDagEdgeInput | unknown)[] | undefined;
}

export interface PlanningDagCheckOptions {
  readonly tasks?: Readonly<Record<string, unknown>> | null | undefined;
  readonly graph?: PlanningDagGraphInput | null | undefined;
  readonly repoRoot?: string | undefined;
  readonly state?: Readonly<Record<string, unknown>> | null | undefined;
  readonly activeWorktreeCount?: number | undefined;
}

export interface TaskNodeInfo {
  readonly id: string;
  readonly dependencies: readonly string[];
  readonly status?: string | undefined;
  readonly tier?: number | undefined;
  readonly role?: string | undefined;
  readonly agentId?: string | undefined;
}

export function checkPlanningDag(options: PlanningDagCheckOptions = {}): DoctorCheckEngineResult {
  const findings: DoctorDiagnosticFinding[] = [];
  const nodesMap = populateNodesMap(options);

  if (nodesMap.size === 0) {
    let activeWorktrees = options.activeWorktreeCount ?? 0;
    if (options.activeWorktreeCount === undefined && options.repoRoot) {
      try {
        activeWorktrees = listTrackWorktrees({
          repoRoot: options.repoRoot,
        }).filter((w) => w.status === "active").length;
      } catch {}
    }
    const st = options.state;
    const pulses = Array.isArray(st?.active_pulses)
      ? st.active_pulses.length
      : typeof st?.active_pulses === "number"
        ? st.active_pulses
        : 0;
    const phase =
      typeof st?.phase === "string"
        ? st.phase
        : typeof st?.execution_phase === "string"
          ? st.execution_phase
          : undefined;
    const hasActive =
      activeWorktrees > 0 ||
      pulses > 0 ||
      (phase !== undefined && !["idle", "completed", "init"].includes(phase));

    if (hasActive) {
      findings.push({
        code: "EMPTY_GRAPH_DURING_ACTIVE_EXECUTION",
        severity: "ERROR",
        engine: "checkPlanningDag",
        message: "Planning DAG is empty (0 tasks) during active worktree/pulse execution",
        details: {
          activeWorktrees: options.activeWorktreeCount ?? activeWorktrees,
        },
      });
      return { engine: "checkPlanningDag", passed: computeDoctorEnginePassed(findings), findings };
    }
  }

  const allEdges = collectAllEdges(options.graph, nodesMap);
  const seenEdges = new Set<string>();

  for (const edge of allEdges) {
    const key = `${edge.from}->${edge.to}`;
    if (seenEdges.has(key)) continue;
    seenEdges.add(key);

    const fromNode = nodesMap.get(edge.from);
    const toNode = nodesMap.get(edge.to);
    const fromTier = fromNode?.tier ?? resolveTier(undefined, undefined, undefined, edge.from);
    const toTier = toNode?.tier ?? resolveTier(undefined, undefined, undefined, edge.to);

    if (fromTier !== undefined && toTier !== undefined) {
      const delta = Math.abs(toTier - fromTier);
      if (delta > 1) {
        findings.push({
          code: "PLANNING_DAG_TIER_SKIP_VIOLATION",
          severity: "ERROR",
          engine: "checkPlanningDag",
          message: `Tier-skip violation detected in planning DAG edge: "${edge.from}" (Tier ${fromTier}) -> "${edge.to}" (Tier ${toTier}) exceeds delta_tier <= 1`,
          details: { from: edge.from, to: edge.to, fromTier, toTier, delta },
        });
      }
    }
  }

  const allNodeIds = Array.from(nodesMap.keys());
  const allNodeSet = new Set(allNodeIds);
  const adjacency = new Map<string, string[]>();

  for (const [id, node] of nodesMap.entries()) {
    const validDeps: string[] = [];
    for (const depId of node.dependencies) {
      if (!allNodeSet.has(depId)) {
        findings.push({
          code: "PLANNING_DAG_MISSING_DEPENDENCY",
          severity: "ERROR",
          engine: "checkPlanningDag",
          message: `Task "${id}" references missing dependency "${depId}"`,
          details: { taskId: id, missingDependencyId: depId },
        });
      } else validDeps.push(depId);
    }
    adjacency.set(id, validDeps);
  }

  for (const cycle of findCycles(allNodeIds, adjacency)) {
    findings.push({
      code: "PLANNING_DAG_CYCLE_DETECTED",
      severity: "ERROR",
      engine: "checkPlanningDag",
      message: `Cycle detected in planning DAG: ${cycle.join(" -> ")} -> ${cycle[0]}`,
      details: { cycleNodes: cycle },
    });
  }

  if (allNodeIds.length > 1) {
    const isTargetSet = new Set<string>();
    for (const deps of adjacency.values()) for (const d of deps) isTargetSet.add(d);
    for (const id of allNodeIds) {
      if ((adjacency.get(id) ?? []).length === 0 && !isTargetSet.has(id)) {
        findings.push({
          code: "PLANNING_DAG_ORPHAN_TASK",
          severity: "WARN",
          engine: "checkPlanningDag",
          message: `Orphan task with no dependencies and no dependents detected: "${id}"`,
          details: { taskId: id },
        });
      }
    }
  }

  return {
    engine: "checkPlanningDag",
    passed: computeDoctorEnginePassed(findings),
    findings,
  };
}
