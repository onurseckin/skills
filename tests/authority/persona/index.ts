/**
 * Authority Persona & Grounding Subdomain Test Facade.
 * Explicit named exports for cognitive pillars, reflexive audits, watchdog grounding, and verbatim role injectors.
 */

export {
  COGNITIVE_PILLARS,
  COGNITIVE_PILLARS_COUNT,
  COGNITIVE_PILLARS_MAP,
  COGNITIVE_PILLARS_BY_CODE,
  PILLAR_1_CLI_FIRST,
  PILLAR_2_VISUAL_TRUTH,
  PILLAR_3_THREAD_AUTHORITY,
  PILLAR_4_PERPETUAL_SELF_EVOLUTION,
  PILLAR_5_GRAPH_INTEROPERABILITY,
  PILLAR_6_FIRST_PRINCIPLES,
  PILLAR_7_INFINITE_CADENCE,
  getAllCognitivePillars,
  getCognitivePillar,
  getPillarAuditQuestions,
  formatPillarsMarkdown,
  formatPillarsBrief,
  type CognitivePillar,
  type CognitivePillarId,
  type SupervisoryRole,
} from "../../../olt/scripts/src/authority/pillars.ts";

export {
  evaluateReflexiveSelfAudit,
  formatReflexiveAuditEvaluation,
  generateWatchdogPersonaGrounding,
  buildWatchdogAuditPrompt,
  createWatchdogTickReminder,
  getRoleBoundaryProfile,
  getAllRoleBoundaryProfiles,
  isSupervisoryRole,
  normalizeSupervisoryRole,
  SUPERVISORY_ROLE_BOUNDARIES,
  type ReflexiveAuditContext,
  type ReflexiveAuditEvaluation,
  type RoleBoundaryProfile,
} from "../../../olt/scripts/src/authority/persona/index.ts";

export {
  VerbatimRoleInjector,
  type StagnationTelemetry,
  type RolePromptOptions,
  type MindInitOptions,
  type SupervisoryInitOptions,
  type SubagentSystemPromptOptions,
  type SubagentDispatchContext,
} from "../../../olt/scripts/src/authority/verbatim-role-injector.ts";
