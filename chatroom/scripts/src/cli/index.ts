export {
  flagPositions,
  nearestFlagNames,
  parseArguments,
  suggestCommand,
  suggestFlag,
} from "./arguments.ts";
export type { FlagSuggestion, ParsedArguments } from "./arguments.ts";
export { assertFlags, boolFlag, intFlag, integerFlag, listFlag, textFlag } from "./options.ts";
export { formatCommandHelp, helpRequest, renderHelp } from "./help.ts";
export type { HelpRequest } from "./help.ts";
export { executeCommand } from "./execute.ts";
export type {
  CommandContext,
  CommandFlagSpec,
  CommandHandler,
  CommandSpec,
  ExitCodeSpec,
  FlagShape,
  FlagShapes,
  FlagSpec,
  FlagType,
  FlagValue,
  FlagValues,
  Flags,
} from "./registry/index.ts";
export {
  CHAT_COMMANDS,
  CliError,
  DEFAULT_EXIT_CODES,
  ackSpec,
  allCommands,
  commandInvocations,
  daemonSpec,
  doctorSpec,
  findCommand,
  flagShapes,
  initSpec,
  inspectSpec,
  inviteSpec,
  joinSpec,
  offSpec,
  onSpec,
  optionalFlag,
  readSpec,
  repeatableFlag,
  requiredFlag,
  roomsSpec,
  saySpec,
  watchSpec,
} from "./registry/index.ts";
export {
  CommandExecutionError,
  ackCommand,
  daemonCommand,
  doctorCommand,
  initCommand,
  inspectCommand,
  inviteCommand,
  joinCommand,
  offCommand,
  onCommand,
  readCommand,
  roomsCommand,
  sayCommand,
  watchCommand,
} from "./commands/index.ts";
