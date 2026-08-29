import { DynamicTopologyOptions, DynamicTopologySynthesis, computeWorkSpanMetrics, partitionOrchestratorDomains, DynamicTopologyWave, CrossOrchestratorBarrier, calculateValidatorAllocations, computeResourceDisjointness, calculateCriticConcurrency } from "..";
import { TopologyDecision, TopologyReason } from "../../../core/contracts";
import { HarnessError } from "../../../core/errors";
import { dependencyMap } from "../../../graph/dependency-map";
import { isInteger } from "../../../requirements/predicates";
import { isRecord } from "../../store/layout/layout-json.ts";
import { ScheduledTask } from "../conflict/rank";
import { proposeBatch } from "../dispatch/propose-batch.ts";
import { taskRecord, conflicting, derivedRationale } from "./unlimited-utils";

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
