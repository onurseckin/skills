import { explainCommand } from "../commands/explain-ops.ts";
import { DEFAULT_EXIT_CODES, optionalFlag, requiredFlag, type CommandSpec } from "./types.ts";

export const EXPLAIN_COMMANDS: readonly CommandSpec[] = [
  {
    name: "explain",
    aliases: [],
    domain: "diagnostics",
    summary:
      "Explain a HarnessError code: the rule it enforces, common causes and the remedy for each.",
    description:
      "Answers a refused command with a command instead of a file to read. --code is one of the ErrorCode values a HarnessError actually carries (INTEGRITY, INVALID_ARGUMENT, INVALID_STATE, LOCK_TIMEOUT, NOT_IMPLEMENTED, PATH_SAFETY, UNSUPPORTED_PLATFORM); case-insensitive. Every cause is grounded in real throw sites in this build, cited by file and line, plus a live count of how many places in the current source tree still throw that code. --command narrows further: it dynamically scans that command's own implementation file for direct throws of --code and reports the exact lines and messages, rather than a canned guess about which command hits which cause.",
    flags: [
      requiredFlag(
        "code",
        "string",
        "HarnessError code to explain: INTEGRITY, INVALID_ARGUMENT, INVALID_STATE, LOCK_TIMEOUT, NOT_IMPLEMENTED, PATH_SAFETY, or UNSUPPORTED_PLATFORM. Case-insensitive.",
      ),
      optionalFlag(
        "command",
        "string",
        "CLI command name (e.g. task:claim) to narrow the explanation to that command's own direct throw sites.",
      ),
    ],
    readsStdin: false,
    takesRemainder: false,
    exitCodes: DEFAULT_EXIT_CODES,
    examples: [
      "bun harness.ts explain --code INTEGRITY",
      "bun harness.ts explain --code INVALID_STATE --command task:claim",
    ],
    handler: explainCommand,
  },
];
