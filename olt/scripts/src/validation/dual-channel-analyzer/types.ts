import type {
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
} from "../channels/dual-channel-types.ts";

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
};

export type PngDimensionRead =
  | { readonly status: "unreadable" }
  | { readonly status: "invalid_png" }
  | { readonly status: "measured"; readonly width: number; readonly height: number };

export interface PngVerificationResult {
  readonly reads: ReadonlyMap<ScreenshotMetadata, PngDimensionRead>;
  readonly verifiedClaims: ReadonlySet<ScreenshotMetadata>;
}

export interface ManifestCriteriaValidationResult {
  readonly valid: boolean;
  readonly evaluatedCriteriaCount: number;
  readonly passedCriteriaCount: number;
  readonly pillarsPresent: readonly string[];
}

export interface ValidateCompanionManifestOptions {
  readonly requireSemanticDepth?: boolean | undefined;
}
