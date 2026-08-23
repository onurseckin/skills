import {
  formatMindObserveBrief,
  mindObserveCommand,
  type MindObserveResult,
} from "../cli/commands/mind-observe.ts";
import type { CommandContext, Flags } from "../cli/options.ts";
import {
  LEGACY_LOWER_OBSERVATIONS_FILE,
  LEGACY_OBSERVATIONS_FILE,
  resolveCanonicalObservationsPath,
  resolveObservationsPath,
} from "./sources.ts";

export {
  formatMindObserveBrief,
  LEGACY_LOWER_OBSERVATIONS_FILE,
  LEGACY_OBSERVATIONS_FILE,
  mindObserveCommand,
  resolveCanonicalObservationsPath,
  resolveObservationsPath,
  type MindObserveResult,
};

export function executeMindObserve(flags: Flags, context?: CommandContext): MindObserveResult {
  return mindObserveCommand(flags, context);
}
