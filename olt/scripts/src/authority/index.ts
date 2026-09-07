export { normalizeRoleKey, resolveAgentHostConfiguration } from "./host-bindings.ts";

export {
  parseUnifiedAgentManifest,
  validateUnifiedAgentManifest,
  type AgentManifestCommunicationContract,
  type UnifiedAgentManifest,
} from "./manifest-schema.ts";

export {
  COGNITIVE_PILLARS,
  COGNITIVE_PILLARS_BY_CODE,
  COGNITIVE_PILLARS_COUNT,
  COGNITIVE_PILLARS_MAP,
  PILLAR_1_CLI_FIRST,
  PILLAR_2_VISUAL_TRUTH,
  PILLAR_3_THREAD_AUTHORITY,
  PILLAR_4_PERPETUAL_SELF_EVOLUTION,
  PILLAR_5_GRAPH_INTEROPERABILITY,
  PILLAR_6_FIRST_PRINCIPLES,
  PILLAR_7_INFINITE_CADENCE,
  formatPillarsBrief,
  formatPillarsMarkdown,
  getAllCognitivePillars,
  getCognitivePillar,
  getPillarAuditQuestions,
  type CognitivePillar,
  type CognitivePillarId,
  type SupervisoryRole,
} from "./pillars.ts";

export {
  VerbatimRoleInjector,
  type MindInitializationOptions,
  type RoleInitializationOptions,
  type StagnationTelemetry,
  type SubagentDispatchPromptOptions,
  type SubagentSystemPromptOptions,
} from "./verbatim-role-injector.ts";

export {
  inferRoleFromAgentId,
  matchesBoundaryPrefix,
  matchesBoundarySuffix,
} from "./thread/index.ts";
