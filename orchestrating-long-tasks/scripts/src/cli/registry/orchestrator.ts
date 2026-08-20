import { orchestratorRunCommand } from "../commands/orchestrator-ops.ts";
import { DEFAULT_EXIT_CODES, optionalFlag, type CommandSpec } from "./types.ts";

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
];
