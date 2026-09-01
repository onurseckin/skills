export {
  MIND_CHARTER_INVARIANTS,
  DEFAULT_MAX_DASHBOARD_STALENESS_MS,
  type MindCharterInvariant,
  type AntiStagnationDoctorOptions,
  type InvariantAuditResult,
  type AntiStagnationAuditReport,
} from "./types.ts";
export {
  checkAntiStagnationDoctor,
  auditAntiStagnationHealth,
} from "./engine.ts";
