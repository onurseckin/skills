import {
  sameProcessIdentity,
  type ProcessIdentity,
  type ProcessTopology,
} from "../process/process-identity";
import { matchesTopology } from "../process/process-tree";

export function liveTrackedParents(
  rootPid: number,
  rootIdentity: ProcessIdentity | undefined,
  tracked: ReadonlyMap<number, ProcessIdentity>,
  processes: ReadonlyMap<number, ProcessTopology>,
  identify: (pid: number) => ProcessIdentity | undefined,
  runnerPid: number,
): Set<number> {
  const live = new Set<number>();
  const currentRoot = rootIdentity ? identify(rootIdentity.pid) : undefined;
  if (
    !sameProcessIdentity(rootIdentity, currentRoot) ||
    !matchesTopology(currentRoot, processes.get(rootPid)) ||
    currentRoot.parent !== runnerPid ||
    currentRoot.group !== currentRoot.pid
  )
    return live;
  live.add(currentRoot.pid);
  let changed = true;
  while (changed) {
    changed = false;
    for (const expected of tracked.values()) {
      if (live.has(expected.pid)) continue;
      const current = identify(expected.pid);
      if (
        sameProcessIdentity(expected, current) &&
        matchesTopology(current, processes.get(expected.pid)) &&
        live.has(current.parent)
      ) {
        live.add(expected.pid);
        changed = true;
      }
    }
  }
  return live;
}

export function expandDescendants(
  rootPid: number,
  protectedNow: ReadonlySet<number>,
  liveParents: Set<number>,
  processes: ReadonlyMap<number, ProcessTopology>,
  tracked: Map<number, ProcessIdentity>,
  identify: (pid: number) => ProcessIdentity | undefined,
): void {
  let changed = true;
  while (changed) {
    changed = false;
    for (const topology of processes.values()) {
      if (
        topology.pid === rootPid ||
        protectedNow.has(topology.pid) ||
        !liveParents.has(topology.parent) ||
        tracked.has(topology.pid)
      )
        continue;
      const current = identify(topology.pid);
      if (!matchesTopology(current, topology)) continue;
      tracked.set(topology.pid, current);
      liveParents.add(topology.pid);
      changed = true;
    }
  }
}
