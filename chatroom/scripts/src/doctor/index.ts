export { formatProvisioningDrift, inspectAllRooms, inspectRoom } from "./inspect.ts";
export { repairAllRooms, repairRoom } from "./repair.ts";

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
