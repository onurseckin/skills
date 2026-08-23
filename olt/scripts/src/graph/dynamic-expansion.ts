import { HarnessError } from "../core/errors/harness-error.ts";
import { isInteger, isNonblank, isRecord } from "../requirements/predicates.ts";
import type { TaskDeclaration } from "../requirements/compiler.ts";
import { normalizeScopePath, checkScopeOverlap } from "./scope-analyzer.ts";
import { dependencyData, topologicalOrder, type DependencyMap } from "./topology.ts";
import { validateGraph } from "./validate-graph.ts";
import { jsonCopy } from "./plan-contract.ts";

export interface SubtaskDecomposition {
  readonly id: string;
  readonly label: string;
  readonly writeScope: readonly string[];
  readonly gate: string | readonly string[];
  readonly deps?: readonly string[] | undefined;
  readonly depReasons?: Readonly<Record<string, string>> | undefined;
  readonly goal?: string | undefined;
  readonly criteria?: readonly string[] | undefined;
  readonly priority?: number | undefined;
  readonly effort?: number | undefined;
  readonly requirementLines?: readonly number[] | undefined;
  readonly role?:
    | "implementer"
    | "sub_implementer"
    | "repairer"
    | "validator"
    | "sub_validator"
    | undefined;
  readonly assignedAgent?: string | undefined;
  readonly validatorId?: string | undefined;
  readonly validatorGate?: string | readonly string[] | undefined;
  readonly validatorScope?: readonly string[] | undefined;
}

export interface DeeperExpansionRequest {
  readonly parentTaskId: string;
  readonly subtasks: readonly SubtaskDecomposition[];
  readonly decompositionRationale?: string | undefined;
  readonly autoPairValidators?: boolean | undefined;
  readonly rewireDependents?: boolean | undefined;
  readonly rewirePrerequisites?: boolean | undefined;
}

export interface WiderExpansionRequest {
  readonly newTasks: readonly SubtaskDecomposition[];
  readonly admissionRationale?: string | undefined;
  readonly autoPairValidators?: boolean | undefined;
  readonly connectToRunGate?: boolean | undefined;
}

export interface DynamicExpansionOptions {
  readonly allowScopeGrowth?: boolean | undefined;
  readonly preserveJustifiedEdges?: boolean | undefined;
  readonly autoPromoteReady?: boolean | undefined;
  readonly strictBypassCheck?: boolean | undefined;
  readonly maxLanes?: number | undefined;
  readonly revision?: number | undefined;
}

export interface SuggestedEdge {
  readonly source: string;
  readonly target: string;
  readonly type?: string | undefined;
}

export interface CognitiveGuidance {
  readonly summary: string;
  readonly invariant: string;
  readonly rationale: string;
  readonly remediationAction: string;
  readonly suggestedRemediationEdges: readonly SuggestedEdge[];
}

export interface BypassViolation {
  readonly code: "TRANSITIVE_BYPASS_VIOLATION";
  readonly edge: { readonly source: string; readonly target: string };
  readonly bypassedPath: readonly string[];
  readonly bypassedStage: string;
  readonly reason: string;
  readonly guidance: CognitiveGuidance;
}

export interface TransitiveBypassCheckResult {
  readonly hasBypass: boolean;
  readonly violations: readonly BypassViolation[];
  readonly warnings: readonly string[];
}

export interface TaskRolePair {
  readonly implementerTask: Record<string, unknown>;
  readonly validatorTask: Record<string, unknown>;
  readonly artifactNode: Record<string, unknown>;
  readonly valArtifactNode: Record<string, unknown>;
  readonly producesEdge: Record<string, unknown>;
  readonly valProducesEdge: Record<string, unknown>;
  readonly validationEdge: Record<string, unknown>;
  readonly gateNode: Record<string, unknown>;
  readonly validatorGateNode?: Record<string, unknown> | undefined;
}

export interface DynamicExpansionResult {
  readonly success: boolean;
  readonly graphDocument: Record<string, unknown>;
  readonly addedTasks: readonly Record<string, unknown>[];
  readonly addedEdges: readonly Record<string, unknown>[];
  readonly addedGates: readonly Record<string, unknown>[];
  readonly pairedTasks: readonly {
    readonly implementerTaskId: string;
    readonly validatorTaskId: string;
  }[];
  readonly bypassViolations: readonly BypassViolation[];
  readonly cognitiveGuidance: readonly CognitiveGuidance[];
  readonly revision: number;
  readonly warnings: readonly string[];
}

export interface ImplementerValidatorConfig {
  readonly taskId: string;
  readonly label: string;
  readonly writeScope: readonly string[];
  readonly gate: string | readonly string[];
  readonly validatorId?: string | undefined;
  readonly validatorGate?: string | readonly string[] | undefined;
  readonly validatorScope?: readonly string[] | undefined;
  readonly priority?: number | undefined;
  readonly effort?: number | undefined;
  readonly requirementIds?: readonly string[] | undefined;
  readonly status?: string | undefined;
  readonly deps?: readonly string[] | undefined;
  readonly role?: string | undefined;
  readonly createdOrder?: number | undefined;
}

function parseGateCommand(gate: string | readonly string[]): string[] {
  if (typeof gate === "string") {
    return gate
      .trim()
      .split(/\s+/u)
      .filter((t) => t.length > 0);
  }
  return gate.map((item) => String(item).trim()).filter((item) => item.length > 0);
}

/**
 * Creates a dedicated implementer/validator task pair with artifact and validation edges.
 */
export function createImplementerValidatorPair(config: ImplementerValidatorConfig): TaskRolePair {
  const taskId = config.taskId;
  const valId = config.validatorId ?? `val-${taskId.replace(/^task-?/, "")}`;
  const artifactId = `artifact-${taskId.replace(/^task-?/, "")}`;
  const valArtifactId = `artifact-${valId.replace(/^task-?/, "")}`;
  const gateId = `gate-${taskId.replace(/^task-?/, "")}`;
  const valGateId = `gate-${valId.replace(/^task-?/, "")}`;
  const normalizedScopes = config.writeScope.map(normalizeScopePath);
  const reqIds =
    config.requirementIds && config.requirementIds.length > 0
      ? [...config.requirementIds]
      : [`req-${taskId.replace(/^task-?/, "")}`];
  const gateCmd = parseGateCommand(config.gate);

  const baseOrder = config.createdOrder ?? 1;

  const implementerTask: Record<string, unknown> = {
    id: taskId,
    type: "task",
    label: config.label,
    role: typeof config.role === "string" ? config.role : "implementer",
    requirement_ids: reqIds,
    write_scope: normalizedScopes,
    resource_scope: [],
    artifact_ids: [artifactId],
    status: config.status ?? (config.deps && config.deps.length > 0 ? "proposed" : "ready"),
    priority: config.priority ?? 50,
    effort: config.effort ?? 3,
    created_order: baseOrder,
    paired_validator_id: valId,
  };

  const validatorScope =
    config.validatorScope && config.validatorScope.length > 0
      ? config.validatorScope.map(normalizeScopePath)
      : normalizedScopes;

  const validatorTask: Record<string, unknown> = {
    id: valId,
    type: "task",
    label: `Validator for ${config.label}`,
    role: "validator",
    requirement_ids: reqIds,
    write_scope: validatorScope,
    resource_scope: [],
    artifact_ids: [valArtifactId],
    status: "proposed",
    priority: (config.priority ?? 50) + 1,
    effort: 1,
    created_order: baseOrder + 1,
    validates_task_id: taskId,
  };

  const artifactNode: Record<string, unknown> = {
    id: artifactId,
    type: "artifact",
    label: `Artifact for ${config.label}`,
  };

  const valArtifactNode: Record<string, unknown> = {
    id: valArtifactId,
    type: "artifact",
    label: `Validation Artifact for ${config.label}`,
  };

  const producesEdge: Record<string, unknown> = {
    source: taskId,
    target: artifactId,
    type: "produces",
  };

  const valProducesEdge: Record<string, unknown> = {
    source: valId,
    target: valArtifactId,
    type: "produces",
  };

  const validationEdge: Record<string, unknown> = {
    source: valId,
    target: taskId,
    type: "depends_on",
    dataflow_justification: `Validator ${valId} validates outputs produced by ${taskId}`,
  };

  const gateNode: Record<string, unknown> = {
    id: gateId,
    command: gateCmd,
    cwd: ".",
    scope: "task",
    requirement_ids: reqIds,
    mandatory: true,
  };

  let validatorGateNode: Record<string, unknown> | undefined = undefined;
  if (config.validatorGate) {
    const valGateCmd = parseGateCommand(config.validatorGate);
    validatorGateNode = {
      id: valGateId,
      command: valGateCmd,
      cwd: ".",
      scope: "task",
      requirement_ids: reqIds,
      mandatory: true,
    };
  }

  return {
    implementerTask,
    validatorTask,
    artifactNode,
    valArtifactNode,
    producesEdge,
    valProducesEdge,
    validationEdge,
    gateNode,
    validatorGateNode,
  };
}

/**
 * Detects illegal transitive bypasses across nodes and edges at compile time.
 * Flags any direct edge that bypasses a mandatory intermediate validation stage, gate, or task sequence.
 */
export function detectTransitiveBypasses(
  nodes: readonly Record<string, unknown>[],
  edges: readonly Record<string, unknown>[],
): TransitiveBypassCheckResult {
  const taskMap = new Map<string, Record<string, unknown>>();
  const nodeIds = new Set<string>();

  for (const node of nodes) {
    if (isRecord(node) && typeof node.id === "string") {
      nodeIds.add(node.id);
      if (node.type === "task") {
        taskMap.set(node.id, node);
      }
    }
  }

  const adj = new Map<string, string[]>();
  for (const id of nodeIds) {
    adj.set(id, []);
  }

  const depEdges: { source: string; target: string; type: string }[] = [];
  for (const edge of edges) {
    if (
      isRecord(edge) &&
      typeof edge.source === "string" &&
      typeof edge.target === "string" &&
      edge.type === "depends_on"
    ) {
      depEdges.push({ source: edge.source, target: edge.target, type: edge.type });
      adj.get(edge.source)?.push(edge.target);
    }
  }

  function findAllPaths(start: string, target: string, maxDepth = 6): string[][] {
    const paths: string[][] = [];
    function dfs(curr: string, currentPath: string[]): void {
      if (currentPath.length > maxDepth) return;
      if (curr === target) {
        if (currentPath.length > 2) {
          paths.push([...currentPath]);
        }
        return;
      }
      const neighbors = adj.get(curr) ?? [];
      for (const next of neighbors) {
        if (!currentPath.includes(next)) {
          currentPath.push(next);
          dfs(next, currentPath);
          currentPath.pop();
        }
      }
    }
    dfs(start, [start]);
    return paths;
  }

  const violations: BypassViolation[] = [];
  const warnings: string[] = [];

  for (const edge of depEdges) {
    const longerPaths = findAllPaths(edge.source, edge.target);
    if (longerPaths.length > 0) {
      for (const path of longerPaths) {
        const intermediate = path.slice(1, -1);
        const bypassedStage = intermediate[0]!;
        const bypassedTask = taskMap.get(bypassedStage);
        const isValidatorStage =
          bypassedStage.startsWith("val-") || (bypassedTask && bypassedTask.role === "validator");

        const invariantName = isValidatorStage
          ? "A3-gate-discrimination / Validator Bypass Invariant"
          : "Transitive Graph Integrity Invariant";

        const reason = isValidatorStage
          ? `Direct dependency edge [${edge.source} -> ${edge.target}] bypasses mandatory validator stage '${bypassedStage}' in intermediate path (${path.join(" -> ")})`
          : `Direct dependency edge [${edge.source} -> ${edge.target}] creates redundant transitive bypass over intermediate stage (${intermediate.join(" -> ")})`;

        const guidance: CognitiveGuidance = {
          summary: `Direct edge ${edge.source} -> ${edge.target} bypasses intermediate stage ${bypassedStage}.`,
          invariant: invariantName,
          rationale:
            `In a high-leverage execution topology, downstream consumers must depend on verified validation outcomes ` +
            `or intermediate milestones rather than short-circuiting around them. Bypassing stage '${bypassedStage}' violates graph monotonicity.`,
          remediationAction: `Remove direct bypass edge [${edge.source} -> ${edge.target}] and ensure dependency is routed through the intermediate stage '${bypassedStage}' ([${edge.source} -> ${bypassedStage}]).`,
          suggestedRemediationEdges: [
            { source: edge.source, target: bypassedStage, type: "depends_on" },
          ],
        };

        violations.push({
          code: "TRANSITIVE_BYPASS_VIOLATION",
          edge: { source: edge.source, target: edge.target },
          bypassedPath: path,
          bypassedStage,
          reason,
          guidance,
        });

        warnings.push(`[TRANSITIVE BYPASS]: ${reason}`);
      }
    }
  }

  // Also check for paired validator bypass:
  // If task A is paired with val-A, and task B depends on task A directly without depending on val-A
  for (const edge of depEdges) {
    const targetTask = taskMap.get(edge.target);
    if (targetTask && typeof targetTask.paired_validator_id === "string") {
      const valId = targetTask.paired_validator_id;
      // If edge.source is NOT the validator itself, and edge.source does not depend on val-A
      if (edge.source !== valId && taskMap.has(valId)) {
        const sourceDeps = adj.get(edge.source) ?? [];
        if (!sourceDeps.includes(valId)) {
          const reason = `Task ${edge.source} directly depends on implementer ${edge.target} instead of its paired validator ${valId}.`;
          const guidance: CognitiveGuidance = {
            summary: `Downstream consumer ${edge.source} bypasses paired validator ${valId} for ${edge.target}.`,
            invariant: "Validator-First Downstream Consumption Invariant",
            rationale:
              `Downstream tasks must consume validated artifacts produced by the paired validator stage '${valId}' ` +
              `to guarantee that unverified implementations never cascade downstream.`,
            remediationAction: `Rewire dependency: make ${edge.source} depend on ${valId} instead of raw ${edge.target}.`,
            suggestedRemediationEdges: [{ source: edge.source, target: valId, type: "depends_on" }],
          };

          violations.push({
            code: "TRANSITIVE_BYPASS_VIOLATION",
            edge: { source: edge.source, target: edge.target },
            bypassedPath: [edge.source, edge.target, valId],
            bypassedStage: valId,
            reason,
            guidance,
          });

          warnings.push(`[VALIDATOR BYPASS]: ${reason}`);
        }
      }
    }
  }

  return {
    hasBypass: violations.length > 0,
    violations,
    warnings,
  };
}

/**
 * Expands a task deeper via sub-task decomposition mid-flight.
 */
export function expandDeeper(
  graph: Record<string, unknown>,
  request: DeeperExpansionRequest,
  options: DynamicExpansionOptions = {},
): DynamicExpansionResult {
  const currentGraph = jsonCopy(graph);
  const nodes = Array.isArray(currentGraph.nodes)
    ? (currentGraph.nodes as Record<string, unknown>[])
    : [];
  const edges = Array.isArray(currentGraph.edges)
    ? (currentGraph.edges as Record<string, unknown>[])
    : [];
  const gates = Array.isArray(currentGraph.gates)
    ? (currentGraph.gates as Record<string, unknown>[])
    : [];

  const parentNode = nodes.find(
    (n) => isRecord(n) && n.type === "task" && n.id === request.parentTaskId,
  );
  if (!parentNode) {
    throw new HarnessError(
      "INVALID_ARGUMENT",
      `parent task '${request.parentTaskId}' not found in graph for deeper expansion`,
    );
  }

  if (request.subtasks.length === 0) {
    throw new HarnessError(
      "INVALID_ARGUMENT",
      `deeper expansion of '${request.parentTaskId}' requires at least one subtask decomposition`,
    );
  }

  const parentWriteScope = Array.isArray(parentNode.write_scope)
    ? (parentNode.write_scope as string[]).map(normalizeScopePath)
    : [];

  const allowGrowth = options.allowScopeGrowth ?? false;
  if (!allowGrowth) {
    for (const sub of request.subtasks) {
      const subScopes = sub.writeScope.map(normalizeScopePath);
      for (const s of subScopes) {
        const withinParent = parentWriteScope.some(
          (p) => s === p || s.startsWith(`${p}/`) || p === ".",
        );
        if (!withinParent) {
          throw new HarnessError(
            "INTEGRITY",
            `subtask '${sub.id}' write scope '${s}' exceeds parent scope [${parentWriteScope.join(", ")}]; deeper expansion must stay confined or set allowScopeGrowth=true`,
          );
        }
      }
    }
  }

  const addedTasks: Record<string, unknown>[] = [];
  const addedEdges: Record<string, unknown>[] = [];
  const addedGates: Record<string, unknown>[] = [];
  const pairedTasks: { implementerTaskId: string; validatorTaskId: string }[] = [];
  const warnings: string[] = [];

  const parentReqIds =
    Array.isArray(parentNode.requirement_ids) && (parentNode.requirement_ids as string[]).length > 0
      ? (parentNode.requirement_ids as string[])
      : [`req-${request.parentTaskId.replace(/^task-?/, "")}`];

  // Find parent's existing dependencies and downstream tasks
  const parentPrereqs: string[] = [];
  const parentDownstreamTasks: string[] = [];

  for (const edge of edges) {
    if (isRecord(edge) && edge.type === "depends_on") {
      if (edge.source === request.parentTaskId && typeof edge.target === "string") {
        parentPrereqs.push(edge.target);
      }
      if (edge.target === request.parentTaskId && typeof edge.source === "string") {
        parentDownstreamTasks.push(edge.source);
      }
    }
  }

  const subtaskIds = new Set(request.subtasks.map((s) => s.id));
  const autoPair = request.autoPairValidators ?? true;
  const rewirePrereqs = request.rewirePrerequisites ?? true;
  const rewireDownstream = request.rewireDependents ?? true;

  let taskCounter = nodes.filter((n) => isRecord(n) && n.type === "task").length;

  for (let idx = 0; idx < request.subtasks.length; idx++) {
    const sub = request.subtasks[idx]!;
    const hasExplicitDeps = Array.isArray(sub.deps) && sub.deps.length > 0;
    const hasInheritedPrereqs =
      rewirePrereqs &&
      parentPrereqs.length > 0 &&
      (!sub.deps || sub.deps.filter((d) => subtaskIds.has(d)).length === 0);
    const initialStatus = hasExplicitDeps || hasInheritedPrereqs ? "proposed" : "ready";

    taskCounter += 1;
    const currentOrder = taskCounter;

    if (autoPair) {
      taskCounter += 1;
      const pair = createImplementerValidatorPair({
        taskId: sub.id,
        label: sub.label,
        writeScope: sub.writeScope,
        gate: sub.gate,
        validatorId: sub.validatorId,
        validatorGate: sub.validatorGate,
        validatorScope: sub.validatorScope,
        priority:
          sub.priority ?? (typeof parentNode.priority === "number" ? parentNode.priority : 50),
        effort: sub.effort ?? 1,
        requirementIds: parentReqIds,
        status: initialStatus,
        deps: sub.deps,
        role: typeof sub.role === "string" ? sub.role : "sub_implementer",
        createdOrder: currentOrder,
      });

      nodes.push(pair.implementerTask, pair.validatorTask, pair.artifactNode, pair.valArtifactNode);
      edges.push(pair.producesEdge, pair.valProducesEdge, pair.validationEdge);
      gates.push(pair.gateNode);
      if (pair.validatorGateNode) gates.push(pair.validatorGateNode);

      addedTasks.push(pair.implementerTask, pair.validatorTask);
      addedEdges.push(pair.producesEdge, pair.valProducesEdge, pair.validationEdge);
      addedGates.push(pair.gateNode);
      if (pair.validatorGateNode) addedGates.push(pair.validatorGateNode);

      pairedTasks.push({
        implementerTaskId: String(pair.implementerTask.id),
        validatorTaskId: String(pair.validatorTask.id),
      });
    } else {
      const artifactId = `artifact-${sub.id.replace(/^task-?/, "")}`;
      const gateCmd = parseGateCommand(sub.gate);

      const taskNode: Record<string, unknown> = {
        id: sub.id,
        type: "task",
        label: sub.label,
        role: typeof sub.role === "string" ? sub.role : "sub_implementer",
        requirement_ids: parentReqIds,
        write_scope: sub.writeScope.map(normalizeScopePath),
        resource_scope: [],
        artifact_ids: [artifactId],
        status: initialStatus,
        priority:
          sub.priority ?? (typeof parentNode.priority === "number" ? parentNode.priority : 50),
        effort: sub.effort ?? 1,
        created_order: currentOrder,
      };

      const artifactNode: Record<string, unknown> = {
        id: artifactId,
        type: "artifact",
        label: `Artifact for ${sub.label}`,
      };

      const producesEdge: Record<string, unknown> = {
        source: sub.id,
        target: artifactId,
        type: "produces",
      };

      const gateNode: Record<string, unknown> = {
        id: `gate-${sub.id.replace(/^task-?/, "")}`,
        command: gateCmd,
        cwd: ".",
        scope: "task",
        requirement_ids: parentReqIds,
        mandatory: true,
      };

      nodes.push(taskNode, artifactNode);
      edges.push(producesEdge);
      gates.push(gateNode);

      addedTasks.push(taskNode);
      addedEdges.push(producesEdge);
      addedGates.push(gateNode);
    }

    // Connect internal subtask dependencies
    for (const dep of sub.deps ?? []) {
      const depTarget = autoPair && subtaskIds.has(dep) ? `val-${dep.replace(/^task-?/, "")}` : dep;
      const subEdge: Record<string, unknown> = {
        source: sub.id,
        target: depTarget,
        type: "depends_on",
      };
      edges.push(subEdge);
      addedEdges.push(subEdge);
    }
  }

  // Initial subtasks (subtasks with no subtask dependencies) inherit parent's prerequisites
  if (rewirePrereqs && parentPrereqs.length > 0) {
    const initialSubtasks = request.subtasks.filter(
      (s) => !s.deps || s.deps.filter((d) => subtaskIds.has(d)).length === 0,
    );
    for (const initial of initialSubtasks) {
      for (const prereq of parentPrereqs) {
        const inheritedEdge: Record<string, unknown> = {
          source: initial.id,
          target: prereq,
          type: "depends_on",
        };
        edges.push(inheritedEdge);
        addedEdges.push(inheritedEdge);
      }
    }
  }

  // Downstream tasks that depended on parentTaskId are rewired to depend on terminal subtasks
  if (rewireDownstream && parentDownstreamTasks.length > 0) {
    // Terminal subtasks: subtasks not depended on by any other subtask
    const dependedOnSubtasks = new Set<string>();
    for (const s of request.subtasks) {
      for (const d of s.deps ?? []) {
        if (subtaskIds.has(d)) dependedOnSubtasks.add(d);
      }
    }
    const terminalSubtasks = request.subtasks.filter((s) => !dependedOnSubtasks.has(s.id));
    const terminalTargets = terminalSubtasks.map((t) =>
      autoPair ? (t.validatorId ?? `val-${t.id.replace(/^task-?/, "")}`) : t.id,
    );

    // Update existing edges from downstream tasks
    for (const edge of edges) {
      if (isRecord(edge) && edge.type === "depends_on" && edge.target === request.parentTaskId) {
        // Point to first terminal target or create duplicate edges for multiple terminal targets
        if (terminalTargets.length > 0) {
          edge.target = terminalTargets[0]!;
          for (let i = 1; i < terminalTargets.length; i++) {
            const extraEdge: Record<string, unknown> = {
              source: edge.source,
              target: terminalTargets[i]!,
              type: "depends_on",
            };
            edges.push(extraEdge);
            addedEdges.push(extraEdge);
          }
        }
      }
    }
  }

  // Mark parent task as decomposed
  parentNode.status = "done";
  parentNode.decomposition_state = "expanded_deeper";
  parentNode.decomposed_subtasks = request.subtasks.map((s) => s.id);
  if (request.decompositionRationale) {
    parentNode.decomposition_rationale = request.decompositionRationale;
  }

  // Create decision node recording the decomposition
  const decisionNode: Record<string, unknown> = {
    id: `decision-decompose-${request.parentTaskId}`,
    type: "decision",
    label: `Dynamic Deeper Decomposition of ${request.parentTaskId}`,
    superseded_task_id: request.parentTaskId,
    explanation:
      request.decompositionRationale ?? `Task decomposed into ${request.subtasks.length} subtasks`,
  };
  nodes.push(decisionNode);

  const supersedesEdge: Record<string, unknown> = {
    source: request.subtasks[0]!.id,
    target: decisionNode.id,
    type: "supersedes",
  };
  edges.push(supersedesEdge);

  const nextRevision =
    options.revision ?? (typeof currentGraph.revision === "number" ? currentGraph.revision + 1 : 2);
  currentGraph.revision = nextRevision;
  currentGraph.nodes = nodes;
  currentGraph.edges = edges;
  currentGraph.gates = gates;

  // Transitive bypass validation
  const bypassResult = detectTransitiveBypasses(nodes, edges);
  if ((options.strictBypassCheck ?? true) && bypassResult.hasBypass) {
    const firstBypass = bypassResult.violations[0]!;
    throw new HarnessError(
      "INTEGRITY",
      `Dynamic expansion failed bypass validation: ${firstBypass.reason}. Cognitive guidance: ${firstBypass.guidance.remediationAction}`,
    );
  }

  return {
    success: true,
    graphDocument: currentGraph,
    addedTasks,
    addedEdges,
    addedGates,
    pairedTasks,
    bypassViolations: bypassResult.violations,
    cognitiveGuidance: bypassResult.violations.map((v) => v.guidance),
    revision: nextRevision,
    warnings: [...warnings, ...bypassResult.warnings],
  };
}

/**
 * Expands a plan wider via parallel task admission mid-flight.
 */
export function expandWider(
  graph: Record<string, unknown>,
  request: WiderExpansionRequest,
  options: DynamicExpansionOptions = {},
): DynamicExpansionResult {
  const currentGraph = jsonCopy(graph);
  const nodes = Array.isArray(currentGraph.nodes)
    ? (currentGraph.nodes as Record<string, unknown>[])
    : [];
  const edges = Array.isArray(currentGraph.edges)
    ? (currentGraph.edges as Record<string, unknown>[])
    : [];
  const gates = Array.isArray(currentGraph.gates)
    ? (currentGraph.gates as Record<string, unknown>[])
    : [];

  if (request.newTasks.length === 0) {
    throw new HarnessError(
      "INVALID_ARGUMENT",
      "wider expansion requires at least one task to admit",
    );
  }

  const existingTaskIds = new Set(
    nodes.filter((n) => isRecord(n) && n.type === "task").map((n) => String(n.id)),
  );

  for (const t of request.newTasks) {
    if (existingTaskIds.has(t.id)) {
      throw new HarnessError(
        "INVALID_ARGUMENT",
        `cannot admit task '${t.id}'; task ID already exists in graph`,
      );
    }
  }

  // Find existing requirement IDs in the graph or allocate new requirement nodes
  const existingReqIds = nodes
    .filter((n) => isRecord(n) && n.type === "requirement" && typeof n.requirement_id === "string")
    .map((n) => String(n.requirement_id));
  const fallbackReqId = existingReqIds.length > 0 ? existingReqIds[0]! : "req-1";

  const addedTasks: Record<string, unknown>[] = [];
  const addedEdges: Record<string, unknown>[] = [];
  const addedGates: Record<string, unknown>[] = [];
  const pairedTasks: { implementerTaskId: string; validatorTaskId: string }[] = [];
  const warnings: string[] = [];

  const autoPair = request.autoPairValidators ?? true;
  let taskCounter = nodes.filter((n) => isRecord(n) && n.type === "task").length;

  for (const task of request.newTasks) {
    taskCounter += 1;
    const currentOrder = taskCounter;
    const taskReqIds = [fallbackReqId];

    if (autoPair) {
      taskCounter += 1;
      const pair = createImplementerValidatorPair({
        taskId: task.id,
        label: task.label,
        writeScope: task.writeScope,
        gate: task.gate,
        validatorId: task.validatorId,
        validatorGate: task.validatorGate,
        validatorScope: task.validatorScope,
        priority: task.priority ?? 50,
        effort: task.effort ?? 2,
        requirementIds: taskReqIds,
        deps: task.deps,
        role: typeof task.role === "string" ? task.role : "implementer",
        createdOrder: currentOrder,
      });

      nodes.push(pair.implementerTask, pair.validatorTask, pair.artifactNode, pair.valArtifactNode);
      edges.push(pair.producesEdge, pair.valProducesEdge, pair.validationEdge);
      gates.push(pair.gateNode);
      if (pair.validatorGateNode) gates.push(pair.validatorGateNode);

      addedTasks.push(pair.implementerTask, pair.validatorTask);
      addedEdges.push(pair.producesEdge, pair.valProducesEdge, pair.validationEdge);
      addedGates.push(pair.gateNode);
      if (pair.validatorGateNode) addedGates.push(pair.validatorGateNode);

      pairedTasks.push({
        implementerTaskId: String(pair.implementerTask.id),
        validatorTaskId: String(pair.validatorTask.id),
      });
    } else {
      const artifactId = `artifact-${task.id.replace(/^task-?/, "")}`;
      const gateCmd = parseGateCommand(task.gate);

      const taskNode: Record<string, unknown> = {
        id: task.id,
        type: "task",
        label: task.label,
        role: typeof task.role === "string" ? task.role : "implementer",
        requirement_ids: taskReqIds,
        write_scope: task.writeScope.map(normalizeScopePath),
        resource_scope: [],
        artifact_ids: [artifactId],
        status: task.deps && task.deps.length > 0 ? "proposed" : "ready",
        priority: task.priority ?? 50,
        effort: task.effort ?? 2,
        created_order: currentOrder,
      };

      const artifactNode: Record<string, unknown> = {
        id: artifactId,
        type: "artifact",
        label: `Artifact for ${task.label}`,
      };

      const producesEdge: Record<string, unknown> = {
        source: task.id,
        target: artifactId,
        type: "produces",
      };

      const gateNode: Record<string, unknown> = {
        id: `gate-${task.id.replace(/^task-?/, "")}`,
        command: gateCmd,
        cwd: ".",
        scope: "task",
        requirement_ids: taskReqIds,
        mandatory: true,
      };

      nodes.push(taskNode, artifactNode);
      edges.push(producesEdge);
      gates.push(gateNode);

      addedTasks.push(taskNode);
      addedEdges.push(producesEdge);
      addedGates.push(gateNode);
    }

    // Connect dependencies
    for (const dep of task.deps ?? []) {
      const depTarget =
        autoPair &&
        existingTaskIds.has(dep) &&
        nodes.some((n) => n.id === `val-${dep.replace(/^task-?/, "")}`)
          ? `val-${dep.replace(/^task-?/, "")}`
          : dep;
      const edge: Record<string, unknown> = {
        source: task.id,
        target: depTarget,
        type: "depends_on",
      };
      if (task.depReasons?.[dep]) {
        edge.dataflow_justification = task.depReasons[dep];
      }
      edges.push(edge);
      addedEdges.push(edge);
    }
  }

  const nextRevision =
    options.revision ?? (typeof currentGraph.revision === "number" ? currentGraph.revision + 1 : 2);
  currentGraph.revision = nextRevision;
  currentGraph.nodes = nodes;
  currentGraph.edges = edges;
  currentGraph.gates = gates;

  // Transitive bypass validation
  const bypassResult = detectTransitiveBypasses(nodes, edges);
  if ((options.strictBypassCheck ?? true) && bypassResult.hasBypass) {
    const firstBypass = bypassResult.violations[0]!;
    throw new HarnessError(
      "INTEGRITY",
      `Dynamic wider expansion failed bypass validation: ${firstBypass.reason}. Cognitive guidance: ${firstBypass.guidance.remediationAction}`,
    );
  }

  return {
    success: true,
    graphDocument: currentGraph,
    addedTasks,
    addedEdges,
    addedGates,
    pairedTasks,
    bypassViolations: bypassResult.violations,
    cognitiveGuidance: bypassResult.violations.map((v) => v.guidance),
    revision: nextRevision,
    warnings: [...warnings, ...bypassResult.warnings],
  };
}

export interface DynamicExpansionPlan {
  readonly deeper?: readonly DeeperExpansionRequest[] | undefined;
  readonly wider?: readonly WiderExpansionRequest[] | undefined;
}

function isDeeperRequest(request: unknown): request is DeeperExpansionRequest {
  return (
    isRecord(request) && typeof request.parentTaskId === "string" && Array.isArray(request.subtasks)
  );
}

function isWiderRequest(request: unknown): request is WiderExpansionRequest {
  return isRecord(request) && Array.isArray(request.newTasks);
}

/**
 * Unified atomic expansion entry point. Expands the DAG deeper, wider, or both.
 */
export function expandDynamicPlan(
  currentGraph: Record<string, unknown>,
  expansion: DynamicExpansionPlan | DeeperExpansionRequest | WiderExpansionRequest,
  requirementsDocument?: Record<string, unknown>,
  options: DynamicExpansionOptions = {},
): DynamicExpansionResult {
  let workingGraph = jsonCopy(currentGraph);
  const allAddedTasks: Record<string, unknown>[] = [];
  const allAddedEdges: Record<string, unknown>[] = [];
  const allAddedGates: Record<string, unknown>[] = [];
  const allPairedTasks: { implementerTaskId: string; validatorTaskId: string }[] = [];
  const allWarnings: string[] = [];
  const allViolations: BypassViolation[] = [];
  const allGuidance: CognitiveGuidance[] = [];

  let nextRevision =
    options.revision ?? (typeof workingGraph.revision === "number" ? workingGraph.revision + 1 : 2);

  if (isDeeperRequest(expansion)) {
    const res = expandDeeper(workingGraph, expansion, { ...options, revision: nextRevision });
    workingGraph = res.graphDocument;
    allAddedTasks.push(...res.addedTasks);
    allAddedEdges.push(...res.addedEdges);
    allAddedGates.push(...res.addedGates);
    allPairedTasks.push(...res.pairedTasks);
    allWarnings.push(...res.warnings);
    allViolations.push(...res.bypassViolations);
    allGuidance.push(...res.cognitiveGuidance);
    nextRevision = res.revision;
  } else if (isWiderRequest(expansion)) {
    const res = expandWider(workingGraph, expansion, { ...options, revision: nextRevision });
    workingGraph = res.graphDocument;
    allAddedTasks.push(...res.addedTasks);
    allAddedEdges.push(...res.addedEdges);
    allAddedGates.push(...res.addedGates);
    allPairedTasks.push(...res.pairedTasks);
    allWarnings.push(...res.warnings);
    allViolations.push(...res.bypassViolations);
    allGuidance.push(...res.cognitiveGuidance);
    nextRevision = res.revision;
  } else if (isRecord(expansion)) {
    const plan = expansion as DynamicExpansionPlan;
    if (plan.deeper) {
      for (const deepReq of plan.deeper) {
        const res = expandDeeper(workingGraph, deepReq, { ...options, revision: nextRevision });
        workingGraph = res.graphDocument;
        allAddedTasks.push(...res.addedTasks);
        allAddedEdges.push(...res.addedEdges);
        allAddedGates.push(...res.addedGates);
        allPairedTasks.push(...res.pairedTasks);
        allWarnings.push(...res.warnings);
        allViolations.push(...res.bypassViolations);
        allGuidance.push(...res.cognitiveGuidance);
      }
    }
    if (plan.wider) {
      for (const wideReq of plan.wider) {
        const res = expandWider(workingGraph, wideReq, { ...options, revision: nextRevision });
        workingGraph = res.graphDocument;
        allAddedTasks.push(...res.addedTasks);
        allAddedEdges.push(...res.addedEdges);
        allAddedGates.push(...res.addedGates);
        allPairedTasks.push(...res.pairedTasks);
        allWarnings.push(...res.warnings);
        allViolations.push(...res.bypassViolations);
        allGuidance.push(...res.cognitiveGuidance);
      }
    }
  }

  // Final graph validation if requirements provided
  if (requirementsDocument) {
    const issues = validateGraph(workingGraph, requirementsDocument, {
      allowRuntimeStatuses: true,
    });
    if (issues.length > 0) {
      throw new HarnessError(
        "INTEGRITY",
        `dynamic expansion resulted in invalid graph: ${issues.join("; ")}`,
      );
    }
  }

  return {
    success: true,
    graphDocument: workingGraph,
    addedTasks: allAddedTasks,
    addedEdges: allAddedEdges,
    addedGates: allAddedGates,
    pairedTasks: allPairedTasks,
    bypassViolations: allViolations,
    cognitiveGuidance: allGuidance,
    revision: nextRevision,
    warnings: allWarnings,
  };
}
