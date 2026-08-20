import type { ResolvedHarnessConfig } from "../config/harness-config.ts";
import type {
  TopologyDecision,
  TopologyReason,
  TopologyRecord,
  TopologyWave,
} from "../contracts/topology.ts";
import { HarnessError } from "../errors/harness-error.ts";
import { dependencyMap } from "../graph/dependency-map.ts";
import { isInteger, isRecord } from "../requirements/predicates.ts";
import { resourceConflict, scopeConflict } from "./conflicts.ts";
import { proposeBatch } from "./propose-batch.ts";
import type { ScheduledTask } from "./rank.ts";

export type TopologyConfig = Readonly<Pick<ResolvedHarnessConfig, "default_max_parallel">>;

export interface TopologyInputs {
  /**
   * Coordinator-authored explanation per task id. Recorded verbatim as `agent_reported`; a task with
   * no entry keeps the harness's own `derived` sentence rather than borrowing someone else's.
   */
  rationales?: Readonly<Record<string, string>>;
}

/**
 * Each clause names only the tasks that actually caused it. A task can be both depended on and
 * scope-overlapping, so folding `serialized_after` into one sentence would report scope neighbours
 * as dependencies the graph never declared.
 */
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

function conflicting(left: ScheduledTask, right: ScheduledTask): boolean {
  return (
    scopeConflict(left.write_scope, right.write_scope) ||
    resourceConflict(left.resource_scope ?? [], right.resource_scope ?? [])
  );
}

/**
 * Replays `proposeBatch` wave by wave against a working copy so the recorded plan and the runtime
 * queue answer "what may run together" with the same code. Tasks the scheduler can never make
 * eligible — paused authority, unsatisfiable dependencies — drop out of the record entirely; giving
 * them a wave number would be an invention, and the loop must still terminate.
 */
export function computeTopology(
  state: unknown,
  config: TopologyConfig,
  inputs: TopologyInputs = {},
): TopologyRecord {
  const maxParallel = config.default_max_parallel;
  if (!isInteger(maxParallel) || maxParallel < 1) {
    throw new HarnessError(
      "INVALID_ARGUMENT",
      "default_max_parallel must be a positive integer to record topology",
    );
  }
  if (!isRecord(state) || !isRecord(state.graph) || !isRecord(state.tasks)) {
    throw new HarnessError("INVALID_STATE", "a plan must be applied before topology is recorded");
  }
  const revision = state.graph.revision;
  if (!isInteger(revision) || revision < 1) {
    throw new HarnessError("INVALID_STATE", "graph revision is required to record topology");
  }

  const dependencies = dependencyMap(state.graph);
  const working = structuredClone(state);
  const workingTasks = working.tasks;
  if (!isRecord(workingTasks)) {
    throw new HarnessError("INVALID_STATE", "a plan must be applied before topology is recorded");
  }

  const rationales = inputs.rationales ?? {};
  const waves: TopologyWave[] = [];
  const decisions: TopologyDecision[] = [];
  const assigned = new Map<string, { wave: number; task: ScheduledTask }>();

  for (let wave = 1; ; wave += 1) {
    const batch = proposeBatch(working, maxParallel);
    if (batch.length === 0) break;
    const taskIds = batch.map(({ id }) => id);
    waves.push({ wave, task_ids: [...taskIds] });

    for (const task of batch) {
      const prerequisites = [...(dependencies.get(task.id) ?? [])].filter((id) => assigned.has(id));
      const overlaps = [...assigned]
        .filter(([, entry]) => conflicting(task, entry.task))
        .map(([id]) => id);
      // Precedence is strongest-constraint-first: a dependency would serialize the task even if the
      // scopes were disjoint, so it names the reason whenever both hold.
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

  return { revision, waves, decisions, max_parallel: maxParallel };
}
