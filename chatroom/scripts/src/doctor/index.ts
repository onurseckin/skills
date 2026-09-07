export { formatProvisioningDrift, inspectAllRooms, inspectRoom } from "./inspect.ts";
export { inspectProvisioning, type InspectorPorts } from "./inspectors.ts";
export { repairAllRooms, repairRoom, repairSpoolFile, repairTornSpools } from "./repair.ts";

export type {
  DaemonLivenessState,
  DoctorInspectOptions,
  DoctorInspectionResult,
  LeaseInfo,
  LockReport,
  ManifestReport,
  ProvisionReport,
  ReaderHealthReport,
  RoomHealthReport,
} from "./types.ts";

export type {
  DaemonRestartRepair,
  DoctorRepairOptions,
  DoctorRepairResult,
  RoomRepairReport,
  StaleLockRepair,
  TornSpoolRepair,
} from "./repair.ts";
