import type { RunState } from "../../core/contracts/capsule.ts";
import type { TopologyRecord } from "../../core/contracts/topology.ts";
import { loadRun } from "../store/load.ts";
import { transact } from "../store/transaction.ts";
import { computeTopology, type TopologyConfig, type TopologyInputs } from "./topology.ts";

function persistTopology(runRoot: string, actor: string, topology: TopologyRecord): RunState {
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

export function recordTopology(
  runRoot: string,
  actor: string,
  config: TopologyConfig,
  inputs: TopologyInputs = {},
): { state: RunState; topology: TopologyRecord } {
  const topology = computeTopology(loadRun(runRoot).state, config, inputs);
  return { state: persistTopology(runRoot, actor, topology), topology };
}
