export { BootGateEnforcer } from "./enforcer.ts";
export { renderAsciiBootGateTable } from "./formatter.ts";
export {
  applyDoctorExecution,
  applyWhoamiExecution,
  createSpawnedSubagentRecord,
} from "./recorder.ts";
export { auditBootGatesFromState } from "./state-auditor.ts";
export { assertBootGatesPassed, auditFindings, verifyBootGates } from "./verifier.ts";
export type {
  BootGateVerificationResult,
  LiveCliProof,
  MandatoryBootGate,
  ProcessHealthStatus,
  SubagentBootGateRecord,
  SubagentRegistrationOptions,
  WatchdogFinding,
} from "./types.ts";
