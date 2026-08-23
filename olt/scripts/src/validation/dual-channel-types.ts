export interface OverflowViolation {
  readonly elementId?: string;
  readonly selector: string;
  readonly viewport: string;
  readonly scrollWidth: number;
  readonly clientWidth: number;
  readonly overflowX: number;
  readonly message: string;
}

export interface ClippingViolation {
  readonly elementId?: string;
  readonly selector: string;
  readonly viewport: string;
  readonly textContent?: string;
  readonly scrollHeight: number;
  readonly clientHeight: number;
  readonly lineHeight?: number;
  readonly message: string;
}

export interface StackingViolation {
  readonly topElementSelector: string;
  readonly bottomElementSelector: string;
  readonly viewport: string;
  readonly topZIndex?: number | string;
  readonly bottomZIndex?: number | string;
  readonly collisionArea?: number;
  readonly message: string;
}

export interface ContrastViolation {
  readonly elementId?: string;
  readonly selector: string;
  readonly textColor: string;
  readonly backgroundColor: string;
  readonly contrastRatio: number;
  readonly requiredRatio: number;
  readonly wcagLevel: "AA" | "AAA";
  readonly message: string;
}

export interface OrphanViolation {
  readonly elementId?: string;
  readonly selector: string;
  readonly x: number;
  readonly y: number;
  readonly message: string;
}

export interface ViewportMetrics {
  readonly viewport: string;
  readonly width?: number;
  readonly height?: number;
  readonly subpixelTolerance?: number;
  readonly overflowViolations?: readonly OverflowViolation[];
  readonly clippingViolations?: readonly ClippingViolation[];
  readonly stackingViolations?: readonly StackingViolation[];
  readonly contrastViolations?: readonly ContrastViolation[];
  readonly orphanViolations?: readonly OrphanViolation[];
  readonly renderCacheReset?: boolean;
}

export interface VisualMetricsReport {
  readonly schema?: string;
  readonly version?: number;
  readonly timestamp?: string;
  readonly taskId?: string;
  readonly commandId?: string;
  readonly subpixelTolerance?: number;
  readonly viewports: readonly ViewportMetrics[];
  readonly renderCacheReset?: boolean;
  readonly totalViolations?: number;
  readonly summary?: string;
}

export interface ScreenshotMetadata {
  readonly name: string;
  readonly path: string;
  readonly viewport?: string;
  readonly width?: number;
  readonly height?: number;
  readonly sizeBytes: number;
  readonly timestamp?: string;
  readonly commandId?: string;
  readonly taskId?: string;
}

export interface EvaluatedCriterion {
  readonly id: string;
  readonly pillar?: string;
  readonly name?: string;
  readonly passed: boolean;
  readonly details?: string;
  readonly evidence?: string;
}

export interface CompanionManifestData {
  readonly schema?: string;
  readonly screenId?: string;
  readonly screenName?: string;
  readonly path?: string;
  readonly viewport?: string;
  readonly dimensions?: {
    readonly width?: number;
    readonly height?: number;
    readonly deviceScaleFactor?: number;
  };
  readonly imageFile?: string;
  readonly imageSizeBytes?: number;
  readonly imageSha256?: string;
  readonly criteria?: readonly EvaluatedCriterion[];
  readonly [key: string]: unknown;
}

export interface DualChannelInput {
  readonly taskFiles?: readonly string[] | undefined;
  readonly writeScope?: readonly string[] | undefined;
  readonly domReport?: VisualMetricsReport | null | undefined;
  readonly screenshots?: readonly ScreenshotMetadata[] | null | undefined;
  readonly manifests?: readonly (CompanionManifestData | unknown)[] | null | undefined;
  readonly requiredViewports?: readonly string[] | undefined;
  readonly subpixelTolerance?: number | undefined;
  readonly requireSemanticDepth?: boolean | undefined;
}

export interface CrossChannelProof {
  readonly viewport: string;
  readonly screenshotPath?: string;
  readonly screenshotSizeBytes?: number;
  readonly domMetricsPresent: boolean;
  readonly verifiedInvariants: readonly string[];
  readonly status:
    | "corroborated"
    | "dom_only_gap_filled"
    | "screenshot_only_gap_filled"
    | "violation_detected";
}

export interface StructuredFinding {
  readonly id: string;
  readonly severity: "error" | "warning";
  readonly category:
    | "missing_channel"
    | "zero_byte_screenshot"
    | "invalid_screenshot_size"
    | "missing_manifest"
    | "invalid_manifest"
    | "missing_manifest_criteria"
    | "invalid_manifest_criterion"
    | "missing_pillar_criteria"
    | "manifest_criterion_failed"
    | "missing_viewport"
    | "overflow"
    | "clipping"
    | "stacking"
    | "contrast"
    | "orphan"
    | "render_cache"
    | "cross_channel_mismatch"
    | "boilerplate_evidence"
    | "superficial_evidence"
    | "missing_evidence_metrics"
    | "superficial_cognitive_feedback"
    | "invalid_evidence_location";
  readonly message: string;
  readonly affectedSelector?: string;
  readonly viewport?: string;
  readonly remediation: string;
}

export interface DualChannelAuditResult {
  readonly isUiTask: boolean;
  readonly passed: boolean;
  readonly mode:
    | "dual_channel_corroborated"
    | "dom_gap_filled"
    | "screenshot_gap_filled"
    | "non_ui_skipped"
    | "rejected";
  readonly findings: readonly StructuredFinding[];
  readonly proofs: readonly CrossChannelProof[];
  readonly summary: string;
}
