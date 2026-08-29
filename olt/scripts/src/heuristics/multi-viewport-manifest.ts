/**
 * @file multi-viewport-manifest.ts
 * Facade for Multi-Viewport Companion Manifest & 4-Pillar Verification Engine
 */

export {
  CANONICAL_VIEWPORTS,
  CANONICAL_VIEWPORT_SPECS,
  MANDATORY_PILLARS,
  MINIMUM_SCREENSHOT_BYTES,
  SUPERFICIAL_BOILERPLATE_PATTERNS,
  auditCriterionSemanticDepth,
  auditManifestSemanticDepth,
  auditSingleViewportManifest,
  computePhysicalViewportMetrics,
  normalizePillar,
  synthesizeDprAwareCompanionManifest,
  verifyMultiViewportManifests,
} from "./multi-viewport-manifest/index.ts";

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
} from "./multi-viewport-manifest/index.ts";
