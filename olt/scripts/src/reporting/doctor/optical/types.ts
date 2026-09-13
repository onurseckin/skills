import type { DoctorCheckEngineResult, DoctorDiagnosticFinding, DoctorSeverity } from "../types.ts";

export const OPTICAL_DOCTOR_ENGINE_NAME = "optical-doctor";
export const DEFAULT_MIN_WORD_COUNT = 250;
export const DEFAULT_MIN_SCREENSHOT_BYTES = 1024;
export const DEFAULT_MIN_UNIQUE_WORDS = 40;

export type CanonicalViewportKind = "mobile" | "tablet" | "desktop" | "desktop-wide";

export interface ViewportSpecification {
  readonly kind: CanonicalViewportKind;
  readonly width: number;
  readonly height: number;
  readonly pattern: RegExp;
  readonly label: string;
}

export const CANONICAL_VIEWPORTS: readonly ViewportSpecification[] = [
  {
    kind: "mobile",
    width: 390,
    height: 844,
    pattern: /(?:mobile|390(?:x844)?|phone|iphone)/iu,
    label: "Mobile (390x844)",
  },
  {
    kind: "tablet",
    width: 768,
    height: 1024,
    pattern: /(?:tablet|768(?:x1024)?|ipad)/iu,
    label: "Tablet (768x1024)",
  },
  {
    kind: "desktop",
    width: 1440,
    height: 900,
    pattern: /(?:desktop_1440|desktop-1440|1440(?:x900)?)/iu,
    label: "Desktop (1440x900)",
  },
  {
    kind: "desktop-wide",
    width: 1920,
    height: 1080,
    pattern: /(?:desktop_1920|desktop-1920|wide|1920(?:x1080)?)/iu,
    label: "Desktop-Wide (1920x1080)",
  },
];

export type OpticalDoctorFindingCode =
  | "MISSING_VIEWPORT_INSPECTION"
  | "DEFICIENT_VIEWPORT_COVERAGE"
  | "INSUFFICIENT_CRITIQUE_DEPTH"
  | "DEGENERATE_REPETITION_DETECTED"
  | "BANNED_CHECKLIST_BOILERPLATE"
  | "SUPERFICIAL_CHECKLIST_PARROTING"
  | "SYNTHETIC_JSON_EVASION"
  | "SCREENSHOT_PAYLOAD_EMPTY_OR_CORRUPT"
  | "UNINSPECTED_SURFACE_APPROVAL";

export interface OpticalDoctorFinding extends DoctorDiagnosticFinding {
  readonly code: OpticalDoctorFindingCode;
  readonly severity: DoctorSeverity;
  readonly engine: string;
  readonly message: string;
  readonly details?: Readonly<Record<string, unknown>> | undefined;
}

export interface OpticalReviewToolCall {
  readonly tool: string;
  readonly args?: Readonly<Record<string, unknown>> | undefined;
}

export interface OpticalDoctorCheckOptions {
  readonly toolCalls?: readonly OpticalReviewToolCall[] | undefined;
  readonly reviewProse?: string | undefined;
  readonly requiredViewportPaths?: readonly string[] | undefined;
  readonly minWordCount?: number | undefined;
  readonly minUniqueWords?: number | undefined;
  readonly screenshotFileSizes?: Readonly<Record<string, number>> | undefined;
}

export interface OpticalDoctorCheckResult extends DoctorCheckEngineResult {
  readonly engine: string;
  readonly passed: boolean;
  readonly findings: readonly OpticalDoctorFinding[];
}

export interface OpticalReviewHealth {
  readonly healthy: boolean;
  readonly violations: readonly string[];
}
