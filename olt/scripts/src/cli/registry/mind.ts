import { memoryQueryCommand } from "../commands/memory-ops.ts";
import { mindAdmitCommand, mindDeclineCommand } from "../commands/mind-admit.ts";
import { mindAuditReportCommand, mindAuditStartCommand } from "../commands/mind-audit.ts";
import { mindAuditLiveCommand } from "../commands/mind-audit-live.ts";
import { mindCandidateCommand } from "../commands/mind-candidate.ts";
import { mindEscalateCommand } from "../commands/mind-escalate.ts";
import { mindHaltCommand } from "../commands/mind-halt.ts";
import { mindInitCommand } from "../commands/mind-init.ts";
import { mindObserveCommand } from "../commands/mind-observe.ts";
import { mindPulseCommand } from "../commands/mind-pulse.ts";
import { mindPulseOpenCommand } from "../commands/mind-pulse-open.ts";
import { mindQuiesceCommand } from "../commands/mind-quiesce.ts";
import { mindRotateCommand } from "../commands/mind-rotate.ts";
import { mindRoundCloseCommand, mindRoundOpenCommand } from "../commands/mind-round.ts";
import { mindWakeCommand } from "../commands/mind-wake.ts";
import { smartTaskIngestCommand, smartTaskSynthesizeCommand } from "../commands/smart-task-ops.ts";
import { DEFAULT_EXIT_CODES, optionalFlag, requiredFlag, type CommandHandler, type CommandSpec, type FlagSpec } from "./types.ts";

export {
  memoryQueryCommand, mindAdmitCommand, mindAuditLiveCommand, mindAuditReportCommand, mindAuditStartCommand,
  mindCandidateCommand, mindDeclineCommand, mindEscalateCommand, mindHaltCommand, mindInitCommand,
  mindObserveCommand, mindPulseCommand, mindPulseOpenCommand, mindQuiesceCommand, mindRotateCommand,
  mindRoundCloseCommand, mindRoundOpenCommand, mindWakeCommand, smartTaskIngestCommand, smartTaskSynthesizeCommand,
};

const charterGoalFlag: FlagSpec = { name: "charter-goal", type: "string", required: true, repeatable: true, description: "Goal ids from the pinned charter; repeat for multiple." };
const candidateWriteScopeFlag: FlagSpec = { name: "write-scope", type: "string", required: true, repeatable: true, description: "Paths the work would touch; repeat for multiple." };
const quiesceSourceFlag: FlagSpec = { name: "source", type: "string", required: true, repeatable: true, description: "Source scan result as <source>:<command-id>:<count>; repeat for each of the ten sources." };
const auditAnswerFlag: FlagSpec = { name: "answer", type: "string", required: true, repeatable: true, description: "One of eight audit question answers as <question-id>:<command-id>:<verdict>; repeat for all eight." };

function mindCmd(name: string, summary: string, description: string, flags: readonly FlagSpec[], handler: CommandHandler, examples: readonly string[] = []): CommandSpec {
  return { name, aliases: [], domain: "mind", summary, description, flags, readsStdin: false, takesRemainder: false, exitCodes: DEFAULT_EXIT_CODES, examples, handler };
}

export const MIND_COMMANDS: readonly CommandSpec[] = [
  mindCmd(
    "memory:query",
    "Query indexed cross-run knowledge, decisions, and memory documents.",
    "Performs full-text retrieval and ranking across knowledge base, charter, findings, decisions, and past run summaries with zero external file reads required.",
    [
      optionalFlag("query", "string", "Search query terms."), optionalFlag("run", "string", "Filter by capsule run root."),
      optionalFlag("capsules-dir", "string", "Override capsules root directory."), optionalFlag("repo", "string", "Repository root path."),
      optionalFlag("kind", "string", "Filter by document kind."), optionalFlag("limit", "int", "Maximum number of search results.", 10),
      optionalFlag("min-score", "string", "Minimum similarity/match score threshold."), optionalFlag("all", "bool", "Display all matching documents without truncation."),
      optionalFlag("now", "string", "Timestamp override (ISO8601)."),
    ],
    memoryQueryCommand,
    ['bun harness.ts memory:query --query "authentication refactor"'],
  ),
  mindCmd(
    "mind:init",
    "Initialize a mind capsule from an owner charter.",
    "Validates the markdown charter file per CONTRACTS.md §7, creates the mind capsule (mind-gen-<generation>), pins the charter digest into manifest.json, seeds the state projection, and writes the initial last_pulse.json.",
    [
      requiredFlag("repo", "string", "Repository root the mind serves."), requiredFlag("charter", "string", "Path to the owner's charter file."),
      requiredFlag("actor", "string", "Recorded on mind-initialized."), optionalFlag("mind-id", "string", "Mind capsule run id; defaults to mind-gen-1.", "mind-gen-1"),
      optionalFlag("capsules-dir", "string", "Override .olt/capsules/ directory location."),
    ],
    mindInitCommand,
    ["bun harness.ts mind:init --repo . --charter olt/agents/mind.yaml --actor owner"],
  ),
  mindCmd(
    "mind:wake",
    "Produce the Tier A orientation brief and reclaim expired pulses.",
    "Inspects the mind capsule state and budget, reclaims any open pulse past its deadline via mind-pulse-reclaimed, and outputs the Tier A orientation brief ending in prescribed next actions.",
    [
      requiredFlag("run", "string", "The mind capsule root."), optionalFlag("actor", "string", "Recorded only if the call reclaims a dead pulse."),
      optionalFlag("depth", "string", "Orientation depth: brief (default) or run.", "brief"), optionalFlag("target-run", "string", "With --depth run, the run capsule whose handoff to render."),
    ],
    mindWakeCommand,
    ["bun harness.ts mind:wake --run .olt/capsules/mind-gen-1"],
  ),
  mindCmd(
    "mind:pulse-open",
    "Open an active mind pulse under budget constraints.",
    "Opens a new pulse cycle, validating budget headroom, daily pulse and wall-clock caps, quiet hours, and charter digest consistency before appending mind-pulse-opened.",
    [
      requiredFlag("run", "string", "The mind capsule root."), requiredFlag("actor", "string", "The tier-0 agent id."),
      requiredFlag("host", "string", "Host runtime as reported."), requiredFlag("driver", "string", "Driver identity as reported."),
    ],
    mindPulseOpenCommand,
    ["bun harness.ts mind:pulse-open --run .olt/capsules/mind-gen-1 --actor mind-1 --host antigravity --driver bash-loop"],
  ),
  mindCmd(
    "mind:pulse",
    "Unified perpetual mind pulse: report active telemetry or open a new pulse.",
    "Unified perpetual mind pulse command. If a pulse is open, outputs active pulse telemetry and next scheduled interval. If no pulse is open, automatically opens a new perpetual pulse. Enforces CLOSING_FORBIDDEN_FOR_MIND invariant.",
    [
      requiredFlag("run", "string", "The mind capsule root."), optionalFlag("actor", "string", "The acting agent id.", "mind-1"),
      optionalFlag("host", "string", "Host runtime as reported.", "antigravity"), optionalFlag("driver", "string", "Driver identity as reported.", "perpetual-loop"),
      optionalFlag("arm", "string", "Scheduled duration for the next interval, e.g. 15m."), optionalFlag("arm-mechanism", "string", "How the pulse was armed, as reported."),
      optionalFlag("now", "string", "Timestamp override (ISO8601)."),
    ],
    mindPulseCommand,
    ["bun harness.ts mind:pulse --run .olt/capsules/mind-gen-1 --actor mind-1"],
  ),
  mindCmd(
    "mind:observe",
    "Record a discovery source scan count evidenced by a command record.",
    "Records an observation from one of the ten discovery sources evidenced by a recorded command id, appending mind-observed.",
    [
      requiredFlag("run", "string", "The mind capsule root."), requiredFlag("actor", "string", "Acting agent."),
      requiredFlag("source", "string", "One of the ten source ids in PLAN.md §7.2."), requiredFlag("command-id", "string", "The recorded command whose output this is."),
      requiredFlag("count", "int", "How many items that source returned."),
    ],
    mindObserveCommand,
    ["bun harness.ts mind:observe --run .olt/capsules/mind-gen-1 --actor mind-1 --source intent-drift --command-id cmd-41 --count 0"],
  ),
  mindCmd(
    "mind:candidate",
    "Record a discovery candidate (defect or proposal).",
    "Proposes a defect or proposal candidate. Defects require a witness command record and falsifier argv. Validates charter goal alignment and write scope before recording mind-candidate-opened.",
    [
      requiredFlag("run", "string", "The mind capsule root."), requiredFlag("actor", "string", "Acting agent."),
      requiredFlag("kind", "string", "Candidate kind: defect or proposal."), requiredFlag("statement", "string", "One line statement, recorded agent_reported."),
      optionalFlag("witness", "string", "Command id evidencing the defect; required unless --kind proposal."), charterGoalFlag,
      optionalFlag("falsifier", "string", "Argv that fails now and would pass if fixed (defects only)."), candidateWriteScopeFlag,
      optionalFlag("rationale", "string", "Proposals only."),
    ],
    mindCandidateCommand,
    ['bun harness.ts mind:candidate --run .olt/capsules/mind-gen-1 --actor mind-1 --kind defect --statement "typecheck fails" --witness cmd-123 --charter-goal G1 --falsifier "bun run typecheck" --write-scope olt/scripts/src/health/'],
  ),
  mindCmd(
    "mind:admit",
    "Run admission gates on a candidate and admit it.",
    "Runs the six admission gates (falsifier verification, scope disjointness, charter alignment, etc.) in order and admits the candidate, appending mind-candidate-admitted.",
    [requiredFlag("run", "string", "The mind capsule root."), requiredFlag("actor", "string", "Acting agent."), requiredFlag("candidate", "string", "Candidate id.")],
    mindAdmitCommand,
    ["bun harness.ts mind:admit --run .olt/capsules/mind-gen-1 --actor mind-1 --candidate cand-12"],
  ),
  mindCmd(
    "mind:decline",
    "Permanently decline a candidate with a recorded reason.",
    "Marks a candidate permanently declined with a recorded reason and gate failure attribution, appending mind-candidate-declined.",
    [
      requiredFlag("run", "string", "The mind capsule root."), requiredFlag("actor", "string", "Acting agent."),
      requiredFlag("candidate", "string", "Candidate id."), requiredFlag("reason", "string", "Reason why candidate was declined."),
    ],
    mindDeclineCommand,
    ['bun harness.ts mind:decline --run .olt/capsules/mind-gen-1 --actor mind-1 --candidate cand-12 --reason "scope overlaps active lease"'],
  ),
  mindCmd(
    "mind:quiesce",
    "Record a verified quiescent observation across all ten discovery sources.",
    "Records that all ten discovery sources were scanned and found clean with zero items, appending mind-quiesced.",
    [requiredFlag("run", "string", "The mind capsule root."), requiredFlag("actor", "string", "Acting agent."), quiesceSourceFlag],
    mindQuiesceCommand,
    ["bun harness.ts mind:quiesce --run .olt/capsules/mind-gen-1 --actor mind-1 --source intent-drift:cmd-1:0 --source unassigned-todos:cmd-2:0"],
  ),
  mindCmd(
    "mind:escalate",
    "Record an escalation and append to escalation log.",
    "Records an escalation event in the hash chain and appends the escalation reason to escalation.md.",
    [
      requiredFlag("run", "string", "The mind capsule root."), requiredFlag("actor", "string", "Acting agent."),
      requiredFlag("reason", "string", "Reason for escalation."), optionalFlag("severity", "string", "Severity of escalation."),
    ],
    mindEscalateCommand,
    ['bun harness.ts mind:escalate --run .olt/capsules/mind-gen-1 --actor mind-1 --reason "budget exhausted unexpectedly"'],
  ),
  mindCmd(
    "mind:halt",
    "Halt mind pulse execution and suppress successor arming.",
    "Halts the mind run, suppresses further autonomous pulse arming, records mind-halted, and updates last_pulse.json with next_wake_at set to null.",
    [requiredFlag("run", "string", "The mind capsule root."), requiredFlag("actor", "string", "Acting agent."), requiredFlag("reason", "string", "Reason for halting.")],
    mindHaltCommand,
    ['bun harness.ts mind:halt --run .olt/capsules/mind-gen-1 --actor mind-1 --reason "critical safety check failure"'],
  ),
  mindCmd(
    "mind:round-open",
    "Open a multi-pulse round for an objective.",
    "Opens a new execution round for an objective in Phase 4, linking the round to its target capsule and appending mind-round-opened.",
    [
      requiredFlag("run", "string", "The mind capsule root."), requiredFlag("actor", "string", "Acting agent."),
      requiredFlag("objective", "string", "Objective id."), optionalFlag("candidate", "string", "Candidate id."),
      requiredFlag("round", "int", "Round index."), optionalFlag("target-run", "string", "Chained-from capsule run id."),
    ],
    mindRoundOpenCommand,
    ["bun harness.ts mind:round-open --run .olt/capsules/mind-gen-1 --actor mind-1 --objective obj-1 --round 1"],
  ),
  mindCmd(
    "mind:round-close",
    "Close a multi-pulse round for an objective.",
    "Closes an active execution round for an objective in Phase 4, recording successor objective or terminal reason, appending mind-round-closed.",
    [
      requiredFlag("run", "string", "The mind capsule root."), requiredFlag("actor", "string", "Acting agent."),
      requiredFlag("objective", "string", "Objective id."), requiredFlag("round", "int", "Round index."),
      optionalFlag("result", "string", "Round result (converged | exhausted | escalated).", "converged"), optionalFlag("terminal-reason", "string", "Reason if round terminates without successor."),
      optionalFlag("successor-run", "string", "Successor capsule run id."),
    ],
    mindRoundCloseCommand,
    ['bun harness.ts mind:round-close --run .olt/capsules/mind-gen-1 --actor mind-1 --objective obj-1 --round 1 --terminal-reason "objective completed"'],
  ),
  mindCmd(
    "mind:audit-start",
    "Start an independent audit cycle over recent pulses.",
    "Initiates an independent audit cycle in Phase 5, recording window start time and auditor identity, appending mind-audit-started.",
    [
      requiredFlag("run", "string", "The mind capsule root."), requiredFlag("actor", "string", "Auditor agent id."),
      requiredFlag("audit-id", "string", "Audit id."), requiredFlag("window-start", "string", "Window start timestamp (ISO8601)."),
    ],
    mindAuditStartCommand,
    ["bun harness.ts mind:audit-start --run .olt/capsules/mind-gen-1 --actor auditor-1 --audit-id audit-1 --window-start 2026-08-21T00:00:00Z"],
  ),
  mindCmd(
    "mind:audit-report",
    "Submit findings and verdict for an audit cycle.",
    "Records the eight audit answers with supporting command ids and overall verdict in Phase 5, appending mind-audit-reported.",
    [
      requiredFlag("run", "string", "The mind capsule root."), requiredFlag("actor", "string", "Auditor agent id."),
      requiredFlag("audit-id", "string", "Audit id."), requiredFlag("verdict", "string", "Audit verdict: approved or failed."),
      auditAnswerFlag,
    ],
    mindAuditReportCommand,
    ["bun harness.ts mind:audit-report --run .olt/capsules/mind-gen-1 --actor auditor-1 --audit-id audit-1 --verdict approved --answer Q1:cmd-10:pass"],
  ),
  mindCmd(
    "mind:rotate",
    "Rotate generation N capsule into generation N+1.",
    "Performs generational rotation, carrying forward charter pin and declined candidates while preserving auditability.",
    [
      requiredFlag("run", "string", "The current generation capsule root."), requiredFlag("next-run", "string", "The next generation capsule root."),
      requiredFlag("actor", "string", "Acting agent id."),
    ],
    mindRotateCommand,
    ["bun harness.ts mind:rotate --run .olt/capsules/mind-gen-1 --next-run .olt/capsules/mind-gen-2 --actor coordinator-1"],
  ),
  mindCmd(
    "smart-task:plan",
    "Autonomously synthesize self-evolution tasks or plan from feedback queue.",
    "Smart task planner: prioritizes feedback intake, or synthesizes autonomic self-evolution tasks on empty queue.",
    [
      optionalFlag("capsules-dir", "string", "Capsules root directory."), optionalFlag("max-tasks", "int", "Maximum tasks to generate (default: 5)."),
      optionalFlag("goal", "string", "Charter goal ID to bind."),
    ],
    smartTaskSynthesizeCommand,
    ["bun harness.ts smart-task:plan", "bun harness.ts smart-task:plan --max-tasks 3"],
  ),
  mindCmd(
    "smart-task:ingest",
    "Ingest and enhance an external prompt into a gate-verifiable task plan.",
    "Expands an external prompt into a structured task with write scope and mandatory gate.",
    [
      requiredFlag("prompt", "string", "External prompt or task description."), optionalFlag("id", "string", "Custom task ID."),
      optionalFlag("goal", "string", "Charter goal ID to bind."),
    ],
    smartTaskIngestCommand,
    ["bun harness.ts smart-task:ingest --prompt 'Implement real-time metrics telemetry' --id task-metrics"],
  ),
  mindCmd(
    "mind:audit:live",
    "Live Tier 0 out-of-band audit of mind liveness, stagnation, and Mode A/B injection.",
    "Evaluates idle duration against >120s stagnation threshold and builds verbatim role prompt.",
    [
      optionalFlag("repo", "string", "Repository root path."), optionalFlag("threshold", "int", "Stagnation threshold in seconds (default: 120).", 120),
      optionalFlag("conversation-id", "string", "Target conversation identifier."), optionalFlag("json", "bool", "Output structured JSON."),
    ],
    mindAuditLiveCommand,
    ["bun harness.ts mind:audit:live", "bun harness.ts mind:audit:live --threshold 60 --json"],
  ),
];
