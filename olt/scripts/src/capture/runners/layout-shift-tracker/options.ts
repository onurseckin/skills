import type { LayoutShiftTrackerOptions, ResolvedLayoutShiftTrackerOptions } from "./types.ts";

export const DEFAULT_LAYOUT_SHIFT_OPTIONS: ResolvedLayoutShiftTrackerOptions = {
  subpixelTolerance: 0.5,
  userInputWindowMs: 500,
  sessionMaxDurationMs: 5000,
  sessionMaxGapMs: 1000,
  excludeFixedSticky: true,
  excludeTransformOnly: true,
  excludeOpacityOnly: true,
  ignoreUserInputShifts: true,
};

export function resolveLayoutShiftTrackerOptions(
  options?: LayoutShiftTrackerOptions,
): ResolvedLayoutShiftTrackerOptions {
  return {
    subpixelTolerance: options?.subpixelTolerance ?? DEFAULT_LAYOUT_SHIFT_OPTIONS.subpixelTolerance,
    userInputWindowMs: options?.userInputWindowMs ?? DEFAULT_LAYOUT_SHIFT_OPTIONS.userInputWindowMs,
    sessionMaxDurationMs:
      options?.sessionMaxDurationMs ?? DEFAULT_LAYOUT_SHIFT_OPTIONS.sessionMaxDurationMs,
    sessionMaxGapMs: options?.sessionMaxGapMs ?? DEFAULT_LAYOUT_SHIFT_OPTIONS.sessionMaxGapMs,
    excludeFixedSticky:
      options?.excludeFixedSticky ?? DEFAULT_LAYOUT_SHIFT_OPTIONS.excludeFixedSticky,
    excludeTransformOnly:
      options?.excludeTransformOnly ?? DEFAULT_LAYOUT_SHIFT_OPTIONS.excludeTransformOnly,
    excludeOpacityOnly:
      options?.excludeOpacityOnly ?? DEFAULT_LAYOUT_SHIFT_OPTIONS.excludeOpacityOnly,
    ignoreUserInputShifts:
      options?.ignoreUserInputShifts ?? DEFAULT_LAYOUT_SHIFT_OPTIONS.ignoreUserInputShifts,
  };
}
