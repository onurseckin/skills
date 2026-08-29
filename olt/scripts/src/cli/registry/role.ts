import {
  roleCheatSheetCommand,
  roleListCommand,
  roleProfileCommand,
} from "../commands/role-ops.ts";
import { DEFAULT_EXIT_CODES, optionalFlag, type CommandSpec } from "./types.ts";

export const ROLE_COMMANDS: readonly CommandSpec[] = [
  {
    name: "role:list",
    aliases: [],
    domain: "role",
    summary: "List available system roles.",
    description: "Queries and lists all available agent roles from the agents/ directory.",
    flags: [
      optionalFlag("roles-dir", "string", "Override roles directory path."),
      optionalFlag("dir", "string", "Alias for roles-dir."),
    ],
    readsStdin: false,
    takesRemainder: false,
    exitCodes: DEFAULT_EXIT_CODES,
    examples: ["bun harness.ts role:list"],
    handler: roleListCommand,
  },
  {
    name: "role:profile",
    aliases: [],
    domain: "role",
    summary: "Resolve agent model profile binding.",
    description:
      "Resolves profile tier, model bindings, and host support capabilities for an agent role.",
    flags: [
      optionalFlag("role", "string", "Role name to resolve."),
      optionalFlag("profile", "string", "Abstract profile name."),
      optionalFlag("host", "string", "Target host platform identifier."),
    ],
    readsStdin: false,
    takesRemainder: false,
    exitCodes: DEFAULT_EXIT_CODES,
    examples: ["bun harness.ts role:profile --role implementer"],
    handler: roleProfileCommand,
  },
  {
    name: "role:cheat-sheet",
    aliases: [],
    domain: "role",
    summary: "Display compact terminal cheat sheets and command matrices for system roles.",
    description:
      "Renders ASCII tables and formatted markdown cheat sheets detailing tier, granted commands, forbidden actions, spawn rights, and architectural invariants.",
    flags: [
      optionalFlag("role", "string", "Specific role name to inspect."),
      optionalFlag("roles-dir", "string", "Override roles directory path."),
      optionalFlag("all", "bool", "Render full cheat sheets for all available roles."),
      optionalFlag("compact", "bool", "Render compact summary format."),
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
];
