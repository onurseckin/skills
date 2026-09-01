import {
  DEFAULT_EXIT_CODES,
  optionalFlag,
  requiredFlag,
  type CommandHandler,
  type CommandSpec,
  type FlagSpec,
} from "../index.ts";

export const charterGoalFlag: FlagSpec = {
  name: "charter-goal",
  type: "string",
  required: true,
  repeatable: true,
  description: "Goal ids from the pinned charter; repeat for multiple.",
};
export const candidateWriteScopeFlag: FlagSpec = {
  name: "write-scope",
  type: "string",
  required: true,
  repeatable: true,
  description: "Paths the work would touch; repeat for multiple.",
};
export const quiesceSourceFlag: FlagSpec = {
  name: "source",
  type: "string",
  required: true,
  repeatable: true,
  description:
    "Source scan result as <source>:<command-id>:<count>; repeat for each of the ten sources.",
};
export const auditAnswerFlag: FlagSpec = {
  name: "answer",
  type: "string",
  required: true,
  repeatable: true,
  description:
    "One of eight audit question answers as <question-id>:<command-id>:<verdict>; repeat for all eight.",
};

export function mindCmd(
  name: string,
  summary: string,
  description: string,
  flags: readonly FlagSpec[],
  handler: CommandHandler,
  examples: readonly string[] = [],
  aliases: readonly string[] = [],
): CommandSpec {
  return {
    name,
    aliases,
    domain: "mind",
    summary,
    description,
    flags,
    readsStdin: false,
    takesRemainder: false,
    exitCodes: DEFAULT_EXIT_CODES,
    examples,
    handler,
  };
}
