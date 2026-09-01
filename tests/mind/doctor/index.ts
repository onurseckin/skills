/**
 * @file index.ts
 * Mind Doctor Diagnostics Unit Tests
 */

export type {
  MindCharterInvariant,
  AntiStagnationDoctorOptions,
  InvariantAuditResult,
  AntiStagnationAuditReport,
} from "../../../olt/scripts/src/reporting/doctor/anti-stagnation/index.ts";

export {
  MIND_CHARTER_INVARIANTS,
  DEFAULT_MAX_DASHBOARD_STALENESS_MS,
  checkAntiStagnationDoctor,
  auditAntiStagnationHealth,
} from "../../../olt/scripts/src/reporting/doctor/anti-stagnation/index.ts";
