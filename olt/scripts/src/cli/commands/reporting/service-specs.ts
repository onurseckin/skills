import type { CommandSpec } from "../../registry/types.ts";
import { DEFAULT_EXIT_CODES, optionalFlag, requiredFlag } from "../../registry/types.ts";

export const EVENTS_STREAM_SPEC: CommandSpec = {
  name: "events:stream",
  aliases: [],
  domain: "reporting",
  summary: "Stream, query, and tail structured capsule events.",
  description:
    "Streams chronological capsule events as rich terminal ASCII tables, Markdown, or NDJSON, with sequence filtering and optional webhook delivery.",
  flags: [
    optionalFlag("run", "string", "Capsule run root."),
    optionalFlag("run-id", "string", "Capsule run identifier."),
    optionalFlag("repo", "string", "Repository root."),
    optionalFlag("from-seq", "int", "Starting event sequence number."),
    optionalFlag("to-seq", "int", "Ending event sequence number."),
    optionalFlag("max-events", "int", "Maximum events to return.", 50),
    optionalFlag("filter-type", "string", "Filter events by event type name."),
    optionalFlag("filter-actor", "string", "Filter events by acting agent ID."),
    optionalFlag("all", "bool", "Return all matching events."),
    optionalFlag("now", "bool", "Return only the latest event in the log."),
    optionalFlag("format", "string", "Output format: markdown, json, or ndjson."),
    optionalFlag("webhook-url", "string", "Webhook endpoint URL for event forwarding."),
    optionalFlag("webhook-retries", "int", "Webhook retry attempts.", 3),
    optionalFlag("webhook-timeout", "int", "Webhook request timeout in ms.", 5000),
    optionalFlag("json", "bool", "Output JSON."),
  ],
  readsStdin: false,
  takesRemainder: false,
  exitCodes: DEFAULT_EXIT_CODES,
  examples: ["bun harness.ts events:stream --run .olt/capsules/<run-id>"],
  handler: async (flags, ctx, remainder) =>
    (await import("../stream-events.ts")).streamEventsCommand(flags, ctx),
};

export const EVENTS_TRACE_SPEC: CommandSpec = {
  name: "events:trace",
  aliases: [],
  domain: "reporting",
  summary: "Real-time step tracer and dynamic living DAG expansion timeline.",
  description:
    "Replays events.jsonl to construct dynamic branch expansions and renders a chronological vertical step timeline with status glyphs and telemetry.",
  flags: [
    optionalFlag("run", "string", "Capsule run root."),
    optionalFlag("run-id", "string", "Capsule run identifier."),
    optionalFlag("repo", "string", "Repository root."),
    optionalFlag("from-seq", "int", "Starting event sequence number."),
    optionalFlag("to-seq", "int", "Ending event sequence number."),
    optionalFlag("max-steps", "int", "Maximum step entries to display.", 50),
    optionalFlag("task", "string", "Filter steps by task ID."),
    optionalFlag("actor", "string", "Filter steps by agent ID."),
    optionalFlag("filter-type", "string", "Filter steps by event kind."),
    optionalFlag("detailed", "bool", "Detailed step inspection."),
    optionalFlag("all", "bool", "Return all steps without line truncation."),
  ],
  readsStdin: false,
  takesRemainder: false,
  exitCodes: DEFAULT_EXIT_CODES,
  examples: ["bun harness.ts events:trace --run .olt/capsules/<run-id>"],
  handler: async (flags, ctx, remainder) => (await import("../dag.ts")).dagTraceCommand(flags, ctx),
};

export const QUOTA_CHECK_SPEC: CommandSpec = {
  name: "quota:check",
  aliases: [],
  domain: "reporting",
  summary:
    "Evaluate quota circuit-breaker status, wrap-up directives, and auto-wake timer schedule.",
  description:
    "Probes cross-platform quota telemetry, detects exhaustion (<10%), generates wrap-up directives for active agents, and computes one-shot auto-wake scheduler payloads.",
  flags: [
    optionalFlag(
      "platform",
      "string",
      "Filter probe to a specific platform ID (antigravity, claude, cursor, openai, codex).",
    ),
    optionalFlag(
      "threshold",
      "string",
      "Quota percentage threshold to trigger circuit breaker (default: 10.0).",
      "10.0",
    ),
    optionalFlag(
      "active-agents",
      "int",
      "Number of currently active agents to register in auto-wake schedule.",
      0,
    ),
    optionalFlag("detailed", "bool", "Include full vendor observation payloads."),
    optionalFlag("json", "bool", "Output structured JSON report."),
  ],
  readsStdin: false,
  takesRemainder: false,
  exitCodes: DEFAULT_EXIT_CODES,
  examples: ["bun harness.ts quota:check"],
  handler: async (flags, ctx, remainder) =>
    (await import("../quota-check.ts")).quotaCheckCommand(flags, ctx, remainder),
};

export const QUOTA_FREEZE_SPEC: CommandSpec = {
  name: "quota:freeze",
  aliases: [],
  domain: "reporting",
  summary: "Initiate DAG quota freeze and create a snapshot.",
  description:
    "Probes quota telemetry and freezes DAG operations if circuit breaker is triggered or force is applied. Outputs state to a snapshot file.",
  flags: [
    optionalFlag("repo", "string", "Must resolve to the verified run repository."),
    requiredFlag("run", "string", "Verified capsule run root."),
    requiredFlag("actor", "string", "Acting mind or orchestrator agent ID."),
    optionalFlag("threshold", "string", "Quota percentage threshold (default: 10.0).", "10.0"),
    optionalFlag("active-agents", "int", "Number of currently active agents.", 0),
    optionalFlag(
      "force",
      "bool",
      "Override quota policy only; never bypasses quota evidence.",
      false,
    ),
    optionalFlag("json", "bool", "Output structured JSON report."),
    optionalFlag("detailed", "bool", "Detailed markdown output."),
  ],
  readsStdin: false,
  takesRemainder: false,
  exitCodes: DEFAULT_EXIT_CODES,
  examples: ["bun harness.ts quota:freeze --run .olt/capsules/<run-id> --actor mind_1"],
  handler: async (flags, ctx, remainder) =>
    (await import("../quota-freeze.ts")).quotaFreezeCommand(flags, ctx, remainder),
};

export const QUOTA_RESUME_SPEC: CommandSpec = {
  name: "quota:resume",
  aliases: [],
  domain: "reporting",
  summary: "Resume DAG operations from a quota freeze snapshot.",
  description:
    "Probes quota telemetry and resumes operations from a prior freeze if quota is healthy or force is applied.",
  flags: [
    optionalFlag("repo", "string", "Must resolve to the verified run repository."),
    requiredFlag("run", "string", "Verified capsule run root."),
    requiredFlag("actor", "string", "Acting mind or orchestrator agent ID."),
    optionalFlag("threshold", "string", "Quota percentage threshold (default: 10.0).", "10.0"),
    optionalFlag(
      "force",
      "bool",
      "Override quota policy only; does not bypass run or grant authority.",
      false,
    ),
    optionalFlag("json", "bool", "Output structured JSON report."),
    optionalFlag("detailed", "bool", "Detailed markdown output."),
  ],
  readsStdin: false,
  takesRemainder: false,
  exitCodes: DEFAULT_EXIT_CODES,
  examples: ["bun harness.ts quota:resume --run .olt/capsules/<run-id> --actor mind_1"],
  handler: async (flags, ctx, remainder) =>
    (await import("../quota-resume.ts")).quotaResumeCommand(flags, ctx, remainder),
};

export const SKILL_AUDIT_LIVE_SPEC: CommandSpec = {
  name: "skill:audit:live",
  aliases: [],
  domain: "reporting",
  summary: "Live Tier 0 out-of-band audit of skill compliance and delta event forensics.",
  description:
    "Scans incremental delta events, audits cognitive contracts, and routes defects upstream.",
  flags: [
    optionalFlag("repo", "string", "Repository root path."),
    optionalFlag("run", "string", "Target capsule run root directory."),
    optionalFlag("log-defects", "bool", "Automatically log detected incidents as defects.", true),
    optionalFlag("json", "bool", "Output structured JSON."),
  ],
  readsStdin: false,
  takesRemainder: false,
  exitCodes: DEFAULT_EXIT_CODES,
  examples: ["bun harness.ts skill:audit:live"],
  handler: async (flags, ctx, remainder) =>
    (await import("../skill-audit-live.ts")).skillAuditLiveCommand(flags, ctx),
};

export const NOTIFY_PHASE_SPEC: CommandSpec = {
  name: "notify:phase",
  aliases: [],
  domain: "reporting",
  summary: "Trigger cross-platform native OS push notification and audio chime upon phase landing.",
  description:
    "Dispatches native desktop banner notifications and plays the macOS Glass chime upon successful upstream release landings.",
  flags: [
    optionalFlag("phase", "string", "Name or identifier of the completed phase.", "OLT Release"),
    optionalFlag("duration-ms", "int", "Total elapsed duration in milliseconds."),
    optionalFlag("tasks", "int", "Total task count completed in the phase."),
    optionalFlag("commit", "string", "Git commit hash of the release."),
    optionalFlag("title", "string", "Custom notification title."),
    optionalFlag("subtitle", "string", "Custom notification subtitle."),
    optionalFlag("details", "string", "Additional details."),
    optionalFlag("sound", "bool", "Enable Glass audio chime (default: true).", true),
    optionalFlag("no-sound", "bool", "Disable audio chime.", false),
    optionalFlag("silent", "bool", "Suppress all audio/visual alerts.", false),
    optionalFlag("json", "bool", "Output structured JSON report.", false),
  ],
  readsStdin: false,
  takesRemainder: false,
  exitCodes: DEFAULT_EXIT_CODES,
  examples: [
    "bun harness.ts notify:phase --phase 'Core Architecture' --tasks 12 --duration-ms 272000",
  ],
  handler: async (flags, ctx, remainder) =>
    (await import("../notify-ops.ts")).notifyPhaseCommand(flags),
};

export const NOTIFY_TEST_SPEC: CommandSpec = {
  name: "notify:test",
  aliases: [],
  domain: "reporting",
  summary: "Send a test native OS notification and Glass chime to verify desktop integration.",
  description:
    "Triggers a non-blocking test notification and Glass audio chime on macOS or standard alert chime on Linux/Windows.",
  flags: [
    optionalFlag("no-sound", "bool", "Mute audio chime.", false),
    optionalFlag("json", "bool", "Output structured JSON report.", false),
  ],
  readsStdin: false,
  takesRemainder: false,
  exitCodes: DEFAULT_EXIT_CODES,
  examples: ["bun harness.ts notify:test"],
  handler: async (flags, ctx, remainder) =>
    (await import("../notify-ops.ts")).notifyTestCommand(flags),
};

export const SERVICE_REPORT_SPECS: readonly CommandSpec[] = [
  EVENTS_STREAM_SPEC,
  EVENTS_TRACE_SPEC,
  QUOTA_CHECK_SPEC,
  QUOTA_FREEZE_SPEC,
  QUOTA_RESUME_SPEC,
  SKILL_AUDIT_LIVE_SPEC,
  NOTIFY_PHASE_SPEC,
  NOTIFY_TEST_SPEC,
];
