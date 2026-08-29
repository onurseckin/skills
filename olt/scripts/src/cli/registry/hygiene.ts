import { hygieneAuditCommand, hygieneFixCommand } from "../commands/hygiene-ops.ts";
import { DEFAULT_EXIT_CODES, optionalFlag, type CommandSpec } from "./types.ts";

export const HYGIENE_COMMANDS: readonly CommandSpec[] = [
  {
    name: "hygiene:audit",
    aliases: [],
    domain: "hygiene",
    summary: "Audit repository root hygiene invariants.",
    description:
      "Scans repo root, scripts/, and static olt/ directories for unapproved files, loose executables, and runtime pollution.",
    flags: [
      optionalFlag("repo-root", "string", "Repository root path."),
      optionalFlag("root", "string", "Alias for repo-root."),
      optionalFlag("fix", "bool", "Automatically quarantine detected violations."),
      optionalFlag("quarantine-dir", "string", "Destination directory for quarantined files."),
    ],
    readsStdin: false,
    takesRemainder: false,
    exitCodes: DEFAULT_EXIT_CODES,
    examples: ["bun harness.ts hygiene:audit"],
    handler: hygieneAuditCommand,
  },
  {
    name: "hygiene:fix",
    aliases: [],
    domain: "hygiene",
    summary: "Quarantine repository root hygiene violations.",
    description:
      "Scans repository root and automatically quarantines unconfined scratch scripts and loose files.",
    flags: [
      optionalFlag("repo-root", "string", "Repository root path."),
      optionalFlag("root", "string", "Alias for repo-root."),
      optionalFlag("quarantine-dir", "string", "Destination directory for quarantined files."),
    ],
    readsStdin: false,
    takesRemainder: false,
    exitCodes: DEFAULT_EXIT_CODES,
    examples: ["bun harness.ts hygiene:fix"],
    handler: hygieneFixCommand,
  },
];
