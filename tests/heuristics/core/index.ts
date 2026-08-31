/**
 * Heuristics Core Subdomain Test Facade.
 * Explicit named exports for core heuristic engine analyzers and utilities.
 */

export {
  analyzeGlassSurfaces,
  validateModalFocusTrap,
  validateSubpixelBorders,
  computePhysicalViewportMetrics,
  auditCriterionSemanticDepth,
  auditManifestSemanticDepth,
  analyzeBehavioralForensics,
  calculateForensicsEfficiencyScore,
} from "../../../olt/scripts/src/heuristics/index.ts";
