/**
 * @file index.ts
 * Behavioral Forensics & Token Burn Heuristics Facade
 */

export {
  FORENSICS_SEVERITIES,
  POLL_TOOLS,
  READ_TOOLS,
  ROOT_CAUSE_CATEGORIES,
  WRITE_TOOLS,
  isJsonObject,
  isPollTool,
  isReadTool,
  isWriteTool,
  type AgentRecord,
  type BehavioralForensicsAnalysisResult,
  type BehavioralForensicsContext,
  type BehavioralForensicsIncident,
  type BehavioralForensicsMetrics,
  type BehavioralForensicsSummary,
  type ExtractedToolCall,
  type FeedbackCategory,
  type FeedbackPriority,
  type ForensicsCategory,
  type ForensicsSeverity,
  type PlanInjectionProposal,
  type QuantitativeDeduction,
  type QuantitativeEfficiencyReport,
  type RootCauseCategory,
  type TaskRecord,
} from "./types.ts";

export {
  REMEDIATION_DIRECTIVES,
  createIncident,
  generateIncidentId,
  generateProposalId,
} from "./incident-generator.ts";

export { evaluateTokenBurnHeuristics, type TokenBurnAnalysisResult } from "./token-burn.ts";

export {
  evaluateSerializationHeuristics,
  type SerializationAnalysisResult,
} from "./serialization.ts";

export {
  PERMITTED_VALIDATOR_TOOLS,
  evaluateRoleBoundaryHeuristics,
  isSupervisorRole,
  isValidatorRole,
  type RoleBoundaryAnalysisResult,
} from "./role-boundaries.ts";

export { evaluateSystemLeaksHeuristics, type SystemLeaksAnalysisResult } from "./system-leaks.ts";

export {
  calculateForensicsEfficiencyScore,
  type EfficiencyScoringInput,
} from "./efficiency-scorer.ts";

export {
  PROPOSAL_TEMPLATES,
  serializeProposalsToFeedbackJson,
  synthesizePlanInjectionProposals,
  type ProposalMetadata,
} from "./plan-injection.ts";

export {
  analyzeBehavioralForensics,
  formatBehavioralForensicsReport,
  renderBehavioralForensicsAsciiTable,
  type RunForensicsAnalysisInput,
} from "./evaluator.ts";
