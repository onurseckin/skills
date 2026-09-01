/**
 * Lane 10: Heuristics Domain Root Test Facade.
 * Re-exports domain facades across all 3 subdomains:
 * - behavioral/
 * - edge-cases/
 * - core/
 */

// 1. Behavioral Subdomain
export {
  analyzeBehavioralForensics,
  calculateForensicsEfficiencyScore,
  createIncident,
  formatBehavioralForensicsReport,
  renderBehavioralForensicsAsciiTable,
  serializeProposalsToFeedbackJson,
  synthesizePlanInjectionProposals,
  type ExtractedToolCall,
  type BehavioralForensicsAnalysis,
  type ForensicsEfficiencyScore,
  type ForensicsIncident,
  type IncidentCategory,
  type IncidentSeverity,
  type PlanInjectionProposal,
} from "./behavioral/index.ts";

// 2. Edge Cases Subdomain
export { HEURISTICS_EDGE_CASES_SUITES } from "./edge-cases/index.ts";

// 3. Core Subdomain
export {
  analyzeGlassSurfaces,
  validateModalFocusTrap,
  validateSubpixelBorders,
  computePhysicalViewportMetrics,
  auditCriterionSemanticDepth,
  auditManifestSemanticDepth,
} from "./core/index.ts";
