import { shellCommand } from "../commands/shell.ts";
import { scopeExpandCommand } from "../commands/scope-expand.ts";
import {
  DEFAULT_EXIT_CODES,
  optionalFlag,
  requiredFlag,
  type CommandSpec,
  type ExitCodeSpec,
} from "./types.ts";

const SHELL_EXIT_CODES: readonly ExitCodeSpec[] = [
  { code: 0, meaning: "SUCCESS - the command executed under RBAC policy" },
  {
    code: 70,
    meaning: "POLICY_VIOLATION / PERMISSION_DENIED / INVALID_SCOPE - command blocked by RBAC",
  },
  ...DEFAULT_EXIT_CODES.slice(1),
];

export const SHELL_COMMANDS: readonly CommandSpec[] = [
  {
    name: "shell",
    aliases: ["sh", "exec:safe"],
    domain: "run",
    summary:
      "Execute direct non-interactive CLI commands under mechanical RBAC policy with signed evidence.",
    description:
      "Validates actor role capabilities against repository policy (blocking un-targeted whole-suite runs and cognitive validator commands) and emits cryptographic receipts into evidence/ and telemetry.",
    flags: [
      requiredFlag("actor", "string", "Who is executing the command."),
      optionalFlag("run", "string", "Capsule run root (optional if running standalone)."),
      optionalFlag("run-id", "string", "Alias for --run."),
      optionalFlag("task", "string", "Task id this command belongs to."),
      optionalFlag("gate", "string", "Gate id proven by this command."),
      optionalFlag("cwd", "string", "Working directory for the execution."),
      optionalFlag(
        "role",
        "string",
        "Explicit role override if actor metadata is not initialized on disk.",
      ),
    ],
    readsStdin: false,
    takesRemainder: true,
    exitCodes: SHELL_EXIT_CODES,
    examples: [
      "bun harness.ts shell --actor imp-1 -- bun test tests/unit/auth.test.ts",
      "bun harness.ts shell --actor val-1 -- git status",
      "bun harness.ts shell --actor imp-1 --run .capsules/<run-id> --task task-1 -- bun test tests/unit/parser.test.ts",
    ],
    handler: shellCommand,
  },
  {
    name: "scope:expand",
    aliases: ["scope-expand"],
    domain: "agent",
    summary: "Dynamically expand the declared read scope neighborhood for an active actor.",
    description:
      "Appends the specified target path or directory to the agent's allowed read scope manifest and logs the expansion.",
    flags: [
      requiredFlag("actor", "string", "Agent id whose read scope is being expanded."),
      requiredFlag("read", "string", "Target file or directory path to add to allowed read scope."),
      optionalFlag("run", "string", "Capsule run root."),
      optionalFlag("run-id", "string", "Alias for --run."),
    ],
    readsStdin: false,
    takesRemainder: false,
    exitCodes: DEFAULT_EXIT_CODES,
    examples: [
      "bun harness.ts scope:expand --actor imp-1 --read src/shared/types.ts",
      "bun harness.ts scope:expand --actor imp-1 --run .capsules/<run-id> --read src/policy/repo-policy.ts",
    ],
    handler: scopeExpandCommand,
  },
];
