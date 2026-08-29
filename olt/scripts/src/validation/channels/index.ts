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
} from "./dual-channel-types.ts";

export {
  normalizeViewportName,
  validateCrossChannelConsistency,
} from "./cross-channel-consistency.ts";

export {
  extractDomViolations,
  type FindingAdder,
} from "./dom-violation-extractor.ts";
