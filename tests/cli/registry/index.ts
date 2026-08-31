export { detectDuplicateInvocations, type DuplicateCollision } from "./registry-uniqueness.test.ts";

export {
  COMMAND_DOMAINS,
  COMMAND_REGISTRY,
  PRIMARY_COMMANDS,
  INTERNAL_COMMANDS,
  commandInvocations,
  commandTier,
  findCommand,
  flagShapes,
  getInternalCommands,
  getPrimaryCommands,
  isInternalCommand,
  isPrimaryCommand,
  type CommandDomain,
  type CommandSpec,
  type FlagSpec,
} from "../../../olt/scripts/src/cli/registry/index.ts";
