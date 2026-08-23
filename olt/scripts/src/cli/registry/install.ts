import { installCommand, installationStatusCommand } from "../commands/install-ops.ts";
import { DEFAULT_EXIT_CODES, optionalFlag, requiredFlag, type CommandSpec } from "./types.ts";

export const INSTALL_COMMANDS: readonly CommandSpec[] = [
  {
    name: "install",
    aliases: [],
    domain: "install",
    summary: "Install the skill release and link it into the requested clients.",
    description:
      "Copies the validated source tree to <home>/.agents/skills and publishes a symlink per client, rolling the whole transaction back on failure.",
    flags: [
      requiredFlag("source", "string", "Skill source directory to install."),
      requiredFlag("home", "string", "Home directory that receives the release."),
      requiredFlag(
        "clients",
        "string",
        "Comma-separated clients: antigravity, claude, codex, chatgpt.",
      ),
    ],
    readsStdin: false,
    takesRemainder: false,
    exitCodes: DEFAULT_EXIT_CODES,
    examples: ["bun harness.ts install --source . --home ~ --clients claude,antigravity"],
    handler: installCommand,
  },
  {
    name: "installation-status",
    aliases: [],
    domain: "install",
    summary: "Audit the installed release, its digest and its client links.",
    description:
      "Compares the installed tree digest against the source, then checks every client symlink target.",
    flags: [
      requiredFlag("source", "string", "Skill source directory to compare against."),
      requiredFlag("home", "string", "Home directory holding the release."),
      optionalFlag(
        "clients",
        "string",
        "Comma-separated clients; defaults to the installed manifest.",
      ),
    ],
    readsStdin: false,
    takesRemainder: false,
    exitCodes: DEFAULT_EXIT_CODES,
    examples: ["bun harness.ts installation-status --source . --home ~"],
    handler: installationStatusCommand,
  },
];
