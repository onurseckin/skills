import {
  mindQueueAddCommand,
  mindQueueCleanCommand,
  mindQueueDrainCommand,
  mindQueueListCommand,
  mindQueueSealCommand,
  todoAddCommand,
  todoCleanCommand,
  todoDrainCommand,
  todoListCommand,
  todoSealCommand,
} from "../commands/todo-ops.ts";
import { memoryQueryCommand } from "../commands/memory-ops.ts";
import { mindAdmitCommand, mindDeclineCommand } from "../commands/mind-admit.ts";
import { mindAuditReportCommand, mindAuditStartCommand } from "../commands/mind-audit.ts";
import { mindCandidateCommand } from "../commands/mind-candidate.ts";
import { mindInitCommand } from "../commands/mind-init.ts";
import { mindObserveCommand } from "../commands/mind-observe.ts";
import { mindPulseCommand } from "../commands/mind-pulse.ts";
import { mindPulseOpenCommand } from "../commands/mind-pulse-open.ts";
import { mindQuiesceCommand } from "../commands/mind-quiesce.ts";
import { mindRotateCommand } from "../commands/mind-rotate.ts";
import { mindRoundCloseCommand, mindRoundOpenCommand } from "../commands/mind-round.ts";
import { mindWakeCommand } from "../commands/mind-wake.ts";
import { smartTaskIngestCommand, smartTaskSynthesizeCommand } from "../commands/smart-task-ops.ts";
import { HarnessError } from "../../core/errors/harness-error.ts";
import {
  DEFAULT_EXIT_CODES,
  optionalFlag,
  requiredFlag,
  type CommandSpec,
  type FlagSpec,
} from "./types.ts";

export {
  memoryQueryCommand,
  mindAdmitCommand,
  mindAuditReportCommand,
  mindAuditStartCommand,
  mindCandidateCommand,
  mindDeclineCommand,
  mindInitCommand,
  mindObserveCommand,
  mindPulseCommand,
  mindPulseOpenCommand,
  mindQueueAddCommand,
  mindQueueCleanCommand,
  mindQueueDrainCommand,
  mindQueueListCommand,
  mindQueueSealCommand,
  mindQuiesceCommand,
  mindRotateCommand,
  mindRoundCloseCommand,
  mindRoundOpenCommand,
  mindWakeCommand,
  smartTaskIngestCommand,
  smartTaskSynthesizeCommand,
  todoAddCommand,
  todoCleanCommand,
  todoDrainCommand,
  todoListCommand,
  todoSealCommand,
};

export function mindEscalateCommand(): Record<string, unknown> {
  throw new HarnessError("NOT_IMPLEMENTED", "mind:escalate handler is not implemented yet");
}

export function mindHaltCommand(): Record<string, unknown> {
  throw new HarnessError("NOT_IMPLEMENTED", "mind:halt handler is not implemented yet");
}

const charterGoalFlag: FlagSpec = {
  name: "charter-goal",
  type: "string",
  required: true,
  repeatable: true,
  description: "Goal ids from the pinned charter; repeat for multiple.",
};

const candidateWriteScopeFlag: FlagSpec = {
  name: "write-scope",
  type: "string",
  required: true,
  repeatable: true,
  description: "Paths the work would touch; repeat for multiple.",
};

const quiesceSourceFlag: FlagSpec = {
  name: "source",
  type: "string",
  required: true,
  repeatable: true,
  description:
    "Source scan result as <source>:<command-id>:<count>; repeat for each of the ten sources.",
};

const auditAnswerFlag: FlagSpec = {
  name: "answer",
  type: "string",
  required: true,
  repeatable: true,
  description:
    "One of eight audit question answers as <question-id>:<command-id>:<verdict>; repeat for all eight.",
};

export const MIND_COMMANDS: readonly CommandSpec[] = [
  {
    name: "memory:query",
    aliases: ["memory:search"],
    domain: "mind",
    summary: "Query indexed cross-run knowledge, decisions, and memory documents.",
    description:
      "Performs full-text retrieval and ranking across knowledge base, charter, findings, decisions, and past run summaries with zero external file reads required.",
    flags: [
      optionalFlag("query", "string", "Search query terms."),
      optionalFlag("run", "string", "Filter by capsule run root."),
      optionalFlag("capsules-dir", "string", "Override capsules root directory."),
      optionalFlag("repo", "string", "Repository root path."),
      optionalFlag("kind", "string", "Filter by document kind."),
      optionalFlag("limit", "int", "Maximum number of search results.", 10),
      optionalFlag("min-score", "string", "Minimum similarity/match score threshold."),
      optionalFlag("format", "string", "Output format: markdown or json."),
      optionalFlag("all", "bool", "Display all matching documents without truncation."),
      optionalFlag("now", "string", "Timestamp override (ISO8601)."),
      optionalFlag("json", "bool", "Output JSON."),
    ],
    readsStdin: false,
    takesRemainder: false,
    exitCodes: DEFAULT_EXIT_CODES,
    examples: [
      'bun harness.ts memory:query --query "authentication refactor"',
      'bun harness.ts memory:query --query "rate limit" --limit 5',
    ],
    handler: memoryQueryCommand,
  },
  {
    name: "mind:init",
    aliases: [],
    domain: "mind",
    summary: "Initialize a mind capsule from an owner charter.",
    description:
      "Validates the markdown charter file per CONTRACTS.md §7, creates the mind capsule (mind-gen-<generation>), pins the charter digest into manifest.json, seeds the state projection, and writes the initial last_pulse.json.",
    flags: [
      requiredFlag("repo", "string", "Repository root the mind serves."),
      requiredFlag("charter", "string", "Path to the owner's charter file."),
      requiredFlag("actor", "string", "Recorded on mind-initialized."),
      optionalFlag(
        "mind-id",
        "string",
        "Mind capsule run id; defaults to mind-gen-1.",
        "mind-gen-1",
      ),
      optionalFlag("capsules-dir", "string", "Override .olt/capsules/ directory location."),
    ],
    readsStdin: false,
    takesRemainder: false,
    exitCodes: DEFAULT_EXIT_CODES,
    examples: ["bun harness.ts mind:init --repo . --charter docs/CHARTER.md --actor owner"],
    handler: mindInitCommand,
  },
  {
    name: "mind:wake",
    aliases: [],
    domain: "mind",
    summary: "Produce the Tier A orientation brief and reclaim expired pulses.",
    description:
      "Inspects the mind capsule state and budget, reclaims any open pulse past its deadline via mind-pulse-reclaimed, and outputs the Tier A orientation brief ending in prescribed next actions.",
    flags: [
      requiredFlag("run", "string", "The mind capsule root."),
      optionalFlag("actor", "string", "Recorded only if the call reclaims a dead pulse."),
      optionalFlag("depth", "string", "Orientation depth: brief (default) or run.", "brief"),
      optionalFlag(
        "target-run",
        "string",
        "With --depth run, the run capsule whose handoff to render.",
      ),
    ],
    readsStdin: false,
    takesRemainder: false,
    exitCodes: DEFAULT_EXIT_CODES,
    examples: ["bun harness.ts mind:wake --run .olt/capsules/mind-gen-1"],
    handler: mindWakeCommand,
  },
  {
    name: "mind:pulse-open",
    aliases: [],
    domain: "mind",
    summary: "Open an active mind pulse under budget constraints.",
    description:
      "Opens a new pulse cycle, validating budget headroom, daily pulse and wall-clock caps, quiet hours, and charter digest consistency before appending mind-pulse-opened.",
    flags: [
      requiredFlag("run", "string", "The mind capsule root."),
      requiredFlag("actor", "string", "The tier-0 agent id."),
      requiredFlag("host", "string", "Host runtime as reported."),
      requiredFlag("driver", "string", "Driver identity as reported."),
    ],
    readsStdin: false,
    takesRemainder: false,
    exitCodes: DEFAULT_EXIT_CODES,
    examples: [
      "bun harness.ts mind:pulse-open --run .olt/capsules/mind-gen-1 --actor mind-1 --host antigravity --driver bash-loop",
    ],
    handler: mindPulseOpenCommand,
  },
  {
    name: "mind:pulse",
    aliases: [],
    domain: "mind",
    summary: "Unified perpetual mind pulse: report active telemetry or open a new pulse.",
    description:
      "Unified perpetual mind pulse command. If a pulse is open, outputs active pulse telemetry and next scheduled interval. If no pulse is open, automatically opens a new perpetual pulse. Enforces CLOSING_FORBIDDEN_FOR_MIND invariant.",
    flags: [
      requiredFlag("run", "string", "The mind capsule root."),
      optionalFlag("actor", "string", "The acting agent id.", "mind-1"),
      optionalFlag("host", "string", "Host runtime as reported.", "antigravity"),
      optionalFlag("driver", "string", "Driver identity as reported.", "perpetual-loop"),
      optionalFlag("arm", "string", "Scheduled duration for the next interval, e.g. 15m."),
      optionalFlag("arm-mechanism", "string", "How the pulse was armed, as reported."),
      optionalFlag("now", "string", "Timestamp override (ISO8601)."),
    ],
    readsStdin: false,
    takesRemainder: false,
    exitCodes: DEFAULT_EXIT_CODES,
    examples: [
      "bun harness.ts mind:pulse --run .olt/capsules/mind-gen-1 --actor mind-1",
      "bun harness.ts mind:pulse --run .olt/capsules/mind-gen-1 --arm 15m",
    ],
    handler: mindPulseCommand,
  },
  {
    name: "mind:observe",
    aliases: [],
    domain: "mind",
    summary: "Record a discovery source scan count evidenced by a command record.",
    description:
      "Records an observation from one of the ten discovery sources evidenced by a recorded command id, appending mind-observed.",
    flags: [
      requiredFlag("run", "string", "The mind capsule root."),
      requiredFlag("actor", "string", "Acting agent."),
      requiredFlag("source", "string", "One of the ten source ids in PLAN.md §7.2."),
      requiredFlag("command-id", "string", "The recorded command whose output this is."),
      requiredFlag("count", "int", "How many items that source returned."),
    ],
    readsStdin: false,
    takesRemainder: false,
    exitCodes: DEFAULT_EXIT_CODES,
    examples: [
      "bun harness.ts mind:observe --run .olt/capsules/mind-gen-1 --actor mind-1 --source intent-drift --command-id cmd-41 --count 0",
    ],
    handler: mindObserveCommand,
  },
  {
    name: "mind:candidate",
    aliases: [],
    domain: "mind",
    summary: "Record a discovery candidate (defect or proposal).",
    description:
      "Proposes a defect or proposal candidate. Defects require a witness command record and falsifier argv. Validates charter goal alignment and write scope before recording mind-candidate-opened.",
    flags: [
      requiredFlag("run", "string", "The mind capsule root."),
      requiredFlag("actor", "string", "Acting agent."),
      requiredFlag("kind", "string", "Candidate kind: defect or proposal."),
      requiredFlag("statement", "string", "One line statement, recorded agent_reported."),
      optionalFlag(
        "witness",
        "string",
        "Command id evidencing the defect; required unless --kind proposal.",
      ),
      charterGoalFlag,
      optionalFlag(
        "falsifier",
        "string",
        "Argv that fails now and would pass if fixed (defects only).",
      ),
      candidateWriteScopeFlag,
      optionalFlag("rationale", "string", "Proposals only."),
    ],
    readsStdin: false,
    takesRemainder: false,
    exitCodes: DEFAULT_EXIT_CODES,
    examples: [
      'bun harness.ts mind:candidate --run .olt/capsules/mind-gen-1 --actor mind-1 --kind defect --statement "typecheck fails" --witness cmd-123 --charter-goal G1 --falsifier "bun run typecheck" --write-scope olt/scripts/src/health/',
    ],
    handler: mindCandidateCommand,
  },
  {
    name: "mind:admit",
    aliases: [],
    domain: "mind",
    summary: "Run admission gates on a candidate and admit it.",
    description:
      "Runs the six admission gates (falsifier verification, scope disjointness, charter alignment, etc.) in order and admits the candidate, appending mind-candidate-admitted.",
    flags: [
      requiredFlag("run", "string", "The mind capsule root."),
      requiredFlag("actor", "string", "Acting agent."),
      requiredFlag("candidate", "string", "Candidate id."),
    ],
    readsStdin: false,
    takesRemainder: false,
    exitCodes: DEFAULT_EXIT_CODES,
    examples: [
      "bun harness.ts mind:admit --run .olt/capsules/mind-gen-1 --actor mind-1 --candidate cand-12",
    ],
    handler: mindAdmitCommand,
  },
  {
    name: "mind:decline",
    aliases: [],
    domain: "mind",
    summary: "Permanently decline a candidate with a recorded reason.",
    description:
      "Marks a candidate permanently declined with a recorded reason and gate failure attribution, appending mind-candidate-declined.",
    flags: [
      requiredFlag("run", "string", "The mind capsule root."),
      requiredFlag("actor", "string", "Acting agent."),
      requiredFlag("candidate", "string", "Candidate id."),
      requiredFlag("reason", "string", "Reason why candidate was declined."),
    ],
    readsStdin: false,
    takesRemainder: false,
    exitCodes: DEFAULT_EXIT_CODES,
    examples: [
      'bun harness.ts mind:decline --run .olt/capsules/mind-gen-1 --actor mind-1 --candidate cand-12 --reason "scope overlaps active lease"',
    ],
    handler: mindDeclineCommand,
  },
  {
    name: "mind:quiesce",
    aliases: [],
    domain: "mind",
    summary: "Record a verified quiescent observation across all ten discovery sources.",
    description:
      "Records that all ten discovery sources were scanned and found clean with zero items, appending mind-quiesced.",
    flags: [
      requiredFlag("run", "string", "The mind capsule root."),
      requiredFlag("actor", "string", "Acting agent."),
      quiesceSourceFlag,
    ],
    readsStdin: false,
    takesRemainder: false,
    exitCodes: DEFAULT_EXIT_CODES,
    examples: [
      "bun harness.ts mind:quiesce --run .olt/capsules/mind-gen-1 --actor mind-1 --source intent-drift:cmd-1:0 --source unassigned-todos:cmd-2:0",
    ],
    handler: mindQuiesceCommand,
  },
  {
    name: "mind:escalate",
    aliases: [],
    domain: "mind",
    summary: "Record an escalation and append to escalation log.",
    description:
      "Records an escalation event in the hash chain and appends the escalation reason to escalation.md.",
    flags: [
      requiredFlag("run", "string", "The mind capsule root."),
      requiredFlag("actor", "string", "Acting agent."),
      requiredFlag("reason", "string", "Reason for escalation."),
      optionalFlag("severity", "string", "Severity of escalation."),
    ],
    readsStdin: false,
    takesRemainder: false,
    exitCodes: DEFAULT_EXIT_CODES,
    examples: [
      'bun harness.ts mind:escalate --run .olt/capsules/mind-gen-1 --actor mind-1 --reason "budget exhausted unexpectedly"',
    ],
    handler: mindEscalateCommand,
  },
  {
    name: "mind:halt",
    aliases: [],
    domain: "mind",
    summary: "Halt mind pulse execution and suppress successor arming.",
    description:
      "Halts the mind run, suppresses further autonomous pulse arming, records mind-halted, and updates last_pulse.json with next_wake_at set to null.",
    flags: [
      requiredFlag("run", "string", "The mind capsule root."),
      requiredFlag("actor", "string", "Acting agent."),
      requiredFlag("reason", "string", "Reason for halting."),
    ],
    readsStdin: false,
    takesRemainder: false,
    exitCodes: DEFAULT_EXIT_CODES,
    examples: [
      'bun harness.ts mind:halt --run .olt/capsules/mind-gen-1 --actor mind-1 --reason "critical safety check failure"',
    ],
    handler: mindHaltCommand,
  },
  {
    name: "mind:round-open",
    aliases: [],
    domain: "mind",
    summary: "Open a multi-pulse round for an objective.",
    description:
      "Opens a new execution round for an objective in Phase 4, linking the round to its target capsule and appending mind-round-opened.",
    flags: [
      requiredFlag("run", "string", "The mind capsule root."),
      requiredFlag("actor", "string", "Acting agent."),
      requiredFlag("objective", "string", "Objective id."),
      optionalFlag("candidate", "string", "Candidate id."),
      requiredFlag("round", "int", "Round index."),
      optionalFlag("target-run", "string", "Chained-from capsule run id."),
    ],
    readsStdin: false,
    takesRemainder: false,
    exitCodes: DEFAULT_EXIT_CODES,
    examples: [
      "bun harness.ts mind:round-open --run .olt/capsules/mind-gen-1 --actor mind-1 --objective obj-1 --round 1",
    ],
    handler: mindRoundOpenCommand,
  },
  {
    name: "mind:round-close",
    aliases: [],
    domain: "mind",
    summary: "Close a multi-pulse round for an objective.",
    description:
      "Closes an active execution round for an objective in Phase 4, recording successor objective or terminal reason, appending mind-round-closed.",
    flags: [
      requiredFlag("run", "string", "The mind capsule root."),
      requiredFlag("actor", "string", "Acting agent."),
      requiredFlag("objective", "string", "Objective id."),
      requiredFlag("round", "int", "Round index."),
      optionalFlag(
        "result",
        "string",
        "Round result (converged | exhausted | escalated).",
        "converged",
      ),
      optionalFlag("terminal-reason", "string", "Reason if round terminates without successor."),
      optionalFlag("successor-run", "string", "Successor capsule run id."),
    ],
    readsStdin: false,
    takesRemainder: false,
    exitCodes: DEFAULT_EXIT_CODES,
    examples: [
      'bun harness.ts mind:round-close --run .olt/capsules/mind-gen-1 --actor mind-1 --objective obj-1 --round 1 --terminal-reason "objective completed"',
    ],
    handler: mindRoundCloseCommand,
  },
  {
    name: "mind:audit-start",
    aliases: [],
    domain: "mind",
    summary: "Start an independent audit cycle over recent pulses.",
    description:
      "Initiates an independent audit cycle in Phase 5, recording window start time and auditor identity, appending mind-audit-started.",
    flags: [
      requiredFlag("run", "string", "The mind capsule root."),
      requiredFlag("actor", "string", "Auditor agent id."),
      requiredFlag("audit-id", "string", "Audit id."),
      requiredFlag("window-start", "string", "Window start timestamp (ISO8601)."),
    ],
    readsStdin: false,
    takesRemainder: false,
    exitCodes: DEFAULT_EXIT_CODES,
    examples: [
      "bun harness.ts mind:audit-start --run .olt/capsules/mind-gen-1 --actor auditor-1 --audit-id audit-1 --window-start 2026-08-21T00:00:00Z",
    ],
    handler: mindAuditStartCommand,
  },
  {
    name: "mind:audit-report",
    aliases: [],
    domain: "mind",
    summary: "Submit findings and verdict for an audit cycle.",
    description:
      "Records the eight audit answers with supporting command ids and overall verdict in Phase 5, appending mind-audit-reported.",
    flags: [
      requiredFlag("run", "string", "The mind capsule root."),
      requiredFlag("actor", "string", "Auditor agent id."),
      requiredFlag("audit-id", "string", "Audit id."),
      requiredFlag("verdict", "string", "Audit verdict: approved or failed."),
      auditAnswerFlag,
    ],
    readsStdin: false,
    takesRemainder: false,
    exitCodes: DEFAULT_EXIT_CODES,
    examples: [
      "bun harness.ts mind:audit-report --run .olt/capsules/mind-gen-1 --actor auditor-1 --audit-id audit-1 --verdict approved --answer Q1:cmd-10:pass",
    ],
    handler: mindAuditReportCommand,
  },
  {
    name: "mind:rotate",
    aliases: [],
    domain: "mind",
    summary: "Rotate generation N capsule into generation N+1.",
    description:
      "Performs generational rotation, carrying forward charter pin and declined candidates while preserving auditability.",
    flags: [
      requiredFlag("run", "string", "The current generation capsule root."),
      requiredFlag("next-run", "string", "The next generation capsule root."),
      requiredFlag("actor", "string", "Acting agent id."),
    ],
    readsStdin: false,
    takesRemainder: false,
    exitCodes: DEFAULT_EXIT_CODES,
    examples: [
      "bun harness.ts mind:rotate --run .olt/capsules/mind-gen-1 --next-run .olt/capsules/mind-gen-2 --actor coordinator-1",
    ],
    handler: mindRotateCommand,
  },
  {
    name: "smart-task:plan",
    aliases: ["task:synthesize"],
    domain: "mind",
    summary: "Autonomously synthesize self-evolution tasks or plan from feedback queue.",
    description:
      "Smart task planner: prioritizes feedback intake, or synthesizes autonomic self-evolution tasks on empty queue.",
    flags: [
      optionalFlag("capsules-dir", "string", "Capsules root directory."),
      optionalFlag("max-tasks", "int", "Maximum tasks to generate (default: 5)."),
      optionalFlag("goal", "string", "Charter goal ID to bind."),
    ],
    readsStdin: false,
    takesRemainder: false,
    exitCodes: DEFAULT_EXIT_CODES,
    examples: ["bun harness.ts smart-task:plan", "bun harness.ts smart-task:plan --max-tasks 3"],
    handler: smartTaskSynthesizeCommand,
  },
  {
    name: "smart-task:ingest",
    aliases: ["smart-task:expand"],
    domain: "mind",
    summary: "Ingest and enhance an external prompt into a gate-verifiable task plan.",
    description:
      "Expands an external prompt into a structured task with write scope and mandatory gate.",
    flags: [
      requiredFlag("prompt", "string", "External prompt or task description."),
      optionalFlag("id", "string", "Custom task ID."),
      optionalFlag("goal", "string", "Charter goal ID to bind."),
    ],
    readsStdin: false,
    takesRemainder: false,
    exitCodes: DEFAULT_EXIT_CODES,
    examples: [
      "bun harness.ts smart-task:ingest --prompt 'Implement real-time metrics telemetry' --id task-metrics",
    ],
    handler: smartTaskIngestCommand,
  },
  {
    name: "mind:queue:list",
    aliases: ["todo:list", "feedback:list"],
    domain: "mind",
    summary: "List and inspect mind feedback queue items.",
    description:
      "Lists active feedback items from the canonical feedback queue (.olt/backlog.jsonl).",
    flags: [
      optionalFlag("status", "string", "Filter by item status."),
      optionalFlag("priority", "string", "Filter by priority level."),
      optionalFlag("category", "string", "Filter by category."),
      optionalFlag("queue-file", "string", "Override queue file path."),
      optionalFlag("queue-path", "string", "Alias for --queue-file."),
      optionalFlag("all", "bool", "Show all items without pagination."),
      optionalFlag("limit", "int", "Maximum items to display."),
      optionalFlag("json", "bool", "Output JSON."),
    ],
    readsStdin: false,
    takesRemainder: false,
    exitCodes: DEFAULT_EXIT_CODES,
    examples: [
      "bun harness.ts mind:queue:list",
      "bun harness.ts todo:list",
      "bun harness.ts feedback:list",
    ],
    handler: mindQueueListCommand,
  },
  {
    name: "mind:queue:add",
    aliases: ["todo:add", "feedback:ingest", "feedback:add"],
    domain: "mind",
    summary: "Add a feedback item to the mind queue.",
    description: "Appends a new feedback item to .olt/backlog.jsonl.",
    flags: [
      requiredFlag("title", "string", "Title of the feedback item."),
      optionalFlag("content", "string", "Content or body of the feedback item."),
      optionalFlag("description", "string", "Detailed description of the feedback."),
      optionalFlag("priority", "string", "Priority level: CRITICAL, HIGH, NORMAL, LOW."),
      optionalFlag("category", "string", "Feedback category."),
      optionalFlag("id", "string", "Explicit item ID override."),
      optionalFlag("queue-file", "string", "Override queue file path."),
      optionalFlag("queue-path", "string", "Alias for --queue-file."),
      optionalFlag("json", "bool", "Output JSON."),
    ],
    readsStdin: false,
    takesRemainder: false,
    exitCodes: DEFAULT_EXIT_CODES,
    examples: ["bun harness.ts mind:queue:add --title 'Fix memory leak' --priority HIGH"],
    handler: mindQueueAddCommand,
  },
  {
    name: "mind:queue:drain",
    aliases: ["todo:drain", "feedback:drain"],
    domain: "mind",
    summary: "Drain and mark pending feedback items for execution.",
    description: "Drains pending items from .olt/backlog.jsonl in FIFO order.",
    flags: [
      optionalFlag("limit", "int", "Maximum items to drain.", 5),
      optionalFlag("mark-as", "string", "Target status: PROCESSED, IN_PROGRESS, ADMITTED."),
      optionalFlag("category", "string", "Filter by category."),
      optionalFlag("priority", "string", "Filter by priority level."),
      optionalFlag("queue-file", "string", "Override queue file path."),
      optionalFlag("queue-path", "string", "Alias for --queue-file."),
      optionalFlag("json", "bool", "Output JSON."),
    ],
    readsStdin: false,
    takesRemainder: false,
    exitCodes: DEFAULT_EXIT_CODES,
    examples: ["bun harness.ts mind:queue:drain", "bun harness.ts todo:drain --limit 3"],
    handler: mindQueueDrainCommand,
  },
  {
    name: "mind:queue:seal",
    aliases: ["todo:seal", "feedback:seal"],
    domain: "mind",
    summary: "Seal completed queue items with empirical verification proofs.",
    description: "Marks queue items completed and attaches proof records.",
    flags: [
      requiredFlag("id", "string", "Feedback item ID to seal."),
      optionalFlag("proof", "string", "Commit SHA or test receipt proving resolution."),
      optionalFlag("resolution", "string", "Resolution description."),
      optionalFlag("commit", "string", "Commit SHA proving resolution."),
      optionalFlag("test-path", "string", "Test file path proving resolution."),
      optionalFlag("assertions", "string", "Number of test assertions verified."),
      optionalFlag("runtime-ms", "string", "Execution duration in milliseconds."),
      optionalFlag("note", "string", "Resolution notes."),
      optionalFlag("summary", "string", "Summary of resolution."),
      optionalFlag("queue-file", "string", "Override queue file path."),
      optionalFlag("queue-path", "string", "Alias for --queue-file."),
      optionalFlag("json", "bool", "Output JSON."),
    ],
    readsStdin: false,
    takesRemainder: false,
    exitCodes: DEFAULT_EXIT_CODES,
    examples: ["bun harness.ts mind:queue:seal --id fb-123 --proof sha-abc"],
    handler: mindQueueSealCommand,
  },
  {
    name: "mind:queue:clean",
    aliases: ["todo:clean", "feedback:clean"],
    domain: "mind",
    summary: "Prune resolved items from queue into completed-tasks archive.",
    description: "Moves sealed items from .olt/backlog.jsonl to .olt/completed-tasks.jsonl.",
    flags: [
      optionalFlag("force", "bool", "Force clean all completed items."),
      optionalFlag("dry-run", "bool", "Simulate clean without mutating files."),
      optionalFlag("queue-file", "string", "Override queue file path."),
      optionalFlag("queue-path", "string", "Alias for --queue-file."),
      optionalFlag("archive-file", "string", "Override archive destination file."),
      optionalFlag("json", "bool", "Output JSON."),
    ],
    readsStdin: false,
    takesRemainder: false,
    exitCodes: DEFAULT_EXIT_CODES,
    examples: ["bun harness.ts mind:queue:clean", "bun harness.ts todo:clean"],
    handler: mindQueueCleanCommand,
  },
];
