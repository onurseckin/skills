import { HarnessError } from "../../core/errors/index.ts";

/**
 * Target Frame Rate and Motion Constraints
 */
export const TARGET_FRAME_RATE = 60;
export const TARGET_FRAME_DURATION_MS = 1000 / TARGET_FRAME_RATE; // ~16.67ms
export const JANK_FRAME_THRESHOLD_MS = 20.0; // Frames taking >20ms considered jank at 60fps
export const MAX_PERMISSIBLE_JANK_RATE = 0.05; // 5% max acceptable jank
export const MAX_PERMISSIBLE_CLS = 0.01; // Cumulative Layout Shift threshold

/**
 * GPU Accelerated vs Layout-Triggering CSS Properties
 */
export const GPU_ACCELERATED_PROPERTIES = [
  "transform",
  "opacity",
  "filter",
  "backdrop-filter",
  "will-change",
] as const;

export const LAYOUT_TRIGGERING_PROPERTIES = [
  "width",
  "height",
  "top",
  "left",
  "right",
  "bottom",
  "margin",
  "margin-top",
  "margin-bottom",
  "margin-left",
  "margin-right",
  "padding",
  "padding-top",
  "padding-bottom",
  "padding-left",
  "padding-right",
  "border-width",
  "flex",
  "grid-template-columns",
  "grid-template-rows",
] as const;

export type GpuAcceleratedProperty = (typeof GPU_ACCELERATED_PROPERTIES)[number];
export type LayoutTriggeringProperty = (typeof LAYOUT_TRIGGERING_PROPERTIES)[number];

/**
 * Canonical Spring Physics Presets
 */
export interface SpringPresetConfig {
  readonly name: string;
  readonly stiffness: number;
  readonly damping: number;
  readonly mass: number;
  readonly maxDurationMs: number;
  readonly expectedOvershootRatio: number;
}

export const SPRING_PRESETS: Record<string, SpringPresetConfig> = {
  GENTLE: {
    name: "gentle",
    stiffness: 120,
    damping: 14,
    mass: 1,
    maxDurationMs: 600,
    expectedOvershootRatio: 0.05,
  },
  SNAPPY: {
    name: "snappy",
    stiffness: 300,
    damping: 20,
    mass: 0.8,
    maxDurationMs: 350,
    expectedOvershootRatio: 0.02,
  },
  BOUNCY: {
    name: "bouncy",
    stiffness: 180,
    damping: 10,
    mass: 1,
    maxDurationMs: 500,
    expectedOvershootRatio: 0.15,
  },
  COCKPIT: {
    name: "cockpit",
    stiffness: 400,
    damping: 28,
    mass: 0.5,
    maxDurationMs: 250,
    expectedOvershootRatio: 0.0,
  },
} as const;

export type SpringPresetKey = "GENTLE" | "SNAPPY" | "BOUNCY" | "COCKPIT";
export type SpringPresetName = "gentle" | "snappy" | "bouncy" | "cockpit";

// ============================================================================
// 1. Phase 1: Quantitative Motion Headless Pre-flight
// ============================================================================

export interface FrameSample {
  readonly timestampMs: number;
  readonly durationMs: number;
  readonly cpuTimeMs?: number;
  readonly gpuRasterTimeMs?: number;
}

export interface LayoutShiftSample {
  readonly shiftScore: number;
  readonly sourceSelector?: string;
  readonly timestampMs?: number;
}

export interface AnimatedPropertyAudit {
  readonly property: string;
  readonly isGpuAccelerated: boolean;
  readonly isLayoutTriggering: boolean;
  readonly recommendation?: string;
}

export interface MotionHeadlessPreFlightInput {
  readonly animationName: string;
  readonly targetSelector: string;
  readonly animatedProperties: readonly string[];
  readonly frameSamples: readonly FrameSample[];
  readonly layoutShifts?: readonly LayoutShiftSample[];
  readonly targetFps?: number;
}

export interface MotionHeadlessPreFlightResult {
  readonly animationName: string;
  readonly targetSelector: string;
  readonly passed: boolean;
  readonly totalFrames: number;
  readonly jankFrames: number;
  readonly jankRate: number;
  readonly averageFrameDurationMs: number;
  readonly maxFrameDurationMs: number;
  readonly cumulativeLayoutShift: number;
  readonly propertyAudits: readonly AnimatedPropertyAudit[];
  readonly layoutTriggeringViolations: readonly string[];
  readonly violations: readonly string[];
}

export interface KeyframeSamplePoint {
  readonly point: "0%" | "50%" | "100%" | number;
  readonly timestampMs: number;
  readonly value: number; // Normalized animated value (e.g. 0 to 1, or pixel coordinate)
  readonly computedStyle?: Record<string, string | number>;
  readonly transformMatrix?: readonly number[];
  readonly opacity?: number;
  readonly blurDetected?: boolean;
}

export interface TemporalKeyframeInspectionInput {
  readonly animationName: string;
  readonly durationMs: number;
  readonly samples: readonly KeyframeSamplePoint[];
  readonly easingType?: "linear" | "ease-in" | "ease-out" | "ease-in-out" | "spring" | string;
  readonly targetRestingValue?: number;
  readonly allowOvershoot?: boolean;
}

export interface TemporalKeyframeInspectionResult {
  readonly animationName: string;
  readonly passed: boolean;
  readonly sampledInception0: boolean;
  readonly sampledMidpoint50: boolean;
  readonly sampledFinal100: boolean;
  readonly easingCurveValid: boolean;
  readonly bounceOvershootDetected: boolean;
  readonly overshootRatio: number;
  readonly blurArtifactDetected: boolean;
  readonly violations: readonly string[];
}

export interface FocusRingMetrics {
  readonly selector: string;
  readonly outlineWidthPx: number;
  readonly outlineStyle: string;
  readonly outlineColor: string;
  readonly outlineOffsetPx: number;
  readonly contrastRatioWithBackground: number;
  readonly isCrisp?: boolean;
}

export interface FocusRingInspectionResult {
  readonly selector: string;
  readonly passed: boolean;
  readonly outlineWidthValid: boolean;
  readonly offsetValid: boolean;
  readonly contrastValid: boolean;
  readonly violations: readonly string[];
}

export interface HoverLiftMetrics {
  readonly selector: string;
  readonly defaultTransform: string;
  readonly hoverTransform: string;
  readonly defaultBoxShadow: string;
  readonly hoverBoxShadow: string;
  readonly translateYPx: number;
  readonly shadowDepthChange: number;
}

export interface HoverLiftInspectionResult {
  readonly selector: string;
  readonly passed: boolean;
  readonly elevationValid: boolean;
  readonly shadowValid: boolean;
  readonly violations: readonly string[];
}

export interface TrajectoryPoint {
  readonly timeMs: number;
  readonly value: number;
}

export interface SpringPhysicsInspectionInput {
  readonly presetName?: SpringPresetName;
  readonly customConfig?: {
    stiffness: number;
    damping: number;
    mass: number;
    maxDurationMs: number;
  };
  readonly trajectorySamples: readonly TrajectoryPoint[];
  readonly targetValue: number;
}

export interface SpringPhysicsInspectionResult {
  readonly passed: boolean;
  readonly settlingTimeMs: number;
  readonly maxOvershoot: number;
  readonly oscillationsCount: number;
  readonly jitterDetected: boolean;
  readonly violations: readonly string[];
}
