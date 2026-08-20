import { orchestratorRunCommand, orchestratorSuperviseCommand } from "../commands/orchestrator-ops.ts";
import { DEFAULT_EXIT_CODES, optionalFlag, requiredFlag, type CommandSpec } from "./types.ts";

export const ORCHESTRATOR_COMMANDS: readonly CommandSpec[] = [
  {
    name: "orchestrator:run",
    aliases: ["orchestrator"],
    domain: "orchestrator",
    summary: "Run the autonomous coordination loop over a fresh capsule.",
    description:
      "Drives plan, execute, validate and critic rounds until the critic approves or the round budget is spent. The host must inject a round executor; without one the command fails with INVALID_STATE.",
    flags: [
      optionalFlag("repo", "string", "Repository root; falls back to the current directory."),
      optionalFlag("prompt", "string", "Inline prompt text."),
      optionalFlag("prompt-file", "string", "File holding the prompt."),
      optionalFlag("prompt-stdin", "bool", "Read the prompt from stdin."),
      optionalFlag("run-id", "string", "Base run id for the generated capsules."),
      optionalFlag("run", "string", "Alias of --run-id."),
      optionalFlag("capsules-dir", "string", "Directory that holds the capsules."),
      optionalFlag("max-rounds", "int", "Round budget, clamped to 1-10.", 10),
      optionalFlag(
        "actor",
        "string",
        "Actor recorded on the loop summary; omitted leaves the loop unattributed.",
      ),
    ],
    readsStdin: true,
    takesRemainder: false,
    exitCodes: DEFAULT_EXIT_CODES,
    examples: [
      'bun harness.ts orchestrator:run --repo . --prompt "Implement the feature" --max-rounds 3',
    ],
    handler: orchestratorRunCommand,
  },
  {
    name: "orchestrator:supervise",
    aliases: [],
    domain: "orchestrator",
    summary: "Reclaim dead agents, escalate dead-end tasks, and dispatch what's ready (B28).",
    description:
      "One reclaim-classify-dispatch pass over a run's eligible set: reclaims leases whose agent died without submitting, escalates tasks whose failures have become deterministic (B28.3) instead of retrying them forever, and reports what is safe to dispatch now versus still backing off. With a host-injected dispatcher it loops until the run reaches a terminal state; without one it performs a single pass, which is what makes it safe to drive from an external poll loop. Recovery is on by default (B28.5) - use --no-recover to disable it.",
    flags: [
      requiredFlag("run", "string", "Capsule run root."),
      requiredFlag(
        "actor",
        "string",
        "Who is running the supervisor. Recorded on every event; there is no default actor.",
      ),
      optionalFlag("max-parallel", "int", "Occupancy ceiling; falls back to the run's configured default."),
      optionalFlag(
        "gate-max-parallel",
        "int",
        "B27.2: the separate, lower ceiling for gate-running (CPU-bound) work, reported alongside --max-parallel; falls back to the run's configured default (derived from host cores).",
      ),
      optionalFlag("no-recover", "bool", "Disable automatic dead-agent reclaim and escalation (on by default)."),
      optionalFlag("grace-seconds", "int", "Grace period past lease expiry before reclaiming, 0-86400."),
      optionalFlag("poll-interval-ms", "int", "How often to re-tick while a dispatcher is driving the loop."),
      optionalFlag("max-elapsed-ms", "int", "Per-task retry budget before a transient failure reads as deterministic (B28.3)."),
      optionalFlag("max-total-elapsed-ms", "int", "Whole-run wall-clock budget before the supervisor stops and reports."),
      optionalFlag("deterministic-repeat-threshold", "int", "Consecutive identical failures before they read as deterministic."),
    ],
    readsStdin: false,
    takesRemainder: false,
    exitCodes: DEFAULT_EXIT_CODES,
    examples: ["bun harness.ts orchestrator:supervise --run .capsules/<run-id> --actor coordinator"],
    handler: orchestratorSuperviseCommand,
  },
];
