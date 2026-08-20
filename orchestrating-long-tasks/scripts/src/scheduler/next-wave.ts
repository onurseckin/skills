import { readTopology, topologyWavesByTask } from "../contracts/topology.ts";
import { proposeBatch } from "./propose-batch.ts";

export interface WaveEntry {
  task_id: string;
  label: string | null;
  priority: number;
  write_scope: string[];
  resource_scope: string[];
  /** The wave `plan:compile` recorded for this task, or null when the capsule has no topology. */
  recorded_wave: number | null;
}

export interface WaveSelection {
  entries: WaveEntry[];
  max_parallel: number;
  /** "recorded" only when the capsule actually holds a topology; never assumed. */
  topology_source: "recorded" | "absent";
  topology_revision: number | null;
}

/**
 * The whole conflict-free set a coordinator may dispatch at once. Selection is `proposeBatch` — the
 * same authority that decided the recorded waves — so a persisted topology annotates the answer
 * instead of second-guessing it; live status is what makes a task dispatchable now.
 */
export function nextWave(state: unknown, maxParallel: number): WaveSelection {
  const batch = proposeBatch(state, maxParallel);
  const topology = readTopology(state);
  const recordedWaves = topology === null ? null : topologyWavesByTask(topology);
  return {
    entries: batch.map((task) => ({
      task_id: task.id,
      label: typeof task.label === "string" ? task.label : null,
      priority: task.priority,
      write_scope: [...task.write_scope],
      resource_scope: [...(task.resource_scope ?? [])],
      recorded_wave: recordedWaves?.get(task.id) ?? null,
    })),
    max_parallel: maxParallel,
    topology_source: topology === null ? "absent" : "recorded",
    topology_revision: topology?.revision ?? null,
  };
}
