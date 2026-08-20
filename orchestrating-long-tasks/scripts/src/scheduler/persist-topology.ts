import type { RunState } from "../contracts/capsule.ts";
import type { TopologyRecord } from "../contracts/topology.ts";
import { loadRun } from "../store/load.ts";
import { transact } from "../store/transaction.ts";
import { computeTopology, type TopologyConfig, type TopologyInputs } from "./topology.ts";

/**
 * Writes the decided topology to `state.topology` through the hash chain. Recording is a separate
 * call from deciding so a caller can show the waves it is about to commit, and so the event payload
 * carries the shape of the decision rather than the whole record twice.
 */
export function persistTopology(
  runRoot: string,
  actor: string,
  topology: TopologyRecord,
): RunState {
  return transact(
    runRoot,
    actor,
    "topology-recorded",
    {
      revision: topology.revision,
      wave_count: topology.waves.length,
      task_count: topology.decisions.length,
      max_parallel: topology.max_parallel,
    },
    (draft) => {
      draft.topology = structuredClone(topology);
    },
  );
}

/** Decide-then-record against the capsule on disk; this is what `plan:compile` calls. */
export function recordTopology(
  runRoot: string,
  actor: string,
  config: TopologyConfig,
  inputs: TopologyInputs = {},
): { state: RunState; topology: TopologyRecord } {
  const topology = computeTopology(loadRun(runRoot).state, config, inputs);
  return { state: persistTopology(runRoot, actor, topology), topology };
}
