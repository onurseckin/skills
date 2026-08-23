import {
  formatMindObserveBrief,
  mindObserveCommand,
  type MindObserveResult,
} from "../cli/commands/mind-observe.ts";
import type { CommandContext, Flags } from "../cli/options.ts";
import {
  CANONICAL_OBSERVATIONS_FILE,
  LEGACY_LOWER_OBSERVATIONS_FILE,
  LEGACY_OBSERVATIONS_FILE,
  resolveCanonicalObservationsPath,
  resolveObservationsPath,
  TODO_OBSERVATIONS_FILE,
} from "./sources.ts";

export {
  CANONICAL_OBSERVATIONS_FILE,
  formatMindObserveBrief,
  LEGACY_LOWER_OBSERVATIONS_FILE,
  LEGACY_OBSERVATIONS_FILE,
  mindObserveCommand,
  resolveCanonicalObservationsPath,
  resolveObservationsPath,
  TODO_OBSERVATIONS_FILE,
  type MindObserveResult,
};

export function executeMindObserve(flags: Flags, context?: CommandContext): MindObserveResult {
  return mindObserveCommand(flags, context);
}
