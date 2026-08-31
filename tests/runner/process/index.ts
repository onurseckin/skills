/**
 * Runner Process Subdomain Test Facade.
 * Explicit named exports for process lifecycle, signals, group termination, and procfs inspection.
 */

export {
  terminateProcessGroup,
  signalProcessGroup,
  type ProcessGroupInspection,
} from "../../../olt/scripts/src/engine/runner/process/process-group.ts";

export {
  readProcessIdentity,
  sameProcessIdentity,
  type ProcessIdentity,
} from "../../../olt/scripts/src/engine/runner/process/identity.ts";

export {
  processSnapshot,
  ancestry,
  matchesTopology,
  type ProcessSnapshotEntry,
} from "../../../olt/scripts/src/engine/runner/process/snapshot.ts";
