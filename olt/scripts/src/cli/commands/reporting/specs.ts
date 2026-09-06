import type { CommandSpec } from "../../registry/types.ts";
import { DEFAULT_EXIT_CODES, optionalFlag, requiredFlag } from "../../registry/types.ts";

export const REPORT_UNIFIED_SPEC: CommandSpec = {
  name: "report:unified",
  aliases: ["report"],
  domain: "reporting",
  summary: "Deliver unified topology, lifecycle tier breakdown, agent roles, IDs, and timestamps.",
  description:
    "Generates comprehensive unified run report across tasks, topology, agent lifecycle tiers, occupancy, wave status, gate progress, and diagnostic receipts.",
  flags: [
    optionalFlag(
      "run",
      "string",
      "Capsule run root. Defaults to current repository .olt/capsules/ when omitted.",
    ),
    optionalFlag("run-id", "string", "Alias of --run."),
    optionalFlag("repo", "string", "Repository root to search for .olt/capsules/.", "."),
    optionalFlag("detailed", "bool", "Detailed topology and audit forensics."),
    optionalFlag("json", "bool", "Output structured JSON report."),
  ],
  readsStdin: false,
  takesRemainder: false,
  exitCodes: DEFAULT_EXIT_CODES,
  examples: [
    "bun harness.ts report",
    "bun harness.ts report:unified",
    "bun harness.ts report --run .olt/capsules/<run-id>",
  ],
  handler: async (flags, ctx, remainder) =>
    (await import("./report-unified.ts")).reportUnifiedCommand(flags, ctx),
};

export const REPORT_DAG_SPEC: CommandSpec = {
  name: "report:dag",
  aliases: [],
  domain: "reporting",
  summary:
    "Render Sugiyama hierarchical DAG layout with rounded Unicode boxes and cycle diagnostics.",
  description:
    "Computes Sugiyama layered layout, crossing minimization via barycenter heuristics, Tarjan cycle alerts, illegal bypass warnings, orthogonal connectors, and APCA contrast.",
  flags: [
    optionalFlag(
      "run",
      "string",
      "Capsule run root. Defaults to current repository .olt/capsules/ when omitted.",
    ),
    optionalFlag("run-id", "string", "Alias of --run."),
    optionalFlag("repo", "string", "Repository root to search for .olt/capsules/.", "."),
    optionalFlag(
      "detailed",
      "bool",
      "Render full write scopes, gate commands, and dependency lists.",
    ),
    optionalFlag("recommendations", "bool", "Include algorithmic parallelization recommendations."),
    optionalFlag("box-style", "string", "Box border style: rounded, sharp, or ascii.", "rounded"),
    optionalFlag("all", "bool", "Do not truncate output lines."),
    optionalFlag("json", "bool", "Output structured JSON report."),
  ],
  readsStdin: false,
  takesRemainder: false,
  exitCodes: DEFAULT_EXIT_CODES,
  examples: [
    "bun harness.ts report:dag",
    "bun harness.ts report:dag --run .olt/capsules/<run-id>",
    "bun harness.ts report:dag --detailed",
  ],
  handler: async (flags, ctx, remainder) =>
    (await import("./report-dag.ts")).reportDagCommand(flags, ctx),
};

export const REPORT_SUMMARY_SPEC: CommandSpec = {
  name: "report:summary",
  aliases: [],
  domain: "reporting",
  summary: "Render executive summary brief of capsule run.",
  description: "Renders the executive brief in markdown or JSON directly to terminal.",
  flags: [
    requiredFlag("run", "string", "Capsule run root."),
    optionalFlag("out", "string", "Directory for viewer registry export."),
    optionalFlag("json", "bool", "Output JSON."),
  ],
  readsStdin: false,
  takesRemainder: false,
  exitCodes: DEFAULT_EXIT_CODES,
  examples: ["bun harness.ts report:summary --run .olt/capsules/<run-id>"],
  handler: async (flags) => (await import("../summary-ops.ts")).summaryViewCommand(flags),
};

export const REPORT_TASK_SPEC: CommandSpec = {
  name: "report:task",
  aliases: [],
  domain: "reporting",
  summary: "Read and render a task submission, review or critic report.",
  description:
    "Extracts and formats full task report evidence including verification outcomes, gate executions, and screenshot records without requiring raw file inspection.",
  flags: [
    requiredFlag("run", "string", "Capsule run root."),
    optionalFlag("task", "string", "Task whose report is wanted."),
    optionalFlag("critic", "bool", "Read the critic review report."),
    optionalFlag("submission", "bool", "Force the submission report."),
    optionalFlag("review", "bool", "Force the review report."),
    optionalFlag("type", "string", "submission, review or critic."),
    optionalFlag("stage", "string", "Alias of --type."),
    optionalFlag("report", "string", "Explicit report file name."),
    optionalFlag("id", "string", "Alias of --report."),
    optionalFlag("screenshots", "bool", "Include screenshot records."),
  ],
  readsStdin: false,
  takesRemainder: false,
  exitCodes: DEFAULT_EXIT_CODES,
  examples: [
    "bun harness.ts report:task --run .olt/capsules/<run-id> --task task-1",
    "bun harness.ts report:task --run .olt/capsules/<run-id> --task task-1 --type review",
  ],
  handler: async (flags) => (await import("../inspection-ops.ts")).reportGetCommand(flags),
};

export const REPORT_HEALTH_SPEC: CommandSpec = {
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
  examples: ["bun harness.ts report:health --run .olt/capsules/<run-id>"],
  handler: async (flags, ctx, remainder) =>
    (await import("../unified-reporting.ts")).reportHealthCommand(flags),
};

export const REPORT_LEASES_SPEC: CommandSpec = {
  name: "report:leases",
  aliases: [],
  domain: "reporting",
  summary: "Active lease and agent matrix.",
  description: "Reports the matrix of active leases.",
  flags: [requiredFlag("run", "string", "Capsule run root.")],
  readsStdin: false,
  takesRemainder: false,
  exitCodes: DEFAULT_EXIT_CODES,
  examples: ["bun harness.ts report:leases --run .olt/capsules/<run-id>"],
  handler: async (flags, ctx, remainder) =>
    (await import("../unified-reporting.ts")).reportLeasesCommand(flags),
};

export const REPORT_DECISIONS_SPEC: CommandSpec = {
  name: "report:decisions",
  aliases: [],
  domain: "reporting",
  summary: "Inspection of authority decisions and governance audit.",
  description: "Reports the decisions audit matrix.",
  flags: [requiredFlag("run", "string", "Capsule run root.")],
  readsStdin: false,
  takesRemainder: false,
  exitCodes: DEFAULT_EXIT_CODES,
  examples: ["bun harness.ts report:decisions --run .olt/capsules/<run-id>"],
  handler: async (flags, ctx, remainder) =>
    (await import("../unified-reporting.ts")).reportDecisionsCommand(flags),
};

export const REPORT_USAGE_SPEC: CommandSpec = {
  name: "report:usage",
  aliases: [],
  domain: "reporting",
  summary: "Discover and report cross-platform quota, rate limit, and token usage telemetry.",
  description:
    "Autonomously probes frontier LLM platforms (Antigravity, Claude, Cursor, OpenAI/Codex) using a 3-tier fallback strategy and generates unified ASCII telemetry tables.",
  flags: [
    optionalFlag(
      "platform",
      "string",
      "Filter probe to a specific platform ID (antigravity, claude, cursor, openai, codex).",
    ),
    optionalFlag("detailed", "bool", "Include full raw vendor observation payloads."),
    optionalFlag("json", "bool", "Output structured JSON report."),
  ],
  readsStdin: false,
  takesRemainder: false,
  exitCodes: DEFAULT_EXIT_CODES,
  examples: [
    "bun harness.ts report:usage",
    "bun harness.ts report:usage --platform antigravity",
    "bun harness.ts report:usage --detailed",
  ],
  handler: async (flags, ctx, remainder) =>
    (await import("../usage-report.ts")).usageReportCommand(flags, ctx, remainder),
};

export const REPORT_GRAPH_JSON_SPEC: CommandSpec = {
  name: "report:graph-json",
  aliases: [],
  domain: "reporting",
  summary: "Export DAG telemetry and metrics to JSON.",
  description: "Export DAG telemetry and metrics to JSON.",
  flags: [
    optionalFlag("run", "string", "Path to capsule run directory"),
    optionalFlag("run-id", "string", "Capsule run identifier"),
    optionalFlag("out", "string", "Path to save JSON"),
    optionalFlag("pretty", "bool", "Format output JSON nicely"),
  ],
  readsStdin: false,
  takesRemainder: false,
  exitCodes: DEFAULT_EXIT_CODES,
  examples: ["bun harness.ts report:graph-json --run .olt/capsules/<run-id> --out graph.json"],
  handler: async (flags, ctx, remainder) =>
    (await import("../graph-export.ts")).exportGraphJsonCommand(flags),
};

export const CORE_REPORT_SPECS: readonly CommandSpec[] = [
  REPORT_UNIFIED_SPEC,
  REPORT_DAG_SPEC,
  REPORT_SUMMARY_SPEC,
  REPORT_TASK_SPEC,
  REPORT_HEALTH_SPEC,
  REPORT_LEASES_SPEC,
  REPORT_DECISIONS_SPEC,
  REPORT_USAGE_SPEC,
  REPORT_GRAPH_JSON_SPEC,
];
