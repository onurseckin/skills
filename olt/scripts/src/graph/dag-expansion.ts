import { HarnessError } from "../core/errors/index.ts";
import type { JsonObject, JsonValue } from "../core/contracts/index.ts";
import { isJsonObject } from "../core/contracts/index.ts";
import { isInteger, isNonblank, isRecord } from "../requirements/predicates.ts";
import {
  compileRequirementsFromPrompt,
  type CompiledRequirementsResult,
  type TaskDeclaration,
} from "../requirements/compiler.ts";
import { compileGraphDocument, type CompiledGraphResult } from "./compiler.ts";
import {
  auditPlan,
  blockingFindings,
  advisoryFindings,
  type AuditFinding,
  type AuditTaskInput,
  type PlanAuditResult,
} from "./plan-audit.ts";
import {
  decoupleDisjointTasks,
  type DecoupledGraphResult,
  type ParallelLaneAssignment,
  type ParallelMetrics,
} from "./parallel-decoupler.ts";
import {
  createImplementerValidatorPair,
  detectTransitiveBypasses,
  expandDeeper,
  expandDynamicPlan,
  expandWider,
  type BypassViolation,
  type CognitiveGuidance,
  type DeeperExpansionRequest,
  type DynamicExpansionOptions,
  type DynamicExpansionPlan,
  type DynamicExpansionResult,
  type ImplementerValidatorConfig,
  type SubtaskDecomposition,
  type SuggestedEdge,
  type TaskRolePair,
  type TransitiveBypassCheckResult,
  type WiderExpansionRequest,
} from "./dynamic-expansion.ts";
import {
  checkScopeOverlap,
  computeConcurrencyWaves,
  normalizeScopePath,
  type ConcurrencyWave,
  type TaskScopeInput,
} from "./scope-analyzer.ts";
import { dependencyData, topologicalOrder, type DependencyMap } from "./topology.ts";
import { validateGraph } from "./validate-graph.ts";
import { jsonCopy } from "./plan-contract.ts";
import {
  compileUnifiedHighLeveragePlan,
  detectCapsuleContext,
  expandDynamicPlanUnified,
  type CapsuleContext,
  type ExecutableTopology,
  type UnifiedPlanInput,
  type UnifiedPlanResult,
} from "./unified-plan.ts";

export {
  compileUnifiedHighLeveragePlan,
  createImplementerValidatorPair,
  detectCapsuleContext,
  detectTransitiveBypasses,
  expandDeeper,
  expandDynamicPlan,
  expandDynamicPlanUnified,
  expandWider,
  type BypassViolation,
  type CapsuleContext,
  type CognitiveGuidance,
  type DeeperExpansionRequest,
  type DynamicExpansionOptions,
  type DynamicExpansionPlan,
  type DynamicExpansionResult,
  type ExecutableTopology,
  type ImplementerValidatorConfig,
  type SubtaskDecomposition,
  type SuggestedEdge,
  type TaskRolePair,
  type TransitiveBypassCheckResult,
  type UnifiedPlanInput,
  type UnifiedPlanResult,
  type WiderExpansionRequest,
};

/**
 * High-Leverage Unified Plan Compilation Pipeline.
 * Alias for compileUnifiedHighLeveragePlan.
 */
export function compileUnifiedPlan(input: UnifiedPlanInput): UnifiedPlanResult {
  return compileUnifiedHighLeveragePlan(input);
}

export type DynamicTaskOrigin =
  | "static"
  | "dynamic_expansion"
  | "branch"
  | "replan"
  | "repair_branch";

export interface DynamicTaskState {
  readonly id: string;
  readonly label: string;
  readonly status: string;
  readonly role?: string | undefined;
  readonly dependencies: readonly string[];
  readonly writeScope: readonly string[];
  readonly assignedAgent?: string | null | undefined;
  readonly origin: DynamicTaskOrigin;
  readonly createdAtSeq: number;
  readonly updatedAtSeq: number;
  readonly branchId?: string | undefined;
  readonly round: number;
  readonly attempt: number;
  readonly executionState: string;
  readonly activeTool?: string | null | undefined;
  readonly activeCommand?: string | null | undefined;
  readonly activeStepIndex?: number | null | undefined;
  readonly rejectionReason?: string | null | undefined;
  readonly validatorId?: string | null | undefined;
  readonly repairForTaskId?: string | null | undefined;
  readonly findings?: readonly string[] | undefined;
}

export interface ActiveAgentState {
  readonly agentId: string;
  readonly role: string;
  readonly currentTaskId: string | null;
  readonly lastActiveSeq: number;
  readonly lastActiveTimestamp?: string | undefined;
}

export interface DynamicDagState {
  readonly revision: number;
  readonly totalEvents: number;
  readonly tasks: readonly DynamicTaskState[];
  readonly activeAgents: readonly ActiveAgentState[];
  readonly waves: readonly ConcurrencyWave[];
  readonly criticalPath: readonly string[];
  readonly executionSummary: {
    readonly totalTasks: number;
    readonly readyTasks: number;
    readonly leasedTasks: number;
    readonly submittedTasks: number;
    readonly validatingTasks: number;
    readonly doneTasks: number;
    readonly failedTasks: number;
    readonly totalBranches: number;
    readonly activeAgentsCount: number;
  };
}

export interface DagCriticalPathResult {
  readonly criticalPath: readonly string[];
  readonly totalEffort: number;
  readonly longestChainLength: number;
}

export interface ConcurrencyMetricsResult {
  readonly maxParallelism: number;
  readonly totalTasks: number;
  readonly totalWaves: number;
  readonly laneUtilization: number;
  readonly averageWaveConcurrency: number;
  readonly theoreticalSpeedup: number;
}

export interface ReplanFindingInput {
  readonly id: string;
  readonly severity: "critical" | "important" | "minor";
  readonly observation: string;
  readonly remediation: string;
  readonly filePaths?: readonly string[] | undefined;
  readonly revalidationGate?: string | undefined;
}

export interface ReplanFromFindingsInput {
  readonly graphDocument: Record<string, unknown>;
  readonly findings: readonly ReplanFindingInput[];
  readonly fallbackGate: string | readonly string[];
  readonly actor?: string | undefined;
  readonly round?: number | undefined;
}

export interface ReplanFromFindingsResult {
  readonly success: boolean;
  readonly graphDocument: Record<string, unknown>;
  readonly newRevision: number;
  readonly addedRepairTasks: readonly Record<string, unknown>[];
  readonly pairedValidators: readonly Record<string, unknown>[];
  readonly partitionedScopes: readonly (readonly string[])[];
}

/**
 * Computes the critical path of a DAG based on task nodes, dependencies, and effort weights.
 */
export function computeDagCriticalPath(
  nodes: readonly Record<string, unknown>[],
  edges: readonly Record<string, unknown>[],
): DagCriticalPathResult {
  const taskMap = new Map<string, { effort: number; label: string }>();
  for (const node of nodes) {
    if (isRecord(node) && node.type === "task" && typeof node.id === "string") {
      const effort = typeof node.effort === "number" && node.effort > 0 ? node.effort : 1;
      const label = typeof node.label === "string" ? node.label : node.id;
      taskMap.set(node.id, { effort, label });
    }
  }

  const adj = new Map<string, string[]>();
  const inDegree = new Map<string, number>();
  for (const taskId of taskMap.keys()) {
    adj.set(taskId, []);
    inDegree.set(taskId, 0);
  }

  for (const edge of edges) {
    if (
      isRecord(edge) &&
      edge.type === "depends_on" &&
      typeof edge.source === "string" &&
      typeof edge.target === "string"
    ) {
      if (taskMap.has(edge.source) && taskMap.has(edge.target)) {
        // edge.source depends on edge.target, meaning target must finish before source
        // Flow: target -> source
        adj.get(edge.target)?.push(edge.source);
        inDegree.set(edge.source, (inDegree.get(edge.source) ?? 0) + 1);
      }
    }
  }

  // Topological sorting for DAG longest path computation
  const queue: string[] = [];
  for (const [taskId, deg] of inDegree.entries()) {
    if (deg === 0) queue.push(taskId);
  }

  const topoOrder: string[] = [];
  const dist = new Map<string, number>();
  const prev = new Map<string, string | null>();

  for (const taskId of taskMap.keys()) {
    dist.set(taskId, taskMap.get(taskId)?.effort ?? 1);
    prev.set(taskId, null);
  }

  while (queue.length > 0) {
    const u = queue.shift()!;
    topoOrder.push(u);
    const uDist = dist.get(u) ?? 0;
    const neighbors = adj.get(u) ?? [];

    for (const v of neighbors) {
      const vEffort = taskMap.get(v)?.effort ?? 1;
      if (uDist + vEffort > (dist.get(v) ?? 0)) {
        dist.set(v, uDist + vEffort);
        prev.set(v, u);
      }
      const newDeg = (inDegree.get(v) ?? 1) - 1;
      inDegree.set(v, newDeg);
      if (newDeg === 0) queue.push(v);
    }
  }

  let maxDist = 0;
  let maxEndNode: string | null = null;
  for (const [taskId, d] of dist.entries()) {
    if (d > maxDist) {
      maxDist = d;
      maxEndNode = taskId;
    }
  }

  const path: string[] = [];
  let curr: string | null = maxEndNode;
  while (curr !== null) {
    path.unshift(curr);
    curr = prev.get(curr) ?? null;
  }

  return {
    criticalPath: path,
    totalEffort: maxDist,
    longestChainLength: path.length,
  };
}

/**
 * Computes parallelism and concurrency metrics across waves and execution lanes.
 */
export function computeConcurrencyMetrics(
  waves: readonly ConcurrencyWave[],
  lanes: readonly ParallelLaneAssignment[] = [],
): ConcurrencyMetricsResult {
  const totalWaves = waves.length;
  let totalTasks = 0;
  let maxParallelism = 0;

  for (const wave of waves) {
    const count = wave.tasks.length;
    totalTasks += count;
    if (count > maxParallelism) {
      maxParallelism = count;
    }
  }

  const averageWaveConcurrency = totalWaves > 0 ? Number((totalTasks / totalWaves).toFixed(2)) : 0;
  const laneUtilization =
    lanes.length > 0
      ? Number((lanes.filter((l) => l.taskId.length > 0).length / lanes.length).toFixed(2))
      : 1;
  const theoreticalSpeedup = totalWaves > 0 ? Number((totalTasks / totalWaves).toFixed(2)) : 1;

  return {
    maxParallelism,
    totalTasks,
    totalWaves,
    laneUtilization,
    averageWaveConcurrency,
    theoreticalSpeedup,
  };
}

/**
 * Reconstructs the living Dynamic DAG state by replaying capsule events.
 */
export function reconstructDynamicDagState(
  events: readonly JsonObject[],
  initialGraph: Record<string, unknown> | null = null,
): DynamicDagState {
  const taskMap = new Map<string, DynamicTaskState>();
  const agentMap = new Map<string, ActiveAgentState>();
  let currentRevision = 1;
  let totalBranches = 0;

  // Initialize from initialGraph if provided
  if (initialGraph && isRecord(initialGraph) && Array.isArray(initialGraph.nodes)) {
    if (typeof initialGraph.revision === "number") {
      currentRevision = initialGraph.revision;
    }
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
  }

  // Replay events
  for (let seq = 0; seq < events.length; seq++) {
    const event = events[seq]!;
    const kind =
      typeof event.kind === "string"
        ? event.kind
        : typeof event.type === "string"
          ? event.type
          : "";
    const actor = typeof event.actor === "string" ? event.actor : "";
    const payload = isJsonObject(event.payload)
      ? event.payload
      : isJsonObject(event.data)
        ? event.data
        : {};
    const timestamp = typeof event.timestamp === "string" ? event.timestamp : undefined;

    if (actor && actor !== "system") {
      const existingAgent = agentMap.get(actor);
      agentMap.set(actor, {
        agentId: actor,
        role: existingAgent?.role ?? "worker",
        currentTaskId: existingAgent?.currentTaskId ?? null,
        lastActiveSeq: seq + 1,
        lastActiveTimestamp: timestamp,
      });
    }

    switch (kind) {
      case "plan-compiled": {
        if (typeof payload.revision === "number") {
          currentRevision = payload.revision;
        }
        break;
      }
      case "plan-task-added": {
        const taskId = typeof payload.task_id === "string" ? payload.task_id : "";
        if (taskId && !taskMap.has(taskId)) {
          taskMap.set(taskId, {
            id: taskId,
            label: typeof payload.label === "string" ? payload.label : taskId,
            status: "ready",
            role: typeof payload.role === "string" ? payload.role : "implementer",
            dependencies: [],
            writeScope: Array.isArray(payload.write_scope)
              ? payload.write_scope.filter((s): s is string => typeof s === "string")
              : [],
            assignedAgent: null,
            origin: "dynamic_expansion",
            createdAtSeq: seq + 1,
            updatedAtSeq: seq + 1,
            round: 1,
            attempt: 1,
            executionState: "ready",
          });
        }
        break;
      }
      case "task-claimed": {
        const taskId = typeof payload.task_id === "string" ? payload.task_id : "";
        const agent = typeof payload.agent === "string" ? payload.agent : actor;
        const role = typeof payload.role === "string" ? payload.role : "implementer";
        const existing = taskMap.get(taskId);
        if (existing) {
          taskMap.set(taskId, {
            ...existing,
            status: "leased",
            assignedAgent: agent,
            role,
            updatedAtSeq: seq + 1,
            executionState: "in_flight",
          });
        }
        if (agent) {
          agentMap.set(agent, {
            agentId: agent,
            role,
            currentTaskId: taskId,
            lastActiveSeq: seq + 1,
            lastActiveTimestamp: timestamp,
          });
        }
        break;
      }
      case "task-submitted": {
        const taskId = typeof payload.task_id === "string" ? payload.task_id : "";
        const existing = taskMap.get(taskId);
        if (existing) {
          taskMap.set(taskId, {
            ...existing,
            status: "submitted",
            updatedAtSeq: seq + 1,
            executionState: "submitted",
          });
        }
        break;
      }
      case "task-validate-start":
      case "validate-start": {
        const taskId = typeof payload.task_id === "string" ? payload.task_id : "";
        const validator = typeof payload.validator === "string" ? payload.validator : actor;
        const existing = taskMap.get(taskId);
        if (existing) {
          taskMap.set(taskId, {
            ...existing,
            status: "validating",
            validatorId: validator,
            updatedAtSeq: seq + 1,
            executionState: "under_validation",
          });
        }
        if (validator) {
          agentMap.set(validator, {
            agentId: validator,
            role: "validator",
            currentTaskId: taskId,
            lastActiveSeq: seq + 1,
            lastActiveTimestamp: timestamp,
          });
        }
        break;
      }
      case "task-reviewed": {
        const taskId = typeof payload.task_id === "string" ? payload.task_id : "";
        const status = typeof payload.status === "string" ? payload.status : "";
        const existing = taskMap.get(taskId);
        if (existing) {
          const isPass = status === "pass" || status === "passed" || status === "approved";
          taskMap.set(taskId, {
            ...existing,
            status: isPass ? "done" : "changes_requested",
            updatedAtSeq: seq + 1,
            executionState: isPass ? "completed" : "rejected",
            round: isPass ? existing.round : existing.round + 1,
            rejectionReason:
              !isPass && typeof payload.summary === "string" ? payload.summary : undefined,
          });
        }
        break;
      }
      case "branch-opened": {
        totalBranches++;
        const parentTaskId =
          typeof payload.parent_task_id === "string" ? payload.parent_task_id : "";
        const branchId =
          typeof payload.branch_id === "string" ? payload.branch_id : `branch-${totalBranches}`;
        const subtasks = Array.isArray(payload.subtasks) ? payload.subtasks : [];

        for (const sub of subtasks) {
          if (isJsonObject(sub) && typeof sub.id === "string") {
            const subId = sub.id;
            taskMap.set(subId, {
              id: subId,
              label: typeof sub.label === "string" ? sub.label : subId,
              status: "ready",
              role: "sub_implementer",
              dependencies: parentTaskId ? [parentTaskId] : [],
              writeScope: Array.isArray(sub.write_scope)
                ? sub.write_scope.filter((s): s is string => typeof s === "string")
                : [],
              assignedAgent: null,
              origin: "branch",
              createdAtSeq: seq + 1,
              updatedAtSeq: seq + 1,
              branchId,
              round: 1,
              attempt: 1,
              executionState: "branch_ready",
            });
          }
        }
        break;
      }
      case "branch-collected": {
        const branchId = typeof payload.branch_id === "string" ? payload.branch_id : "";
        for (const [id, t] of taskMap.entries()) {
          if (t.branchId === branchId && t.status !== "done") {
            taskMap.set(id, {
              ...t,
              status: "done",
              updatedAtSeq: seq + 1,
              executionState: "branch_collected",
            });
          }
        }
        break;
      }
    }
  }

  const tasksList = Array.from(taskMap.values());
  const activeAgentsList = Array.from(agentMap.values());

  // Compute waves from task list
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
    revision: currentRevision,
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
      totalBranches,
      activeAgentsCount: activeAgentsList.length,
    },
  };
}

/**
 * Generates an automatic replanning expansion given structured validator/critic findings.
 * Partitions defect scopes into parallel repair tasks with paired validators and updated graph revision.
 */
export function replanFromFindings(input: ReplanFromFindingsInput): ReplanFromFindingsResult {
  const currentGraph = jsonCopy(input.graphDocument);
  const nodes = Array.isArray(currentGraph.nodes)
    ? (currentGraph.nodes as Record<string, unknown>[])
    : [];
  const edges = Array.isArray(currentGraph.edges)
    ? (currentGraph.edges as Record<string, unknown>[])
    : [];
  const gates = Array.isArray(currentGraph.gates)
    ? (currentGraph.gates as Record<string, unknown>[])
    : [];

  const baseRevision = typeof currentGraph.revision === "number" ? currentGraph.revision : 1;
  const newRevision = baseRevision + 1;
  const round = input.round ?? newRevision;

  if (input.findings.length === 0) {
    return {
      success: true,
      graphDocument: currentGraph,
      newRevision: baseRevision,
      addedRepairTasks: [],
      pairedValidators: [],
      partitionedScopes: [],
    };
  }

  // Partition findings by unique write scope sets
  const scopeGroups = new Map<
    string,
    { scope: string[]; findings: ReplanFindingInput[]; gate: string }
  >();

  for (let i = 0; i < input.findings.length; i++) {
    const finding = input.findings[i]!;
    const scopes =
      finding.filePaths && finding.filePaths.length > 0
        ? finding.filePaths.map(normalizeScopePath)
        : ["src/repair"];
    const key = [...scopes].sort().join("::");
    const gate =
      finding.revalidationGate ??
      (typeof input.fallbackGate === "string" ? input.fallbackGate : input.fallbackGate.join(" "));

    if (!scopeGroups.has(key)) {
      scopeGroups.set(key, { scope: scopes, findings: [finding], gate });
    } else {
      scopeGroups.get(key)!.findings.push(finding);
    }
  }

  const addedRepairTasks: Record<string, unknown>[] = [];
  const pairedValidators: Record<string, unknown>[] = [];
  const partitionedScopes: string[][] = [];

  let repairIdx = 1;
  for (const group of scopeGroups.values()) {
    const repairTaskId = `task-repair-r${round}-${repairIdx}`;
    const validatorTaskId = `val-repair-r${round}-${repairIdx}`;
    const label = `Repair Round ${round} - ${group.findings.map((f) => f.id).join(", ")}`;

    const pair = createImplementerValidatorPair({
      taskId: repairTaskId,
      label,
      writeScope: group.scope,
      gate: group.gate,
      validatorId: validatorTaskId,
      role: "repairer",
      priority: 90,
      effort: 2,
    });

    nodes.push(pair.implementerTask, pair.validatorTask, pair.artifactNode, pair.valArtifactNode);
    edges.push(pair.producesEdge, pair.valProducesEdge, pair.validationEdge);
    gates.push(pair.gateNode);
    if (pair.validatorGateNode) gates.push(pair.validatorGateNode);

    addedRepairTasks.push(pair.implementerTask);
    pairedValidators.push(pair.validatorTask);
    partitionedScopes.push(group.scope);
    repairIdx++;
  }

  currentGraph.revision = newRevision;
  currentGraph.nodes = nodes;
  currentGraph.edges = edges;
  currentGraph.gates = gates;

  validateGraph(currentGraph, { requirements: [] });

  return {
    success: true,
    graphDocument: currentGraph,
    newRevision,
    addedRepairTasks,
    pairedValidators,
    partitionedScopes,
  };
}

/**
 * Formats an ASCII diagram and overview of the DAG topology.
 */
export function formatDynamicDagAscii(
  input: DynamicDagState | UnifiedPlanResult | Record<string, unknown>,
): string {
  const lines: string[] = [];

  if ("executionSummary" in input && "waves" in input) {
    const dag = input as DynamicDagState;
    lines.push(`=== Dynamic Living DAG State (Revision ${dag.revision}) ===`);
    lines.push(
      `Tasks: ${dag.executionSummary.totalTasks} (Done: ${dag.executionSummary.doneTasks}, Leased: ${dag.executionSummary.leasedTasks}, Ready: ${dag.executionSummary.readyTasks})`,
    );
    lines.push(
      `Active Agents: ${dag.executionSummary.activeAgentsCount}, Total Events: ${dag.totalEvents}`,
    );
    lines.push(`Critical Path: ${dag.criticalPath.join(" -> ") || "none"}`);
    lines.push("");
    lines.push("Concurrency Waves:");
    for (const wave of dag.waves) {
      lines.push(`  Wave ${wave.waveIndex}: [ ${wave.tasks.join(" | ")} ]`);
    }
  } else if ("topology" in input && "graphDocument" in input) {
    const plan = input as UnifiedPlanResult;
    const rev = typeof plan.graphDocument.revision === "number" ? plan.graphDocument.revision : 1;
    lines.push(`=== Unified High-Leverage Plan DAG (Revision ${rev}) ===`);
    lines.push(
      `Parallel Metrics: Factor = ${plan.topology.metrics.parallelismFactor}, Optimal Lanes = ${plan.topology.metrics.optimalLanes}`,
    );
    lines.push("Topological Waves:");
    for (const wave of plan.topology.waves) {
      lines.push(`  Wave ${wave.waveIndex}: [ ${wave.tasks.join(" | ")} ]`);
    }
  } else if (isRecord(input) && Array.isArray(input.nodes)) {
    const nodes = input.nodes as Record<string, unknown>[];
    const taskNodes = nodes.filter((n) => isRecord(n) && n.type === "task");
    lines.push(`=== Plan Graph DAG (${taskNodes.length} tasks) ===`);
    for (const task of taskNodes) {
      const id = typeof task.id === "string" ? task.id : "unknown";
      const label = typeof task.label === "string" ? task.label : id;
      const role = typeof task.role === "string" ? task.role : "implementer";
      const status = typeof task.status === "string" ? task.status : "ready";
      lines.push(`- [${status.toUpperCase()}] ${id} (${role}): ${label}`);
    }
  } else {
    lines.push("=== Dynamic DAG Overview ===");
  }

  return lines.join("\n");
}
