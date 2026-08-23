import {
  queueListCommand,
  queueNextCommand,
  queuePopCommand,
  queueWaveCommand,
} from "../commands/queue.ts";
import { DEFAULT_EXIT_CODES, optionalFlag, requiredFlag, type CommandSpec } from "./types.ts";

export const QUEUE_COMMANDS: readonly CommandSpec[] = [
  {
    name: "queue:next",
    aliases: [],
    domain: "queue",
    summary: "Show the highest-priority ready task without claiming it.",
    description: "Reads the queue and reports the task a coordinator would dispatch next.",
    flags: [requiredFlag("run", "string", "Capsule run root.")],
    readsStdin: false,
    takesRemainder: false,
    exitCodes: DEFAULT_EXIT_CODES,
    examples: ["bun harness.ts queue:next --run .olt/capsules/<run-id>"],
    handler: queueNextCommand,
  },
  {
    name: "queue:list",
    aliases: [],
    domain: "queue",
    summary: "Partition every task by queue status.",
    description:
      "Groups tasks into ready, leased, validating, blocked and satisfied partitions with the blocking dependencies.",
    flags: [requiredFlag("run", "string", "Capsule run root.")],
    readsStdin: false,
    takesRemainder: false,
    exitCodes: DEFAULT_EXIT_CODES,
    examples: ["bun harness.ts queue:list --run .olt/capsules/<run-id>"],
    handler: queueListCommand,
  },
  {
    name: "queue:wave",
    aliases: [],
    domain: "queue",
    summary: "Show every task claimable right now, ranked by critical depth — for display only.",
    description:
      "The readiness query: runs the scheduler over live task state and returns every task whose dependencies are done and whose write scope collides with nothing currently leased, ranked by critical depth and capped at max_parallel. Annotates each task with the wave plan:compile recorded, or reports the topology as absent, purely for display. This is not a batch to assemble and dispatch as one unit — claim each entry the moment an agent is free, and re-run this (or claim atomically with queue:pop / task:claim) the instant any agent finishes; never wait for the rest of one call's answer before claiming the next task. Read-only: each dispatched agent still claims its own task.",
    flags: [
      requiredFlag("run", "string", "Capsule run root."),
      optionalFlag(
        "max-parallel",
        "int",
        "Occupancy ceiling for this query; defaults to the configured default_max_parallel.",
      ),
    ],
    readsStdin: false,
    takesRemainder: false,
    exitCodes: DEFAULT_EXIT_CODES,
    examples: ["bun harness.ts queue:wave --run .olt/capsules/<run-id> --max-parallel 4"],
    handler: queueWaveCommand,
  },
  {
    name: "queue:pop",
    aliases: [],
    domain: "queue",
    summary: "Claim the highest-priority ready task and mint a lease token.",
    description:
      "Atomically leases the next ready task to an agent. Fails when no task is ready rather than waiting.",
    flags: [
      requiredFlag("run", "string", "Capsule run root."),
      requiredFlag("agent", "string", "Agent id receiving the lease."),
      optionalFlag("lease-duration", "int", "Lease length in seconds (5-86400)."),
      optionalFlag("lease-seconds", "int", "Alias of --lease-duration.", 1200),
    ],
    readsStdin: false,
    takesRemainder: false,
    exitCodes: DEFAULT_EXIT_CODES,
    examples: [
      "bun harness.ts queue:pop --run .olt/capsules/<run-id> --agent worker-1 --lease-seconds 1800",
    ],
    handler: queuePopCommand,
  },
];
