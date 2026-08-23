import {
  formatMindObserveBrief,
  mindObserveCommand,
  type MindObserveResult,
} from "../cli/commands/mind-observe.ts";
import type { CommandContext, Flags } from "../cli/options.ts";
import { resolveCanonicalObservationsPath, resolveObservationsPath } from "./sources.ts";

export {
  formatMindObserveBrief,
  mindObserveCommand,
  resolveCanonicalObservationsPath,
  resolveObservationsPath,
  type MindObserveResult,
};

export function executeMindObserve(flags: Flags, context?: CommandContext): MindObserveResult {
  return mindObserveCommand(flags, context);
}
