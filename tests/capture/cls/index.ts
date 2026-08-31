/**
 * @file index.ts
 * Facade for Cumulative Layout Shift (CLS) Tracking and DOM Event Simulation test suites
 */

export const CAPTURE_CLS_SUITES = [
  "layout-shift-detection",
  "layout-shift-session-windows",
  "layout-shift-scoring",
  "dom-event-mouse-simulator",
  "dom-event-keyboard-simulator",
  "dom-event-touch-simulator",
] as const;
