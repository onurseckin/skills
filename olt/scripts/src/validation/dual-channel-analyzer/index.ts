export type {
  ClippingViolation,
  CompanionManifestData,
  ContrastViolation,
  CrossChannelProof,
  DualChannelAuditResult,
  DualChannelInput,
  EvaluatedCriterion,
  ManifestCriteriaValidationResult,
  OrphanViolation,
  OverflowViolation,
  PngDimensionRead,
  PngVerificationResult,
  ScreenshotMetadata,
  StackingViolation,
  StructuredFinding,
  ValidateCompanionManifestOptions,
  ViewportMetrics,
  VisualMetricsReport,
} from "./types.ts";

export {
  UI_DIR_PATTERNS,
  UI_EXTENSIONS,
  isUiScope,
} from "./file-classifier.ts";

export {
  METRIC_PATTERN,
  SUPERFICIAL_BOILERPLATE_PATTERNS,
  validateCompanionManifestCriteria,
} from "./manifest-auditor.ts";

export {
  MAX_DEVICE_SCALE_FACTOR,
  PNG_SIGNATURE,
  measuredWidthOf,
  readPngPixelDimensions,
  resolveScreenshotPath,
  selfReportedDimensionsWithinTolerance,
  validateCrossChannelConsistency,
  verifyScreenshotPixelDimensions,
} from "./cross-proof.ts";

export {
  DEFAULT_REQUIRED_VIEWPORTS,
  MANIFEST_INVARIANT,
  PROTECTED_VIEWPORT_BANDS,
  SCREENSHOT_INVARIANT,
  analyzeDualChannel,
  domInvariantsInspected,
} from "./analyzer.ts";
