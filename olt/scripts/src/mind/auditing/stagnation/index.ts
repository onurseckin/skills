export {
  auditMindPreplanningStagnation,
  auditMindPreplanningLiveness,
  auditMindCreativeStagnation,
  MIND_PREPLANNING_STAGNATION,
  MIND_CREATIVE_STAGNATION,
  DEFAULT_STAGNATION_THRESHOLD_SECONDS,
  DEFAULT_ZERO_DELTA_THRESHOLD_CYCLES,
  DEFAULT_MAINTENANCE_LOOP_THRESHOLD_CYCLES,
  type MindAuditorStagnationReport,
} from "./mind-stagnation-auditor.ts";

export {
  compareReportDelta,
  isZeroDeltaReport,
  suppressZeroDeltaReport,
  computeStateSignature,
  sanitizeFindingForDelta,
  type ZeroDeltaComparisonResult,
  type MindStagnationAuditResult,
  type StagnationAuditOptions,
} from "./stagnation-delta.ts";

export {
  MODE_A_AUTONOMIC_DISCOVERY,
  MODE_B_BACKLOG_REACTIVE,
  MODE_STANDARD_PREPLAN,
  MODE_DORMANT,
  CHRONIC_STAGNATION_CYCLE_THRESHOLD,
  resolveStagnationIncidents,
  executeStagnationShockRecovery,
  type StagnationMode,
  type StagnationShockResult,
  type StagnationRecoveryOptions,
  type StagnationShockOptions,
} from "./stagnation-recovery-interlock.ts";

export {
  auditAntiStagnationPassivity,
  type AntiStagnationAuditOptions,
  type AntiStagnationResult,
} from "./anti-stagnation-engine.ts";
