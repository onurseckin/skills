/**
 * @file types.ts
 * Types for multi-viewport manifest verification, companion manifest synthesis, and semantic depth auditing
 */

import type {
  CompanionManifestV2,
  ElementPhysicsSnapshot,
  EvaluatedCriterion,
  PillarValidationResult,
  ValidationPillar,
} from "../../capture/validator/types.ts";

export type CanonicalViewport = "mobile" | "tablet" | "desktop" | "desktop-wide";

export interface CanonicalViewportSpec {
  readonly name: CanonicalViewport;
  readonly width: number;
  readonly height: number;
  readonly defaultDpr: number;
  readonly supportedDprs: readonly number[];
  readonly physicalWidth: number;
  readonly physicalHeight: number;
}

export interface PhysicalViewportMetrics {
  readonly viewport: string;
  readonly cssWidth: number;
  readonly cssHeight: number;
  readonly dpr: number;
  readonly physicalWidth: number;
  readonly physicalHeight: number;
  readonly totalPhysicalPixels: number;
  readonly isRetinaOrHiDpi: boolean;
}

export type MandatoryPillar = "mechanical" | "cognitive" | "product" | "ux";

export interface ScreenshotArtifact {
  readonly viewport: string;
  readonly path?: string | undefined;
  readonly name?: string | undefined;
  readonly sizeBytes?: number | undefined;
  readonly buffer?: Uint8Array | { readonly length: number } | undefined;
  readonly dpr?: number | undefined;
}

export interface MultiViewportManifestEntry {
  readonly viewport: string;
  readonly manifest: CompanionManifestV2 | Readonly<Record<string, unknown>>;
  readonly screenshot?: ScreenshotArtifact | undefined;
  readonly dpr?: number | undefined;
  readonly devicePixelRatio?: number | undefined;
}

export interface MultiViewportBundleInput {
  readonly entries?: readonly MultiViewportManifestEntry[] | undefined;
  readonly manifests?:
    | readonly (CompanionManifestV2 | Readonly<Record<string, unknown>>)[]
    | undefined;
  readonly screenshots?: readonly ScreenshotArtifact[] | undefined;
  readonly requiredViewports?: readonly string[] | undefined;
  readonly requireSemanticDepth?: boolean | undefined;
  readonly dprOverrides?: Readonly<Record<string, number>> | undefined;
}

export interface MultiViewportDefect {
  readonly id: string;
  readonly category:
    | "missing_viewport"
    | "missing_manifest"
    | "invalid_manifest"
    | "missing_pillar"
    | "missing_boolean_passed"
    | "empty_details_evidence"
    | "superficial_evidence"
    | "boilerplate_evidence"
    | "criterion_failed"
    | "undersized_screenshot"
    | "missing_screenshot"
    | "dpr_mismatch";
  readonly severity: "critical" | "serious" | "moderate" | "minor";
  readonly viewport: string;
  readonly message: string;
  readonly pillar?: string | undefined;
  readonly criterionId?: string | undefined;
  readonly metadata?: Readonly<Record<string, string | number | boolean>> | undefined;
}

export interface SemanticDepthDefect {
  readonly id: string;
  readonly category: "boilerplate_evidence" | "superficial_evidence" | "missing_evidence_metrics";
  readonly severity: "serious" | "moderate" | "minor";
  readonly criterionId: string;
  readonly pillar?: string | undefined;
  readonly message: string;
  readonly details?: string | undefined;
  readonly evidence?: string | undefined;
}

export interface SemanticDepthAuditResult {
  readonly isDeep: boolean;
  readonly qualitativeDepthScore: number;
  readonly quantitativeDepthScore: number;
  readonly combinedDepthScore: number;
  readonly defects: readonly SemanticDepthDefect[];
  readonly metricsFound: readonly string[];
}

export interface ManifestSemanticDepthResult {
  readonly passed: boolean;
  readonly averageDepthScore: number;
  readonly evaluatedCount: number;
  readonly deepCount: number;
  readonly superficialCount: number;
  readonly defects: readonly SemanticDepthDefect[];
}

export interface SingleViewportAuditOptions {
  readonly requireSemanticDepth?: boolean | undefined;
  readonly dpr?: number | undefined;
  readonly devicePixelRatio?: number | undefined;
}

export interface SingleViewportAudit {
  readonly viewport: string;
  readonly passed: boolean;
  readonly hasValidScreenshot: boolean;
  readonly screenshotSizeBytes: number;
  readonly coveredPillars: readonly MandatoryPillar[];
  readonly missingPillars: readonly MandatoryPillar[];
  readonly totalCriteriaCount: number;
  readonly passedCriteriaCount: number;
  readonly dpr?: number | undefined;
  readonly physicalMetrics?: PhysicalViewportMetrics | undefined;
  readonly defects: readonly MultiViewportDefect[];
}

export interface MultiViewportVerificationResult {
  readonly passed: boolean;
  readonly verifiedViewports: readonly string[];
  readonly missingViewports: readonly string[];
  readonly viewportAudits: readonly SingleViewportAudit[];
  readonly pillarMatrix: Record<string, Record<MandatoryPillar, boolean>>;
  readonly defects: readonly MultiViewportDefect[];
  readonly summary: string;
}

export interface DprAwareManifestSynthesisOptions {
  readonly dpr?: number | undefined;
  readonly screenId?: string | undefined;
  readonly elements?: readonly ElementPhysicsSnapshot[] | undefined;
}
