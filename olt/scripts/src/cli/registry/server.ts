/**
 * CLI Command Registry for Dev Server Lifecycle & Port Conflict Guard.
 *
 * Registers server:status, server:restart, and server:clean into the CLI dispatch table.
 */

import {
  serverCleanCommand,
  serverRestartCommand,
  serverStatusCommand,
} from "../commands/server-ops.ts";
import {
  DEFAULT_EXIT_CODES,
  optionalFlag,
  type CommandSpec,
} from "./types.ts";

export const SERVER_COMMANDS: readonly CommandSpec[] = [
  {
    name: "server:status",
    aliases: ["status:server"],
    domain: "diagnostics",
    summary: "Inspect dev server port occupancy, socket bindings, bound processes, and Docker container conflicts.",
    description:
      "Performs non-blocking TCP port probing, socket availability checks, process PID tree inspection, and Docker collision detection across configured or standard dev server ports.",
    flags: [
      optionalFlag("port", "int", "Target port to probe (1-65535)."),
      optionalFlag("all", "bool", "Scan all standard dev server ports (3000, 3001, 4000, 5000, 5173, 8000, 8080, 8888, 9000, 9229)."),
      optionalFlag("host", "string", "Target host address to probe (default: 127.0.0.1)."),
      optionalFlag("format", "string", "Output format: 'json' or 'markdown' (default)."),
    ],
    readsStdin: false,
    takesRemainder: false,
    exitCodes: DEFAULT_EXIT_CODES,
    examples: [
      "bun harness.ts server:status --port 3000",
      "bun harness.ts server:status --all",
      "bun harness.ts server:status --port 5173 --format json",
    ],
    handler: serverStatusCommand,
  },
  {
    name: "server:restart",
    aliases: ["restart:server"],
    domain: "run",
    summary: "Atomically restart a dev server instance with state snapshot preservation and automatic rollback.",
    description:
      "Acquires an atomic restart lock, preserves the running server state snapshot (endpoints, env, PIDs, ports), gracefully terminates the old process, starts the new server instance, and rolls back on failure.",
    flags: [
      optionalFlag("port", "int", "Dev server port to restart (default: 3000)."),
      optionalFlag("force", "bool", "Force kill lingering processes immediately with SIGKILL."),
      optionalFlag("dry-run", "bool", "Simulate atomic restart without signaling processes."),
      optionalFlag("command", "string", "Server start command to execute (e.g. 'bun run dev')."),
      optionalFlag("grace-period-ms", "int", "Grace period in milliseconds before escalating to SIGKILL."),
      optionalFlag("timeout", "int", "Atomic restart lock timeout in milliseconds (default: 10000)."),
      optionalFlag("format", "string", "Output format: 'json' or 'markdown' (default)."),
    ],
    readsStdin: false,
    takesRemainder: false,
    exitCodes: DEFAULT_EXIT_CODES,
    examples: [
      "bun harness.ts server:restart --port 3000",
      "bun harness.ts server:restart --port 3000 --force",
      "bun harness.ts server:restart --port 3000 --dry-run",
      "bun harness.ts server:restart --port 5173 --format json",
    ],
    handler: serverRestartCommand,
  },
  {
    name: "server:clean",
    aliases: ["clean:server", "clean:ports"],
    domain: "run",
    summary: "Safely reclaim occupied dev ports and terminate zombie or orphaned runtime processes.",
    description:
      "Inspects PIDs on target dev ports and executes safe process termination with graceful SIGTERM escalation and SIGKILL fallback, or cleans zombie Node/Bun processes.",
    flags: [
      optionalFlag("port", "int", "Target port to reclaim (1-65535)."),
      optionalFlag("all", "bool", "Reclaim all occupied standard dev server ports."),
      optionalFlag("force", "bool", "Immediately send SIGKILL to terminate processes without grace period."),
      optionalFlag("dry-run", "bool", "Simulate process reclamation without sending OS termination signals."),
      optionalFlag("zombies-only", "bool", "Only terminate detected zombie and orphaned runtime processes."),
      optionalFlag("grace-period-ms", "int", "Grace period in milliseconds for SIGTERM before SIGKILL (default: 1000)."),
      optionalFlag("format", "string", "Output format: 'json' or 'markdown' (default)."),
    ],
    readsStdin: false,
    takesRemainder: false,
    exitCodes: DEFAULT_EXIT_CODES,
    examples: [
      "bun harness.ts server:clean --port 3000",
      "bun harness.ts server:clean --all --force",
      "bun harness.ts server:clean --all --dry-run",
      "bun harness.ts server:clean --port 8080 --format json",
    ],
    handler: serverCleanCommand,
  },
];
