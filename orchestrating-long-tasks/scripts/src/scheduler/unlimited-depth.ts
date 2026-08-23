import { HarnessError } from "../errors/harness-error.ts";
import { dependencyMap } from "../graph/dependency-map.ts";
import { topologicalOrder, type DependencyMap } from "../graph/topology.ts";
import { isInteger, isRecord } from "../requirements/predicates.ts";
import {
  applicableValidatorDomains,
  type ValidatorDomain,
} from "../contracts/workflow.ts";
import type { TopologyDecision, TopologyReason } from "../contracts/topology.ts";
import { resourceConflict, scopeConflict } from "./conflicts.ts";
import { proposeBatch } from "./propose-batch.ts";
import type { ScheduledTask } from "./rank.ts";

export interface UnlimitedDepthSchedulerConfig {
  readonly default_max_parallel?: number | undefined;
  readonly max_depth?: number | null | undefined;
  readonly allow_unbounded_waves?: boolean | undefined;
  readonly require_strict_validator_pairing?: boolean | undefined;
  readonly enforce_zero_leak?: boolean | undefined;
  readonly rationales?: Readonly<Record<string, string>> | undefined;
  readonly requirement_texts?: Readonly<Record<string, readonly string[]>> | undefined;
}

export interface ValidatorPairingRecord {
  readonly taskId: string;
  readonly assignedImplementer?: string | null | undefined;
  readonly applicableDomains: readonly ValidatorDomain[];
  readonly pairedValidatorDomains: readonly ValidatorDomain[];
  readonly isPaired: boolean;
  readonly pairingStrictness: "strict" | "relaxed" | "multi-round";
  readonly reason?: string | undefined;
}

export interface UnboundedWavePartition {
  readonly wave: number;
  readonly taskIds: readonly string[];
  readonly tasks: readonly ScheduledTask[];
  readonly depth: number;
  readonly parallelism: number;
  readonly validatorPairings: readonly ValidatorPairingRecord[];
  readonly isolatedWriteScopes: readonly string[];
  readonly isUnbounded: boolean;
}

export interface DepthMetrics {
  readonly totalTasks: number;
  readonly maxWaveDepth: number;
  readonly criticalPathLength: number;
  readonly criticalPathTasks: readonly string[];
  readonly longestChainEffort: number;
  readonly maxConcurrentWidth: number;
  readonly averageConcurrency: number;
  readonly unboundedSafetyVerified: boolean;
  readonly validatorPairingRate: number;
}

export interface CriticalPathDepthResult {
  readonly depth: number;
  readonly criticalPath: readonly string[];
  readonly longestChainEffort: number;
}

export interface DepthInvariantValidationResult {
  readonly valid: boolean;
  readonly violations: readonly string[];
}

export interface PairValidatorsOptions {
  readonly requireAllDomains?: boolean | undefined;
  readonly pairingStrictness?: "strict" | "relaxed" | "multi-round" | undefined;
  readonly requirementTexts?:
    | ReadonlyMap<string, readonly string[]>
    | Readonly<Record<string, readonly string[]>>
    | undefined;
  readonly assignedImplementers?:
    | ReadonlyMap<string, string>
    | Readonly<Record<string, string>>
    | undefined;
}

export interface UnlimitedDepthScheduleResult {
  readonly revision: number;
  readonly waves: readonly UnboundedWavePartition[];
  readonly metrics: DepthMetrics;
  readonly pairings: readonly ValidatorPairingRecord[];
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
  const leftResource = Array.isArray(left.resource_scope) ? left.resource_scope : [];
  const rightResource = Array.isArray(right.resource_scope) ? right.resource_scope : [];
  return (
    scopeConflict(left.write_scope, right.write_scope) ||
    resourceConflict(leftResource, rightResource)
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
      `no dependency or scope conflict; ranked into wave ${wave} with max_parallel ${maxParallel}`,
    );
  }
  return `wave ${wave}: ${clauses.join("; ")}`;
}

export function computeCriticalPathDepth(
  dependencies: DependencyMap | ReadonlyMap<string, ReadonlySet<string>>,
  tasks:
    | ReadonlyMap<string, ScheduledTask>
    | readonly ScheduledTask[]
    | Readonly<Record<string, ScheduledTask>>,
): CriticalPathDepthResult {
  const taskMap = new Map<string, ScheduledTask>();
  if (tasks instanceof Map) {
    for (const [id, t] of tasks) {
      taskMap.set(id, t);
    }
  } else if (Array.isArray(tasks)) {
    for (const t of tasks) {
      taskMap.set(t.id, t);
    }
  } else if (isRecord(tasks)) {
    for (const [id, t] of Object.entries(tasks)) {
      if (taskRecord(t)) {
        taskMap.set(id, t);
      }
    }
  }

  const order = topologicalOrder(dependencies);
  if (order.length !== dependencies.size) {
    throw new HarnessError("INTEGRITY", "depends_on edges contain an execution cycle");
  }

  if (order.length === 0) {
    return {
      depth: 0,
      criticalPath: [],
      longestChainEffort: 0,
    };
  }

  const cumulativeNodes = new Map<string, number>();
  const cumulativeEffort = new Map<string, number>();
  const parentOnCriticalPath = new Map<string, string | null>();

  for (const taskId of order) {
    const task = taskMap.get(taskId);
    const taskEffort = task && isInteger(task.effort) && task.effort > 0 ? task.effort : 1;
    const prereqsSet = dependencies.get(taskId);
    const prereqs = prereqsSet !== undefined ? prereqsSet : new Set<string>();

    let maxPrereqNodes = 0;
    let maxPrereqEffort = 0;
    let bestPrereq: string | null = null;

    for (const prereqId of prereqs) {
      const nodesVal = cumulativeNodes.get(prereqId);
      const prereqNodes = typeof nodesVal === "number" ? nodesVal : 0;
      const effortVal = cumulativeEffort.get(prereqId);
      const prereqEffort = typeof effortVal === "number" ? effortVal : 0;

      if (
        prereqNodes > maxPrereqNodes ||
        (prereqNodes === maxPrereqNodes && prereqEffort > maxPrereqEffort)
      ) {
        maxPrereqNodes = prereqNodes;
        maxPrereqEffort = prereqEffort;
        bestPrereq = prereqId;
      }
    }

    cumulativeNodes.set(taskId, maxPrereqNodes + 1);
    let previousEffort = 0;
    if (bestPrereq !== null) {
      const bestVal = cumulativeEffort.get(bestPrereq);
      if (typeof bestVal === "number") {
        previousEffort = bestVal;
      }
    }
    cumulativeEffort.set(taskId, previousEffort + taskEffort);
    parentOnCriticalPath.set(taskId, bestPrereq);
  }

  let maxDepth = 0;
  let maxEffort = 0;
  let criticalEndTask: string | null = null;

  for (const [taskId, depth] of cumulativeNodes.entries()) {
    const rawEffort = cumulativeEffort.get(taskId);
    const effort = typeof rawEffort === "number" ? rawEffort : 0;
    if (depth > maxDepth || (depth === maxDepth && effort > maxEffort)) {
      maxDepth = depth;
      maxEffort = effort;
      criticalEndTask = taskId;
    }
  }

  const criticalPath: string[] = [];
  let curr = criticalEndTask;
  while (curr !== null) {
    criticalPath.unshift(curr);
    const parent = parentOnCriticalPath.get(curr);
    curr = typeof parent === "string" ? parent : null;
  }

  return {
    depth: maxDepth,
    criticalPath,
    longestChainEffort: maxEffort,
  };
}

export function pairValidatorsStrictly(
  tasks: readonly ScheduledTask[],
  options: PairValidatorsOptions = {},
): ValidatorPairingRecord[] {
  const strictness =
    options.pairingStrictness !== undefined ? options.pairingStrictness : "strict";
  const records: ValidatorPairingRecord[] = [];

  const getReqTexts = (taskId: string): readonly string[] => {
    if (!options.requirementTexts) return [];
    if (options.requirementTexts instanceof Map) {
      const texts = options.requirementTexts.get(taskId);
      return Array.isArray(texts) ? texts : [];
    }
    if (isRecord(options.requirementTexts)) {
      const val = options.requirementTexts[taskId];
      return Array.isArray(val) ? val : [];
    }
    return [];
  };

  const getImplementer = (taskId: string): string | null => {
    if (!options.assignedImplementers) return null;
    if (options.assignedImplementers instanceof Map) {
      const impl = options.assignedImplementers.get(taskId);
      return typeof impl === "string" ? impl : null;
    }
    if (isRecord(options.assignedImplementers)) {
      const val = options.assignedImplementers[taskId];
      return typeof val === "string" ? val : null;
    }
    return null;
  };

  for (const task of tasks) {
    const reqTexts = getReqTexts(task.id);
    const applicable = applicableValidatorDomains(task.write_scope, reqTexts);
    const assignedImplementer = getImplementer(task.id);

    let paired: ValidatorDomain[];
    if (strictness === "relaxed") {
      paired = applicable.length > 0 ? [applicable[0]!] : ["code-quality"];
    } else {
      paired = [...applicable];
    }

    const isPaired = applicable.length > 0 && paired.length === applicable.length;
    const reason = isPaired
      ? `Strictly paired ${paired.length} validator domain(s): ${paired.join(", ")}`
      : `Partial validator pairing (${paired.length}/${applicable.length} domains)`;

    records.push({
      taskId: task.id,
      assignedImplementer,
      applicableDomains: applicable,
      pairedValidatorDomains: paired,
      isPaired,
      pairingStrictness: strictness,
      reason,
    });
  }

  return records;
}

export function assertUnboundedConcurrencySafety(
  waves: readonly UnboundedWavePartition[],
  maxParallel?: number | null | undefined,
): void {
  for (const wave of waves) {
    if (
      maxParallel !== undefined &&
      maxParallel !== null &&
      Number.isFinite(maxParallel) &&
      maxParallel > 0 &&
      wave.taskIds.length > maxParallel
    ) {
      throw new HarnessError(
        "INVALID_STATE",
        `Wave ${wave.wave} task count ${wave.taskIds.length} exceeds max_parallel limit ${maxParallel}`,
      );
    }

    const taskCount = wave.tasks.length;
    for (let i = 0; i < taskCount; i++) {
      const left = wave.tasks[i]!;
      for (let j = i + 1; j < taskCount; j++) {
        const right = wave.tasks[j]!;
        if (conflicting(left, right)) {
          throw new HarnessError(
            "INVALID_STATE",
            `Concurrency safety violation in wave ${wave.wave}: tasks ${left.id} and ${right.id} conflict on write or resource scope`,
          );
        }
      }
    }
  }
}

export function validateDepthInvariants(
  metrics: DepthMetrics,
  config?: UnlimitedDepthSchedulerConfig | undefined,
): DepthInvariantValidationResult {
  const violations: string[] = [];

  if (metrics.maxWaveDepth < 0) {
    violations.push("maxWaveDepth must be non-negative");
  }

  if (metrics.criticalPathLength < 0) {
    violations.push("criticalPathLength must be non-negative");
  }

  if (metrics.totalTasks > 0 && metrics.maxWaveDepth === 0) {
    violations.push("maxWaveDepth must be > 0 when totalTasks > 0");
  }

  if (metrics.criticalPathLength > metrics.totalTasks) {
    violations.push("criticalPathLength cannot exceed totalTasks");
  }

  if (metrics.validatorPairingRate < 0 || metrics.validatorPairingRate > 1) {
    violations.push("validatorPairingRate must be between 0.0 and 1.0");
  }

  if (
    config?.require_strict_validator_pairing !== false &&
    metrics.totalTasks > 0 &&
    metrics.validatorPairingRate < 1.0
  ) {
    violations.push("strict validator pairing rate must be 1.0 (100% paired)");
  }

  if (metrics.totalTasks > 0 && !metrics.unboundedSafetyVerified) {
    violations.push("unbounded concurrency safety must be verified");
  }

  if (
    config?.max_depth !== undefined &&
    config.max_depth !== null &&
    Number.isFinite(config.max_depth) &&
    metrics.maxWaveDepth > config.max_depth
  ) {
    violations.push(
      `maxWaveDepth ${metrics.maxWaveDepth} exceeds configured max_depth ${config.max_depth}`,
    );
  }

  return {
    valid: violations.length === 0,
    violations,
  };
}

export function scheduleUnlimitedDepthDAG(
  state: unknown,
  config: UnlimitedDepthSchedulerConfig = {},
): UnlimitedDepthScheduleResult {
  const maxParallel =
    typeof config.default_max_parallel === "number" ? config.default_max_parallel : 4;
  if (!isInteger(maxParallel) || maxParallel < 1) {
    throw new HarnessError(
      "INVALID_ARGUMENT",
      "default_max_parallel must be a positive integer to schedule DAG",
    );
  }

  if (!isRecord(state) || !isRecord(state.graph) || !isRecord(state.tasks)) {
    throw new HarnessError("INVALID_STATE", "a plan must be applied before DAG can be scheduled");
  }

  const revision = state.graph.revision;
  if (!isInteger(revision) || revision < 1) {
    throw new HarnessError("INVALID_STATE", "graph revision is required to schedule DAG");
  }

  const dependencies = dependencyMap(state.graph);
  const taskMap = new Map<string, ScheduledTask>();
  for (const [id, value] of Object.entries(state.tasks)) {
    if (taskRecord(value)) {
      const resourceScope = Array.isArray(value.resource_scope) ? value.resource_scope : [];
      taskMap.set(id, { ...value, resource_scope: resourceScope });
    }
  }

  const criticalPathResult = computeCriticalPathDepth(dependencies, taskMap);

  const working = structuredClone(state);
  const workingTasks = working.tasks;
  if (!isRecord(workingTasks)) {
    throw new HarnessError("INVALID_STATE", "a plan must be applied before DAG can be scheduled");
  }

  const rationales = isRecord(config.rationales) ? config.rationales : {};
  const waves: UnboundedWavePartition[] = [];
  const decisions: TopologyDecision[] = [];
  const allPairings: ValidatorPairingRecord[] = [];
  const assigned = new Map<string, { wave: number; task: ScheduledTask }>();

  for (let wave = 1; ; wave += 1) {
    const batch = proposeBatch(working, maxParallel);
    if (batch.length === 0) break;

    const taskIds = batch.map(({ id }) => id);
    const batchTasks = batch.map((t) => {
      const mapped = taskMap.get(t.id);
      return mapped !== undefined ? mapped : t;
    });

    const pairings = pairValidatorsStrictly(batchTasks, {
      pairingStrictness:
        config.require_strict_validator_pairing === false ? "relaxed" : "strict",
      requirementTexts: config.requirement_texts,
    });
    allPairings.push(...pairings);

    const isolatedWriteScopes = Array.from(
      new Set(batchTasks.flatMap((t) => t.write_scope)),
    ).sort();

    waves.push({
      wave,
      taskIds: [...taskIds],
      tasks: batchTasks,
      depth: wave,
      parallelism: taskIds.length,
      validatorPairings: pairings,
      isolatedWriteScopes,
      isUnbounded: true,
    });

    for (const task of batch) {
      const taskPrereqs = dependencies.get(task.id);
      const prerequisites = (taskPrereqs !== undefined ? [...taskPrereqs] : []).filter((id) =>
        assigned.has(id),
      );
      const overlaps = [...assigned]
        .filter(([, entry]) => conflicting(task, entry.task))
        .map(([id]) => id);

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
          : derivedRationale(
              wave,
              [...prerequisites].sort(),
              [...overlaps].sort(),
              maxParallel,
            ),
        evidence_class: agentReported ? "agent_reported" : "derived",
      });
    }

    for (const task of batch) {
      assigned.set(task.id, { wave, task });
      const record = workingTasks[task.id];
      if (isRecord(record)) record.status = "done";
    }
  }

  assertUnboundedConcurrencySafety(waves, maxParallel);

  const totalTasks = taskMap.size;
  const maxWaveDepth = waves.length;
  const maxConcurrentWidth =
    waves.length > 0 ? Math.max(...waves.map((w) => w.parallelism)) : 0;
  const averageConcurrency =
    totalTasks > 0 && waves.length > 0
      ? Number((totalTasks / waves.length).toFixed(2))
      : 0;
  const pairedCount = allPairings.filter((p) => p.isPaired).length;
  const validatorPairingRate =
    totalTasks > 0 ? Number((pairedCount / totalTasks).toFixed(2)) : 1.0;

  const metrics: DepthMetrics = {
    totalTasks,
    maxWaveDepth,
    criticalPathLength: criticalPathResult.depth,
    criticalPathTasks: criticalPathResult.criticalPath,
    longestChainEffort: criticalPathResult.longestChainEffort,
    maxConcurrentWidth,
    averageConcurrency,
    unboundedSafetyVerified: true,
    validatorPairingRate,
  };

  const invariantCheck = validateDepthInvariants(metrics, config);
  if (!invariantCheck.valid) {
    throw new HarnessError(
      "INVALID_STATE",
      `Depth invariant violated: ${invariantCheck.violations.join("; ")}`,
    );
  }

  return {
    revision,
    waves,
    metrics,
    pairings: allPairings,
    decisions,
    max_parallel: maxParallel,
  };
}
