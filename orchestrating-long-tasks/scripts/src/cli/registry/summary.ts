import { summaryExportCommand, summaryViewCommand } from "../commands/summary-ops.ts";
import { testSummaryCommand } from "../commands/test-summary.ts";
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
  {
    name: "test:summary",
    aliases: [],
    domain: "summary",
    summary: "Display or record test execution summary metadata.",
    description:
      "Reads or records test summary records from capsule storage, showing passed/failed counts, duration, coverage, and execution scope.",
    flags: [
      optionalFlag("run", "string", "Capsule run root or storage directory."),
      optionalFlag("json", "bool", "Output JSON format."),
      optionalFlag("passed", "int", "Passed test count for manual summary recording."),
      optionalFlag("failed", "int", "Failed test count for manual summary recording."),
      optionalFlag("skipped", "int", "Skipped test count for manual summary recording."),
      optionalFlag("duration", "int", "Duration in milliseconds for manual summary recording."),
      optionalFlag("coverage", "string", "Coverage percentage for manual summary recording."),
      optionalFlag("commit", "string", "Commit SHA for manual summary recording."),
      optionalFlag("files", "int", "Test files count for manual summary recording."),
      optionalFlag("scope", "string", "Scope filter or recorded scope (e.g. 'full' or 'scoped')."),
      optionalFlag("agent", "string", "Agent recording the summary."),
    ],
    readsStdin: false,
    takesRemainder: false,
    exitCodes: DEFAULT_EXIT_CODES,
    examples: [
      "bun harness.ts test:summary",
      "bun harness.ts test:summary --run .capsules/<run-id>",
      "bun harness.ts test:summary --passed 45 --failed 0 --duration 1200",
    ],
    handler: testSummaryCommand,
  },
];
