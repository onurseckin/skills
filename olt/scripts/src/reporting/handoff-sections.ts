import type { AgentGrantRecord } from "../core/contracts/index.ts";
import type { Evidenced } from "../core/contracts/index.ts";
import type { JsonValue } from "../core/contracts/index.ts";
import { topologyWavesByTask, type TopologyRecord } from "../core/contracts/index.ts";
import type { TaskView } from "./action-types.ts";

const UNKNOWN = "unknown";

function evidencedValue(entry: Evidenced<JsonValue> | undefined): JsonValue {
  if (entry === undefined) return UNKNOWN;
  return {
    value: entry.value,
    evidence_class: entry.evidence_class,
    ...(entry.is_estimated === undefined ? {} : { is_estimated: entry.is_estimated }),
  };
}

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
