// @ts-nocheck

import { mindCmd, charterGoalFlag, candidateWriteScopeFlag, quiesceSourceFlag, auditAnswerFlag } from "./types.ts";
import { type CommandSpec, type FlagSpec, optionalFlag, requiredFlag } from "../index.ts";
import {
  memoryQueryCommand,
  mindAdmitCommand,
  mindDeclineCommand,
  mindAuditReportCommand,
  mindAuditStartCommand,
  mindAuditLiveCommand,
  mindCandidateCommand,
  mindEscalateCommand,
  mindHaltCommand,
  mindInitCommand,
  mindObserveCommand,
  mindPulseCommand,
  mindPulseOpenCommand,
  mindQuiesceCommand,
  mindRotateCommand,
  mindRoundCloseCommand,
  mindRoundOpenCommand,
  mindWakeCommand,
  smartTaskIngestCommand,
  smartTaskSynthesizeCommand,
} from "../../commands/index.ts";

export const MIND_COMMANDS_2: readonly CommandSpec[] = [
  mindCmd(
    "mind:quiesce",
    "Record a verified quiescent observation across all ten discovery sources.",
    "Records that all ten discovery sources were scanned and found clean with zero items, appending mind-quiesced.",
    [
      requiredFlag("run", "string", "The mind capsule root."),
      requiredFlag("actor", "string", "Acting agent."),
      quiesceSourceFlag,
    ],
    mindQuiesceCommand,
    [
      "bun harness.ts mind:quiesce --run .olt/capsules/mind-gen-1 --actor mind-1 --source intent-drift:cmd-1:0 --source unassigned-todos:cmd-2:0",
    ],
  ),
  mindCmd(
    "mind:escalate",
    "Record an escalation and append to escalation log.",
    "Records an escalation event in the hash chain and appends the escalation reason to escalation.md.",
    [
      requiredFlag("run", "string", "The mind capsule root."),
      requiredFlag("actor", "string", "Acting agent."),
      requiredFlag("reason", "string", "Reason for escalation."),
      optionalFlag("severity", "string", "Severity of escalation."),
    ],
    mindEscalateCommand,
    [
      'bun harness.ts mind:escalate --run .olt/capsules/mind-gen-1 --actor mind-1 --reason "budget exhausted unexpectedly"',
    ],
  ),
  mindCmd(
    "mind:halt",
    "Halt mind pulse execution and suppress successor arming.",
    "Halts the mind run, suppresses further autonomous pulse arming, records mind-halted, and updates last_pulse.json with next_wake_at set to null.",
    [
      requiredFlag("run", "string", "The mind capsule root."),
      requiredFlag("actor", "string", "Acting agent."),
      requiredFlag("reason", "string", "Reason for halting."),
    ],
    mindHaltCommand,
    [
      'bun harness.ts mind:halt --run .olt/capsules/mind-gen-1 --actor mind-1 --reason "critical safety check failure"',
    ],
  ),
  mindCmd(
    "mind:round-open",
    "Open a multi-pulse round for an objective.",
    "Opens a new execution round for an objective in Phase 4, linking the round to its target capsule and appending mind-round-opened.",
    [
      requiredFlag("run", "string", "The mind capsule root."),
      requiredFlag("actor", "string", "Acting agent."),
      requiredFlag("objective", "string", "Objective id."),
      optionalFlag("candidate", "string", "Candidate id."),
      requiredFlag("round", "int", "Round index."),
      optionalFlag("target-run", "string", "Chained-from capsule run id."),
    ],
    mindRoundOpenCommand,
    [
      "bun harness.ts mind:round-open --run .olt/capsules/mind-gen-1 --actor mind-1 --objective obj-1 --round 1",
    ],
  ),
  mindCmd(
    "mind:round-close",
    "Close a multi-pulse round for an objective.",
    "Closes an active execution round for an objective in Phase 4, recording successor objective or terminal reason, appending mind-round-closed.",
    [
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
    mindRoundCloseCommand,
    [
      'bun harness.ts mind:round-close --run .olt/capsules/mind-gen-1 --actor mind-1 --objective obj-1 --round 1 --terminal-reason "objective completed"',
    ],
  ),
  mindCmd(
    "mind:audit-start",
    "Start an independent audit cycle over recent pulses.",
    "Initiates an independent audit cycle in Phase 5, recording window start time and auditor identity, appending mind-audit-started.",
    [
      requiredFlag("run", "string", "The mind capsule root."),
      requiredFlag("actor", "string", "Auditor agent id."),
      requiredFlag("audit-id", "string", "Audit id."),
      requiredFlag("window-start", "string", "Window start timestamp (ISO8601)."),
    ],
    mindAuditStartCommand,
    [
      "bun harness.ts mind:audit-start --run .olt/capsules/mind-gen-1 --actor auditor-1 --audit-id audit-1 --window-start 2026-08-21T00:00:00Z",
    ],
  ),
  mindCmd(
    "mind:audit-report",
    "Submit findings and verdict for an audit cycle.",
    "Records the eight audit answers with supporting command ids and overall verdict in Phase 5, appending mind-audit-reported.",
    [
      requiredFlag("run", "string", "The mind capsule root."),
      requiredFlag("actor", "string", "Auditor agent id."),
      requiredFlag("audit-id", "string", "Audit id."),
      requiredFlag("verdict", "string", "Audit verdict: approved or failed."),
      auditAnswerFlag,
    ],
    mindAuditReportCommand,
    [
      "bun harness.ts mind:audit-report --run .olt/capsules/mind-gen-1 --actor auditor-1 --audit-id audit-1 --verdict approved --answer Q1:cmd-10:pass",
    ],
  ),
  mindCmd(
    "mind:rotate",
    "Rotate generation N capsule into generation N+1.",
    "Performs generational rotation, carrying forward charter pin and declined candidates while preserving auditability.",
    [
      requiredFlag("run", "string", "The current generation capsule root."),
      requiredFlag("next-run", "string", "The next generation capsule root."),
      requiredFlag("actor", "string", "Acting agent id."),
    ],
    mindRotateCommand,
    [
      "bun harness.ts mind:rotate --run .olt/capsules/mind-gen-1 --next-run .olt/capsules/mind-gen-2 --actor coordinator-1",
    ],
  ),
  mindCmd(
    "smart-task:plan",
    "Autonomously synthesize self-evolution tasks or plan from feedback queue.",
    "Smart task planner: prioritizes feedback intake, or synthesizes autonomic self-evolution tasks on empty queue.",
    [
      optionalFlag("capsules-dir", "string", "Capsules root directory."),
      optionalFlag("max-tasks", "int", "Maximum tasks to generate (default: 5)."),
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
      requiredFlag("prompt", "string", "External prompt or task description."),
      optionalFlag("id", "string", "Custom task ID."),
      optionalFlag("goal", "string", "Charter goal ID to bind."),
    ],
    smartTaskIngestCommand,
    [
      "bun harness.ts smart-task:ingest --prompt 'Implement real-time metrics telemetry' --id task-metrics",
    ],
  ),
  mindCmd(
    "mind:audit:live",
    "Live Tier 0 out-of-band audit of mind liveness, stagnation, and Mode A/B injection.",
    "Evaluates idle duration against >120s stagnation threshold and builds verbatim role prompt.",
    [
      optionalFlag("repo", "string", "Repository root path."),
      optionalFlag("threshold", "int", "Stagnation threshold in seconds (default: 120).", 120),
      optionalFlag("conversation-id", "string", "Target conversation identifier."),
      optionalFlag("json", "bool", "Output structured JSON."),
    ],
    mindAuditLiveCommand,
    ["bun harness.ts mind:audit:live", "bun harness.ts mind:audit:live --threshold 60 --json"],
  ),
];
