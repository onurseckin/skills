export {
  FlagValue,
  FlagValues,
  FlagShape,
  FlagShapes,
  ParsedArguments,
  FlagSuggestion,
  nearestFlagNames,
  suggestFlag,
  parseArguments,
  flagPositions,
} from "./arguments.ts";
export { execute, DeductiveStateMachine, CumulativePhaseInvariantEngine } from "./execute.ts";
export { ensureHarnessIgnored } from "./git-ignore.ts";
export { HelpRequest, RenderHelpOptions, helpRequest, renderHelp } from "./help.ts";
export { probeAgentTelemetry, withHostTelemetryConflicts } from "./host-telemetry-probe.ts";
export {
  MANIFEST_SCHEMA,
  FlagManifest,
  CommandManifest,
  CapabilityManifest,
  capabilityManifest,
  commandSlice,
  domainSlice,
  commandSection,
  domainCommandSpecs,
  renderDomainMarkdown,
  renderManifestMarkdown,
} from "./manifest.ts";
export {
  Flags,
  CommandContext,
  assertFlags,
  textFlag,
  listFlag,
  boolFlag,
  integerFlag,
  actorFlag,
} from "./options.ts";
export { OutputFormatScan, stripOutputFormat } from "./output-format.ts";
export {
  shouldReadPromptStdin,
  OrchestrateArgv,
  extractOrchestrateInlinePrompt,
  shouldAutoReadOrchestrateStdin,
} from "./prompt-input.ts";
export {
  CATEGORY_FLAG_HELP,
  toolRefFlags,
  tokenExtraFlags,
  DeclaredCommandTool,
  declaredToolFlags,
} from "./taxonomy-flags.ts";

export * as commands from "./commands/index.ts";
export * as formatters from "./formatters/index.ts";
export * as registry from "./registry/index.ts";
