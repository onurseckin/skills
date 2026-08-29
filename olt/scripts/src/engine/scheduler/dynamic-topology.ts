import { HarnessError } from "../../core/errors/index.ts";
import { dependencyMap } from "../../graph/dependency-map.ts";
import { downstreamMap, topologicalOrder, type DependencyMap } from "../../graph/topology.ts";
import { isInteger, isRecord } from "../../requirements/predicates.ts";
import {
  applicableValidatorDomains,
  type ValidatorDomain,
  VALIDATOR_DOMAINS,
} from "../../core/contracts/index.ts";
import type { TopologyDecision, TopologyReason, TopologyWave } from "../../core/contracts/index.ts";
import { resourceConflict, scopeConflict } from "./conflicts.ts";
import { schedulingMetrics, type SchedulingMetrics } from "./metrics.ts";
import { proposeBatch } from "./propose-batch.ts";
import { rankTasks, type ScheduledTask } from "./rank.ts";

export interface WorkSpanMetrics {
  readonly work: number;
  readonly span: number;
  readonly parallelismFactor: number;
  readonly criticalPath: readonly string[];
  readonly minWaves: number;
}

export interface OrchestratorPartition {
  readonly partitionId: string;
  readonly domain: string;
  readonly taskIds: readonly string[];
  readonly writeScopes: readonly string[];
  readonly dependencies: readonly string[];
  readonly work: number;
  readonly span: number;
  readonly recommendedWorkers: number;
}

export interface CrossOrchestratorBarrier {
  readonly fromPartitionId: string;
  readonly toPartitionId: string;
  readonly prerequisiteTaskId: string;
  readonly dependentTaskId: string;
  readonly wave: number;
}

export interface ValidatorDemand {
  readonly domain: ValidatorDomain;
  readonly taskCount: number;
  readonly recommendedValidators: number;
}

export interface DynamicTopologyWave {
  readonly wave: number;
  readonly taskIds: readonly string[];
  readonly workerDemand: number;
  readonly validatorDemands: readonly ValidatorDemand[];
  readonly criticDemand: number;
}

export interface DynamicTopologyOptions {
  readonly default_max_parallel?: number | undefined;
  readonly max_orchestrator_partitions?: number | undefined;
  readonly target_worker_efficiency?: number | undefined;
  readonly rationales?: Readonly<Record<string, string>> | undefined;
}

export interface ResourceDisjointnessMetrics {
  readonly disjointComponentCount: number;
  readonly disjointnessScore: number;
  readonly componentTaskIds: readonly (readonly string[])[];
}

export interface DynamicTopologySynthesis {
  readonly revision: number;
  readonly work: number;
  readonly span: number;
  readonly parallelismFactor: number;
  readonly criticalPath: readonly string[];
  readonly resourceDisjointness: ResourceDisjointnessMetrics;
  readonly recommendedTier1Orchestrators: number;
  readonly recommendedTier2Coordinators: number;
  readonly recommendedWorkerFleetSize: number;
  readonly recommendedValidatorFleet: Readonly<Record<ValidatorDomain, number>>;
  readonly recommendedCriticConcurrency: number;
  readonly orchestratorPartitions: readonly OrchestratorPartition[];
  readonly crossOrchestratorBarriers: readonly CrossOrchestratorBarrier[];
  readonly waves: readonly DynamicTopologyWave[];
  readonly decisions: readonly TopologyDecision[];
  readonly max_parallel: number;
}

function taskRecord(value: unknown): value is ScheduledTask {
  if (!isRecord(value)) return false;
  return (
    typeof value.id === "string" &&
    isInteger(value.priority) &&
    isInteger(value.created_order) &&
    isInteger(value.effort) &&
    Array.isArray(value.requirement_ids) &&
    value.requirement_ids.every((id) => typeof id === "string") &&
    (value.resource_scope === undefined ||
      (Array.isArray(value.resource_scope) &&
        value.resource_scope.every((scope) => typeof scope === "string"))) &&
    Array.isArray(value.write_scope) &&
    value.write_scope.every((scope) => typeof scope === "string")
  );
}

function conflicting(left: ScheduledTask, right: ScheduledTask): boolean {
  return (
    scopeConflict(left.write_scope, right.write_scope) ||
    resourceConflict(left.resource_scope ?? [], right.resource_scope ?? [])
  );
}

function derivedRationale(
  wave: number,
  prerequisites: readonly string[],
  overlaps: readonly string[],
  maxParallel: number,
): string {
  const clauses: string[] = [];
  if (prerequisites.length > 0) clauses.push(`depends on ${prerequisites.join(", ")}`);
  if (overlaps.length > 0) clauses.push(`write scope overlaps ${overlaps.join(", ")}`);
  if (clauses.length === 0) {
    clauses.push(
      `no dependency or scope conflict; ranked into a slot of max_parallel ${maxParallel}`,
    );
  }
  return `wave ${wave}: ${clauses.join("; ")}`;
}

export function computeWorkSpanMetrics(
  dependencies: DependencyMap,
  tasks: ReadonlyMap<string, ScheduledTask>,
): WorkSpanMetrics {
  const order = topologicalOrder(dependencies);
  if (order.length !== dependencies.size) {
    throw new HarnessError("INTEGRITY", "depends_on edges contain an execution cycle");
  }

  let totalWork = 0;
  for (const taskId of dependencies.keys()) {
    const task = tasks.get(taskId);
    const effort = task && isInteger(task.effort) && task.effort > 0 ? task.effort : 1;
    totalWork += effort;
  }

  // Calculate critical path and cumulative span weights
  const cumulativeSpan = new Map<string, number>();
  const parentOnCriticalPath = new Map<string, string | null>();

  for (const taskId of order) {
    const task = tasks.get(taskId);
    const taskEffort = task && isInteger(task.effort) && task.effort > 0 ? task.effort : 1;
    const prereqs = dependencies.get(taskId) ?? [];
    let maxPrereqSpan = 0;
    let bestPrereq: string | null = null;

    for (const prereqId of prereqs) {
      const prereqSpan = cumulativeSpan.get(prereqId) ?? 0;
      if (prereqSpan > maxPrereqSpan) {
        maxPrereqSpan = prereqSpan;
        bestPrereq = prereqId;
      }
    }

    cumulativeSpan.set(taskId, maxPrereqSpan + taskEffort);
    parentOnCriticalPath.set(taskId, bestPrereq);
  }

  let maxSpan = 0;
  let criticalEndTask: string | null = null;

  for (const [taskId, span] of cumulativeSpan.entries()) {
    if (span > maxSpan) {
      maxSpan = span;
      criticalEndTask = taskId;
    }
  }

  const criticalPath: string[] = [];
  let curr = criticalEndTask;
  while (curr !== null) {
    criticalPath.unshift(curr);
    curr = parentOnCriticalPath.get(curr) ?? null;
  }

  const span = Math.max(1, maxSpan);
  const work = Math.max(1, totalWork);
  const parallelismFactor = Number((work / span).toFixed(2));
  const minWaves = criticalPath.length > 0 ? criticalPath.length : 1;

  return {
    work,
    span,
    parallelismFactor,
    criticalPath,
    minWaves,
  };
}

export function computeResourceDisjointness(
  tasks: readonly ScheduledTask[],
  dependencies?: DependencyMap | undefined,
): ResourceDisjointnessMetrics {
  if (tasks.length === 0) {
    return {
      disjointComponentCount: 0,
      disjointnessScore: 1,
      componentTaskIds: [],
    };
  }

  const adj = new Map<string, Set<string>>();
  for (const t of tasks) {
    adj.set(t.id, new Set<string>());
  }

  for (let i = 0; i < tasks.length; i++) {
    const left = tasks[i]!;
    for (let j = i + 1; j < tasks.length; j++) {
      const right = tasks[j]!;
      const isConflicting = conflicting(left, right);
      const isDep =
        (dependencies?.get(left.id)?.has(right.id) ?? false) ||
        (dependencies?.get(right.id)?.has(left.id) ?? false);
      if (isConflicting || isDep) {
        adj.get(left.id)?.add(right.id);
        adj.get(right.id)?.add(left.id);
      }
    }
  }

  const visited = new Set<string>();
  const components: string[][] = [];

  for (const t of tasks) {
    if (visited.has(t.id)) continue;
    const comp: string[] = [];
    const queue: string[] = [t.id];
    visited.add(t.id);

    while (queue.length > 0) {
      const curr = queue.shift()!;
      comp.push(curr);
      const neighbors = adj.get(curr) ?? new Set<string>();
      for (const n of neighbors) {
        if (!visited.has(n)) {
          visited.add(n);
          queue.push(n);
        }
      }
    }

    comp.sort();
    components.push(comp);
  }

  const disjointComponentCount = components.length;
  const disjointnessScore = Number((disjointComponentCount / Math.max(1, tasks.length)).toFixed(2));

  return {
    disjointComponentCount,
    disjointnessScore,
    componentTaskIds: components,
  };
}

export function partitionOrchestratorDomains(
  tasks: readonly ScheduledTask[],
  dependencies: DependencyMap,
  maxPartitions = 4,
): OrchestratorPartition[] {
  if (tasks.length === 0) return [];

  const taskMap = new Map(tasks.map((t) => [t.id, t]));
  const primaryDomainMap = new Map<string, string>();

  for (const task of tasks) {
    const domains = applicableValidatorDomains(task.write_scope);
    if (domains.includes("ui-design")) {
      primaryDomainMap.set(task.id, "frontend-ui");
    } else if (domains.includes("system-design")) {
      primaryDomainMap.set(task.id, "backend-system");
    } else if (domains.includes("security")) {
      primaryDomainMap.set(task.id, "security-auth");
    } else {
      primaryDomainMap.set(task.id, "core-engine");
    }
  }

  const domainGroups = new Map<string, ScheduledTask[]>();
  for (const task of tasks) {
    const domain = primaryDomainMap.get(task.id) ?? "core-engine";
    const group = domainGroups.get(domain) ?? [];
    group.push(task);
    domainGroups.set(domain, group);
  }

  const partitions: OrchestratorPartition[] = [];
  const sortedDomains = Array.from(domainGroups.keys()).sort();

  for (const domain of sortedDomains) {
    const groupTasks = domainGroups.get(domain) ?? [];
    const groupTaskIds = groupTasks.map((t) => t.id).sort();
    const writeScopes = Array.from(new Set(groupTasks.flatMap((t) => t.write_scope))).sort();

    const crossDeps = new Set<string>();
    for (const task of groupTasks) {
      for (const prereq of dependencies.get(task.id) ?? []) {
        if (!groupTaskIds.includes(prereq)) {
          const prereqDomain = primaryDomainMap.get(prereq);
          if (prereqDomain && prereqDomain !== domain) {
            crossDeps.add(`orchestrator-domain-${prereqDomain}`);
          }
        }
      }
    }

    let groupWork = 0;
    for (const t of groupTasks) {
      groupWork += isInteger(t.effort) && t.effort > 0 ? t.effort : 1;
    }

    const subDeps: DependencyMap = new Map();
    for (const t of groupTasks) {
      const rawPrereqs = dependencies.get(t.id);
      const prereqs = rawPrereqs
        ? Array.from(rawPrereqs).filter((id: string) => groupTaskIds.includes(id))
        : [];
      subDeps.set(t.id, new Set(prereqs));
    }
    const subMetrics = computeWorkSpanMetrics(subDeps, taskMap);
    const recommendedWorkers = Math.max(
      1,
      Math.min(groupTasks.length, Math.ceil(subMetrics.parallelismFactor)),
    );

    partitions.push({
      partitionId: `orchestrator-domain-${domain}`,
      domain,
      taskIds: groupTaskIds,
      writeScopes,
      dependencies: Array.from(crossDeps).sort(),
      work: groupWork,
      span: subMetrics.span,
      recommendedWorkers,
    });
  }

  // Cap partition count if configured
  if (partitions.length > maxPartitions && maxPartitions > 0) {
    const main = partitions.slice(0, maxPartitions - 1);
    const remainder = partitions.slice(maxPartitions - 1);
    const mergedTaskIds = Array.from(new Set(remainder.flatMap((p) => p.taskIds))).sort();
    const mergedWriteScopes = Array.from(new Set(remainder.flatMap((p) => p.writeScopes))).sort();
    const mergedDeps = Array.from(new Set(remainder.flatMap((p) => p.dependencies)))
      .filter((d) => !remainder.some((r) => r.partitionId === d))
      .sort();
    const mergedWork = remainder.reduce((acc, p) => acc + p.work, 0);
    const mergedSpan = Math.max(...remainder.map((p) => p.span));
    const mergedWorkers = Math.max(...remainder.map((p) => p.recommendedWorkers));

    return [
      ...main,
      {
        partitionId: "orchestrator-domain-composite",
        domain: "composite",
        taskIds: mergedTaskIds,
        writeScopes: mergedWriteScopes,
        dependencies: mergedDeps,
        work: mergedWork,
        span: mergedSpan,
        recommendedWorkers: mergedWorkers,
      },
    ];
  }

  return partitions;
}

export function calculateValidatorAllocations(tasks: readonly ScheduledTask[]): {
  demands: readonly ValidatorDemand[];
  fleet: Readonly<Record<ValidatorDomain, number>>;
} {
  const counts: Record<ValidatorDomain, number> = {
    "code-quality": 0,
    product: 0,
    security: 0,
    "system-design": 0,
    "ui-design": 0,
  };

  for (const task of tasks) {
    const domains = applicableValidatorDomains(task.write_scope);
    for (const domain of domains) {
      counts[domain] += 1;
    }
  }

  const demands: ValidatorDemand[] = [];
  const fleet: Record<ValidatorDomain, number> = {
    "code-quality": 0,
    product: 0,
    security: 0,
    "system-design": 0,
    "ui-design": 0,
  };

  for (const domain of VALIDATOR_DOMAINS) {
    const count = counts[domain];
    const rec = Math.min(count, Math.max(count > 0 ? 1 : 0, Math.ceil(count / 2)));
    fleet[domain] = rec;
    demands.push({
      domain,
      taskCount: count,
      recommendedValidators: rec,
    });
  }

  return { demands, fleet };
}

export function calculateCriticConcurrency(
  taskCount: number,
  waveCount: number,
  partitionCount: number,
): number {
  if (taskCount === 0) return 1;
  const base = Math.max(1, partitionCount);
  const waveLoad = Math.ceil(taskCount / Math.max(1, waveCount));
  return Math.min(4, Math.max(1, Math.min(base, waveLoad)));
}

export function synthesizeDynamicTopology(
  state: unknown,
  options: DynamicTopologyOptions = {},
): DynamicTopologySynthesis {
  const maxParallel = options.default_max_parallel ?? 4;
  if (!isInteger(maxParallel) || maxParallel < 1) {
    throw new HarnessError(
      "INVALID_ARGUMENT",
      "default_max_parallel must be a positive integer to synthesize dynamic topology",
    );
  }
  if (!isRecord(state) || !isRecord(state.graph) || !isRecord(state.tasks)) {
    throw new HarnessError(
      "INVALID_STATE",
      "a plan must be applied before topology is synthesized",
    );
  }
  const revision = state.graph.revision;
  if (!isInteger(revision) || revision < 1) {
    throw new HarnessError(
      "INVALID_STATE",
      "graph revision is required to synthesize dynamic topology",
    );
  }

  const dependencies = dependencyMap(state.graph);
  const taskMap = new Map<string, ScheduledTask>();
  for (const [id, value] of Object.entries(state.tasks)) {
    if (taskRecord(value)) {
      taskMap.set(id, { ...value, resource_scope: value.resource_scope ?? [] });
    }
  }

  const workSpan = computeWorkSpanMetrics(dependencies, taskMap);
  const allTasks = Array.from(taskMap.values());
  const partitions = partitionOrchestratorDomains(
    allTasks,
    dependencies,
    options.max_orchestrator_partitions ?? 4,
  );

  const partitionByTaskId = new Map<string, string>();
  for (const part of partitions) {
    for (const tid of part.taskIds) {
      partitionByTaskId.set(tid, part.partitionId);
    }
  }

  const working = structuredClone(state);
  const workingTasks = working.tasks;
  if (!isRecord(workingTasks)) {
    throw new HarnessError(
      "INVALID_STATE",
      "a plan must be applied before topology is synthesized",
    );
  }

  const rationales = options.rationales ?? {};
  const waves: DynamicTopologyWave[] = [];
  const decisions: TopologyDecision[] = [];
  const assigned = new Map<string, { wave: number; task: ScheduledTask }>();
  const crossOrchestratorBarriers: CrossOrchestratorBarrier[] = [];

  let peakWaveTaskCount = 0;

  for (let wave = 1; ; wave += 1) {
    const batch = proposeBatch(working, maxParallel);
    if (batch.length === 0) break;
    const taskIds = batch.map(({ id }) => id);
    peakWaveTaskCount = Math.max(peakWaveTaskCount, taskIds.length);

    const waveTasks = batch.map((t) => taskMap.get(t.id) ?? t);
    const { demands: validatorDemands } = calculateValidatorAllocations(waveTasks);
    const criticDemand = Math.max(1, Math.min(taskIds.length, 2));

    waves.push({
      wave,
      taskIds: [...taskIds],
      workerDemand: taskIds.length,
      validatorDemands,
      criticDemand,
    });

    for (const task of batch) {
      const taskPartition = partitionByTaskId.get(task.id);
      const prerequisites = [...(dependencies.get(task.id) ?? [])].filter((id) => assigned.has(id));
      const overlaps = [...assigned]
        .filter(([, entry]) => conflicting(task, entry.task))
        .map(([id]) => id);

      for (const prereqId of prerequisites) {
        const prereqPartition = partitionByTaskId.get(prereqId);
        if (taskPartition && prereqPartition && taskPartition !== prereqPartition) {
          crossOrchestratorBarriers.push({
            fromPartitionId: prereqPartition,
            toPartitionId: taskPartition,
            prerequisiteTaskId: prereqId,
            dependentTaskId: task.id,
            wave,
          });
        }
      }

      const reason: TopologyReason =
        prerequisites.length > 0
          ? "dependency"
          : overlaps.length > 0
            ? "write_scope_conflict"
            : "priority_capacity";
      const serializedAfter = [...new Set([...prerequisites, ...overlaps])].sort();
      const supplied = rationales[task.id];
      const agentReported = typeof supplied === "string" && supplied.trim().length > 0;

      decisions.push({
        task_id: task.id,
        wave,
        parallel_with: taskIds.filter((id) => id !== task.id),
        serialized_after: serializedAfter,
        reason,
        rationale: agentReported
          ? supplied
          : derivedRationale(wave, [...prerequisites].sort(), [...overlaps].sort(), maxParallel),
        evidence_class: agentReported ? "agent_reported" : "derived",
      });
    }

    for (const task of batch) {
      assigned.set(task.id, { wave, task });
      const record = workingTasks[task.id];
      if (isRecord(record)) record.status = "done";
    }
  }

  const resourceDisjointness = computeResourceDisjointness(allTasks, dependencies);
  const { fleet: recommendedValidatorFleet } = calculateValidatorAllocations(allTasks);
  const recommendedWorkerFleetSize = Math.max(
    1,
    Math.min(maxParallel, Math.max(peakWaveTaskCount, Math.ceil(workSpan.parallelismFactor))),
  );
  const recommendedCriticConcurrency = calculateCriticConcurrency(
    allTasks.length,
    waves.length,
    partitions.length,
  );
  const recommendedTier1Orchestrators = Math.max(
    1,
    Math.min(options.max_orchestrator_partitions ?? 4, Math.max(partitions.length, 1)),
  );
  const recommendedTier2Coordinators =
    partitions.length > 0
      ? partitions.reduce((acc, p) => acc + Math.max(1, Math.ceil(p.recommendedWorkers / 2)), 0)
      : 1;

  return {
    revision,
    work: workSpan.work,
    span: workSpan.span,
    parallelismFactor: workSpan.parallelismFactor,
    criticalPath: workSpan.criticalPath,
    resourceDisjointness,
    recommendedTier1Orchestrators,
    recommendedTier2Coordinators,
    recommendedWorkerFleetSize,
    recommendedValidatorFleet,
    recommendedCriticConcurrency,
    orchestratorPartitions: partitions,
    crossOrchestratorBarriers,
    waves,
    decisions,
    max_parallel: maxParallel,
  };
}
