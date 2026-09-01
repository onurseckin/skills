import { HarnessError } from "../../../core/errors/index.ts";

/**
 * Z-Index Elevation Hierarchy Constants
 */
export const Z_INDEX_HIERARCHY = {
  BASE: 0,
  STICKY: 100,
  DROPDOWN: 800,
  DRAWER: 900,
  BACKDROP: 950,
  MODAL: 1000,
  TOOLTIP: 1100,
  TOAST: 1200,
} as const;

export type ZIndexLayer = keyof typeof Z_INDEX_HIERARCHY;

export interface ZIndexRange {
  readonly min: number;
  readonly max: number;
}

export const Z_INDEX_LAYER_RANGES: Record<ZIndexLayer, ZIndexRange> = {
  BASE: { min: 0, max: 99 },
  STICKY: { min: 100, max: 799 },
  DROPDOWN: { min: 800, max: 899 },
  DRAWER: { min: 900, max: 949 },
  BACKDROP: { min: 950, max: 999 },
  MODAL: { min: 1000, max: 1099 },
  TOOLTIP: { min: 1100, max: 1199 },
  TOAST: { min: 1200, max: 99999 },
};

/**
 * Standard Viewport Presets
 */
export interface ViewportSpecification {
  readonly name: string;
  readonly width: number;
  readonly height: number;
  readonly isMobile: boolean;
  readonly isTablet: boolean;
  readonly devicePixelRatio?: number;
}

export const STANDARD_VIEWPORTS = {
  ULTRA_WIDE_DESKTOP: {
    name: "ultra-wide-desktop",
    width: 1920,
    height: 1080,
    isMobile: false,
    isTablet: false,
    devicePixelRatio: 1,
  },
  STANDARD_DESKTOP: {
    name: "standard-desktop",
    width: 1440,
    height: 900,
    isMobile: false,
    isTablet: false,
    devicePixelRatio: 1,
  },
  TABLET_PORTRAIT: {
    name: "tablet-portrait",
    width: 768,
    height: 1024,
    isMobile: false,
    isTablet: true,
    devicePixelRatio: 2,
  },
  MOBILE_PORTRAIT: {
    name: "mobile-portrait",
    width: 390,
    height: 844,
    isMobile: true,
    isTablet: false,
    devicePixelRatio: 3,
  },
} as const;

export type ViewportPresetName =
  | "ultra-wide-desktop"
  | "standard-desktop"
  | "tablet-portrait"
  | "mobile-portrait";

/**
 * Touch Hitbox Dimensions
 */
export const TOUCH_HITBOX_MINIMUMS = {
  STANDARD: { width: 44, height: 44 }, // >= 44x44pt
  COCKPIT: { width: 48, height: 48 },  // >= 48x48pt for cockpit/critical controls
} as const;

/**
 * Canonical Form Stress Inputs
 */
export const CANONICAL_STRESS_INPUTS = {
  LONG_STRING_1000: "A".repeat(1024),
  UNICODE_EMOJIS: "🚀👨‍👩‍👧‍👦✨🎉🔥💻🎯🧪🎨🛡️⚡️🌟💎🕹️🧭🤖👾🦄🌈",
  RTL_SCRIPTS: "مرحبا بالعالم! שלום עולם! This is mixed RTL text 123.",
  SPECIAL_CHARS_INJECTION: `<script>alert('XSS')</script>'; DROP TABLE users; -- \0\r\n\t\${7*7}&"'>`,
  ZERO_WIDTH_SPACES: "Zero\u200BWidth\u200CSpace\u200DTest\uFEFF\u00A0String",
  EXTREME_NUMBERS_MAX_SAFE: "9007199254740991",
  EXTREME_NUMBERS_MIN_SAFE: "-9007199254740991",
  EXTREME_NUMBERS_EXPONENTIAL: "1e308",
  EXTREME_NUMBERS_SUBTLE_FLOAT: "0.0000000000000001",
  EMPTY: "",
  WHITESPACE_ONLY: "   \t\r\n   ",
} as const;

export type CanonicalStressInputKey = keyof typeof CANONICAL_STRESS_INPUTS;

// ============================================================================
// 1. Active Journey Flows Types & Engine
// ============================================================================

export type JourneyActionType =
  | "navigate"
  | "click"
  | "input"
  | "wait"
  | "assert"
  | "custom";

export interface JourneyStep {
  readonly id: string;
  readonly name: string;
  readonly route: string;
  readonly action: JourneyActionType;
  readonly targetSelector?: string;
  readonly inputValue?: string;
  readonly expectedUrl?: string;
  readonly expectedBreadcrumbs?: readonly string[];
  readonly metadata?: Record<string, unknown>;
}

export interface JourneyFlow {
  readonly id: string;
  readonly name: string;
  readonly description?: string;
  readonly initialRoute: string;
  readonly steps: readonly JourneyStep[];
}

export interface JourneyStepResult {
  readonly stepId: string;
  readonly stepName: string;
  readonly route: string;
  readonly status: "PASSED" | "FAILED" | "SKIPPED";
  readonly durationMs: number;
  readonly breadcrumbsObserved: readonly string[];
  readonly continuityVerified: boolean;
  readonly error?: string;
}

export interface BreadcrumbVerificationResult {
  readonly match: boolean;
  readonly expected: readonly string[];
  readonly observed: readonly string[];
  readonly missingBreadcrumbs: readonly string[];
  readonly unexpectedBreadcrumbs: readonly string[];
}

export interface JourneyFlowResult {
  readonly flowId: string;
  readonly flowName: string;
  readonly success: boolean;
  readonly executedSteps: readonly JourneyStepResult[];
  readonly failedStep?: JourneyStepResult;
  readonly totalDurationMs: number;
  readonly breadcrumbContinuityPassed: boolean;
  readonly violations: readonly string[];
}

export interface JourneyStepHandlerContext {
  readonly step: JourneyStep;
  readonly currentRoute: string;
  readonly stepIndex: number;
}

export type JourneyStepHandler = (
  context: JourneyStepHandlerContext,
) => Promise<{
  breadcrumbsObserved?: readonly string[];
  actualRoute?: string;
  error?: string;
}>;

export * from "./overlay-types.ts";
