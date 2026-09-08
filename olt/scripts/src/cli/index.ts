export {
  CATEGORY_FLAG_HELP,
  declaredToolFlags,
  tokenExtraFlags,
  toolRefFlags,
  type DeclaredCommandTool,
} from "./taxonomy-flags.ts";

export {
  flagPositions,
  nearestFlagNames,
  parseArguments,
  suggestFlag,
  type FlagShape,
  type FlagShapes,
  type FlagSuggestion,
  type FlagValue,
  type FlagValues,
  type ParsedArguments,
} from "./arguments.ts";

export { ensureHarnessIgnored } from "./git-ignore.ts";

export {
  actorFlag,
  assertFlags,
  boolFlag,
  integerFlag,
  listFlag,
  textFlag,
  type CommandContext,
  type Flags,
} from "./options.ts";

export { stripOutputFormat, type OutputFormatScan } from "./output-format.ts";

export { capturePromptWithTimeout } from "./prompt-capture.ts";

export { probeAgentTelemetry, withHostTelemetryConflicts } from "./host-telemetry-probe.ts";
