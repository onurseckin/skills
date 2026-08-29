import { probeAttemptProcess, type AttemptProcessProof } from "../execution/attempt-intent";
import { ownedProcessPids, ownershipTokenIdentities } from "../core/pipe-ownership";
import {
  readProcessIdentity,
  type ProcessIdentity,
  type ProcessTopology,
} from "../process/process-identity";
import { processSnapshot } from "../process/process-tree";

type Kill = (pid: number, signal: NodeJS.Signals) => unknown;

export interface TrackerDependencies {
  runnerPid?: number;
  snapshot?: () => Promise<Map<number, ProcessTopology>>;
  identify?: (pid: number) => ProcessIdentity | undefined;
  ownedPids?: (anchors: ReadonlySet<bigint>, token: string) => Set<number>;
  tokenOwners?: (token: string) => ProcessIdentity[];
  kill?: Kill;
  probe?: (identity: ProcessIdentity) => AttemptProcessProof;
}

export function trackerDependencies(
  input: TrackerDependencies,
  pipeAnchors: ReadonlySet<bigint> = new Set(),
): Required<TrackerDependencies> {
  const identify = input.identify ?? readProcessIdentity;
  const ownedPids = input.ownedPids ?? ownedProcessPids;
  return {
    runnerPid: input.runnerPid ?? process.pid,
    snapshot: input.snapshot ?? processSnapshot,
    identify,
    ownedPids,
    tokenOwners:
      input.tokenOwners ??
      (input.ownedPids
        ? (token) =>
            [...input.ownedPids!(pipeAnchors, token)]
              .map((pid) => identify(pid))
              .filter((identity): identity is ProcessIdentity => identity !== undefined)
        : ownershipTokenIdentities),
    kill: input.kill ?? process.kill,
    probe: input.probe ?? probeAttemptProcess,
  };
}
