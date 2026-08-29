export { probeOrphanedTasks, probeStaleLeases } from "./tasks/tasks.ts";

export { probeCircularDependencies } from "./tasks/tasks-circular.ts";
export { auditGraphHealth, auditSupervisoryWatchdog, recoverStaleTasks } from "./state.ts";

export { probeDoctorErrorResolution } from "./loop-doctor.ts";

export { probeGateCoverageViolations } from "./tasks/tasks-coverage.ts";

export {
  probePlanEnhancementNeeds,
  probeAgentRegistryAccuracy,
  probeRoleBoundaryAdherence,
} from "./loop.ts";

export {
  executePulseTick,
  executePulseTickWithDiagnostics,
  runPulseLoop,
} from "../feedback/pulse-core.ts";

export type {
  PulseLoopOptions,
  PulseLoopResult,
  PulseTickOptions,
  PulseTickResult,
} from "../feedback/pulse-types.ts";

export {
  NOOP_COMMANDS,
  probeScopeCollisionHazards,
  probeWorkSpanParallelizationHealth,
} from "./tasks/tasks-advanced.ts";

export {
  determineTopLeader,
  formatSupervisoryHealthMarkdown,
  auditSupervisory5PointHealth,
  dispatchSupervisoryHealthProbe,
  auditDoctorGate,
  assertDoctorGatePassed,
} from "./lifecycle.ts";

export type {
  GraphHealthIssue,
  OrphanedTasksProbeResult,
  StaleLeaseInfo,
  StaleLeasesProbeResult,
  CircularDependenciesProbeResult,
  GateCoverageProbeResult,
  ScopeCollisionHazard,
  ScopeCollisionProbeResult,
  GraphHealthAuditReport,
  SupervisoryWatchdogAuditReport,
  WorkSpanHealthAudit,
  SupervisoryTopLeader,
  PlanEnhancementAudit,
  AgentRegistryAccuracyAudit,
  RoleBoundaryAdherenceAudit,
  DoctorErrorResolutionAudit,
  Supervisory5PointHealthReport,
  Supervisory5PointOptions,
  SupervisoryProbeDispatchResult,
  TaskRecoveryRecord,
  TaskRecoveryResult,
  ScheduledTaskDispatch,
  BlockedTaskInfo,
  ScheduledWaveResult,
  SchedulerEngineOptions,
} from "./types.ts";

export { SchedulerEngine, createSchedulerEngine } from "./core-engine-class.ts";
