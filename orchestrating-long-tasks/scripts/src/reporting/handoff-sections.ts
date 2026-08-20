import type { AgentGrantRecord } from "../contracts/agents.ts";
import type { Evidenced } from "../contracts/evidence.ts";
import type { JsonValue } from "../contracts/json.ts";
import { topologyWavesByTask, type TopologyRecord } from "../contracts/topology.ts";
import type { TaskView } from "./action-types.ts";

/** Absent telemetry is reported as absent. A grant nobody described gets no invented description. */
const UNKNOWN = "unknown";

function evidencedValue(entry: Evidenced<JsonValue> | undefined): JsonValue {
  if (entry === undefined) return UNKNOWN;
  return {
    value: entry.value,
    evidence_class: entry.evidence_class,
    ...(entry.is_estimated === undefined ? {} : { is_estimated: entry.is_estimated }),
  };
}

/**
 * Which wave the run is actually in, read off the recorded topology rather than re-derived: the
 * lowest wave that still holds an unfinished task. A capsule with no recorded topology has no wave
 * to report, and says so — the alternative is a wave number computed from a different algorithm
 * than the one that dispatched the work.
 */
export function liveWaveLine(topology: TopologyRecord | null, tasks: readonly TaskView[]): string {
  if (topology === null) {
    return `Live wave: ${UNKNOWN} (no topology recorded; plan:compile records one)`;
  }
  const byTask = topologyWavesByTask(topology);
  const unfinished = tasks.filter(({ status }) => status !== "done");
  const waves = unfinished
    .map(({ id }) => byTask.get(id))
    .filter((wave): wave is number => wave !== undefined);
  const total = topology.waves.length;
  const unplaced = unfinished.length - waves.length;
  const suffix =
    unplaced > 0 ? `; ${unplaced} unfinished task(s) outside the recorded topology` : "";
  if (waves.length === 0) {
    return unfinished.length === 0
      ? `Live wave: none, every task in the ${total} recorded wave(s) is done${suffix}`
      : `Live wave: ${UNKNOWN}, no unfinished task appears in the ${total} recorded wave(s)${suffix}`;
  }
  return `Live wave: ${Math.min(...waves)} of ${total} recorded (revision ${topology.revision}, max_parallel ${topology.max_parallel})${suffix}`;
}

export function topologyRows(
  topology: TopologyRecord | null,
  tasks: readonly TaskView[],
): string[] {
  if (topology === null) return ["no topology recorded"];
  const statuses = new Map(tasks.map((task) => [task.id, task.status]));
  return topology.waves.map((wave) =>
    JSON.stringify({
      wave: wave.wave,
      tasks: wave.task_ids.map((id) => ({ id, status: statuses.get(id) ?? UNKNOWN })),
    }),
  );
}

/**
 * The grant ledger as a fresh agent needs it: who is still holding a grant, under what role, and
 * what the host reported about each one. Released grants stay listed because they still count
 * against the run's agent budget.
 */
export function agentRows(agents: readonly AgentGrantRecord[]): string[] {
  if (agents.length === 0) return ["no agent grants recorded"];
  return [...agents]
    .sort((left, right) => left.id.localeCompare(right.id))
    .map((grant) =>
      JSON.stringify({
        id: grant.id,
        role: grant.role,
        status: grant.status,
        host: grant.host,
        parent_agent_id: grant.parent_agent_id,
        parent_task_id: grant.parent_task_id,
        granted_at: grant.granted_at,
        released_at: grant.released_at ?? null,
        model: evidencedValue(grant.model),
        model_tier: evidencedValue(grant.model_tier),
        thinking_level: evidencedValue(grant.thinking_level),
        tokens_in: evidencedValue(grant.tokens_in),
        tokens_out: evidencedValue(grant.tokens_out),
      }),
    );
}
