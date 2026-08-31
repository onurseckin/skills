/**
 * @file index.ts
 * Facade for Optical, Focus Ring, and Mechanical Validator test suites
 */

export const CAPTURE_OPTICAL_SUITES = [
  "focus-ring-color-luminance",
  "focus-ring-concentricity",
  "focus-ring-contrast-curvature",
  "focus-ring-evaluator",
  "mechanical-contrast-apca",
  "mechanical-touch-targets",
  "mechanical-typography-spacing",
] as const;
