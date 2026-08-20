import { readTopology, topologyWavesByTask } from "../contracts/topology.ts";
import { proposeBatch } from "./propose-batch.ts";

export interface ReadyEntry {
  task_id: string;
  label: string | null;
  priority: number;
  write_scope: string[];
  resource_scope: string[];
  /**
   * The wave `plan:compile` recorded for this task, or null when the capsule has no topology. A
   * DISPLAY annotation only (B25) — it says what a planning-time pass observed, never what a
   * coordinator must wait for; dispatch is decided by live dependency and lease state alone.
   */
  recorded_wave: number | null;
}

export interface ReadySetSelection {
  entries: ReadyEntry[];
  max_parallel: number;
  /** "recorded" only when the capsule actually holds a topology; never assumed. */
  topology_source: "recorded" | "absent";
  topology_revision: number | null;
}

/**
 * The live readiness snapshot: every task whose dependencies are done and whose write scope
 * collides with nothing currently leased, ranked by critical depth and capped at `maxParallel`.
 * Selection is `proposeBatch` — the same authority that decided the recorded waves — so a
 * persisted topology annotates the answer instead of second-guessing it.
 *
 * This is a READ-ONLY query for display and planning, not a batch to assemble and dispatch as one
 * unit (B24/B25). A coordinator keeping its eligible set full recomputes this whenever a slot
 * frees — an agent submits, a lease is released, a dependency clears — and dispatches the
 * top-ranked entry immediately; it never waits for the rest of this list to be claimed, and a
 * validator becomes eligible the instant its own implementer submits, independent of every other
 * entry here.
 */
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
