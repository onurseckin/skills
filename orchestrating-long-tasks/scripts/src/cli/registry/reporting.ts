import type { CommandSpec } from "./types.ts";
import { DEFAULT_EXIT_CODES, optionalFlag, requiredFlag } from "./types.ts";
import {
  reportDagCommand,
  reportGraphCommand,
  reportGraphJsonCommand,
  reportHealthCommand,
  reportLeasesCommand,
  reportDecisionsCommand,
} from "../commands/unified-reporting.ts";

import { exportGraphJsonCommand } from "../commands/graph-export.ts";

export const REPORTING_COMMANDS: readonly CommandSpec[] = [
  {
    name: "report:graph-json",
    aliases: ["dag:export-json"],
    domain: "reporting",
    summary: "Export DAG telemetry and metrics to JSON.",
    description: "Export DAG telemetry and metrics to JSON.",
    readsStdin: false,
    takesRemainder: false,
    exitCodes: DEFAULT_EXIT_CODES,
    flags: [
      optionalFlag("run", "string", "Path to capsule run directory"),
      optionalFlag("run-id", "string", "Capsule run identifier"),
      optionalFlag("out", "string", "Path to save JSON"),
      optionalFlag("pretty", "bool", "Format output JSON nicely"),
    ],
    examples: [
      "bun harness.ts report:graph-json --run .capsules/<run-id> --out graph.json"
    ],
    handler: exportGraphJsonCommand,
  },
  {
    name: "report:dag",
    aliases: [],
    domain: "reporting",
    summary: "Canonical reporting for DAG status.",
    description: "Aliases/links to dag:view to inspect compiled graph or planning buffer DAG topology.",
    flags: [
      optionalFlag("run", "string", "Capsule run root. Defaults to current repository .capsules/ when omitted."),
      optionalFlag("run-id", "string", "Alias of --run."),
      optionalFlag("repo", "string", "Repository root to search for .capsules/.", "."),
      optionalFlag("detailed", "bool", "Render full write scopes, gate commands, and dependency lists."),
      optionalFlag("recommendations", "bool", "Highlight algorithmic parallelization opportunities."),
      optionalFlag("all", "bool", "Do not truncate output lines."),
    ],
    readsStdin: false,
    takesRemainder: false,
    exitCodes: DEFAULT_EXIT_CODES,
    examples: ["bun harness.ts report:dag --run .capsules/<run-id>"],
    handler: reportDagCommand,
  },
  {
    name: "report:graph",
    aliases: [],
    domain: "reporting",
    summary: "Visual/ASCII and graph overview.",
    description: "Renders the task graph.",
    flags: [
      requiredFlag("run", "string", "Capsule run root."),
      optionalFlag("detailed", "bool", "Detailed output."),
    ],
    readsStdin: false,
    takesRemainder: false,
    exitCodes: DEFAULT_EXIT_CODES,
    examples: ["bun harness.ts report:graph --run .capsules/<run-id>"],
    handler: reportGraphCommand,
  },
  {
    name: "report:health",
    aliases: [],
    domain: "reporting",
    summary: "Canonical reporting for health/doctor status.",
    description: "Runs the capsule doctor to check health status.",
    flags: [
      requiredFlag("run", "string", "Capsule run root."),
      optionalFlag("source", "string", "Source."),
      optionalFlag("home", "string", "Home."),
      optionalFlag("clients", "string", "Clients."),
    ],
    readsStdin: false,
    takesRemainder: false,
    exitCodes: DEFAULT_EXIT_CODES,
    examples: ["bun harness.ts report:health --run .capsules/<run-id>"],
    handler: reportHealthCommand,
  },
  {
    name: "report:leases",
    aliases: [],
    domain: "reporting",
    summary: "Active lease and agent matrix.",
    description: "Reports the matrix of active leases.",
    flags: [
      requiredFlag("run", "string", "Capsule run root."),
    ],
    readsStdin: false,
    takesRemainder: false,
    exitCodes: DEFAULT_EXIT_CODES,
    examples: ["bun harness.ts report:leases --run .capsules/<run-id>"],
    handler: reportLeasesCommand,
  },
  {
    name: "report:decisions",
    aliases: [],
    domain: "reporting",
    summary: "Inspection of authority decisions and governance audit.",
    description: "Reports the decisions audit matrix.",
    flags: [
      requiredFlag("run", "string", "Capsule run root."),
    ],
    readsStdin: false,
    takesRemainder: false,
    exitCodes: DEFAULT_EXIT_CODES,
    examples: ["bun harness.ts report:decisions --run .capsules/<run-id>"],
    handler: reportDecisionsCommand,
  },
];
