/**
 * Optical Doctor Checks Facade
 *
 * Enforces headful visual inspection integrity, 4-viewport coverage,
 * and formless human-grade perception standards for UI validation.
 */

// Primary Engine & Lightweight Doctor Bridge
export { checkOpticalDoctor, verifyOpticalReview } from "./engine.ts";

// Granular Inspection Detectors
export {
  BANNED_CHECKLIST_PATTERNS,
  detectSuperficialChecklists,
  type BannedChecklistPatternRule,
} from "./checklist-detector.ts";

export {
  SYNTHETIC_JSON_PATTERNS,
  detectSyntheticJsonEvasion,
  type SyntheticJsonPatternRule,
} from "./synthetic-json-detector.ts";

export { detectViewportReviewDefects, normalizePath } from "./viewport-review-detector.ts";

// Canonical Invariants & Constants
export {
  CANONICAL_VIEWPORTS,
  DEFAULT_MIN_SCREENSHOT_BYTES,
  DEFAULT_MIN_UNIQUE_WORDS,
  DEFAULT_MIN_WORD_COUNT,
  OPTICAL_DOCTOR_ENGINE_NAME,
} from "./types.ts";

// Strong Public Contracts (0 any, 0 suppressions)
export type {
  CanonicalViewportKind,
  OpticalDoctorCheckOptions,
  OpticalDoctorCheckResult,
  OpticalDoctorFinding,
  OpticalDoctorFindingCode,
  OpticalReviewHealth,
  OpticalReviewToolCall,
  ViewportSpecification,
} from "./types.ts";
