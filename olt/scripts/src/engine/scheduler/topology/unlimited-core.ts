import { TopologyDecision, TopologyReason } from "../../../core/contracts";
import { HarnessError } from "../../../core/errors";
import { dependencyMap } from "../../../graph/dependency-map";
import { isInteger } from "../../../requirements/predicates";
import { isRecord } from "../../store/layout/layout-json.ts";
import { ScheduledTask } from "../conflict/rank";
import { proposeBatch } from "../dispatch/propose-batch.ts";
import { pairValidatorsStrictly, assertUnboundedConcurrencySafety, validateDepthInvariants } from "./unlimited-pairing";
import { UnlimitedDepthSchedulerConfig, UnlimitedDepthScheduleResult, UnboundedWavePartition, ValidatorPairingRecord, DepthMetrics } from "./unlimited-types";
import { taskRecord, computeCriticalPathDepth, conflicting, derivedRationale } from "./unlimited-utils";

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
      pairingStrictness: config.require_strict_validator_pairing === false ? "relaxed" : "strict",
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

  assertUnboundedConcurrencySafety(waves, maxParallel);

  const totalTasks = taskMap.size;
  const maxWaveDepth = waves.length;
  const maxConcurrentWidth = waves.length > 0 ? Math.max(...waves.map((w) => w.parallelism)) : 0;
  const averageConcurrency =
    totalTasks > 0 && waves.length > 0 ? Number((totalTasks / waves.length).toFixed(2)) : 0;
  const pairedCount = allPairings.filter((p) => p.isPaired).length;
  const validatorPairingRate = totalTasks > 0 ? Number((pairedCount / totalTasks).toFixed(2)) : 1.0;

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
