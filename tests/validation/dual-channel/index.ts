/**
 * Dual-Channel Facade.
 */
export {
  normalizeViewportName,
  validateCrossChannelConsistency,
  extractDomViolations,
  type FindingAdder,
} from "../../../olt/scripts/src/validation/channels/index.ts";

export type {
  ClippingViolation,
  CompanionManifestData,
  ContrastViolation,
  CrossChannelProof,
  DualChannelAuditResult,
  DualChannelInput,
  EvaluatedCriterion,
  OrphanViolation,
  OverflowViolation,
  ScreenshotMetadata,
  StackingViolation,
  StructuredFinding,
  ViewportMetrics,
  VisualMetricsReport,
} from "../../../olt/scripts/src/validation/channels/index.ts";
