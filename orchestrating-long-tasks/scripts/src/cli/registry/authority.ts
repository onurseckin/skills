import { authorityDecideCommand } from "../commands/authority-ops.ts";
import { roleCheatSheetCommand } from "../commands/role-cheat-sheet.ts";
import { watchdogStatusCommand } from "../commands/watchdog-ops.ts";
import { whoamiCommand } from "../commands/whoami.ts";
import { DEFAULT_EXIT_CODES, optionalFlag, requiredFlag, type CommandSpec } from "./types.ts";

export const AUTHORITY_COMMANDS: readonly CommandSpec[] = [
  {
    name: "authority:decide",
    aliases: [],
    domain: "authority",
    summary: "Grant or decline a needs_authority requirement.",
    description:
      "A requirement disposed needs_authority holds every task built on it non-executable until this is recorded. Granting makes it actionable; declining disposes it out_of_scope and cancels every dormant task that depends on it alone, refusing instead if that would invalidate an active or completed one. The decision is permanent: a second call with the same actor and rationale is idempotent, any other call against an already-decided requirement is refused.",
    flags: [
      requiredFlag("run", "string", "Capsule run root."),
      requiredFlag("requirement", "string", "Requirement id, currently disposed needs_authority."),
      requiredFlag("actor", "string", "Who is making the decision."),
      requiredFlag("decision", "string", "grant or decline."),
      requiredFlag("rationale", "string", "Why this decision is correct."),
    ],
    readsStdin: false,
    takesRemainder: false,
    exitCodes: DEFAULT_EXIT_CODES,
    examples: [
      'bun harness.ts authority:decide --run .capsules/<run-id> --requirement req-prod-deploy --actor coordinator --decision grant --rationale "Human approved the production deploy in the review thread"',
    ],
    handler: authorityDecideCommand,
  },
  {
    name: "whoami",
    aliases: [],
    domain: "authority",
    summary: "Inspect thread execution tier, PID, active agent, grants, and main-thread compliance.",
    description:
      "Inspects the calling thread's OS process ID, parent PID, execution tier, active agent ID, active role grants, and task leases. When executed on the interactive main thread, enforces the Main-Thread Restraint Guard advisory and logs structured blunder records for unauthorized direct implementations.",
    flags: [
      optionalFlag("run", "string", "Capsule run root to cross-reference active leases and grants."),
      optionalFlag("agent", "string", "Explicit agent id override to inspect."),
      optionalFlag("pid", "int", "Process ID override for testing."),
      optionalFlag("ppid", "int", "Parent Process ID override for testing."),
      optionalFlag("json", "bool", "Output JSON format."),
    ],
    readsStdin: false,
    takesRemainder: false,
    exitCodes: DEFAULT_EXIT_CODES,
    examples: [
      "bun harness.ts whoami",
      "bun harness.ts whoami --run .capsules/<run-id> --agent coordinator-lead",
    ],
    handler: whoamiCommand,
  },
  {
    name: "role:cheat-sheet",
    aliases: ["role:contract", "role:cheat"],
    domain: "authority",
    summary: "Display compact terminal cheat sheets and command matrices for system roles.",
    description:
      "Renders ASCII tables and formatted markdown cheat sheets detailing tier, granted commands, forbidden actions, spawn rights, and architectural invariants.",
    flags: [
      optionalFlag("role", "string", "Specific role name to inspect."),
      optionalFlag("roles-dir", "string", "Override roles directory path."),
      optionalFlag("all", "bool", "Render full cheat sheets for all available roles."),
      optionalFlag("compact", "bool", "Render compact summary format."),
      optionalFlag("json", "bool", "Output JSON."),
    ],
    readsStdin: false,
    takesRemainder: false,
    exitCodes: DEFAULT_EXIT_CODES,
    examples: [
      "bun harness.ts role:cheat-sheet",
      "bun harness.ts role:cheat-sheet --role implementer",
      "bun harness.ts role:cheat-sheet --all",
    ],
    handler: roleCheatSheetCommand,
  },
  {
    name: "watchdog:status",
    aliases: ["watchdog:list"],
    domain: "authority",
    summary: "Query watchdog lifecycle, monitor cadence, and health status.",
    description:
      "Inspects background watchdog monitors across runs and generations, reporting active, stale, terminated, and orphaned monitors.",
    flags: [
      optionalFlag("run", "string", "Capsule run root."),
      optionalFlag("capsules-dir", "string", "Capsules root directory."),
      optionalFlag("generation", "int", "Filter by mind generation."),
      optionalFlag("filter-status", "string", "Filter by status: active, stale, terminated, orphaned, all."),
      optionalFlag("max-age-ms", "int", "Maximum age in milliseconds."),
      optionalFlag("dry-run", "bool", "Simulate cleanup without disk mutation."),
      optionalFlag("all", "bool", "Show all watchdog monitors."),
      optionalFlag("now", "string", "Timestamp override (ISO8601)."),
      optionalFlag("json", "bool", "Output JSON."),
    ],
    readsStdin: false,
    takesRemainder: false,
    exitCodes: DEFAULT_EXIT_CODES,
    examples: [
      "bun harness.ts watchdog:status",
      "bun harness.ts watchdog:status --generation 1 --filter-status active",
    ],
    handler: watchdogStatusCommand,
  },
];
