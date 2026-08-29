/**
 * @file index.ts
 * Multi-Viewport Companion Manifest & 4-Pillar Verification Module
 */

export {
  CANONICAL_VIEWPORTS,
  CANONICAL_VIEWPORT_SPECS,
  MANDATORY_PILLARS,
  MINIMUM_SCREENSHOT_BYTES,
  SUPERFICIAL_BOILERPLATE_PATTERNS,
} from "./constants.ts";

export { computePhysicalViewportMetrics } from "./metrics.ts";

export { normalizePillar } from "./pillars.ts";

export {
  auditCriterionSemanticDepth,
  auditManifestSemanticDepth,
} from "./semantic-depth.ts";

export { auditSingleViewportManifest } from "./single-verifier.ts";

export { verifyMultiViewportManifests } from "./bundle-verifier.ts";

export { synthesizeDprAwareCompanionManifest } from "./synthesizer.ts";

export type {
  CanonicalViewport,
  CanonicalViewportSpec,
  DprAwareManifestSynthesisOptions,
  MandatoryPillar,
  ManifestSemanticDepthResult,
  MultiViewportBundleInput,
  MultiViewportDefect,
  MultiViewportManifestEntry,
  MultiViewportVerificationResult,
  PhysicalViewportMetrics,
  ScreenshotArtifact,
  SemanticDepthAuditResult,
  SemanticDepthDefect,
  SingleViewportAudit,
  SingleViewportAuditOptions,
} from "./types.ts";
