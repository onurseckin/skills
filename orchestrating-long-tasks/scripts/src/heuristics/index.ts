/**
 * @file index.ts
 * Extended Edge-Case Heuristics Engine
 *
 * Exports:
 * - Glass surface analysis (nested backdrop-filter stacking, luminosity interference, APCA multi-substrate validation).
 * - Modal focus traps (cycle detection, active element containment, aria-hidden/inert sibling isolation, scroll-lock checks).
 * - Subpixel borders & hairline artifact detector across fractional DPR scales.
 * - Multi-viewport companion manifest & 4-pillar verification.
 */

export * from "./glass-surfaces.ts";
export * from "./modal-focus-traps.ts";
export * from "./subpixel-borders.ts";
export * from "./multi-viewport-manifest.ts";
