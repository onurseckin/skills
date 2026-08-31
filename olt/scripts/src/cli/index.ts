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

export { CumulativePhaseInvariantEngine, DeductiveStateMachine, execute } from "./execute.ts";

export { ensureHarnessIgnored } from "./git-ignore.ts";

export {
  formatCommandHelp,
  formatCommandTable,
  formatDomainSummary,
  helpRequest,
  renderHelp,
  type HelpRequest,
  type RenderHelpOptions,
} from "./help.ts";

export { probeAgentTelemetry, withHostTelemetryConflicts } from "./host-telemetry-probe.ts";

export {
  COMMANDS_DIR,
  DOMAINS_DIR,
  INDEX_FILE,
  SPLIT_MANIFEST_SCHEMA,
  commandFilePath,
  commandFileSlug,
  domainFilePath,
  loadCapabilitySplit,
  loadCommandDetail,
  renderCommandDetailFiles,
  renderCommandDetailJson,
  renderCommandIndexJsonl,
  renderSplitManifestJson,
  splitManifest,
  type CommandDetailFile,
  type DomainManifestEntry,
  type IndexRecord,
  type LoadCapabilitySplitOptions,
  type SplitManifest,
} from "./manifest-split.ts";

export {
  MANIFEST_SCHEMA,
  capabilityManifest,
  commandSection,
  commandSlice,
  domainCommandSpecs,
  domainSlice,
  renderDomainMarkdown,
  renderManifestMarkdown,
  type CapabilityManifest,
  type CommandManifest,
  type FlagManifest,
} from "./manifest.ts";

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

export {
  extractOrchestrateInlinePrompt,
  shouldAutoReadOrchestrateStdin,
  shouldReadPromptStdin,
  type OrchestrateArgv,
} from "./prompt-input.ts";

export {
  CATEGORY_FLAG_HELP,
  declaredToolFlags,
  tokenExtraFlags,
  toolRefFlags,
  type DeclaredCommandTool,
} from "./taxonomy-flags.ts";

import * as commands from "./commands/index.ts";
import * as formatters from "./formatters/index.ts";
import * as registry from "./registry/index.ts";
import * as signals from "./signals/index.ts";

export { commands, formatters, registry, signals };
