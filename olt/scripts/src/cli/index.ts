export type {
  FlagValue,
  FlagValues,
  FlagShape,
  FlagShapes,
  ParsedArguments,
  FlagSuggestion,
} from "./arguments.ts";
export { nearestFlagNames, suggestFlag, parseArguments, flagPositions } from "./arguments.ts";
export { execute, DeductiveStateMachine, CumulativePhaseInvariantEngine } from "./execute.ts";
export { ensureHarnessIgnored } from "./git-ignore.ts";
export type { HelpRequest, RenderHelpOptions } from "./help.ts";
export { helpRequest, renderHelp } from "./help.ts";
export { probeAgentTelemetry, withHostTelemetryConflicts } from "./host-telemetry-probe.ts";
export { MANIFEST_SCHEMA } from "./manifest.ts";
export type { FlagManifest, CommandManifest, CapabilityManifest } from "./manifest.ts";
export {
  capabilityManifest,
  commandSlice,
  domainSlice,
  commandSection,
  domainCommandSpecs,
  renderDomainMarkdown,
  renderManifestMarkdown,
} from "./manifest.ts";
export type { Flags, CommandContext } from "./options.ts";
export { assertFlags, textFlag, listFlag, boolFlag, integerFlag, actorFlag } from "./options.ts";
export type { OutputFormatScan } from "./output-format.ts";
export { stripOutputFormat } from "./output-format.ts";
export type { OrchestrateArgv } from "./prompt-input.ts";
export {
  shouldReadPromptStdin,
  extractOrchestrateInlinePrompt,
  shouldAutoReadOrchestrateStdin,
} from "./prompt-input.ts";
export type { DeclaredCommandTool } from "./taxonomy-flags.ts";
export {
  CATEGORY_FLAG_HELP,
  toolRefFlags,
  tokenExtraFlags,
  declaredToolFlags,
} from "./taxonomy-flags.ts";

export * as commands from "./commands/index.ts";
export * as formatters from "./formatters/index.ts";
export * as registry from "./registry/index.ts";
