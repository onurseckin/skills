import { createHash, createHmac } from "node:crypto";
import { HarnessError } from "../../core/errors/index.ts";

// ============================================================================
// 1. Composite-Key Artifact Identification Framework
// ============================================================================

export interface CompositeArtifactKey {
  readonly epic: string;
  readonly round: number;
  readonly route: string;
  readonly state: string;
  readonly viewport: string;
}

export type EvidenceTier = 1 | 2 | 3;

export interface ArtifactMetadata {
  readonly key: CompositeArtifactKey;
  readonly keyString: string;
  readonly filename: string;
  readonly tier: EvidenceTier;
  readonly createdAt: string;
  readonly sizeBytes: number;
  readonly mimeType: "image/png" | "image/webp" | "image/jpeg" | "application/json";
  readonly sha256: string;
  readonly readinessToken?: string;
  readonly isMilestoneAnchor?: boolean;
}

export interface OpticalStabilityInput {
  readonly inFlightRequests: number;
  readonly networkQuiescenceDurationMs: number;
  readonly fontsReady: boolean;
  readonly unrenderedAssetCount: number;
  readonly activeAnimationsCount: number;
  readonly layoutShiftDelta: number;
  readonly minQuiescenceMs?: number;
}

export interface OpticalStabilityResult {
  readonly stable: boolean;
  readonly readinessScore: number; // 0.0 to 1.0
  readonly networkSettled: boolean;
  readonly fontAndAssetsSettled: boolean;
  readonly layoutAndAnimationsSettled: boolean;
  readonly readinessToken?: string;
  readonly failureReasons: readonly string[];
}

export interface EvidenceStorageStats {
  readonly tier1Count: number;
  readonly tier1SizeBytes: number;
  readonly tier2Count: number;
  readonly tier2SizeBytes: number;
  readonly tier3PrunedCount: number;
  readonly tier3PrunedSizeBytes: number;
  readonly totalActiveCount: number;
  readonly totalActiveSizeBytes: number;
}

export type PixelDeltaSeverity = "NONE" | "MINOR" | "SIGNIFICANT" | "CRITICAL";

export interface PixelCoordinate {
  readonly x: number;
  readonly y: number;
}

export interface BoundingBox {
  readonly minX: number;
  readonly minY: number;
  readonly maxX: number;
  readonly maxY: number;
  readonly width: number;
  readonly height: number;
  readonly pixelCount: number;
}

export interface VisualDeltaInput {
  readonly baselineWidth: number;
  readonly baselineHeight: number;
  readonly candidateWidth: number;
  readonly candidateHeight: number;
  readonly totalPixels: number;
  readonly differingPixels: number;
  readonly differingPixelCoordinates?: readonly PixelCoordinate[];
  readonly tolerance?: number;
}

export interface VisualDeltaReport {
  readonly pixelDeltaRatio: number; // 0.0 to 1.0
  readonly differingPixelsCount: number;
  readonly totalPixels: number;
  readonly severity: PixelDeltaSeverity;
  readonly boundingBoxes: readonly BoundingBox[];
  readonly clusterCount: number;
  readonly shiftDetected: boolean;
  readonly passed: boolean;
  readonly summary: string;
}
