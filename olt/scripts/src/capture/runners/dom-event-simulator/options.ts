import { resolveLayoutShiftTrackerOptions } from "../layout-shift-tracker.ts";
import type { DomSimulationOptions, ResolvedDomSimulationOptions } from "./types.ts";

export const DEFAULT_DOM_SIMULATION_OPTIONS: ResolvedDomSimulationOptions = {
  settleDelayMs: 50,
  clsThreshold: 0.1,
  failOnUnexpectedShift: false,
  trackerOptions: {
    subpixelTolerance: 0.5,
    userInputWindowMs: 500,
    sessionMaxDurationMs: 5000,
    sessionMaxGapMs: 1000,
    excludeFixedSticky: true,
    excludeTransformOnly: true,
    excludeOpacityOnly: true,
    ignoreUserInputShifts: false,
  },
};

export function resolveDomSimulationOptions(
  options?: DomSimulationOptions,
): ResolvedDomSimulationOptions {
  return {
    settleDelayMs: options?.settleDelayMs ?? DEFAULT_DOM_SIMULATION_OPTIONS.settleDelayMs,
    clsThreshold: options?.clsThreshold ?? DEFAULT_DOM_SIMULATION_OPTIONS.clsThreshold,
    failOnUnexpectedShift:
      options?.failOnUnexpectedShift ?? DEFAULT_DOM_SIMULATION_OPTIONS.failOnUnexpectedShift,
    trackerOptions: resolveLayoutShiftTrackerOptions(options?.trackerOptions),
  };
}
