import { readTopology, topologyWavesByTask } from "../contracts/topology.ts";
import { proposeBatch } from "./propose-batch.ts";

export interface ReadyEntry {
  task_id: string;
  label: string | null;
  priority: number;
  write_scope: string[];
  resource_scope: string[];
  recorded_wave: number | null;
}

export interface ReadySetSelection {
  entries: ReadyEntry[];
  max_parallel: number;
  topology_source: "recorded" | "absent";
  topology_revision: number | null;
}

export function readySet(state: unknown, maxParallel: number): ReadySetSelection {
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
