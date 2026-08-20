import {
  doctorCommand,
  healthCommand,
  recoverCommand,
  repairProjectionCommand,
  taskReleaseCommand,
} from "../commands/diagnostics-ops.ts";
import {
  DEFAULT_EXIT_CODES,
  optionalFlag,
  repeatableFlag,
  requiredFlag,
  type CommandSpec,
} from "./types.ts";

export const DIAGNOSTICS_COMMANDS: readonly CommandSpec[] = [
  {
    name: "health",
    aliases: [],
    domain: "diagnostics",
    summary: "Check whether the code still does what the requirements said.",
    description:
      "Reports unused exports and unreachable modules, dead or superseded code, declared behaviour nothing enforces, requirements with no code or no test, literal fallbacks that substitute a plausible value for a missing one, and vendor names in identifier positions. Every check prints what it cannot see. Unlike `doctor` it reads a source tree, not a capsule.",
    flags: [
      optionalFlag(
        "scripts",
        "string",
        "Harness scripts root to inspect. Defaults to the running harness.",
      ),
      optionalFlag(
        "consumer",
        "string",
        "Consumer repository root. Without it the vendor-name sweep covers one repo, and says so.",
      ),
      repeatableFlag("check", "string", "Restrict the run to named checks."),
      optionalFlag(
        "all",
        "bool",
        "List every failure instead of the first five per check, and every advisory alongside them.",
      ),
      optionalFlag("strict", "bool", "Exit nonzero when the report is unhealthy."),
    ],
    readsStdin: false,
    takesRemainder: false,
    exitCodes: DEFAULT_EXIT_CODES,
    examples: [
      "bun harness.ts health",
      "bun harness.ts health --consumer ../gvui --all",
      "bun harness.ts health --check unused-code --strict",
    ],
    handler: healthCommand,
  },
  {
    name: "doctor",
    aliases: [],
    domain: "diagnostics",
    summary: "Verify capsule integrity, command evidence and the runtime.",
    description:
      "Re-hashes the event chain, re-verifies every recorded command, reports workflow blockers and, with --source and --home, the installation state.",
    flags: [
      requiredFlag("run", "string", "Capsule run root."),
      optionalFlag("source", "string", "Skill source directory for the installation check."),
      optionalFlag("home", "string", "Home directory for the installation check."),
      optionalFlag("clients", "string", "Comma-separated clients for the installation check."),
    ],
    readsStdin: false,
    takesRemainder: false,
    exitCodes: DEFAULT_EXIT_CODES,
    examples: ["bun harness.ts doctor --run .capsules/<run-id>"],
    handler: doctorCommand,
  },
  {
    name: "doctor:repair",
    aliases: [],
    domain: "diagnostics",
    summary: "Re-derive state.json from the event chain after a crash tears the log's tail.",
    description:
      "The repair counterpart to `doctor`: `doctor` only reports a torn tail or a state/event mismatch. This re-derives state.json from the event chain's last complete event, quarantining any torn final fragment under quarantine/ instead of discarding it, and records a projection-recovered event. Refuses if the manifest or prompt itself is corrupt - that is an integrity failure, not something to repair silently.",
    flags: [
      requiredFlag("run", "string", "Capsule run root."),
      requiredFlag(
        "actor",
        "string",
        "Who is running the repair. Recorded on the event; there is no default actor.",
      ),
    ],
    readsStdin: false,
    takesRemainder: false,
    exitCodes: DEFAULT_EXIT_CODES,
    examples: ["bun harness.ts doctor:repair --run .capsules/<run-id> --actor coordinator"],
    handler: repairProjectionCommand,
  },
  {
    name: "recover",
    aliases: [],
    domain: "diagnostics",
    summary: "Release expired leases and interrupted validations.",
    description:
      "Returns tasks whose lease expired to retry_ready (or changes_requested after a repair attempt), reopens interrupted validations, reclaims branch sub-tasks whose sub-agent died, and expires a stale completeness critic. A branched parent's frozen lease is never reaped: it is blocked on children, not gone.",
    flags: [
      requiredFlag("run", "string", "Capsule run root."),
      requiredFlag(
        "actor",
        "string",
        "Who is running the recovery. Recorded on the event; there is no default actor.",
      ),
      optionalFlag("grace-seconds", "int", "Grace period past expiry, 0-86400.", 30),
    ],
    readsStdin: false,
    takesRemainder: false,
    exitCodes: DEFAULT_EXIT_CODES,
    examples: ["bun harness.ts recover --run .capsules/<run-id> --actor coordinator"],
    handler: recoverCommand,
  },
  {
    name: "task:release",
    aliases: [],
    domain: "task",
    summary: "Hand a live lease back without waiting for it to expire.",
    description:
      "The voluntary counterpart to `recover`. Requires the live lease token; the task returns to retry_ready, or to changes_requested when the released attempt was a repair. A branched task cannot be released - collect or abandon the branch first.",
    flags: [
      requiredFlag("run", "string", "Capsule run root."),
      requiredFlag("task", "string", "Leased task id."),
      requiredFlag("agent", "string", "Agent holding the lease."),
      requiredFlag("token", "string", "Lease bearer token."),
    ],
    readsStdin: false,
    takesRemainder: false,
    exitCodes: DEFAULT_EXIT_CODES,
    examples: [
      "bun harness.ts task:release --run .capsules/<run-id> --task task-1 --agent worker-1 --token <token>",
    ],
    handler: taskReleaseCommand,
  },
];
