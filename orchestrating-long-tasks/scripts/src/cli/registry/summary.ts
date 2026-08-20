import { summaryExportCommand, summaryViewCommand } from "../commands/summary-ops.ts";
import { DEFAULT_EXIT_CODES, optionalFlag, requiredFlag, type CommandSpec } from "./types.ts";

export const SUMMARY_COMMANDS: readonly CommandSpec[] = [
  {
    name: "summary:export",
    aliases: [],
    domain: "summary",
    summary: "Write the graph, timeline, metrics and executive brief to disk.",
    description:
      "Generates the summary suite under <run>/summary and, with --out, an additional registry export for the graph viewer.",
    flags: [
      requiredFlag("run", "string", "Capsule run root."),
      optionalFlag("out", "string", "Directory for the viewer registry export."),
    ],
    readsStdin: false,
    takesRemainder: false,
    exitCodes: DEFAULT_EXIT_CODES,
    examples: ["bun harness.ts summary:export --run .capsules/<run-id>"],
    handler: summaryExportCommand,
  },
  {
    name: "summary:view",
    aliases: [],
    domain: "summary",
    summary: "Render the executive brief without writing anything.",
    description: "Generates the same suite in memory and returns only the markdown brief.",
    flags: [requiredFlag("run", "string", "Capsule run root.")],
    readsStdin: false,
    takesRemainder: false,
    exitCodes: DEFAULT_EXIT_CODES,
    examples: ["bun harness.ts summary:view --run .capsules/<run-id>"],
    handler: summaryViewCommand,
  },
];
